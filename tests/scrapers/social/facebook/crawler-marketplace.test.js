// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler, DEFAULT_FB_DOC_IDS } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { PrismaClient } from '@prisma/client';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';

/**
 * Story 13.8: Facebook Hybrid Marketplace (Search, Categories & Item Details)
 * Acceptance Tests (ATDD Red Phase)
 */

describe('Story 13.8 — Facebook Hybrid Marketplace', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  const prisma = new PrismaClient();
  const store = new PrismaStore({ prisma });
  let sessionManager;
  let proxyPool;
  let governor;
  let accountPool;

  const marketplaceDocIds = {
    MARKETPLACE_SEARCH: 'fb_marketplace_search_test_doc',
  };

  const makeListingNode = (id, title = 'MacBook Pro 14 M3', price = '$1,200', location = 'Ho Chi Minh City') => ({
    id,
    listing: {
      id,
      story: null,
      marketplace_listing_title: title,
      listing_price: {
        formatted_amount: price,
        amount: '1200',
        currency: 'USD',
        amount_in_hundredths: 120000,
      },
      location: {
        reverse_geocode: {
          city: location,
        },
      },
      primary_listing_photo: {
        image: {
          uri: `https://scontent.xx.fbcdn.net/m1/${id}.jpg`,
        },
      },
      seller: {
        id: `seller_${id}`,
        name: `Seller ${id}`,
      },
      creation_time: 1787680000,
    },
  });

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool, defaultRps: 100, maxRps: 100 });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_fb_1', {
      accountId: 'acc_fb_1',
      platform: 'facebook',
      cookies: { c_user: '61590064244856', xs: 'sec_xs_123' },
    });
    accountPool.registerAccounts('facebook', ['acc_fb_1']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_456"; });
                window.__spin_r = 1016839210;
                window.__spin_t = 1787681000;
                window.__hsi = "hsi_123";
              </script>
            </body></html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          if (docId === marketplaceDocIds.MARKETPLACE_SEARCH) {
            const isPaginated = Boolean(variables.cursor || variables.after);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                marketplace_search: {
                  feed_units: {
                    edges: isPaginated
                      ? [
                          { node: makeListingNode('listing_3', 'MacBook Air M2', '$900') },
                        ]
                      : [
                          { node: makeListingNode('listing_1', 'MacBook Pro 14 M3 +1 555-123-4567', '$1,200') },
                          { node: makeListingNode('listing_2', 'Dell XPS 15 seller@test.com', '$1,100') },
                        ],
                    page_info: {
                      has_next_page: !isPaginated,
                      end_cursor: 'cursor_mkt_page_1',
                    },
                  },
                },
              },
            }));
            return;
          }

          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ errors: [{ message: `Unknown doc_id in test: ${docId}` }] }));
        }
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  it('[AC-1] should register marketplace action in FacebookCrawler ActionRegistry', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager });

    const actions = crawler.listActions();
    const action = actions.find((a) => a.action === 'marketplace');

    expect(action).toBeDefined();
    expect(action?.requiredArgs).toContain('query');
    expect(action?.optionalArgs).toEqual(
      expect.arrayContaining(['location', 'category', 'categoryId', 'minPrice', 'maxPrice', 'limit', 'cursor'])
    );
    expect(action?.outputType).toMatch(/PostItem/);
  });

  it('[AC-2 & AC-3 & AC-6] should search marketplace, normalize to PostItem with category ecom, strip PII, and save checkpoint', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      store,
      sessionManager,
      docIds: marketplaceDocIds,
    });

    const res = await crawler.start({
      action: 'marketplace',
      args: {
        query: 'macbook pro 14',
        location: 'hochiminhcity',
        minPrice: 800,
        maxPrice: 1500,
        limit: 10,
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res).toBeDefined();
    const posts = res.posts || res;
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThanOrEqual(2);

    const first = posts[0];
    expect(first.platform).toBe('facebook');
    expect(first.category).toBe('ecom');
    expect(first.id).toBe('facebook:listing_1');
    expect(first.metadata?.isMarketplace).toBe(true);
    expect(first.metadata?.price).toBeDefined();
    expect(first.metadata?.sourceMethod).toBe('graphql');

    // AC-3: PII stripping verification
    expect(first.content).not.toContain('+1 555-123-4567');

    const second = posts[1];
    expect(second.content).not.toContain('seller@test.com');

    // AC-6: Checkpoint verification
    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: {
        platform: 'facebook',
        targetType: 'marketplace',
      },
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('macbook pro 14');
  });

  it('[AC-4] should support dryRun preview mode and return searchUrl without calling network', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager });

    const res = await crawler.start({
      action: 'marketplace',
      args: {
        query: 'iphone 15 pro',
        location: 'hanoi',
        minPrice: 500,
        maxPrice: 1000,
        dryRun: true,
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res).toBeDefined();
    expect(res.dryRun).toBe(true);
    expect(res.searchUrl).toContain('marketplace');
    expect(res.searchUrl).toContain('iphone%2015%20pro');
  });

  it('[AC-4 & AC-6] should support cursor pagination with cursor/after argument', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: marketplaceDocIds,
    });

    const res = await crawler.start({
      action: 'marketplace',
      args: {
        query: 'macbook air',
        cursor: 'cursor_mkt_page_1',
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res.posts).toBeDefined();
    expect(res.posts.length).toBe(1);
    expect(res.posts[0].externalId).toBe('listing_3');
  });

  it('[AC-7] should reject empty query, invalid prices, and malformed category inputs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager });

    // Empty query
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: '' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // Negative price
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', minPrice: -10 },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // minPrice > maxPrice
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', minPrice: 1000, maxPrice: 500 },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // Path traversal in category
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', category: '../../etc/passwd' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // Invalid coordinates
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', latitude: 100 },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // Mismatched coordinates (lat provided without lng)
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', latitude: 10.5 },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // Invalid categoryId with special chars
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', categoryId: '123; DROP TABLE' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // SSRF guard on location URL
    await expect(crawler.start({
      action: 'marketplace',
      args: { query: 'car', location: 'http://malicious.com/exploit' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);
  });

  it('[AC-5] should handle GraphQL failure gracefully with fallback note and empty posts list', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        MARKETPLACE_SEARCH: 'invalid_unconfigured_doc_id',
      },
    });

    const res = await crawler.start({
      action: 'marketplace',
      args: {
        query: 'nintendo switch',
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res).toBeDefined();
    expect(res.posts).toEqual([]);
    expect(res.note).toBeDefined();
    expect(res.note).toContain('Marketplace GraphQL query failed');
  });

  it('[AC-5] should use browserBridge evaluate fallback when GraphQL fails and browserBridge is provided', async () => {
    const mockBridge = {
      evaluate: async (_fn, _url) => [
        {
          id: 'listing_dom_1',
          title: 'MacBook Pro 16 M2 Max',
          price: '$2,400',
          image: 'https://scontent.xx.fbcdn.net/dom1.jpg',
          seller: { id: 'seller_dom_1', name: 'DOM Seller' },
          creationTime: 1787680500,
        },
      ],
    };

    const client = new FacebookClient({ baseUrl: serverUrl });
    client.browserBridge = mockBridge;

    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        MARKETPLACE_SEARCH: 'invalid_unconfigured_doc_id',
      },
    });

    const res = await crawler.start({
      action: 'marketplace',
      args: {
        query: 'macbook pro 16',
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res.posts).toBeDefined();
    expect(res.posts.length).toBe(1);
    expect(res.posts[0].id).toBe('facebook:listing_dom_1');
    expect(res.posts[0].metadata?.sourceMethod).toBe('browser');
    expect(res.note).toContain('Used browser fallback');
  });

  it('[AC-9] should mark legacy scrapeMarketplace as deprecated in JSDoc', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const legacyFile = path.resolve(process.cwd(), 'src/scrapers/facebook/marketplace.js');
    const content = fs.readFileSync(legacyFile, 'utf8');

    expect(content).toContain('@deprecated');
    expect(content).toContain('FacebookCrawler');
  });

  it('[AC-10] should validate marketplace PostItem metadata against schemas/facebook/ecom.json', async () => {
    const metadataSchemaRegistry = (await import('../../../../src/core/metadata-schema-registry.js')).default;

    const sampleListing = {
      isMarketplace: true,
      price: '$1,200',
      currency: 'USD',
      location: 'Ho Chi Minh City',
      seller: 'John Doe',
      sellerUrl: 'https://www.facebook.com/seller_1',
      sellerId: 'seller_1',
      category: 'electronics',
      categoryId: '12345',
      listingUrl: 'https://www.facebook.com/marketplace/item/12345',
      sourceMethod: 'graphql',
      rawId: '12345',
      creationTime: 1787680000,
    };

    const validation = metadataSchemaRegistry.validateMetadata('facebook', 'ecom', sampleListing);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });
});



