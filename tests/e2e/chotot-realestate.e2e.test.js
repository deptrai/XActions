// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for Chợ Tốt Real Estate & Classified Scraper (Story 17.1).
// by nichxbt
import { describe, it, expect } from 'vitest';
import { scrape } from '../../src/scrapers/index.js';
import { scrapeChotot } from '../../src/scrapers/realestate/chotot/index.js';

describe('Story 17.1 — Chợ Tốt Real Estate & Multi-Category E2E', () => {
  it('should search real public real estate listings on Chợ Tốt with phone decryption', async () => {
    const result = await scrape('chotot', 'search_listings', {
      category: 'bds',
      region_v2: 13000, // TP.HCM
      limit: 2,
      includePhone: true,
      requiresProxy: false,
      autoClose: true,
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);

    const firstAd = result.listings[0];
    expect(firstAd.id).toMatch(/^chotot:ad:\d+/);
    expect(firstAd.platform).toBe('chotot');
    expect(firstAd.category).toBe('realestate');
    expect(firstAd.metadata.title).toBeTruthy();
    expect(firstAd.metadata.listId).toBeTruthy();
    expect(firstAd.metadata.region).toBeTruthy();
  });

  it('should fetch and decrypt phone number for a specific listId', async () => {
    // 1. Search for live listId
    const searchResult = await scrapeChotot('search_listings', {
      category: 'bds',
      region_v2: 13000,
      limit: 1,
      requiresProxy: false,
      autoClose: true,
    });

    expect(searchResult.listings.length).toBeGreaterThan(0);
    const targetListId = searchResult.listings[0].metadata.listId;
    expect(targetListId).toBeTruthy();

    // 2. Query get_phone action
    const phoneResult = await scrape('chotot', 'get_phone', {
      listId: targetListId,
      requiresProxy: false,
      autoClose: true,
    });

    expect(phoneResult).toHaveProperty('phone');
    expect(phoneResult).toHaveProperty('isPhoneVerified');
    if (phoneResult.phone) {
      expect(phoneResult.phone).toMatch(/^0\d{9}$/);
      expect(phoneResult.isPhoneVerified).toBe(true);
    }
  });

  it('should support multi-category search across cars and electronics', async () => {
    const carsResult = await scrape('chotot', 'search_listings', {
      category: 'cars',
      limit: 1,
      requiresProxy: false,
      autoClose: true,
    });

    expect(carsResult.listings.length).toBeGreaterThan(0);
    expect(carsResult.listings[0].metadata.category).toBe('cars');

    const techResult = await scrape('chotot', 'search_listings', {
      category: 'electronics',
      limit: 1,
      requiresProxy: false,
      autoClose: true,
    });

    expect(techResult.listings.length).toBeGreaterThan(0);
    expect(techResult.listings[0].metadata.category).toBe('electronics');
  });

  it('should throw validation error when required arguments are missing', async () => {
    await expect(scrape('chotot', 'listing_detail', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });

    await expect(scrape('chotot', 'get_phone', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });
  });
});
