// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue metadata schema and province constants.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/** @type {Record<string, { slug: string, id: number, name: string }>} */
export const MASOTHUE_PROVINCES = {
  'ho-chi-minh': { slug: 'ho-chi-minh', id: 79, name: 'Hồ Chí Minh' },
  'ha-noi': { slug: 'ha-noi', id: 1, name: 'Hà Nội' },
  'da-nang': { slug: 'da-nang', id: 48, name: 'Đà Nẵng' },
  'hai-phong': { slug: 'hai-phong', id: 31, name: 'Hải Phòng' },
  'can-tho': { slug: 'can-tho', id: 92, name: 'Cần Thơ' },
  'binh-duong': { slug: 'binh-duong', id: 74, name: 'Bình Dương' },
  'dong-nai': { slug: 'dong-nai', id: 75, name: 'Đồng Nai' },
  'long-an': { slug: 'long-an', id: 80, name: 'Long An' },
  'tay-ninh': { slug: 'tay-ninh', id: 72, name: 'Tây Ninh' },
  'ba-ria-vung-tau': { slug: 'ba-ria-vung-tau', id: 77, name: 'Bà Rịa - Vũng Tàu' },
};

/**
 * Resolve a province key (slug or hyphenated Vietnamese name) to a province entry.
 * @param {string} key
 * @returns {{ slug: string, id: number, name: string } | null}
 */
export function resolveProvince(key) {
  if (!key || typeof key !== 'string') return null;
  const normalized = key.toLowerCase().trim().replace(/\s+/g, '-');
  return MASOTHUE_PROVINCES[normalized] || null;
}

/**
 * Convert province name/slug to canonical hyphenated slug.
 * @param {string} input
 * @returns {string}
 */
export function normalizeProvinceSlug(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
