// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy Network schema definitions and normalization utilities.
 * Supports Medpro, YouMed, Long Chau, and Thuocsi.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseVnPhone } from '../../utils/vn-phone.js';

export const HEALTHCARE_PLATFORMS = Object.freeze([
  'medpro',
  'youmed',
  'nhathuoclongchau',
  'thuocsi',
]);

export const HEALTHCARE_BASE_URLS = Object.freeze({
  medpro: 'https://medpro.vn',
  youmed: 'https://youmed.vn',
  nhathuoclongchau: 'https://nhathuoclongchau.com.vn',
  thuocsi: 'https://thuocsi.vn',
});

export const CITY_SLUG_MAP = Object.freeze({
  'hà nội': 'ha-noi',
  'ha noi': 'ha-noi',
  'hn': 'ha-noi',
  'thành phố hồ chí minh': 'ho-chi-minh',
  'tp. hồ chí minh': 'ho-chi-minh',
  'tp hồ chí minh': 'ho-chi-minh',
  'hồ chí minh': 'ho-chi-minh',
  'ho chi minh': 'ho-chi-minh',
  'tp.hcm': 'ho-chi-minh',
  'tp-hcm': 'ho-chi-minh',
  'hcm': 'ho-chi-minh',
  'đà nẵng': 'da-nang',
  'da nang': 'da-nang',
  'hải phòng': 'hai-phong',
  'hai phong': 'hai-phong',
  'cần thơ': 'can-tho',
  'can tho': 'can-tho',
  'bình dương': 'binh-duong',
  'đồng nai': 'dong-nai',
});

/**
 * Remove Vietnamese diacritics and convert to URL-safe kebab slug.
 * @param {string} text
 * @returns {string}
 */
export function removeVietnameseDiacritics(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Normalize a city name or slug to standard healthcare platform format.
 * @param {string} city
 * @returns {string}
 */
export function normalizeCitySlug(city) {
  if (typeof city !== 'string' || !city.trim()) return '';
  const key = city.trim().toLowerCase();
  const map = /** @type {Record<string, string>} */ (CITY_SLUG_MAP);
  if (map[key]) return map[key];
  return removeVietnameseDiacritics(city);
}

/**
 * Normalize specialty name to standard slug.
 * @param {string} specialty
 * @returns {string}
 */
export function normalizeSpecialtySlug(specialty) {
  if (typeof specialty !== 'string' || !specialty.trim()) return '';
  return removeVietnameseDiacritics(specialty);
}

// Re-export so existing `import { parseVnPhone } from './schema.js'` callers keep working.
export { parseVnPhone };
