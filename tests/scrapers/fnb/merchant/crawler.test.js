// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantCrawler — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FnbMerchantCrawler } from '../../../../src/scrapers/fnb/merchant/crawler.js';
import { FnbMerchantClient } from '../../../../src/scrapers/fnb/merchant/client.js';
import { isValidCategory } from '../../../../src/core/types.js';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

function makeHttpClient(route) {
  return async (opts) => {
    const url = new URL(opts.url);
    const pathname = url.pathname;
    const host = url.hostname;
    let body = '';
    let status = 200;

    if (host.includes('pasgo') && pathname.includes('nha-hang')) {
      body = loadFixture('pasgo-search.html');
    } else if (host.includes('foody') && pathname.includes('nha-hang')) {
      body = loadFixture('foody-search.html');
    } else if (host.includes('riviu') && pathname.includes('nha-hang')) {
      body = loadFixture('riviu-search.html');
    } else if (pathname.includes('detail')) {
      body = loadFixture('pasgo-detail.html');
    } else if (pathname.includes('challenge')) {
      status = 403;
      body = '<html><body>Just a moment...</body></html>';
    } else {
      status = 404;
      body = '<html><body>Not found</body></html>';
    }

    if (route) {
      const routed = route({ pathname, url });
      if (routed) {
        body = routed.body;
        status = routed.status;
      }
    }

    return {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body,
      data: undefined,
    };
  };
}

describe('fnb_merchant category', () => {
  it('should accept fnb_merchant as valid category', () => {
    expect(isValidCategory('fnb_merchant')).toBe(true);
  });
});

describe('FnbMerchantCrawler', () => {
  it('should create crawler with default client', () => {
    const crawler = new FnbMerchantCrawler();
    expect(crawler.name).toBe('fnb');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('should have registered actions', () => {
    const crawler = new FnbMerchantCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('search_restaurants');
    expect(actionNames).toContain('newly_opened');
    expect(actionNames).toContain('search_by_district');
    expect(actionNames).toContain('detail');
  });

  it('should execute search_restaurants for PasGo', async () => {
    const httpClient = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    const result = await crawler.start({ action: 'search_restaurants', args: { city: 'ha-noi', platform: 'pasgo' } });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].platform).toBe('pasgo');
    expect(result.posts[0].category).toBe('fnb_merchant');
    expect(result.pageInfo.page).toBe(1);
  });

  it('should execute search_restaurants for Foody', async () => {
    const httpClient = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'foody', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    const result = await crawler.start({ action: 'search_restaurants', args: { city: 'ho-chi-minh', platform: 'foody' } });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].platform).toBe('foody');
  });

  it('should execute search_restaurants for Riviu', async () => {
    const httpClient = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'riviu', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    const result = await crawler.start({ action: 'search_restaurants', args: { city: 'ha-noi', platform: 'riviu' } });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].platform).toBe('riviu');
  });

  it('should execute detail for PasGo', async () => {
    const httpClient = makeHttpClient((args) => {
      if (args.pathname.includes('detail')) {
        return { body: loadFixture('pasgo-detail.html'), status: 200 };
      }
      return { body: loadFixture('pasgo-search.html'), status: 200 };
    });
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    const result = await crawler.start({ action: 'detail', args: { platform: 'pasgo', id: '123', slug: 'nha-hang-abc' } });
    expect(result.post).toBeDefined();
    expect(result.post.platform).toBe('pasgo');
    expect(result.post.metadata.restaurantName).toBeDefined();
  });

  it('should throw on 404 response', async () => {
    const httpClient = makeHttpClient(() => ({ body: 'Not found', status: 404 }));
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    await expect(crawler.start({ action: 'search_restaurants', args: { city: 'ha-noi', platform: 'pasgo' } }))
      .rejects.toThrow(/404/);
  });

  it('should throw on missing city for search_restaurants', async () => {
    const httpClient = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    await expect(crawler.start({ action: 'search_restaurants', args: { platform: 'pasgo' } }))
      .rejects.toThrow(/city/);
  });

  it('should throw on missing district for search_by_district', async () => {
    const httpClient = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const crawler = new FnbMerchantCrawler({ client });
    await expect(crawler.start({ action: 'search_by_district', args: { city: 'ha-noi', platform: 'pasgo' } }))
      .rejects.toThrow(/district/);
  });
});
