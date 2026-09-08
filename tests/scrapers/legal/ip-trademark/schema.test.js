import { describe, it, expect } from 'vitest';
import {
  IP_LEGAL_PLATFORMS,
  IP_LEGAL_BASE_URLS,
  normalizeApplicationNumber,
  parseVnDate,
} from '../../../../src/scrapers/legal/ip-trademark/schema.js';

describe('Story 22.3: Legal & Trademark Schema Helpers', () => {
  it('defines IP_LEGAL_PLATFORMS and IP_LEGAL_BASE_URLS', () => {
    expect(IP_LEGAL_PLATFORMS).toContain('ipvietnam');
    expect(IP_LEGAL_BASE_URLS.ipvietnam).toBe('https://ipvietnam.gov.vn');
  });

  describe('normalizeApplicationNumber', () => {
    it('normalizes standard formatted numbers', () => {
      expect(normalizeApplicationNumber('4-2026-11740')).toBe('4-2026-11740');
    });

    it('cleans spaces and slashes/dots', () => {
      expect(normalizeApplicationNumber(' 4 - 2024 - 14654 ')).toBe('4-2024-14654');
      expect(normalizeApplicationNumber('4/2024/14654')).toBe('4-2024-14654');
      expect(normalizeApplicationNumber('4.2024.14654')).toBe('4-2024-14654');
    });

    it('returns empty string for non-string or falsy input', () => {
      expect(normalizeApplicationNumber(null)).toBe('');
      expect(normalizeApplicationNumber(undefined)).toBe('');
      expect(normalizeApplicationNumber(12345)).toBe('');
    });
  });

  describe('parseVnDate', () => {
    it('parses valid DD/MM/YYYY dates to ISO', () => {
      expect(parseVnDate('08/04/2024')).toBe('2024-04-08T00:00:00.000Z');
      expect(parseVnDate('10-04-2026')).toBe('2026-04-10T00:00:00.000Z');
      expect(parseVnDate('1/5/2025')).toBe('2025-05-01T00:00:00.000Z');
    });

    it('returns null for invalid or unparseable dates', () => {
      expect(parseVnDate(null)).toBeNull();
      expect(parseVnDate('')).toBeNull();
      expect(parseVnDate('not-a-date')).toBeNull();
      expect(parseVnDate('32/01/2026')).toBeNull();
      expect(parseVnDate('15/13/2026')).toBeNull();
    });
  });
});
