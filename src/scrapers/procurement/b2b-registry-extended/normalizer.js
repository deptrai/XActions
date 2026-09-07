// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * HoSoCongTy & MuaSamCong HTML and JSON normalizer.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';

const TAG_RE = /<[^>]+>/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/&(#?x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    /** @type {Record<string, string>} */
    const entityMap = ENTITIES;
    return entityMap[entity] ?? m;
  });
}

/**
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(html.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * Parse Vietnamese date string formats:
 * - "DD/MM/YYYY - HH:mm"
 * - "DD/MM/YYYY HH:mm"
 * - "DD/MM/YYYY"
 * Returns valid Date or null.
 * @param {string | null | undefined} raw
 * @returns {Date | null}
 */
export function parseVietnameseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:(?:\s*-\s*|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const [, day, month, year, hour = '0', min = '0', sec = '0'] = dmyMatch;
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${min.padStart(2, '0')}:${sec.padStart(2, '0')}+07:00`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * @param {string} html
 * @param {string} label
 * @returns {string}
 */
function extractByLabel(html, label) {
  if (!html || typeof html !== 'string' || !label) return '';
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Capture text after label up to the next closing/opening structural tag, newline, or end of string.
  // Handles nested <a>, <i>, <span>, <em> elements before/within the value.
  const pattern = new RegExp(
    `${escaped}[\\s:]*([\\s\\S]*?)(?=<\\/(?:li|p|div|td|h[1-6]|ul|ol|tr|table)>|<(?:li|p|div|td|h[1-6]|tr|br\\s*\\/?)[\s>]|\\n|$)`,
    'i'
  );
  const match = html.match(pattern);
  if (match) {
    const cleaned = stripTags(match[1]).trim();
    if (cleaned) return cleaned;
  }

  return '';
}

/**
 * @param {Record<string, any>} input
 * @returns {import('../../../core/types.js').PostItem}
 */
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
 * @param {'search' | 'detail'} [kind='search']
 * @param {Record<string, any>} [context={}]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeHosocongty(html, kind = 'search', context = {}) {
  const items = [];

  if (kind === 'detail') {
    const extractedTaxCode = extractByLabel(html, 'Mã số thuế') || extractByLabel(html, 'Tax code') || '';
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1Text = h1Match ? stripTags(h1Match[1]).replace(/^Tên công ty\s*:\s*/i, '').trim() : '';

    const companyName = extractByLabel(html, 'Tên công ty') ||
      h1Text ||
      extractByLabel(html, 'Tên viết tắt') ||
      extractByLabel(html, 'Company name') ||
      '';
    const shortName = extractByLabel(html, 'Tên viết tắt') || '';
    const taxCode = extractedTaxCode || context.taxCode || 'unknown';
    const representativeName = extractByLabel(html, 'Đại diện pháp luật') ||
      extractByLabel(html, 'Người đại diện') ||
      extractByLabel(html, 'Representative') ||
      '';
    const address = extractByLabel(html, 'Địa chỉ thuế') ||
      extractByLabel(html, 'Địa chỉ') ||
      extractByLabel(html, 'Address') ||
      '';
    const phone = extractByLabel(html, 'Điện thoại') ||
      extractByLabel(html, 'Số điện thoại') ||
      extractByLabel(html, 'Phone') ||
      '';
    const businessLines = extractByLabel(html, 'Ngành nghề') ||
      extractByLabel(html, 'Business lines') ||
      '';
    const charterCapital = extractByLabel(html, 'Vốn điều lệ') ||
      extractByLabel(html, 'Charter capital') ||
      '';
    const establishedDateRaw = extractByLabel(html, 'Ngày cấp') ||
      extractByLabel(html, 'Ngày thành lập') ||
      extractByLabel(html, 'Established date') ||
      '';
    const establishedDate = parseVietnameseDate(establishedDateRaw);
    const legalForm = extractByLabel(html, 'Loại hình') ||
      extractByLabel(html, 'Legal form') ||
      '';
    const status = extractByLabel(html, 'Trạng thái') ||
      extractByLabel(html, 'Tình trạng') ||
      extractByLabel(html, 'Status') ||
      '';

    if (companyName || extractedTaxCode) {
      items.push(buildPostItem({
        platform: 'hosocongty',
        externalId: taxCode,
        title: companyName,
        contentParts: [companyName, businessLines, address, phone].filter(Boolean),
        authorId: taxCode && taxCode !== 'unknown' ? `hosocongty:${taxCode}` : `hosocongty:${companyName || 'unknown'}`,
        authorName: representativeName || 'Unknown',
        postUrl: context.postUrl || (taxCode !== 'unknown' ? `https://hosocongty.vn/tra-cuu/${taxCode}` : ''),
        publishedAt: establishedDate,
        metadata: {
          taxCode,
          companyName,
          shortName,
          representativeName,
          phone,
          businessLines,
          charterCapital,
          establishedDate: establishedDateRaw,
          address,
          legalForm,
          status,
        },
      }));
    }
  } else {
    // Search results: split by live <ul class="hsdn"><li>...</li></ul> or legacy blocks
    let blocks = [];
    const ulMatch = html.match(/<ul[^>]*class="[^"]*hsdn[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (ulMatch) {
      blocks = ulMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
    } else {
      blocks = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ||
        html.match(/<div[^>]*class="[^"]*company[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    }

    for (const block of blocks.slice(0, 50)) {
      const titleMatch = block.match(/<a[^>]*title="([^"]*?)"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<h[1-6][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

      let companyName = '';
      let taxCode = '';

      if (titleMatch) {
        const titleAttr = titleMatch[1] || '';
        const anchorText = stripTags(titleMatch[2] || titleMatch[1] || '').trim();
        companyName = anchorText;

        if (titleAttr && titleAttr.includes(' - ')) {
          const parts = titleAttr.split(' - ');
          if (/^\d{10,14}$/.test(parts[0].trim())) {
            taxCode = parts[0].trim();
            if (!companyName) companyName = parts.slice(1).join(' - ').trim();
          }
        }
      }

      const taxCodeMatch = block.match(/Mã số thuế\s*:\s*<a[^>]*>([^<]+)<\/a>/i) ||
        block.match(/Mã số thuế\s*:\s*([0-9]{10,14})/i) ||
        block.match(/(\b[0-9]{10}(?:-[0-9]{3})?\b)/);
      if (taxCodeMatch && !taxCode) {
        taxCode = taxCodeMatch[1].trim();
      }

      const addressMatch = block.match(/<em>Địa chỉ:<\/em>\s*([^<]+?)(?:<br|<\/div|<\/li|$)/i) ||
        block.match(/Địa chỉ\s*:\s*([^<]+?)(?:<br|<\/div|<\/li|$)/i);
      const address = addressMatch ? stripTags(addressMatch[1]).trim() : '';

      if (!companyName && !taxCode) continue;
      if (!companyName) companyName = `Doanh nghiệp ${taxCode}`;

      items.push(buildPostItem({
        platform: 'hosocongty',
        externalId: taxCode || companyName,
        title: companyName,
        contentParts: [companyName, address].filter(Boolean),
        authorId: taxCode ? `hosocongty:${taxCode}` : `hosocongty:${companyName}`,
        authorName: '',
        postUrl: taxCode ? `https://hosocongty.vn/tra-cuu/${taxCode}` : '',
        metadata: {
          taxCode,
          companyName,
          address,
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
 * Normalize MuaSamCong search results (JSON or HTML) to PostItem[].
 * @param {string | Record<string, any>} data
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeMuasamcongSearch(data) {
  let parsed = null;
  if (typeof data === 'object' && data !== null) {
    parsed = data;
  } else if (typeof data === 'string') {
    const trimmed = data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {}
    }
  }

  if (parsed) {
    const list = Array.isArray(parsed) ? parsed : (parsed.page?.content || parsed.data || parsed.items || []);
    if (Array.isArray(list) && list.length > 0) {
      return list.map((item) => {
        const tenderNo = item.notifyNo || item.id || '';
        const title = Array.isArray(item.bidName) ? item.bidName[0] : (item.bidName || item.tenderName || item.ctName || '');
        const procuringEntityName = item.investorName || item.procuringEntityName || '';
        const bidField = Array.isArray(item.investField) ? item.investField.join(', ') : (item.investField || '');
        const locations = Array.isArray(item.locations)
          ? item.locations.map((/** @type {Record<string, any>} */ loc) => [loc?.districtName, loc?.provName].filter(Boolean).join(', ')).join('; ')
          : (item.bidLocation || '');
        const publishDateRaw = item.publicDate || item.originalPublicDate || '';
        const publishDate = publishDateRaw ? new Date(publishDateRaw) : null;
        const bidSubmissionDeadline = item.bidCloseDate || '';
        const status = item.status || '';

        return buildPostItem({
          platform: 'muasamcong',
          externalId: tenderNo,
          title,
          contentParts: [title, procuringEntityName, bidField, locations].filter(Boolean),
          authorId: procuringEntityName || `muasamcong:${tenderNo}`,
          authorName: procuringEntityName || '',
          postUrl: item.id ? `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?render=detail-v2&id=${item.id}&notifyNo=${tenderNo}` : '',
          publishedAt: publishDate && !isNaN(publishDate.getTime()) ? publishDate : null,
          metadata: {
            id: item.id,
            tenderNo,
            tenderName: title,
            procuringEntityName,
            publishDate: publishDateRaw,
            bidSubmissionDeadline,
            bidStatus: status,
            bidField,
            bidLocation: locations,
            planNo: item.planNo || '',
            bidPrice: item.bidPrice || null,
          },
        });
      });
    }
  }

  const html = typeof data === 'string'
    ? data
    : (data && typeof data === 'object' && 'body' in data ? String(data.body) : '');
  const items = [];
  const blocks = extractBalancedBlocks(html, 'content__body__left__item');

  for (const block of blocks.slice(0, 50)) {
    const code = stripTags(block.match(/class="content__body__left__item__infor__code"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const tenderNo = code.replace(/Mã TBMT\s*:\s*/i, '').trim() || '';
    if (!tenderNo) continue;

    const title = stripTags(block.match(/class="content__body__left__item__infor__contract__name[^"]*"[^>]*>([\s\S]*?)<\/h5>/i)?.[1] || '').trim();
    const statusMatch = block.match(/class="content__body__left__item__infor__notice[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const status = statusMatch ? stripTags(statusMatch[1]).trim() : '';
    const bidField = stripTags(block.match(/>\s*Lĩnh vực\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const bidLocation = stripTags(block.match(/>\s*Địa điểm\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const procuringEntityName = stripTags(block.match(/>\s*Chủ đầu tư\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const publishDateRaw = stripTags(block.match(/>\s*Ngày đăng tải thông báo\s*:\s*<span>([^<]+)<\/span>/i)?.[1] || '');
    const publishDate = parseVietnameseDate(publishDateRaw);
    const closeMatch = block.match(/Thời điểm đóng thầu[\s\S]*?<\/p>\s*<h5[^>]*>([\s\S]*?)<\/h5>\s*<h5[^>]*>([\s\S]*?)<\/h5>/i);
    const time = closeMatch ? stripTags(closeMatch[1]).trim() : '';
    const date = closeMatch ? stripTags(closeMatch[2]).trim() : '';
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
 * Normalize MuaSamCong detail (JSON or HTML) to PostItem[].
 * @param {string | Record<string, any>} data
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeMuasamcongDetail(data) {
  let parsed = null;
  if (typeof data === 'object' && data !== null) {
    parsed = data;
  } else if (typeof data === 'string') {
    const trimmed = data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {}
    }
  }

  if (parsed) {
    const d = parsed.bidoNotifyContractorM || parsed.data || parsed;
    const tenderNo = d.notifyNo || d.id || '';
    const tenderName = Array.isArray(d.bidName) ? d.bidName[0] : (d.bidName || d.tenderName || '');
    if (tenderNo || tenderName) {
      const publishDateRaw = d.publicDate || '';
      const publishedAt = publishDateRaw ? new Date(publishDateRaw) : null;
      const procuringEntityName = d.procuringEntityName || d.investorName || '';
      const bidField = Array.isArray(d.investField) ? d.investField.join(', ') : (d.investField || '');
      const bidLocation = d.bidOpenLocation || d.executionLocation || '';
      const bidValue = d.guaranteeValue
        ? `${Number(d.guaranteeValue).toLocaleString('vi-VN')} VND`
        : (d.bidPrice ? `${Number(d.bidPrice).toLocaleString('vi-VN')} VND` : '');
      const bidSecurity = d.guaranteeForm || '';
      const bidSubmissionDeadline = d.bidCloseDate || '';
      const bidOpeningDate = d.bidOpenDate || '';

      return [buildPostItem({
        platform: 'muasamcong',
        externalId: tenderNo,
        title: tenderName,
        contentParts: [tenderName, procuringEntityName, bidField, bidLocation].filter(Boolean),
        authorId: procuringEntityName || `muasamcong:${tenderNo}`,
        authorName: procuringEntityName || '',
        postUrl: d.id ? `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?render=detail-v2&id=${d.id}&notifyNo=${tenderNo}` : '',
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        metadata: {
          id: d.id,
          tenderNo,
          publishDate: publishDateRaw,
          planNo: d.planNo || '',
          tenderName,
          procuringEntityName,
          bidValue,
          bidSecurity,
          bidField,
          bidForm: d.bidForm || '',
          contractType: d.contractType || '',
          bidMethod: d.bidMode || '',
          bidDuration: d.contractPeriod ? `${d.contractPeriod} ${d.contractPeriodUnit || ''}`.trim() : '',
          bidSubmissionDeadline,
          bidOpeningDate,
          bidLocation,
        },
      })];
    }
  }

  const html = typeof data === 'string'
    ? data
    : (data && typeof data === 'object' && 'body' in data ? String(data.body) : '');
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
    publishedAt: parseVietnameseDate(publishDateRaw),
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
 * @param {string | Record<string, any>} data
 * @param {'search' | 'detail' | 'list'} [kind='search']
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.taxCode]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeB2BRegistryResults(data, kind = 'search', options = {}) {
  if (!data) return [];
  const platform = options.platform || 'b2b_registry_extended';

  if (platform === 'muasamcong') {
    return kind === 'detail' ? normalizeMuasamcongDetail(data) : normalizeMuasamcongSearch(data);
  }

  const html = typeof data === 'string'
    ? data
    : (data && typeof data === 'object'
      ? String('body' in data ? data.body : ('data' in data ? data.data : ''))
      : '');
  if (!html || html.length < 50) return [];

  return normalizeHosocongty(html, kind === 'detail' ? 'detail' : 'search', options);
}
