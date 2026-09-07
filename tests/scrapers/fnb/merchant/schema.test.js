// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant schema helpers — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeCitySlug, normalizeDistrictSlug, parseVnPhone, parseRating, parseReviewCount, parseOpeningDate, isNewlyOpened } from '../../../../src/scrapers/fnb/merchant/schema.js';

describe('normalizeCitySlug', () => {
  it('should normalize known city slugs', () => {
    expect(normalizeCitySlug('Hà Nội')).toBe('ha-noi');
    expect(normalizeCitySlug('TP.HCM')).toBe('ho-chi-minh');
    expect(normalizeCitySlug('Sài Gòn')).toBe('ho-chi-minh');
  });

  it('should return slug for unknown cities', () => {
    expect(normalizeCitySlug('Da Nang')).toBe('da-nang');
  });

  it('should return empty for invalid input', () => {
    expect(normalizeCitySlug('')).toBe('');
    expect(normalizeCitySlug(null)).toBe('');
  });
});

describe('normalizeDistrictSlug', () => {
  it('should normalize district names', () => {
    expect(normalizeDistrictSlug('Quận 1', 'ho-chi-minh')).toBe('quan-1');
    expect(normalizeDistrictSlug('Đống Đa', 'ha-noi')).toBe('dong-da');
  });

  it('should return slug for unknown districts', () => {
    expect(normalizeDistrictSlug('Unknown District', 'ha-noi')).toBe('unknown-district');
  });
});

describe('parseVnPhone', () => {
  it('should parse valid VN phone', () => {
    expect(parseVnPhone('0901234567')).toEqual({ phone: '0901234567', phoneMasked: false });
    expect(parseVnPhone('+84901234567')).toEqual({ phone: '0901234567', phoneMasked: false });
  });

  it('should detect masked phone', () => {
    expect(parseVnPhone('***')).toEqual({ phone: null, phoneMasked: true });
    expect(parseVnPhone('không hiển thị')).toEqual({ phone: null, phoneMasked: true });
  });

  it('should return null for empty input', () => {
    expect(parseVnPhone('')).toEqual({ phone: null, phoneMasked: false });
    expect(parseVnPhone(null)).toEqual({ phone: null, phoneMasked: false });
  });
});

describe('parseRating', () => {
  it('should parse rating strings', () => {
    expect(parseRating('4.5')).toBe(4.5);
    expect(parseRating('4,5')).toBe(4.5);
    expect(parseRating(4.2)).toBe(4.2);
  });

  it('should return null for invalid', () => {
    expect(parseRating('abc')).toBeNull();
    expect(parseRating(null)).toBeNull();
  });
});

describe('parseReviewCount', () => {
  it('should parse review counts', () => {
    expect(parseReviewCount('120')).toBe(120);
    expect(parseReviewCount(85)).toBe(85);
  });
});

describe('parseOpeningDate', () => {
  it('should parse ISO date strings', () => {
    const date = parseOpeningDate('2026-08-15');
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).not.toBeNaN();
  });

  it('should return null for invalid dates', () => {
    expect(parseOpeningDate('not-a-date')).toBeNull();
    expect(parseOpeningDate('')).toBeNull();
    expect(parseOpeningDate(null)).toBeNull();
  });
});

describe('isNewlyOpened', () => {
  it('should return true for dates within cutoff', () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(isNewlyOpened(recent, 30)).toBe(true);
  });

  it('should return false for dates beyond cutoff', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(isNewlyOpened(old, 30)).toBe(false);
  });

  it('should return false for null/invalid', () => {
    expect(isNewlyOpened(null, 30)).toBe(false);
    expect(isNewlyOpened('invalid', 30)).toBe(false);
  });
});
