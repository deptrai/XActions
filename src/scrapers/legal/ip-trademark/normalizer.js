// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer for Legal & Intellectual Property Trademark data (ipvietnam.gov.vn).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CATEGORIES } from '../../../core/types.js';
import { normalizeApplicationNumber, parseVnDate } from './schema.js';

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(html) {
  if (!html || typeof html !== 'string') return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Extract articles from weekly gazette list HTML page.
 * @param {string} html
 * @returns {Array<{ title: string, url: string, date?: string }>}
 */
export function extractGazetteArticles(html) {
  if (!html || typeof html !== 'string') return [];
  const articles = [];
  const seenUrls = new Set();

  // Match links inside article list portlet
  // Typical href pattern: /web/guest/-/danh-sach-don-... or href="/web/guest/...-don-..."
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = decodeHtmlEntities(match[1].trim());
    const title = stripTags(match[2]);
    const isRelevant = /(?:danh-sach|cong-bo|nhan-hieu|don|tuan|gazette)/i.test(rawUrl) ||
      /(?:danh sách|công bố|nhãn hiệu|đơn|tuần)/i.test(title);
    if (rawUrl && title && isRelevant && !seenUrls.has(rawUrl) && !rawUrl.includes('javascript:') && !/\.(xlsx|xls|pdf|docx|doc)$/i.test(rawUrl)) {
      seenUrls.add(rawUrl);
      const url = rawUrl.startsWith('http') ? rawUrl : `https://ipvietnam.gov.vn${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      articles.push({ title, url });
    }
  }

  return articles;
}

/**
 * Extract yearly summary links (such as .xlsx or .pdf files).
 * @param {string} html
 * @returns {Array<{ title: string, url: string, fileType: string }>}
 */
export function extractYearlyDownloads(html) {
  if (!html || typeof html !== 'string') return [];
  const downloads = [];
  const seen = new Set();

  const fileRegex = /<a\s+[^>]*href=["']([^"']*\.(xlsx|xls|pdf|docx|doc))["'][^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = fileRegex.exec(html)) !== null) {
    const rawUrl = decodeHtmlEntities(match[1].trim());
    const fileType = match[2].toLowerCase();
    const title = stripTags(match[3]) || `Tài liệu công bố (.${fileType})`;
    if (rawUrl && !seen.has(rawUrl)) {
      seen.add(rawUrl);
      const url = rawUrl.startsWith('http') ? rawUrl : `https://ipvietnam.gov.vn${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      downloads.push({ title, url, fileType });
    }
  }

  return downloads;
}

/**
 * Extract weekly gazette table rows from article HTML.
 * Table columns: STT | Số đơn | Ngày nộp đơn | Ngày chuyển công bố
 * @param {string} html
 * @param {Object} [options={}]
 * @param {string} [options.articleUrl]
 * @param {string} [options.articleTitle]
 * @returns {Array<import('../../../core/types.js').PostItem>}
 */
export function extractWeeklyTableRows(html, options = {}) {
  if (!html || typeof html !== 'string') return [];

  const items = [];
  const articleUrl = options.articleUrl || 'https://ipvietnam.gov.vn';
  const articleTitle = options.articleTitle || 'Công báo Sở hữu Công nghiệp';

  // Extract gazette period from title if present (e.g. "tuần 14 năm 2026" or "tuần 34")
  const periodMatch = articleTitle.match(/tuần\s*(\d+)(?:\s*năm\s*(\d{4}))?/i);
  const gazettePeriod = periodMatch
    ? `Tuần ${periodMatch[1]}${periodMatch[2] ? '/' + periodMatch[2] : ''}`
    : 'Công bố hàng tuần';

  // Find table rows
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    // Extract td or th cells
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length >= 3) {
      // Possible layouts:
      // Layout A (4 columns): STT | Số đơn | Ngày nộp đơn | Ngày chuyển công bố
      // Layout B (3 columns): STT | Số đơn | Ngày nộp đơn
      // Layout C (3 columns): Số đơn | Ngày nộp đơn | Ngày chuyển công bố
      let rawAppNum = '';
      let rawAppDate = '';
      let rawPubDate = '';

      if (cells.length >= 4) {
        rawAppNum = cells[1];
        rawAppDate = cells[2];
        rawPubDate = cells[3];
      } else if (cells.length === 3) {
        // Check if cells[0] is numeric STT
        if (/^\d+$/.test(cells[0])) {
          rawAppNum = cells[1];
          rawAppDate = cells[2];
        } else {
          rawAppNum = cells[0];
          rawAppDate = cells[1];
          rawPubDate = cells[2];
        }
      }

      const appNum = normalizeApplicationNumber(rawAppNum);
      // Ensure application number has valid pattern (e.g. starts with digit or has hyphen)
      if (appNum && /\d/.test(appNum)) {
        const appDateIso = parseVnDate(rawAppDate);
        const pubDateIso = parseVnDate(rawPubDate);

        const postItem = {
          id: `ipvietnam:${appNum}`,
          platform: 'ipvietnam',
          externalId: appNum,
          title: `Đơn nhãn hiệu ${appNum}`,
          category: CATEGORIES.LEGAL,
          authorId: 'ipvietnam',
          authorName: 'Cục Sở hữu Trí tuệ Việt Nam',
          authorUrl: 'https://ipvietnam.gov.vn',
          postUrl: articleUrl,
          content: `Đơn nhãn hiệu ${appNum} - Ngày nộp đơn: ${rawAppDate || 'N/A'} - Ngày chuyển công bố: ${rawPubDate || 'N/A'} (${gazettePeriod})`,
          metadata: {
            applicationNumber: appNum,
            applicationDate: appDateIso,
            publicationDate: pubDateIso,
            rawApplicationDate: rawAppDate,
            rawPublicationDate: rawPubDate,
            gazettePeriod,
            status: 'chuyển công bố (hợp lệ)',
            sourcePlatform: 'ipvietnam',
          },
          crawledAt: new Date(),
        };

        items.push(postItem);
      }
    }
  }

  return items;
}

/**
 * Main normalizer dispatch.
 * @param {any} data
 * @param {'search_gazette' | 'get_weekly_list' | 'yearly_summary' | 'detail'} kind
 * @param {Record<string, any>} [options={}]
 * @returns {Array<import('../../../core/types.js').PostItem> | import('../../../core/types.js').PostItem | null}
 */
export function normalizeIpLegalResults(data, kind, options = {}) {
  const html = typeof data === 'string' ? data : data?.body || '';

  if (kind === 'search_gazette' || kind === 'search') {
    // If the HTML already contains a table with application numbers, parse rows directly
    const tableItems = extractWeeklyTableRows(html, options);
    if (tableItems.length > 0) return tableItems;

    // Otherwise, convert gazette articles into PostItems
    const articles = extractGazetteArticles(html);
    return articles.map((article, idx) => ({
      id: `ipvietnam:gazette-${idx + 1}-${Date.now()}`,
      platform: 'ipvietnam',
      externalId: `gazette-${idx + 1}`,
      title: article.title,
      category: CATEGORIES.LEGAL,
      authorId: 'ipvietnam',
      authorName: 'Cục Sở hữu Trí tuệ Việt Nam',
      authorUrl: 'https://ipvietnam.gov.vn',
      postUrl: article.url,
      content: article.title,
      metadata: {
        articleUrl: article.url,
        articleTitle: article.title,
        status: 'công bố',
        sourcePlatform: 'ipvietnam',
      },
      crawledAt: new Date(),
    }));
  }

  if (kind === 'get_weekly_list') {
    return extractWeeklyTableRows(html, options);
  }

  if (kind === 'yearly_summary') {
    const downloads = extractYearlyDownloads(html);
    return downloads.map((dl, idx) => ({
      id: `ipvietnam:yearly-${dl.fileType}-${idx + 1}`,
      platform: 'ipvietnam',
      externalId: `yearly-${idx + 1}`,
      title: dl.title,
      category: CATEGORIES.LEGAL,
      authorId: 'ipvietnam',
      authorName: 'Cục Sở hữu Trí tuệ Việt Nam',
      authorUrl: 'https://ipvietnam.gov.vn',
      postUrl: dl.url,
      content: `${dl.title} - Tải xuống tệp dữ liệu công bố (${dl.fileType})`,
      metadata: {
        downloadUrl: dl.url,
        fileType: dl.fileType,
        status: 'tổng hợp năm',
        sourcePlatform: 'ipvietnam',
      },
      crawledAt: new Date(),
    }));
  }

  if (kind === 'detail') {
    // If id is specified in options, search for row in table HTML matching id
    const targetId = normalizeApplicationNumber(options.id);
    const tableItems = extractWeeklyTableRows(html, options);
    if (targetId) {
      const found = tableItems.find((item) => item.metadata?.applicationNumber === targetId);
      if (found) return found;
    }

    if (tableItems.length > 0) {
      return tableItems[0];
    }

    if (targetId && html.includes(targetId)) {
      return {
        id: `ipvietnam:${targetId}`,
        platform: 'ipvietnam',
        externalId: targetId,
        title: `Đơn nhãn hiệu ${targetId}`,
        category: CATEGORIES.LEGAL,
        authorId: 'ipvietnam',
        authorName: 'Cục Sở hữu Trí tuệ Việt Nam',
        authorUrl: 'https://ipvietnam.gov.vn',
        postUrl: options.articleUrl || 'https://ipvietnam.gov.vn',
        content: `Đơn nhãn hiệu ${targetId}`,
        metadata: {
          applicationNumber: targetId,
          status: 'chuyển công bố (hợp lệ)',
          sourcePlatform: 'ipvietnam',
        },
        crawledAt: new Date(),
      };
    }

    return null;
  }

  return [];
}
