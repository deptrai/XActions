// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant Normalizer — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeFnbMerchantResults } from '../../../../src/scrapers/fnb/merchant/normalizer.js';
import { normalizeFnbResults } from '../../../../src/scrapers/fnb/merchant/index.js';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('normalizeFnbMerchantResults', () => {
  it('should parse PasGo JSON-LD search results', () => {
    const html = loadFixture('pasgo-search.html');
    const result = normalizeFnbMerchantResults(html, 'search', { platform: 'pasgo' });
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('pasgo');
    expect(result[0].category).toBe('fnb_merchant');
    expect(result[0].metadata.restaurantName).toBe('Nhà hàng ABC');
    expect(result[0].metadata.phone).toBe('0901234567');
    expect(result[0].metadata.rating).toBe(4.5);
    expect(result[0].metadata.reviewCount).toBe(120);
  });

  it('should parse Foody embedded jsonData', () => {
    const html = loadFixture('foody-search.html');
    const result = normalizeFnbMerchantResults(html, 'search', { platform: 'foody' });
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('foody');
    expect(result[0].category).toBe('fnb_merchant');
    expect(result[0].metadata.restaurantName).toBe('Quán Ăn XYZ');
    expect(result[0].metadata.phone).toBe('0912345678');
    expect(result[0].metadata.rating).toBe(4.2);
    expect(result[0].metadata.reviewCount).toBe(85);
  });

  it('should detect masked phone in Foody results', () => {
    const html = loadFixture('foody-search.html');
    const result = normalizeFnbMerchantResults(html, 'search', { platform: 'foody' });
    expect(result[1].metadata.phone).toBeNull();
    expect(result[1].metadata.phoneMasked).toBe(true);
  });

  it('should parse Riviu SSR HTML', () => {
    const html = loadFixture('riviu-search.html');
    const result = normalizeFnbMerchantResults(html, 'search', { platform: 'riviu' });
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('riviu');
    expect(result[0].category).toBe('fnb_merchant');
    expect(result[0].metadata.restaurantName).toBe('Nhà Hàng ABC');
    expect(result[0].metadata.phone).toBe('0923456789');
    expect(result[0].metadata.rating).toBe(4.0);
    expect(result[0].metadata.reviewCount).toBe(56);
  });

  it('should detect masked phone in Riviu results', () => {
    const html = loadFixture('riviu-search.html');
    const result = normalizeFnbMerchantResults(html, 'search', { platform: 'riviu' });
    expect(result[1].metadata.phone).toBeNull();
    expect(result[1].metadata.phoneMasked).toBe(true);
  });

  it('should return empty array for invalid HTML', () => {
    const result = normalizeFnbMerchantResults('', 'search', { platform: 'pasgo' });
    expect(result).toEqual([]);
  });

  it('should expose normalizeFnbResults alias', () => {
    expect(normalizeFnbResults).toBe(normalizeFnbMerchantResults);
  });

  it('should filter newly opened Foody results', () => {
    const html = loadFixture('foody-search.html');
    const result = normalizeFnbMerchantResults(html, 'newly_opened', { platform: 'foody', days: 30 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].metadata.restaurantName).toBe('Quán Ăn XYZ');
  });

  it('should filter by district in Foody results', () => {
    const html = loadFixture('foody-search.html');
    const result = normalizeFnbMerchantResults(html, 'search_by_district', { platform: 'foody', district: 'Quận 3' });
    expect(result).toHaveLength(1);
    expect(result[0].metadata.restaurantName).toBe('Quán Ăn XYZ');
  });

  it('should parse PasGo detail result', () => {
    const html = loadFixture('pasgo-detail.html');
    const result = normalizeFnbMerchantResults(html, 'detail', { platform: 'pasgo' });
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('pasgo');
    expect(result[0].metadata.restaurantName).toBeDefined();
  });

  it('should parse Foody detail result', () => {
    const html = loadFixture('foody-detail.html');
    const result = normalizeFnbMerchantResults(html, 'detail', { platform: 'foody' });
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('foody');
    expect(result[0].metadata.restaurantName).toBeDefined();
  });

  it('should parse Riviu detail result', () => {
    const html = loadFixture('riviu-detail.html');
    const result = normalizeFnbMerchantResults(html, 'detail', { platform: 'riviu' });
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('riviu');
    expect(result[0].metadata.restaurantName).toBeDefined();
  });
});
