// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Automotive metadata schema, constants, and normalization helpers.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { normalizeProvinceSlug } from '../../procurement/masothue/schema.js';

/** @type {Record<string, string>} */
export const AUTOMOTIVE_CITY_SLUGS = {
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
};

/** @type {Record<string, string>} */
export const AUTOMOTIVE_BRAND_ALIASES = {
  'toyota': 'toyota',
  'honda': 'honda',
  'mazda': 'mazda',
  'kia': 'kia',
  'hyundai': 'hyundai',
  'mitsubishi': 'mitsubishi',
  'ford': 'ford',
  'nissan': 'nissan',
  'suzuki': 'suzuki',
  'mercedes': 'mercedes-benz',
  'mercedes-benz': 'mercedes-benz',
  'bmw': 'bmw',
  'audi': 'audi',
  'lexus': 'lexus',
  'porsche': 'porsche',
  'vinfast': 'vinfast',
  'hino': 'hino',
  'isuzu': 'isuzu',
  'chevrolet': 'chevrolet',
  'peugeot': 'peugeot',
  'volkswagen': 'volkswagen',
  'kawasaki': 'kawasaki',
  'yamaha': 'yamaha',
  'sym': 'sym',
  'piaggio': 'piaggio',
  'vespa': 'vespa',
};

/**
 * Normalize city input to Oto.com.vn / BonBanh slug.
 * @param {string} input
 * @returns {string}
 */
export function normalizeCitySlug(input) {
  if (!input || typeof input !== 'string') return '';
  const slug = normalizeProvinceSlug(input);
  return AUTOMOTIVE_CITY_SLUGS[slug] || slug;
}

/**
 * Normalize brand input to canonical slug.
 * @param {string} input
 * @returns {string}
 */
export function normalizeBrandSlug(input) {
  if (!input || typeof input !== 'string') return '';
  const normalized = input.toLowerCase().trim().replace(/\s+/g, '-');
  return AUTOMOTIVE_BRAND_ALIASES[normalized] || normalized;
}

/**
 * Parse Vietnamese price string to integer VND.
 * @param {string} text
 * @returns {{ price: number | null, priceFormatted: string, priceNegotiable: boolean }}
 */
export function parseVndPrice(text) {
  if (!text || typeof text !== 'string') {
    return { price: null, priceFormatted: '', priceNegotiable: false };
  }

  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes('thỏa thuận') || lower.includes('giá alo') || lower.includes('liên hệ')) {
    return { price: null, priceFormatted: cleaned, priceNegotiable: true };
  }

  let total = 0;
  let found = false;

  // Match "1 tỷ 250 triệu" or "1 tỷ"
  const tyMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*tỷ/);
  if (tyMatch) {
    const num = parseFloat(tyMatch[1].replace(',', '.'));
    if (Number.isFinite(num)) {
      total += num * 1_000_000_000;
      found = true;
    }
  }

  // Match "250 triệu" or "795 triệu"
  const trieuMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*triệu/);
  if (trieuMatch) {
    const num = parseFloat(trieuMatch[1].replace(',', '.'));
    if (Number.isFinite(num)) {
      total += num * 1_000_000;
      found = true;
    }
  }

  // Match raw number like "795.000.000" or "795000000"
  if (!found) {
    const rawMatch = cleaned.replace(/[.,\s]/g, '').match(/(\d{6,})/);
    if (rawMatch) {
      const num = parseInt(rawMatch[1], 10);
      if (Number.isFinite(num)) {
        total = num;
        found = true;
      }
    }
  }

  if (!found) {
    return { price: null, priceFormatted: cleaned, priceNegotiable: false };
  }

  return { price: Math.round(total), priceFormatted: cleaned, priceNegotiable: false };
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
  if (/^0\d{9,10}$/.test(digits)) {
    return { phone: digits, phoneMasked: false };
  }

  return { phone: trimmed, phoneMasked: false };
}

/**
 * Parse mileage string to number (km).
 * @param {string} text
 * @returns {{ mileage: number | null, mileageFormatted: string }}
 */
export function parseMileage(text) {
  if (!text || typeof text !== 'string') {
    return { mileage: null, mileageFormatted: '' };
  }

  const cleaned = text.trim();
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)\s*(?:km|nghìn km|km đã đi|odo)/i);
  if (!match) return { mileage: null, mileageFormatted: cleaned };

  let num = parseFloat(match[1].replace(',', '.'));
  if (cleaned.toLowerCase().includes('nghìn')) {
    num *= 1000;
  }

  return { mileage: Number.isFinite(num) ? Math.round(num) : null, mileageFormatted: cleaned };
}

/**
 * Normalize transmission string.
 * @param {string} text
 * @returns {string}
 */
export function normalizeTransmission(text) {
  if (!text || typeof text !== 'string') return '';
  const lower = text.toLowerCase();
  if (lower.includes('số tự động') || lower.includes('tự động') || lower.includes('at')) return 'số tự động';
  if (lower.includes('số sàn') || lower.includes('sàn') || lower.includes('mt')) return 'số sàn';
  if (lower.includes('số tay')) return 'số tay';
  return text.trim();
}

/**
 * Normalize fuel type string.
 * @param {string} text
 * @returns {string}
 */
export function normalizeFuel(text) {
  if (!text || typeof text !== 'string') return '';
  const lower = text.toLowerCase();
  if (lower.includes('xăng')) return 'xăng';
  if (lower.includes('dầu') || lower.includes('diesel')) return 'dầu';
  if (lower.includes('điện') || lower.includes('electric')) return 'điện';
  if (lower.includes('hybrid')) return 'hybrid';
  return text.trim();
}

/**
 * Infer seller type from text / flags.
 * @param {Object} options
 * @param {string} [options.text]
 * @param {string} [options.url]
 * @param {boolean} [options.companyAd]
 * @returns {'chinh-chu' | 'salon'}
 */
export function inferSellerType({ text = '', url = '', companyAd = false } = {}) {
  const lower = String(text).toLowerCase();
  const urlLower = String(url).toLowerCase();
  if (companyAd || lower.includes('salon') || lower.includes('đại lý') || urlLower.includes('salon')) {
    return 'salon';
  }
  return 'chinh-chu';
}
