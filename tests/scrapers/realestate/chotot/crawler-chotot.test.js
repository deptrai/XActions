// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

import { ChototCrawler } from '../../../../src/scrapers/realestate/chotot/crawler.js';
import { ChototClient } from '../../../../src/scrapers/realestate/chotot/client.js';
import { ChototPlatformResponseValidator } from '../../../../src/scrapers/realestate/chotot/validator.js';
import {
  encryptChototListId,
  validateAndFormatPhone,
  normalizeChototListing,
  getCategoryConfig,
} from '../../../../src/scrapers/realestate/chotot/normalize-chotot.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 17.1 — Chợ Tốt Multi-Category Scraper with Phone Mask Detector (TDD)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
        });

        // Challenge endpoint
        if (url.searchParams.get('category') === 'challenge_test') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied', code: 403 }));
          return;
        }

        // Listings endpoint
        if (url.pathname.includes('/v1/public/ad-listing')) {
          if (url.pathname.includes('/phone')) {
            // Phone decrypt endpoint
            const token = url.searchParams.get('e');
            if (token === 'invalid_token') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ phone: '09012***89' })); // Masked
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ phone: '0901234567' }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ads: [
              {
                list_id: 11223344,
                subject: 'Bán nhà mặt tiền Quận 1 giá tốt',
                body: 'Nhà đẹp 4 tầng, vị trí đắc địa kinh doanh sầm uất.',
                price: 15000000000,
                price_string: '15 tỷ',
                size: 120.5,
                rooms: 4,
                region_name: 'Tp Hồ Chí Minh',
                region_v2: 13000,
                area_name: 'Quận 1',
                area_v2: 13001,
                account_name: 'Nguyễn Văn Chủ Nhà',
                account_oid: 'acc_778899',
                images: [
                  'https://cdn.chotot.com/images/house1.jpg',
                  'https://cdn.chotot.com/images/house2.jpg',
                ],
                list_time: 1788160000000,
                cg: 1000,
              },
            ],
            total: 100,
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    receivedRequests = [];
    await cleanupTestDatabase();
  });

  const buildCrawler = () => {
    const client = new ChototClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new ChototCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('AC-1: ChototCrawler and ChototClient inherit base contracts and register 3 actions', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('chotot');
    expect(crawler.platform).toBe('chotot');
    expect(crawler.requiresAuth).toBe(false);

    const actions = crawler.listActions();
    const searchListings = actions.find((a) => a.action === 'search_listings');
    const listingDetail = actions.find((a) => a.action === 'listing_detail');
    const getPhone = actions.find((a) => a.action === 'get_phone');

    expect(searchListings).toBeTruthy();
    expect(searchListings?.category).toBe('realestate');
    expect(searchListings?.optionalArgs).toContain('category');
    expect(searchListings?.optionalArgs).toContain('region_v2');
    expect(searchListings?.optionalArgs).toContain('includePhone');

    expect(listingDetail).toBeTruthy();
    expect(listingDetail?.category).toBe('realestate');
    expect(listingDetail?.requiredArgs).toEqual(['listId']);

    expect(getPhone).toBeTruthy();
    expect(getPhone?.category).toBe('realestate');
    expect(getPhone?.requiredArgs).toEqual(['listId']);
  });

  it('AC-3: encryptChototListId produces valid RSA encrypted base64 string', () => {
    const token = encryptChototListId(11223344);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(50);
  });

  it('AC-4: validateAndFormatPhone detects masks and validates Vietnamese numbers', () => {
    // Valid numbers
    expect(validateAndFormatPhone('0901234567')).toBe('0901234567');
    expect(validateAndFormatPhone('+84901234567')).toBe('0901234567');
    expect(validateAndFormatPhone('0389998888')).toBe('0389998888');
    expect(validateAndFormatPhone('0771234567')).toBe('0771234567');
    expect(validateAndFormatPhone('0812345678')).toBe('0812345678');

    // Masked numbers -> null
    expect(validateAndFormatPhone('09012***89')).toBeNull();
    expect(validateAndFormatPhone('098****123')).toBeNull();
    expect(validateAndFormatPhone('0901xxx123')).toBeNull();

    // Invalid numbers
    expect(validateAndFormatPhone('123456')).toBeNull();
    expect(validateAndFormatPhone('0123456789012')).toBeNull();
    expect(validateAndFormatPhone(null)).toBeNull();
  });

  it('AC-2: search_listings fetches listings and normalizes PostItem', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_listings',
      args: { category: 'bds', region_v2: 13000, limit: 10, includePhone: true },
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings).toHaveLength(1);

    const item = result.listings[0];
    expect(item.id).toBe('chotot:ad:11223344');
    expect(item.platform).toBe('chotot');
    expect(item.category).toBe('realestate');
    expect(item.content).toContain('Bán nhà mặt tiền Quận 1 giá tốt');
    expect(item.authorName).toBe('Nguyễn Văn Chủ Nhà');
    expect(item.metadata).toMatchObject({
      listId: '11223344',
      title: 'Bán nhà mặt tiền Quận 1 giá tốt',
      price: 15000000000,
      priceString: '15 tỷ',
      size: 120.5,
      rooms: 4,
      region: 'Tp Hồ Chí Minh',
      area: 'Quận 1',
      phone: '0901234567',
      isPhoneVerified: true,
      sourceMethod: 'search_listings',
    });
  });

  it('AC-3: get_phone action resolves and verifies owner phone number', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'get_phone',
      args: { listId: 11223344 },
    });

    expect(result).toHaveProperty('phone', '0901234567');
    expect(result).toHaveProperty('isPhoneVerified', true);
  });

  it('AC-1: ChototPlatformResponseValidator detects rate limits & 403 challenges', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'search_listings',
        args: { category: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('AC-5: unified scrape("chotot", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('chotot', 'search_listings', {
      baseUrl: serverUrl,
      category: 'bds',
      region_v2: 13000,
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.listings[0].platform).toBe('chotot');
    expect(result.listings[0].category).toBe('realestate');
  });

  it('AC-5: package.json exports include ./scrapers/realestate/chotot', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/realestate/chotot']).toBe(
      './src/scrapers/realestate/chotot/index.js'
    );
  });

  it('AC-5: scrapeChotot convenience helper works end-to-end', async () => {
    const { scrapeChotot } = await import(
      '../../../../src/scrapers/realestate/chotot/index.js'
    );

    const result = await scrapeChotot(
      'search_listings',
      { category: 'cars', limit: 5 },
      {
        baseUrl: serverUrl,
        store: createStore(),
        requiresProxy: false,
        autoClose: true,
      }
    );

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.listings[0].platform).toBe('chotot');
  });
});
