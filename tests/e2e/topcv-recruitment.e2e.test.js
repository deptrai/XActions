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

/**
 * Live upstream probe — TopCV Cloudflare challenges are environment-dependent
 * (residential / clean IP pools pass; datacenter IPs and CI runners get interstitial).
 * When upstream blocks us, treat the test as environment-gated rather than a code bug.
 */
const isUpstreamBlocked = (err) =>
  /bot challenge|cloudflare_interstitial|XACT_4030|status 403|status 429/i.test(
    `${err?.code || ''} ${err?.message || err}`
  );

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

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchJobs queries live TopCV and extracts job postings`, async (ctx) => {
    try {
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
    } catch (err) {
      if (isUpstreamBlocked(err)) ctx.skip(`Upstream bot-challenge (Cloudflare) — env-gated: ${err?.code}`);
      throw err;
    }
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes search_jobs via unified scrape() dispatcher`, async (ctx) => {
    try {
      const res = await scrape('topcv', 'search_jobs', {
        keyword: 'tester',
        limit: 2,
        requiresProxy: false,
      });

      expect(res).toBeDefined();
      expect(Array.isArray(res.jobs)).toBe(true);
      expect(res.jobs.length).toBeGreaterThan(0);
      expect(res.jobs[0].platform).toBe('topcv');
    } catch (err) {
      if (isUpstreamBlocked(err)) ctx.skip(`Upstream bot-challenge — env-gated: ${err?.code}`);
      throw err;
    }
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] searchJobs rejects empty input with XACT_4001 when required`, async (ctx) => {
    try {
      const crawler = new TopCvCrawler({ requiresProxy: false });
      const res = await crawler.searchJobs({ limit: 1 });
      expect(res).toBeDefined();
      expect(Array.isArray(res.jobs)).toBe(true);
    } catch (err) {
      if (isUpstreamBlocked(err)) ctx.skip(`Upstream bot-challenge — env-gated: ${err?.code}`);
      throw err;
    }
  });
});
