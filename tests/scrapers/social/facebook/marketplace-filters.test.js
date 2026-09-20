// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler, DEFAULT_FB_DOC_IDS } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { buildMarketplaceSearchUrl } from '../../../../src/scrapers/social/facebook/normalize-marketplace.js';
import { executeFacebookEpic4Tool } from '../../../../src/mcp/server.js';

/**
 * Story 13.11: Marketplace Advanced Filters — sortBy/condition + MCP/CLI exposure.
 * Real, no mocks — exercises the validation matrix via crawler.start({ action: 'marketplace' }).
 */

describe('Story 13.11 — Marketplace advanced filters (sortBy/condition)', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let sessionManager;

  const mkCrawler = () => new FacebookCrawler({
    client: new FacebookClient({ baseUrl: serverUrl }),
    sessionManager,
  });

  beforeAll(async () => {
    sessionManager = new SessionManager();
    sessionManager.set('acc_fb_1', {
      accountId: 'acc_fb_1',
      platform: 'facebook',
      cookies: { c_user: '61590064244856', xs: 'sec_xs_123' },
    });

    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body></body></html>');
    });
    await new Promise((r) => server.listen(0, r));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  describe('AC-1: sortBy validation', () => {
    it.each(['relevance', 'price_asc', 'price_desc', 'date_listed'])(
      'should accept valid sortBy=%s via dryRun',
      async (s) => {
        const crawler = mkCrawler();
        const res = await crawler.start({
          action: 'marketplace',
          args: { query: 'macbook', sortBy: s, dryRun: true },
          session: { accountId: 'acc_fb_1' },
        });
        expect(res.dryRun).toBe(true);
        expect(typeof res.searchUrl).toBe('string');
      },
    );

    it('should emit mapped sortBy param in dryRun searchUrl (crawler → URL builder)', async () => {
      const crawler = mkCrawler();
      const res = await crawler.start({
        action: 'marketplace',
        args: { query: 'macbook', sortBy: 'price_asc', dryRun: true },
        session: { accountId: 'acc_fb_1' },
      });
      expect(res.searchUrl).toContain('sortBy=price_ascend');
    });

    it('should normalize mixed-case sortBy input (PRICE_ASC → price_ascend)', async () => {
      const crawler = mkCrawler();
      const res = await crawler.start({
        action: 'marketplace',
        args: { query: 'macbook', sortBy: 'PRICE_ASC', dryRun: true },
        session: { accountId: 'acc_fb_1' },
      });
      expect(res.searchUrl).toContain('sortBy=price_ascend');
    });

    it.each(['PRICE', 'asc', 'invalid', 'price ascending'])(
      'should reject invalid sortBy="%s"',
      async (s) => {
        const crawler = mkCrawler();
        await expect(crawler.start({
          action: 'marketplace',
          args: { query: 'macbook', sortBy: s, dryRun: true },
          session: { accountId: 'acc_fb_1' },
        })).rejects.toThrow(PlatformError);
      },
    );

    it('should reject sortBy=invalid with XACT_4001 code', async () => {
      const crawler = mkCrawler();
      try {
        await crawler.start({
          action: 'marketplace',
          args: { query: 'macbook', sortBy: 'bogus', dryRun: true },
          session: { accountId: 'acc_fb_1' },
        });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(PlatformError);
        expect(e.code).toBe('XACT_4001');
      }
    });
  });

  describe('AC-2: condition validation', () => {
    it.each(['new', 'used'])('should accept condition=%s', async (c) => {
      const crawler = mkCrawler();
      const res = await crawler.start({
        action: 'marketplace',
        args: { query: 'iphone', condition: c, dryRun: true },
        session: { accountId: 'acc_fb_1' },
      });
      expect(res.dryRun).toBe(true);
      expect(res.searchUrl).toContain(`itemCondition=${c}`);
    });

    it('should accept condition as array ["new","used"] and comma-join', async () => {
      const crawler = mkCrawler();
      const res = await crawler.start({
        action: 'marketplace',
        args: { query: 'iphone', condition: ['new', 'used'], dryRun: true },
        session: { accountId: 'acc_fb_1' },
      });
      expect(res.searchUrl).toContain('itemCondition=new%2Cused');
    });

    it.each(['like new', 'refurbished', 'NEW-ish', 'usedlike new'])(
      'should reject invalid condition="%s"',
      async (c) => {
        const crawler = mkCrawler();
        await expect(crawler.start({
          action: 'marketplace',
          args: { query: 'iphone', condition: c, dryRun: true },
          session: { accountId: 'acc_fb_1' },
        })).rejects.toThrow(PlatformError);
      },
    );

    it('should reject mixed-validity condition array ["new","bogus"]', async () => {
      const crawler = mkCrawler();
      await expect(crawler.start({
        action: 'marketplace',
        args: { query: 'iphone', condition: ['new', 'bogus'], dryRun: true },
        session: { accountId: 'acc_fb_1' },
      })).rejects.toThrow(PlatformError);
    });
  });

  describe('AC-6: buildMarketplaceSearchUrl param mapping', () => {
    it('should omit sortBy param when sortBy=relevance (default)', () => {
      const url = buildMarketplaceSearchUrl('macbook', { sortBy: 'relevance' });
      expect(url).not.toContain('sortBy=');
    });

    it('should map sortBy=price_asc → sortBy=price_ascend', () => {
      const url = buildMarketplaceSearchUrl('macbook', { sortBy: 'price_asc' });
      expect(url).toContain('sortBy=price_ascend');
    });

    it('should map sortBy=price_desc → sortBy=price_descend', () => {
      const url = buildMarketplaceSearchUrl('macbook', { sortBy: 'price_desc' });
      expect(url).toContain('sortBy=price_descend');
    });

    it('should map sortBy=date_listed → sortBy=creation_time_descend', () => {
      const url = buildMarketplaceSearchUrl('macbook', { sortBy: 'date_listed' });
      expect(url).toContain('sortBy=creation_time_descend');
    });

    it('should emit itemCondition=new', () => {
      const url = buildMarketplaceSearchUrl('macbook', { condition: 'new' });
      expect(url).toContain('itemCondition=new');
    });

    it('should emit itemCondition=used', () => {
      const url = buildMarketplaceSearchUrl('macbook', { condition: 'used' });
      expect(url).toContain('itemCondition=used');
    });

    it('should comma-join condition=["new","used"]', () => {
      const url = buildMarketplaceSearchUrl('macbook', { condition: ['new', 'used'] });
      expect(url).toContain('itemCondition=new%2Cused');
    });

    it('should silently drop unknown condition strings (defensive)', () => {
      const url = buildMarketplaceSearchUrl('macbook', { condition: ['new', 'bogus'] });
      expect(url).toContain('itemCondition=new');
      expect(url).not.toContain('bogus');
    });

    it('should combine sortBy + condition + price + geo in one URL', () => {
      const url = buildMarketplaceSearchUrl('macbook', {
        minPrice: 500,
        maxPrice: 1500,
        latitude: 10.77,
        longitude: 106.7,
        radiusKm: 50,
        sortBy: 'price_asc',
        condition: 'used',
      });
      expect(url).toContain('minPrice=500');
      expect(url).toContain('maxPrice=1500');
      expect(url).toContain('lat=10.77');
      expect(url).toContain('lng=106.7');
      expect(url).toContain('radius=50');
      expect(url).toContain('sortBy=price_ascend');
      expect(url).toContain('itemCondition=used');
    });
  });

  describe('AC-5: backward compatibility', () => {
    it('should produce identical URL when sortBy/condition omitted', () => {
      const before = buildMarketplaceSearchUrl('macbook', {
        minPrice: 500, maxPrice: 1500, latitude: 10.77, longitude: 106.7, radiusKm: 50,
      });
      const after = buildMarketplaceSearchUrl('macbook', {
        minPrice: 500, maxPrice: 1500, latitude: 10.77, longitude: 106.7, radiusKm: 50,
        sortBy: 'relevance',
      });
      expect(after).toBe(before);
      expect(before).not.toContain('sortBy=');
      expect(before).not.toContain('itemCondition=');
    });

    it('dryRun without sortBy/condition still succeeds', async () => {
      const crawler = mkCrawler();
      const res = await crawler.start({
        action: 'marketplace',
        args: { query: 'macbook', minPrice: 500, maxPrice: 1500, dryRun: true },
        session: { accountId: 'acc_fb_1' },
      });
      expect(res.dryRun).toBe(true);
      expect(res.searchUrl).not.toContain('sortBy=');
      expect(res.searchUrl).not.toContain('itemCondition=');
    });
  });

  describe('AC-6: MCP x_facebook_marketplace validation (new fields)', () => {
    it.each(['relevance', 'price_asc', 'price_desc', 'date_listed'])(
      'MCP accepts sortBy=%s and preview carries it',
      async (v) => {
        const res = await executeFacebookEpic4Tool('x_facebook_marketplace', {
          query: 'macbook', sortBy: v, dryRun: true,
        });
        expect(res.dryRun).toBe(true);
        expect(res.preview.sortBy).toBe(v);
      },
    );

    it('MCP rejects invalid sortBy', async () => {
      await expect(
        executeFacebookEpic4Tool('x_facebook_marketplace', {
          query: 'macbook', sortBy: 'bogus', dryRun: true,
        }),
      ).rejects.toThrow('sortBy');
    });

    it.each(['new', 'used'])('MCP accepts condition=%s', async (v) => {
      const res = await executeFacebookEpic4Tool('x_facebook_marketplace', {
        query: 'iphone', condition: v, dryRun: true,
      });
      expect(res.preview.condition).toBe(v);
      expect(res.preview.searchUrl).toContain(`itemCondition=${v}`);
    });

    it('MCP accepts condition array and normalizes case/whitespace', async () => {
      const res = await executeFacebookEpic4Tool('x_facebook_marketplace', {
        query: 'iphone', condition: [' NEW ', 'used'], dryRun: true,
      });
      expect(res.preview.condition).toEqual(['new', 'used']);
      expect(res.preview.searchUrl).toContain('itemCondition=new%2Cused');
    });

    it('MCP rejects invalid condition', async () => {
      await expect(
        executeFacebookEpic4Tool('x_facebook_marketplace', {
          query: 'iphone', condition: 'refurbished', dryRun: true,
        }),
      ).rejects.toThrow('condition');
    });

    it('MCP normalizes mixed-case sortBy (Price_Asc → price_asc)', async () => {
      const res = await executeFacebookEpic4Tool('x_facebook_marketplace', {
        query: 'macbook', sortBy: 'Price_Asc', dryRun: true,
      });
      expect(res.preview.sortBy).toBe('price_asc');
      expect(res.preview.searchUrl).toContain('sortBy=price_ascend');
    });
  });

  describe('AC-1/AC-2: non-dryRun GraphQL browse_request_params mapping', () => {
    let gqlServer;
    let gqlUrl = '';
    let lastVariables = null;

    const gqlDocIds = { ...DEFAULT_FB_DOC_IDS, MARKETPLACE_SEARCH: 'fb_marketplace_search_test_doc' };

    beforeAll(async () => {
      gqlServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          // Token page: crawler fetches HTML for lsd/dtsg before GraphQL POST
          if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_456"; });</script>
            </body></html>`);
            return;
          }
          if (req.url?.startsWith('/api/graphql')) {
            const params = new URLSearchParams(body);
            lastVariables = JSON.parse(params.get('variables') || '{}');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                marketplace_search: {
                  feed_units: { edges: [], page_info: { has_next_page: false, end_cursor: null } },
                },
              },
            }));
            return;
          }
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
        });
      });
      await new Promise((r) => gqlServer.listen(0, r));
      gqlUrl = `http://127.0.0.1:${gqlServer.address().port}`;
    });

    afterAll(async () => {
      if (gqlServer) await new Promise((r) => gqlServer.close(r));
    });

    it('maps sortBy=price_asc → browse_request_params.sort_by=price_ascend', async () => {
      const crawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: gqlUrl }),
        sessionManager,
        docIds: gqlDocIds,
      });
      await crawler.start({
        action: 'marketplace',
        args: { query: 'macbook', sortBy: 'price_asc', condition: 'new' },
        session: { accountId: 'acc_fb_1' },
      });
      const brp = lastVariables?.params?.browse_request_params;
      expect(brp).toBeDefined();
      expect(brp.sort_by).toBe('price_ascend');
      expect(brp.item_condition).toEqual(['new']);
    });

    it('omits sort_by when relevance; joins multi condition', async () => {
      const crawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: gqlUrl }),
        sessionManager,
        docIds: gqlDocIds,
      });
      await crawler.start({
        action: 'marketplace',
        args: { query: 'macbook', sortBy: 'relevance', condition: ['new', 'used'] },
        session: { accountId: 'acc_fb_1' },
      });
      const brp = lastVariables?.params?.browse_request_params;
      expect(brp).toBeDefined();
      expect(brp.sort_by).toBeUndefined();
      expect(brp.item_condition).toEqual(['new', 'used']);
    });
  });
});
