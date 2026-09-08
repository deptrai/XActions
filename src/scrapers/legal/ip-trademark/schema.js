// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Legal & Intellectual Property Trademark schema definitions and normalization utilities.
 * Supports Vietnam Intellectual Property Office (Cục Sở hữu Trí tuệ - ipvietnam.gov.vn).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export const IP_LEGAL_PLATFORMS = Object.freeze([
  'ipvietnam',
]);

export const IP_LEGAL_BASE_URLS = Object.freeze({
  ipvietnam: 'https://ipvietnam.gov.vn',
});

export const GAZETTE_WEEKLY_PATH = '/web/guest/danh-sach-don-chuyen-cong-bo-hang-tuan';

/**
 * Standardize an application number to format (e.g. "4-2026-11740").
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function normalizeApplicationNumber(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  // Match patterns like "4-2024-14654", "4/2024/14654", "4.2024.14654", "4 - 2024 - 14654"
  const normalized = trimmed.replace(/\s+/g, '').replace(/[/.]/g, '-');
  return normalized;
}

/**
 * Parse a Vietnamese date string in DD/MM/YYYY or DD-MM-YYYY format into an ISO string.
 * @param {string | null | undefined} rawDate
 * @returns {string | null} ISO 8601 string (e.g. "2024-04-08T00:00:00.000Z") or null
 */
export function parseVnDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const match = rawDate.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\D|$)/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Validate that month and day did not roll over (e.g., Feb 30 or Feb 31)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}
