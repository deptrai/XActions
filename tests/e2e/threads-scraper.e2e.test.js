// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Threads Hybrid Scraper (Unauthenticated Guest Mode)
 *
 * Verifies end-to-end flow:
 * 1. Guest token extraction (LSD, HSI, spin_r, spin_t) from threads.com
 * 2. Real user timeline crawl without login credentials
 * 3. Normalization into uniform PostItem format
 * 4. Integration with unified scrape('threads', ...) dispatcher
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ThreadsCrawler } from '../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../src/scrapers/social/threads/client.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-threads-scraper';

describe('Threads — Unauthenticated Guest Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] ThreadsClient extracts live security tokens from threads.com`, async () => {
    const client = new ThreadsClient({
      requiresProxy: false,
    });

    const tokens = await client.ensureLsd('threads-guest', '');
    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBeTruthy();
    expect(tokens.spin_r).toBeDefined();
    expect(tokens.spin_t).toBeDefined();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] ThreadsCrawler crawls public user timeline without login credentials`, async () => {

    const crawler = new ThreadsCrawler({
      requiresProxy: false,
    });

    const res = await crawler.getUserFeed({ username: 'mosseri', count: 3 });
    expect(res).toBeDefined();
    expect(Array.isArray(res.posts)).toBe(true);
    expect(res.posts.length).toBeGreaterThan(0);

    const first = res.posts[0];
    expect(first.platform).toBe('threads');
    expect(first.id).toMatch(/^threads:\d+/);
    expect(first.category).toBe('social');
  }, 60000);

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes timeline crawl via unified scrape() dispatcher`, async () => {
    const res = await scrape('threads', 'user_feed', {
      username: 'zuck',
      count: 2,
      requiresProxy: false,
    });

    expect(res).toBeDefined();
    expect(Array.isArray(res.posts)).toBe(true);
    expect(res.posts.length).toBeGreaterThan(0);
    expect(res.posts[0].platform).toBe('threads');
  }, 60000);

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] throws XACT_4001 when username is missing`, async () => {
    const crawler = new ThreadsCrawler({ requiresProxy: false });
    await expect(crawler.getUserFeed({})).rejects.toMatchObject({
      code: 'XACT_4001',
    });
  });
});
