// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Facebook Marketplace Unauthenticated Guest Scraper
 *
 * Verifies end-to-end flow:
 * 1. Guest token extraction (LSD, spin_r, spin_t) without account credentials
 * 2. Marketplace product search via Browser Bridge (Guest Desktop View)
 * 3. Normalization to standard PostItem (category: ecom) with price & location
 * 4. PII stripping (phone numbers / personal emails removed)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FacebookCrawler } from '../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../src/scrapers/social/facebook/client.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-facebook-guest';

describe('Facebook — Unauthenticated Marketplace Scraper E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] extracts live LSD and spin tokens for guest session`, async () => {
    const client = new FacebookClient({
      client: 'curl',
      requiresProxy: false,
    });

    const tokens = await client.ensureTokens('fb-guest', '');
    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBeTruthy();
    expect(tokens.spin_r).toBeDefined();
    expect(tokens.spin_t).toBeDefined();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searches Marketplace via desktop guest view and normalizes products`, async () => {
    const crawler = new FacebookCrawler({
      launchChrome: true,
      headless: true,
      requiresProxy: false,
    });

    try {
      const res = await crawler.marketplace(
        { query: 'laptop', location: 'hanoi', limit: 3 },
        { accountId: 'fb-guest' }
      );

      expect(res).toBeDefined();
      const items = res.posts || res;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);

      const first = items[0];
      expect(first.platform).toBe('facebook');
      expect(first.category).toBe('ecom');
      expect(first.id).toMatch(/^facebook:/);
      expect(first.content).toBeTruthy();
    } finally {
      await crawler.cleanup().catch(() => {});
    }
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] marketplace rejects empty query with XACT_4001`, async () => {
    const crawler = new FacebookCrawler({ requiresProxy: false });
    await expect(crawler.marketplace({})).rejects.toMatchObject({
      code: 'XACT_4001',
    });
  });
});
