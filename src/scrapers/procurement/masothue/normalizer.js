// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue HTML → PostItem normalizer.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';
import { resolveProvince } from './schema.js';

/**
 * Extract plain text content from HTML string using a safe regex fallback.
 * For real DOM parsing, consumers should use jsdom/cheerio — this is a minimal fallback.
 * @param {string} html
 * @param {string} tag
 * @param {string} [attr]
 * @param {string} [attrValue]
 * @returns {string[]}
 */
function extractTextByTag(html, tag, attr = '', attrValue = '') {
  const regex = new RegExp(`<${tag}[^>]*${attr ? `${attr}="${attrValue}"` : ''}[^>]*>([^<]*)<\\/${tag}>`, 'gi');
  const matches = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

/**
 * Normalize MaSoThue search results or detail page HTML into PostItem array.
 * For search results: each row/li becomes a PostItem.
 * For detail pages: single PostItem.
 *
 * @param {string} html
 * @param {'search' | 'province' | 'detail'} kind
 * @param {Object} [options]
 * @param {string} [options.baseUrl]
 * @param {string} [options.province]
 * @param {string} [options.detailUrl]
 * @param {string} [options.keyword]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeMaSoThueResults(html, kind = 'search', options = {}) {
  const items = [];
  const now = new Date();

  if (typeof html !== 'string' || html.length < 100) {
    return items;
  }

  // Fallback: strip tags and look for tax code patterns
  // Real implementation should use jsdom/cheerio for robust parsing.
  const taxCodePattern = /\b\d{9,13}\b/g;
  const taxCodes = new Set();
  let m;
  while ((m = taxCodePattern.exec(html)) !== null) {
    taxCodes.add(m[0]);
  }

  const province = options.province || '';
  const provinceInfo = resolveProvince(province) || {};

  for (const taxCode of taxCodes) {
    // Find nearby company name (naive extraction)
    const nameMatch = html.match(new RegExp(`>${taxCode}[^<]*<|(${taxCode}[^\\s]*)`, 'i'));
    const companyName = nameMatch ? (nameMatch[1] || nameMatch[0]).replace(/^>|</g, '').trim() : `Company ${taxCode}`;

    items.push({
      id: generatePostId('masothue', taxCode),
      platform: 'masothue',
      externalId: taxCode,
      category: 'b2b',
      authorId: taxCode,
      authorName: companyName,
      content: `Mã số thuế: ${taxCode}${companyName ? ` — ${companyName}` : ''}`,
      metadata: {
        taxCode,
        companyName,
        businessLines: extractTextByTag(html, 'span', 'itemprop', 'jobTitle').join('; ') || '',
        address: extractTextByTag(html, 'span', 'itemprop', 'address').join('; ') || '',
        detailUrl: options.detailUrl || `https://masothue.com/${taxCode}`,
        province: provinceInfo.name || province,
      },
      crawledAt: now,
    });
  }

  return items;
}
