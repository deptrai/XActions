// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — F&B Merchant Directory & Restaurant Scraper (PasGo / Foody)
 *
 * Verifies end-to-end flow:
 * 1. Action registration in FnbMerchantCrawler
 * 2. Real restaurant / merchant search via PasGo gateway
 * 3. Normalization into standard PostItem (category: fnb)
 * 4. Integration with unified scrape('fnb', ...) dispatcher
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FnbMerchantCrawler } from '../../src/scrapers/fnb/merchant/crawler.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-fnb-merchant';

describe('FnB — Merchant & Restaurant Directory Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] registers search_restaurants and detail actions`, () => {
    const crawler = new FnbMerchantCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search_restaurants');
    expect(actionNames).toContain('detail');
    expect(crawler.requiresAuth).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchRestaurants queries live directory and returns restaurant items`, async () => {
    const crawler = new FnbMerchantCrawler();
    const res = await crawler.searchRestaurants({
      platform: 'pasgo',
      city: 'ha-noi',
      limit: 3,
    });

    expect(res).toBeDefined();
    const items = Array.isArray(res) ? res : res.items || res.merchants || res.posts || [];
    expect(items.length).toBeGreaterThan(0);

    const first = items[0];
    expect(['fnb', 'fnb_merchant']).toContain(first.category);
    expect(first.content).toBeTruthy();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes search_restaurants through unified scrape() dispatcher`, async () => {
    const res = await scrape('fnb', 'search_restaurants', {
      platform: 'pasgo',
      city: 'ha-noi',
      limit: 2,
    });

    expect(res).toBeDefined();
    const items = Array.isArray(res) ? res : res.items || res.merchants || res.posts || [];
    expect(items.length).toBeGreaterThan(0);
    expect(['fnb', 'fnb_merchant']).toContain(items[0].category);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] searchRestaurants rejects invalid platform with XACT_4001`, async () => {
    const crawler = new FnbMerchantCrawler();
    await expect(
      crawler.searchRestaurants({ platform: 'unsupported_fnb_app_xyz' })
    ).rejects.toMatchObject({
      code: 'XACT_4001',
    });
  });
});
