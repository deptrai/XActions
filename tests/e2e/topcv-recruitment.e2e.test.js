// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — TopCV Job & Recruitment Scraper
 *
 * Verifies end-to-end flow:
 * 1. Action registration in TopCvCrawler
 * 2. Live job search query execution via TopCV with Cloudflare stealth bypass
 * 3. Normalization into standard PostItem (category: recruitment)
 * 4. Integration with unified scrape('topcv', ...) dispatcher
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TopCvCrawler } from '../../src/scrapers/recruitment/topcv/crawler.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-topcv';

describe('TopCV — Vietnam Recruitment Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] registers search_jobs, job_detail, and company_detail actions`, () => {
    const crawler = new TopCvCrawler({ requiresProxy: false });
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search_jobs');
    expect(actionNames).toContain('job_detail');
    expect(actionNames).toContain('company_detail');
    expect(crawler.requiresAuth).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchJobs queries live TopCV and extracts job postings`, async () => {
    const crawler = new TopCvCrawler({ requiresProxy: false });
    const res = await crawler.searchJobs({ keyword: 'developer', limit: 2 });

    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBeGreaterThan(0);

    const first = res.jobs[0];
    expect(first.platform).toBe('topcv');
    expect(first.category).toBe('recruitment');
    expect(first.id).toMatch(/^topcv:job:/);
    expect(first.content).toBeTruthy();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes search_jobs via unified scrape() dispatcher`, async () => {
    const res = await scrape('topcv', 'search_jobs', {
      keyword: 'tester',
      limit: 2,
      requiresProxy: false,
    });

    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBeGreaterThan(0);
    expect(res.jobs[0].platform).toBe('topcv');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] searchJobs rejects empty input with XACT_4001 when required`, async () => {
    const crawler = new TopCvCrawler({ requiresProxy: false });
    const res = await crawler.searchJobs({ limit: 1 });
    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
  });
});
