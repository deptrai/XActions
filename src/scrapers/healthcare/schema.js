// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy Network schema definitions and normalization utilities.
 * Supports Medpro, YouMed, Long Chau, and Thuocsi.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

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
  if (CITY_SLUG_MAP[key]) return CITY_SLUG_MAP[key];
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

const VN_PHONE_RE = /^(?:02[0-9]{9}|1[89]00[0-9]{4,6}|(?:\+84|84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7})$/;
const MASKED_PHONE_RE = /[*xX]{2,}|\.{3,}|không hiển thị|ẩn|liên hệ/i;

/**
 * Parse and validate Vietnamese phone number (mobile, landline with area code, or 1800/1900 hotline).
 * @param {string | null | undefined} rawPhone
 * @returns {{ phone: string | null, phoneMasked: boolean }}
 */
export function parseVnPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { phone: null, phoneMasked: false };
  }
  const cleaned = rawPhone.replace(/[\s().-]/g, '').trim();
  if (MASKED_PHONE_RE.test(cleaned)) {
    return { phone: null, phoneMasked: true };
  }
  const normalized = cleaned.startsWith('+84')
    ? '0' + cleaned.slice(3)
    : cleaned.startsWith('84') && cleaned.length >= 11
      ? '0' + cleaned.slice(2)
      : cleaned;
  if (VN_PHONE_RE.test(normalized)) {
    return { phone: normalized, phoneMasked: false };
  }
  return { phone: null, phoneMasked: false };
}
