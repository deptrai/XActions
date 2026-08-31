// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for Batdongsan.com.vn Real Estate Scraper (Story 17.2).
// by nichxbt
import { describe, it, expect } from 'vitest';
import { scrape } from '../../src/scrapers/index.js';
import { scrapeBatdongsan } from '../../src/scrapers/realestate/batdongsan/index.js';

describe('Story 17.2 — Batdongsan.com.vn Property E2E', () => {
  it('should execute search_listings through unified dispatcher without auth', async () => {
    const result = await scrape('batdongsan', 'search_listings', {
      city: 'SG',
      category: 'can-ho',
      limit: 5,
      requiresProxy: false,
      autoClose: true,
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
  });

  it('should execute search_listings via scrapeBatdongsan convenience helper', async () => {
    const result = await scrapeBatdongsan(
      'search_listings',
      { city: 'HN', category: 'nha-rieng', limit: 3 },
      { requiresProxy: false, autoClose: true }
    );

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
  });

  it('should throw validation error when productId is missing for listing_detail', async () => {
    await expect(scrape('batdongsan', 'listing_detail', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });
  });
});
