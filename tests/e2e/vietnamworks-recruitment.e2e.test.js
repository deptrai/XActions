// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — VietnamWorks Job & Recruitment Scraper
 *
 * Verifies end-to-end flow:
 * 1. Action registration in VietnamWorksCrawler
 * 2. Real job search query execution via ms.vietnamworks.com
 * 3. Normalization into standard PostItem (category: recruitment)
 * 4. Integration with unified scrape('vietnamworks', ...) dispatcher
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { VietnamWorksCrawler } from '../../src/scrapers/recruitment/vietnamworks/crawler.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-vietnamworks';

describe('VietnamWorks — Recruitment Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] registers search_jobs, job_detail, and company_detail actions`, () => {
    const crawler = new VietnamWorksCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search_jobs');
    expect(actionNames).toContain('job_detail');
    expect(actionNames).toContain('company_detail');
    expect(crawler.requiresAuth).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchJobs queries live VietnamWorks and extracts jobs`, async () => {
    const crawler = new VietnamWorksCrawler();
    const res = await crawler.searchJobs({ keyword: 'Software Engineer', limit: 3 });

    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBeGreaterThan(0);

    const job = res.jobs[0];
    expect(job.platform).toBe('vietnamworks');
    expect(job.category).toBe('recruitment');
    expect(job.id).toMatch(/^vietnamworks:job:\d+/);
    expect(job.authorName).toBeTruthy(); // Employer / Company name
    expect(job.postUrl).toContain('vietnamworks.com');
    expect(job.content).toBeTruthy();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes search_jobs via unified scrape() dispatcher`, async () => {
    const res = await scrape('vietnamworks', 'search_jobs', {
      keyword: 'React',
      limit: 2,
    });

    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBeGreaterThan(0);
    expect(res.jobs[0].platform).toBe('vietnamworks');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] searchJobs safely handles missing keyword with sensible default`, async () => {
    const crawler = new VietnamWorksCrawler();
    const res = await crawler.searchJobs({ limit: 2 });
    expect(res).toBeDefined();
    expect(Array.isArray(res.jobs)).toBe(true);
  });
});
