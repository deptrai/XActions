// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization utilities for TopCV Recruitment data
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const NEGOTIATION_KEYWORDS = ['thương lượng', 'thỏa thuận', 'thoả thuận', 'negotiable'];
const SALARY_NUMBER_RE = /[\d.,]+\s*(?:tr(?:iệu)?|k|m|b|t)?/gi;
const SALARY_PERIOD_RE = /\b(tháng|month|năm|year|giờ|hour|ngày|day)\b/i;

/**
 * Convert a Vietnamese search phrase into a TopCV URL slug.
 * @param {string} keyword
 * @returns {string}
 */
export function normalizeKeywordToSlug(keyword) {
  if (!keyword || typeof keyword !== 'string') return 'viec-lam';

  let text = keyword.normalize('NFD').replace(/[̀-ͯ]/g, '');
  text = text.replace(/đ/g, 'd').replace(/Đ/g, 'D');
  text = text.toLowerCase().replace(/[^a-z0-9\s+-]/g, '');
  text = text.trim().replace(/\s+/g, '-').replace(/-+/g, '-');
  const slug = text.replace(/^-+|-+$/g, '');
  return slug || 'viec-lam';
}

/**
 * Parse Vietnamese salary string into structured salary numbers.
 * @param {string} text
 * @returns {{ salaryMin: number | null, salaryMax: number | null, salaryCurrency: string, isNegotiable: boolean }}
 */
export function parseVietnameseSalary(text) {
  if (!text || typeof text !== 'string') {
    return { salaryMin: 0, salaryMax: 0, salaryCurrency: 'VND', isNegotiable: true };
  }

  const lower = text.toLowerCase();
  if (NEGOTIATION_KEYWORDS.some((k) => lower.includes(k))) {
    return { salaryMin: 0, salaryMax: 0, salaryCurrency: 'VND', isNegotiable: true };
  }

  const currency = text.includes('$') || lower.includes('usd') ? 'USD' : 'VND';
  const numbers = [];
  const units = [];

  const matches = text.match(SALARY_NUMBER_RE) || [];
  for (const rawToken of matches) {
    let token = rawToken.trim();
    if (!token) continue;

    if (currency === 'VND') {
      token = token.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    } else {
      token = token.replace(/,/g, '');
    }

    const lowerToken = token.toLowerCase();
    let unit = 1.0;

    if (lowerToken.endsWith('tr') || lowerToken.endsWith('triệu') || lowerToken.endsWith('m')) {
      unit = 1000000;
      token = token.replace(/(?:tr(?:iệu)?|m)$/i, '').trim();
    } else if (lowerToken.endsWith('k')) {
      unit = 1000;
      token = token.slice(0, -1).trim();
    } else if (lowerToken.endsWith('b')) {
      unit = 1000000000;
      token = token.slice(0, -1).trim();
    }

    const val = parseFloat(token);
    if (!Number.isNaN(val)) {
      numbers.push(val);
      units.push(unit);
    }
  }

  if (numbers.length === 0) {
    return { salaryMin: 0, salaryMax: 0, salaryCurrency: currency, isNegotiable: true };
  }

  const sharedUnit = units.find((u) => u > 1) || 1.0;
  const normalizedNumbers = numbers.map((n, i) => n * (units[i] === 1 ? sharedUnit : units[i]));

  let salaryMin = Math.round(normalizedNumbers[0]);
  let salaryMax = normalizedNumbers.length > 1 ? Math.round(normalizedNumbers[normalizedNumbers.length - 1]) : null;

  const hasFrom = lower.includes('từ') || lower.includes('from');
  const hasTo = lower.includes('tới') || lower.includes('up to') || lower.includes('đến') || lower.includes('lên đến');

  if (hasFrom && hasTo) {
    salaryMin = Math.round(normalizedNumbers[0]);
    salaryMax = Math.round(normalizedNumbers[normalizedNumbers.length - 1]);
  } else if (hasTo) {
    salaryMin = 0;
    salaryMax = Math.round(normalizedNumbers[0]);
  } else if (hasFrom) {
    salaryMin = Math.round(normalizedNumbers[0]);
    salaryMax = normalizedNumbers.length > 1 ? Math.round(normalizedNumbers[normalizedNumbers.length - 1]) : null;
  }

  return {
    salaryMin,
    salaryMax,
    salaryCurrency: currency,
    isNegotiable: false,
  };
}

/**
 * Extract experience years number.
 * @param {string} [text]
 * @returns {number | null}
 */
export function parseExperienceYears(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(\d+)\s*\+?\s*(?:năm|years?)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Map employment type string.
 * @param {string} [text]
 * @returns {string | null}
 */
export function mapEmploymentType(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  if (lower.includes('toàn thời gian') || lower.includes('full time') || lower.includes('full-time')) return 'full_time';
  if (lower.includes('bán thời gian') || lower.includes('part time') || lower.includes('part-time')) return 'part_time';
  if (lower.includes('thực tập') || lower.includes('intern')) return 'intern';
  if (lower.includes('hợp đồng') || lower.includes('contract')) return 'contract';
  if (lower.includes('remote') || lower.includes('từ xa')) return 'remote';
  return null;
}

/**
 * Strip HTML tags to get plain text.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
