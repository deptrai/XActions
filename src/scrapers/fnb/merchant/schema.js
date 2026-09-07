// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant metadata schema, constants, and normalization helpers.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { normalizeProvinceSlug } from '../../procurement/masothue/schema.js';

/** @type {Record<string, string>} */
export const FNB_CITY_SLUGS = {
  'ha-noi': 'ha-noi',
  'hanoi': 'ha-noi',
  'ho-chi-minh': 'ho-chi-minh',
  'tphcm': 'ho-chi-minh',
  'sai-gon': 'ho-chi-minh',
  'da-nang': 'da-nang',
  'hai-phong': 'hai-phong',
  'can-tho': 'can-tho',
  'binh-duong': 'binh-duong',
  'dong-nai': 'dong-nai',
  'ba-ria-vung-tau': 'ba-ria-vung-tau',
  'khanh-hoa': 'khanh-hoa',
  'lam-dong': 'lam-dong',
  'hue': 'hue',
  'nghe-an': 'nghe-an',
  'quang-ninh': 'quang-ninh',
  'thanh-hoa': 'thanh-hoa',
  'vung-tau': 'vung-tau',
  'buon-ma-thuot': 'buon-ma-thuot',
  'da-lat': 'da-lat',
};

/** @type {Record<string, string[]>} */
export const FNB_CITY_DISTRICTS = {
  'ha-noi': [
    'ba-dinh', 'hoan-kiem', 'dong-da', 'hai-ba-trung', 'cau-giay',
    'tay-ho', 'thanh-xuan', 'hoang-mai', 'long-bien', 'nam-tu-liem',
    'bac-tu-liem', 'ha-dong', 'thanh-tri', 'gia-lam', 'dong-anh',
    'soc-son', 'me-linh', 'ba-vi', 'phuc-tho', 'dan-phuong',
    'hoai-duc', 'quoc-oai', 'thach-that', 'chuong-my', 'thanh-oai',
    'thuong-tin', 'phu-xuyen', 'ung-hoa', 'my-duc', 'son-tay',
  ],
  'ho-chi-minh': [
    'quan-1', 'quan-2', 'quan-3', 'quan-4', 'quan-5', 'quan-6',
    'quan-7', 'quan-8', 'quan-9', 'quan-10', 'quan-11', 'quan-12',
    'binh-thanh', 'go-vap', 'phu-nhuan', 'tan-binh', 'tan-phu',
    'binh-tan', 'thu-duc', 'cu-chi', 'hoc-mon', 'binh-chanh',
    'nha-be', 'can-gio', 'binh-chanh', 'thu-thiem',
  ],
};

/**
 * Normalize city input to platform-specific slug.
 * @param {string} input
 * @param {string} [platform='pasgo']
 * @returns {string}
 */
export function normalizeCitySlug(input, platform = 'pasgo') {
  if (!input || typeof input !== 'string') return '';
  const slug = normalizeProvinceSlug(input);
  return FNB_CITY_SLUGS[slug] || slug;
}

/**
 * Normalize district input to slug.
 * @param {string} input
 * @param {string} [city='ha-noi']
 * @returns {string}
 */
export function normalizeDistrictSlug(input, city = 'ha-noi') {
  if (!input || typeof input !== 'string') return '';
  const slug = input.toLowerCase().trim()
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const districts = FNB_CITY_DISTRICTS[city] || [];
  if (!districts.includes(slug)) {
    // Unknown district — return the slug anyway so the site can decide whether to 404 or redirect.
    return slug;
  }
  return slug;
}

/**
 * Validate and format Vietnamese phone number.
 * @param {string | null | undefined} phone
 * @returns {{ phone: string | null, phoneMasked: boolean }}
 */
export function parseVnPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { phone: null, phoneMasked: false };
  }

  const trimmed = phone.trim();
  if (!trimmed) return { phone: null, phoneMasked: false };

  if (trimmed.includes('*') || trimmed.includes('x') || trimmed.toLowerCase().includes('không hiển thị')) {
    return { phone: null, phoneMasked: true };
  }

  const digits = trimmed.replace(/\D/g, '');
  // Convert +84 / 84 prefix to 0 prefix
  const normalized = digits.replace(/^(?:\+?84|84)/, '0');
  if (/^0\d{9,10}$/.test(normalized)) {
    return { phone: normalized, phoneMasked: false };
  }

  return { phone: trimmed, phoneMasked: false };
}

/**
 * Parse rating string to number.
 * @param {string | number} text
 * @returns {number | null}
 */
export function parseRating(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const match = String(text).match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse review count from text.
 * @param {string | number} text
 * @returns {number | null}
 */
export function parseReviewCount(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const match = String(text).match(/(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse opening date to Date.
 * @param {string} text
 * @returns {Date | null}
 */
export function parseOpeningDate(text) {
  if (!text || typeof text !== 'string') return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Check if a restaurant is newly opened within N days.
 * @param {Date | null} openingDate
 * @param {number} days
 * @returns {boolean}
 */
export function isNewlyOpened(openingDate, days = 30) {
  if (!openingDate || !(openingDate instanceof Date)) return false;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return openingDate >= cutoff;
}
