// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * HoSoCongTy & MuaSamCong HTML normalizer.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';

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

function extractByLabel(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp(`${escaped}[\\s:]+([^<\n]+)`, 'i'));
  if (m) return stripTags(m[1]).trim();
  return '';
}

function extractByClass(html, className) {
  const m = html.match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([^<]+)`, 'i'));
  return m ? stripTags(m[1]).trim() : '';
}

function buildPostItem(input) {
  const {
    platform,
    externalId,
    title = '',
    contentParts = [],
    authorId = '',
    authorName = '',
    authorUrl,
    postUrl = '',
    mediaUrls = [],
    publishedAt = null,
    metadata = {},
  } = input;

  return {
    id: generatePostId(platform, externalId),
    platform,
    externalId,
    category: 'b2b',
    title,
    authorId,
    authorName,
    authorUrl,
    postUrl,
    content: contentParts.filter(Boolean).join(' - '),
    mediaUrls,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt,
    crawledAt: new Date(),
    metadata,
  };
}

/**
 * Normalize HoSoCongTy company detail/search HTML to PostItem[].
 * @param {string} html
 * @param {'search' | 'detail'} kind
 * @param {Object} context
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeHosocongty(html, kind = 'search', context = {}) {
  // HoSoCongTy real structure unknown (Cloudflare blocked probe).
  // Use best-effort extraction from common VN company registry patterns.
  const items = [];

  if (kind === 'detail') {
    const taxCode = context.taxCode || extractByLabel(html, 'Mã số thuế') || extractByLabel(html, 'Tax code') || 'unknown';
    const companyName = extractByLabel(html, 'Tên công ty') || extractByLabel(html, 'Company name') || '';
    const representativeName = extractByLabel(html, 'Người đại diện') || extractByLabel(html, 'Representative') || '';
    const address = extractByLabel(html, 'Địa chỉ') || extractByLabel(html, 'Address') || '';
    const phone = extractByLabel(html, 'Số điện thoại') || extractByLabel(html, 'Phone') || '';
    const businessLines = extractByLabel(html, 'Ngành nghề') || extractByLabel(html, 'Business lines') || '';
    const charterCapital = extractByLabel(html, 'Vốn điều lệ') || extractByLabel(html, 'Charter capital') || '';
    const establishedDate = extractByLabel(html, 'Ngày thành lập') || extractByLabel(html, 'Established date') || '';
    const legalForm = extractByLabel(html, 'Loại hình') || extractByLabel(html, 'Legal form') || '';
    const status = extractByLabel(html, 'Tình trạng') || extractByLabel(html, 'Status') || '';

    if (companyName || taxCode !== 'unknown') {
      items.push(buildPostItem({
        platform: 'hosocongty',
        externalId: taxCode,
        title: companyName,
        contentParts: [companyName, businessLines, address, phone].filter(Boolean),
        authorId: phone || representativeName || `hosocongty:${taxCode}`,
        authorName: representativeName || 'Unknown',
        postUrl: context.postUrl || '',
        metadata: {
          taxCode,
          companyName,
          representativeName,
          phone,
          businessLines,
          charterCapital,
          establishedDate,
          address,
          legalForm,
          status,
        },
      }));
    }
  } else {
    // Search results: attempt to split by company blocks
    const blocks = html.match(/<div[^>]*class="[^"]*company[^"]*"[^>]*>.*?<\/div>/gi) || [];
    for (const block of blocks.slice(0, 50)) {
      const taxCode = extractByLabel(block, 'Mã số thuế') || '';
      const companyName = extractByLabel(block, 'Tên công ty') || '';
      if (!companyName) continue;

      items.push(buildPostItem({
        platform: 'hosocongty',
        externalId: taxCode || companyName,
        title: companyName,
        contentParts: [companyName, extractByLabel(block, 'Ngành nghề'), extractByLabel(block, 'Địa chỉ')].filter(Boolean),
        authorId: `hosocongty:${taxCode || companyName}`,
        authorName: extractByLabel(block, 'Người đại diện') || '',
        postUrl: '',
        metadata: {
          taxCode,
          companyName,
          address: extractByLabel(block, 'Địa chỉ'),
          businessLines: extractByLabel(block, 'Ngành nghề'),
        },
      }));
    }
  }

  return items;
}

/**
 * Extract top-level blocks matching a class marker while respecting nested <div> balance.
 * @param {string} html
 * @param {string} classMarker
 * @returns {string[]}
 */
function extractBalancedBlocks(html, classMarker) {
  const blocks = [];
  const marker = `class="${classMarker}`;
  let pos = html.indexOf(marker);
  while (pos !== -1) {
    const charAfter = html[pos + marker.length];
    if (charAfter !== '"' && charAfter !== ' ') {
      pos = html.indexOf(marker, pos + marker.length);
      continue;
    }
    const divStart = html.lastIndexOf('<div', pos);
    if (divStart === -1) break;
    let depth = 0;
    let i = divStart;
    while (i < html.length) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextOpen === -1 && nextClose === -1) break;
      if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        i = nextClose + 6;
        if (depth === 0) {
          blocks.push(html.slice(divStart, i));
          break;
        }
      }
    }
    pos = html.indexOf(marker, pos + marker.length);
  }
  return blocks;
}

/**
 * Normalize MuaSamCong search result HTML to PostItem[].
 * @param {string} html
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeMuasamcongSearch(html) {
  const items = [];
  const blocks = extractBalancedBlocks(html, 'content__body__left__item');

  for (const block of blocks.slice(0, 50)) {
    const code = stripTags(block.match(/class="content__body__left__item__infor__code"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const tenderNo = code.replace(/Mã TBMT\s*:\s*/i, '').trim() || '';
    if (!tenderNo) continue;

    const title = stripTags(block.match(/class="content__body__left__item__infor__contract__name[^"]*"[^>]*>([\s\S]*?)<\/h5>/i)?.[1] || '').trim();
    const status = stripTags(block.match(/class="content__body__left__item__infor__notice--([^"\s]+)/i)?.[1] || '');
    const bidField = stripTags(block.match(/>\s*Lĩnh vực\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const bidLocation = stripTags(block.match(/>\s*Địa điểm\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const procuringEntityName = stripTags(block.match(/>\s*Chủ đầu tư\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const publishDateRaw = stripTags(block.match(/>\s*Ngày đăng tải thông báo\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const publishDate = publishDateRaw ? new Date(publishDateRaw) : null;
    const time = stripTags(block.match(/Thời điểm đóng thầu<\/p>\s*<h5>([^<]+)<\/h5>\s*<h5>([^<]+)<\/h5>/i)?.[1] || '');
    const date = stripTags(block.match(/Thời điểm đóng thầu<\/p>\s*<h5>([^<]+)<\/h5>\s*<h5>([^<]+)<\/h5>/i)?.[2] || '');
    const bidSubmissionDeadline = date ? `${date} ${time}`.trim() : '';

    items.push(buildPostItem({
      platform: 'muasamcong',
      externalId: tenderNo,
      title,
      contentParts: [title, procuringEntityName, bidField, bidLocation].filter(Boolean),
      authorId: procuringEntityName || `muasamcong:${tenderNo}`,
      authorName: procuringEntityName || '',
      postUrl: '',
      publishedAt: publishDate,
      metadata: {
        tenderNo,
        tenderName: title,
        procuringEntityName,
        publishDate: publishDateRaw,
        bidSubmissionDeadline,
        bidStatus: status,
        bidField,
        bidLocation,
      },
    }));
  }

  return items;
}

/**
 * Normalize MuaSamCong detail HTML to PostItem.
 * @param {string} html
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeMuasamcongDetail(html) {
  const text = stripTags(html);
  const tenderNo = extractByLabel(html, 'Mã TBMT') || '';
  const tenderName = extractByLabel(html, 'Tên gói thầu') || '';

  if (!tenderNo && !tenderName) return [];

  const publishDateRaw = extractByLabel(html, 'Ngày đăng tải');
  const planNo = extractByLabel(html, 'Mã KHLCNT');
  const procuringEntityName = extractByLabel(html, 'Chủ đầu tư') || extractByLabel(html, 'Bên mời thầu');
  const bidValue = extractByLabel(html, 'Số tiền bảo đảm dự thầu');
  const bidSecurity = extractByLabel(html, 'Hình thức đảm bảo dự thầu');
  const bidField = extractByLabel(html, 'Lĩnh vực');
  const bidForm = extractByLabel(html, 'Hình thức lựa chọn nhà thầu');
  const contractType = extractByLabel(html, 'Loại hợp đồng');
  const bidMethod = extractByLabel(html, 'Phương thức lựa chọn nhà thầu');
  const bidDuration = extractByLabel(html, 'Thời gian thực hiện gói thầu');
  const bidSubmissionDeadline = extractByLabel(html, 'Thời điểm đóng thầu');
  const bidOpeningDate = extractByLabel(html, 'Thời điểm mở thầu');
  const bidLocation = extractByLabel(html, 'Địa điểm thực hiện gói thầu');

  return [buildPostItem({
    platform: 'muasamcong',
    externalId: tenderNo,
    title: tenderName,
    contentParts: [tenderName, procuringEntityName, bidField, bidLocation].filter(Boolean),
    authorId: procuringEntityName || `muasamcong:${tenderNo}`,
    authorName: procuringEntityName || '',
    postUrl: '',
    publishedAt: publishDateRaw ? new Date(publishDateRaw) : null,
    metadata: {
      tenderNo,
      publishDate: publishDateRaw,
      planNo,
      tenderName,
      procuringEntityName,
      bidValue,
      bidSecurity,
      bidField,
      bidForm,
      contractType,
      bidMethod,
      bidDuration,
      bidSubmissionDeadline,
      bidOpeningDate,
      bidLocation,
    },
  })];
}

/**
 * Dispatch normalizer by platform and kind.
 * @param {string | Object} data
 * @param {'search' | 'detail' | 'list'} kind
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeB2BRegistryResults(data, kind = 'search', options = {}) {
  const html = typeof data === 'string' ? data : data?.body || data?.data || '';
  if (!html || html.length < 50) return [];

  const platform = options.platform || 'b2b_registry_extended';

  if (platform === 'muasamcong') {
    return kind === 'detail' ? normalizeMuasamcongDetail(html) : normalizeMuasamcongSearch(html);
  }

  return normalizeHosocongty(html, kind, options);
}
