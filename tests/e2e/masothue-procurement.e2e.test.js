// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — MaSoThue Vietnamese Business & Procurement Scraper
 *
 * Verifies end-to-end flow:
 * 1. Action registration in MaSoThueCrawler
 * 2. Search companies by province (Hà Nội, TP.HCM)
 * 3. Detail extraction by tax code
 * 4. Integration with unified scrape('masothue', ...) dispatcher
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { MaSoThueCrawler } from '../../src/scrapers/procurement/masothue/crawler.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-masothue';

describe('MaSoThue — Vietnam B2B Procurement Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] registers search, search_by_province, and detail actions`, () => {
    const crawler = new MaSoThueCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search');
    expect(actionNames).toContain('search_by_province');
    expect(actionNames).toContain('detail');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchByProvince returns real Vietnamese companies in Hanoi`, async () => {
    const crawler = new MaSoThueCrawler();
    const res = await crawler.searchByProvince({ province: 'ha-noi', page: 1, limit: 3 });

    expect(res).toBeDefined();
    expect(Array.isArray(res.posts)).toBe(true);
    expect(res.posts.length).toBeGreaterThan(0);

    const first = res.posts[0];
    expect(first.platform).toBe('masothue');
    expect(first.category).toBe('b2b');
    expect(first.metadata).toBeDefined();
    expect(first.metadata.taxCode).toMatch(/^\d{10,13}$/);
    expect(first.metadata.companyName).toBeTruthy();
    expect(first.metadata.detailUrl).toContain('masothue.com');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] searchByProvince throws XACT_4001 for unknown province slug`, async () => {
    const crawler = new MaSoThueCrawler();
    await expect(
      crawler.searchByProvince({ province: 'non_existent_province_xyz', page: 1 })
    ).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes search_by_province through unified scrape() dispatcher`, async () => {
    const res = await scrape('masothue', 'search_by_province', {
      province: 'ha-noi',
      limit: 2,
    });

    expect(res).toBeDefined();
    expect(Array.isArray(res.posts)).toBe(true);
    expect(res.posts.length).toBeGreaterThan(0);
    expect(res.posts[0].platform).toBe('masothue');
  });
});
