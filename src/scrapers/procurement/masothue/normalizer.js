// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue HTML → PostItem normalizer.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';
import { resolveProvince } from './schema.js';

const TAG_RE = /<[^>]+>/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/&(#?x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[entity] ?? m;
  });
}

function stripTags(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(html.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim());
}

function extractTableValue(html, label) {
  const lowerHtml = html.toLowerCase();
  const idx = lowerHtml.indexOf(label.toLowerCase());
  if (idx === -1) return '';
  const after = html.slice(idx);
  // Match the <td> immediately after the label's closing </td>
  const m = after.match(/<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (!m) return '';
  const value = m[1].replace(/<\/?(span|a|strong|em|i|b)[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
  return value.replace(/^[:\s-]+|[:\s-]+$/g, '');
}

function extractName(html, taxCode) {
  const h1Match = html.match(/<h1[^>]*>\s*([^<]+)<\/h1>/i) || html.match(/<h2[^>]*>\s*([^<]+)<\/h2>/i);
  if (h1Match) {
    const raw = stripTags(h1Match[1]);
    const parts = raw.split(/\s*[-–—]\s*/);
    const name = parts.length > 1 ? parts.slice(1).join(' - ') : parts[0];
    if (name && !name.match(/^\d+$/)) return name.replace(/-\s*MaSoThue\s*$/i, '').trim();
  }

  const itempropName = html.match(/itemprop="name"[^>]*>\s*<span[^>]*>\s*([^<]+)<\/span>/i) ||
    html.match(/itemprop="name"[^>]*>([^<]+)</i);
  if (itempropName) {
    const name = stripTags(itempropName[1]);
    if (name && !name.match(/^\d+$/)) return name.replace(/-\s*MaSoThue\s*$/i, '').trim();
  }

  const escapedTaxCode = taxCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const textMatch = html.match(new RegExp(`${escapedTaxCode}\\s*[-–—]\\s*([^<\\n]{2,200})`));
  if (textMatch) {
    const name = stripTags(textMatch[1]).replace(/-\s*MaSoThue\s*$/i, '').trim();
    if (name && !name.match(/^\d+$/)) return name;
  }

  return null;
}

function extractDetail(html, taxCode, province) {
  const address = extractTableValue(html, 'Địa chỉ') || extractTableValue(html, 'Địa chỉ Thuế');
  const businessLines = extractTableValue(html, 'Ngành nghề chính');
  const representativeName = extractTableValue(html, 'Người đại diện');
  const phone = html.match(/itemprop=['"]telephone['"][^>]*>\s*<span[^>]*>\s*([^<]+)<\/span>/i)?.[1] || '';
  const statusMatch = html.match(/id=['"]tax-status-html['"][^>]*>(?:<a[^>]*>)?([^<]+)/i);
  const status = statusMatch ? stripTags(statusMatch[1]) : '';

  const companyName = extractName(html, taxCode) || `Company ${taxCode}`;

  return {
    id: generatePostId('masothue', taxCode),
    platform: 'masothue',
    externalId: taxCode,
    category: 'b2b',
    authorId: taxCode,
    authorName: companyName,
    content: `Mã số thuế: ${taxCode} — ${companyName}${address ? ` — ${address}` : ''}`,
    metadata: {
      taxCode,
      companyName,
      address,
      businessLines,
      representativeName,
      phone,
      status,
      detailUrl: `https://masothue.com/${taxCode}`,
      province,
    },
    crawledAt: new Date(),
  };
}

function extractListing(html, province) {
  const items = [];
  const seen = new Set();
  const prefetchBlocks = html.match(/<div[^>]*data-prefetch=['"](?:\/(\d{9,13}(?:-\d{1,3})?-[^'"\s]*))['"][^>]*>[\s\S]*?(<\/div>|<hr\s*\/?>)/gi) || [];

  for (const block of prefetchBlocks) {
    const prefetchMatch = block.match(/data-prefetch=['"]\/(\d{9,13}(?:-\d{1,3})?)-([^'"\s]*)['"]/i);
    if (!prefetchMatch) continue;
    const taxCode = prefetchMatch[1];
    const slug = prefetchMatch[2];
    if (seen.has(taxCode) || !slug) continue;
    seen.add(taxCode);

    const nameMatch = block.match(/<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
      block.match(/<a[^>]*title=['"]Tra cứu mã số thuế \d+\s+([^"']+)['"][^>]*>/i);
    const companyName = nameMatch ? stripTags(nameMatch[1]) : `Company ${taxCode}`;

    const addrMatch = block.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
    const address = addrMatch ? stripTags(addrMatch[1]) : '';

    const repMatch = block.match(/Người đại diện:\s*<em>\s*<a[^>]*>([^<]+)<\/a>/i);
    const representativeName = repMatch ? stripTags(repMatch[1]) : '';

    items.push({
      id: generatePostId('masothue', taxCode),
      platform: 'masothue',
      externalId: taxCode,
      category: 'b2b',
      authorId: taxCode,
      authorName: companyName,
      content: `Mã số thuế: ${taxCode} — ${companyName}${address ? ` — ${address}` : ''}`,
      metadata: {
        taxCode,
        companyName,
        address,
        businessLines: '',
        representativeName,
        detailUrl: `https://masothue.com/${taxCode}-${slug}`,
        province,
      },
      crawledAt: new Date(),
    });
  }

  if (items.length) return items;

  // Fallback for non-listing HTML: any `/{taxCode}-{slug}` anchors.
  const anchorBlocks = html.match(/<a[^>]*href=['"]\/(\d{9,13}(?:-\d{1,3})?)-([^'"\s]+)['"][^>]*>([^<]+)<\/a>/gi) || [];
  for (const block of anchorBlocks) {
    const m = block.match(/href=['"]\/(\d{9,13}(?:-\d{1,3})?)-([^'"\s]+)['"][^>]*>([^<]+)<\/a>/i);
    if (!m) continue;
    const taxCode = m[1];
    const slug = m[2];
    const rawText = stripTags(m[3]);
    if (seen.has(taxCode)) continue;
    seen.add(taxCode);

    let companyName = '';
    if (rawText) {
      const parts = rawText.split(/\s*[-–—]\s*/);
      companyName = parts.length > 1 ? parts.slice(1).join(' - ') : parts[0];
      companyName = companyName.replace(/-\s*MaSoThue\s*$/i, '').trim();
    }
    if (!companyName) companyName = `Company ${taxCode}`;

    items.push({
      id: generatePostId('masothue', taxCode),
      platform: 'masothue',
      externalId: taxCode,
      category: 'b2b',
      authorId: taxCode,
      authorName: companyName,
      content: `Mã số thuế: ${taxCode} — ${companyName}`,
      metadata: {
        taxCode,
        companyName,
        address: '',
        businessLines: '',
        representativeName: '',
        detailUrl: `https://masothue.com/${taxCode}-${slug}`,
        province,
      },
      crawledAt: new Date(),
    });
  }

  return items;
}

export function normalizeMaSoThueResults(html, kind = 'search', options = {}) {
  if (typeof html !== 'string' || html.length < 100) return [];

  const provinceInfo = resolveProvince(options.province) || {};
  const provinceName = provinceInfo.name || options.province || '';

  if (kind === 'detail' && options.taxCode) {
    return [extractDetail(html, options.taxCode, provinceName)];
  }

  return extractListing(html, provinceName);
}
