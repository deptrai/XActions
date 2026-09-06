// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Automotive HTML/JSON → PostItem normalizer for Oto.com.vn, BonBanh, Chợ Tốt Xe.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';
import {
  parseVndPrice,
  parseVnPhone,
  parseMileage,
  normalizeTransmission,
  normalizeFuel,
  inferSellerType,
} from './schema.js';

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

function extractByItemProp(html, prop) {
  const m = html.match(new RegExp(`itemprop=["']${prop}["'][^>]*>([^<]+)`, 'i'));
  return m ? stripTags(m[1]) : '';
}

function extractByAttr(html, attr) {
  const m = html.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/**
 * Build a PostItem for a vehicle listing.
 * @param {Object} input
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
    category: 'automotive',
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

// ── BonBanh ──────────────────────────────────────────────────────────────

function extractBonBanhItems(html, sourcePlatform = 'bonbanh') {
  const items = [];
  const seen = new Set();

  // Schema.org Car microdata blocks
  const carBlocks = html.match(/<li[^>]*itemtype=["']http:\/\/schema\.org\/Car["'][^>]*>[\s\S]*?<\/li>/gi) || [];

  for (const block of carBlocks) {
    const name = extractByItemProp(block, 'name') || '';
    const priceRaw = extractByItemProp(block, 'price') || extractByAttr(block, 'content');
    const engine = extractByItemProp(block, 'vehicleEngine') || '';
    const mileageRaw = extractByItemProp(block, 'mileageFromOdometer') || '';
    const transmission = extractByItemProp(block, 'vehicleTransmission') || '';
    const fuel = extractByItemProp(block, 'fuelType') || '';
    const modelDate = extractByItemProp(block, 'modelDate') || '';
    const image = extractByItemProp(block, 'image') || extractByAttr(block, 'src') || '';

    const urlMatch = block.match(/href=["'](xe-[^"']+)["']/i) || block.match(/href=["'](\/oto\/[^"']+)["']/i);
    const href = urlMatch ? urlMatch[1] : '';
    const externalId = href.split('-').pop() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);

    const { price, priceFormatted, priceNegotiable } = parseVndPrice(priceRaw);
    const { mileage, mileageFormatted } = parseMileage(mileageRaw);
    const phone = extractByAttr(block, 'data-phone') || '';

    items.push(buildPostItem({
      platform: 'bonbanh',
      externalId,
      title: name,
      contentParts: [name, priceFormatted, mileageFormatted, transmission, fuel].filter(Boolean),
      authorId: phone || `bonbanh:${externalId}`,
      authorName: 'Salon/Chính chủ',
      postUrl: href.startsWith('http') ? href : `https://bonbanh.com${href.startsWith('/') ? '' : '/'}${href}`,
      mediaUrls: image ? [image] : [],
      metadata: {
        brand: '',
        model: name,
        year: modelDate ? Number(modelDate) : null,
        mileage,
        mileageFormatted,
        transmission: normalizeTransmission(transmission),
        fuel: normalizeFuel(fuel),
        price,
        priceFormatted,
        priceNegotiable,
        sellerType: 'salon',
        phone: null,
        phoneMasked: false,
        address: '',
        city: '',
        detailUrl: href.startsWith('http') ? href : `https://bonbanh.com${href.startsWith('/') ? '' : '/'}${href}`,
        imageUrls: image ? [image] : [],
        listingDate: null,
        sourcePlatform,
      },
    }));
  }

  return items;
}

function extractBonBanhDetail(html, sourcePlatform = 'bonbanh') {
  const name = extractByItemProp(html, 'name') || '';
  const priceRaw = extractByItemProp(html, 'price') || '';
  const engine = extractByItemProp(html, 'vehicleEngine') || '';
  const mileageRaw = extractByItemProp(html, 'mileageFromOdometer') || '';
  const transmission = extractByItemProp(html, 'vehicleTransmission') || '';
  const fuel = extractByItemProp(html, 'fuelType') || '';
  const modelDate = extractByItemProp(html, 'modelDate') || '';
  const image = extractByItemProp(html, 'image') || '';

  const phoneMatch = html.match(/href=["']tel:([^"']+)["']/i) || html.match(/itemprop=["']telephone["'][^>]*>([^<]+)/i);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  const sellerType = inferSellerType({ text: html, url: html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || '' });

  const { price, priceFormatted, priceNegotiable } = parseVndPrice(priceRaw);
  const { mileage, mileageFormatted } = parseMileage(mileageRaw);
  const { phone: parsedPhone, phoneMasked } = parseVnPhone(phone);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || '';
  const urlMatch = html.match(/href=['"](xe-[^'"]+)['"]/) || html.match(/href=['"](\/oto\/[^'"]+)['"]/);
  const externalId = urlMatch ? urlMatch[1].split('-').pop() : (canonical.split('-').pop() || canonical.split('/').pop() || 'detail');

  return [buildPostItem({
    platform: 'bonbanh',
    externalId,
    title: name,
    contentParts: [name, priceFormatted, mileageFormatted, transmission, fuel].filter(Boolean),
    authorId: parsedPhone || `bonbanh:${externalId}`,
    authorName: 'Salon/Chính chủ',
    postUrl: canonical,
    mediaUrls: image ? [image] : [],
    metadata: {
      brand: '',
      model: name,
      year: modelDate ? Number(modelDate) : null,
      mileage,
      mileageFormatted,
      transmission: normalizeTransmission(transmission),
      fuel: normalizeFuel(fuel),
      price,
      priceFormatted,
      priceNegotiable,
      sellerType,
      phone: parsedPhone,
      phoneMasked,
      address: '',
      city: '',
      detailUrl: canonical,
      imageUrls: image ? [image] : [],
      listingDate: null,
      sourcePlatform,
    },
  })];
}

// ── Oto.com.vn ────────────────────────────────────────────────────────────

function extractOtoVnItems(html, sourcePlatform = 'oto_vn') {
  const items = [];
  const seen = new Set();

  const cardBlocks = html.match(/<div[^>]*class=["'][^"']*item-car[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || [];

  for (const block of cardBlocks) {
    const idMatch = block.match(/data-autoid=["'](\d+)["']/i) || block.match(/data-item-id=["'](\d+)["']/i) || block.match(/data-id=["'](\d+)["']/i);
    const externalId = idMatch ? idMatch[1] : `oto-${seen.size}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const title = stripTags(block.match(/<span[^>]*class=["']car-name["'][^>]*>([^<]+)/i)?.[1] || block.match(/<h3[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)/i)?.[1] || block.match(/<a[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)/i)?.[1] || '');
    const priceText = stripTags(block.match(/<p[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const specsText = stripTags(block.match(/<ul[^>]*class=["'][^"']*tag-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '');
    const sellerText = stripTags(block.match(/<li[^>]*class=["'][^"']*seller-name[^"']*["'][^>]*>([\s\S]*?)<\/li>/i)?.[1] || '');

    const mileageMatch = specsText.match(/(\d+(?:[.,]\d+)?)\s*km/i) || specsText.match(/(\d+)\s*nghìn\s*km/i);
    const transmissionMatch = specsText.match(/(số tự động|số sàn|số tay|tự động|sàn)/i);
    const fuelMatch = specsText.match(/(xăng|dầu|điện|hybrid|diesel)/i);
    const yearMatch = title.match(/(\d{4})/) || specsText.match(/(\d{4})/);

    const { price, priceFormatted, priceNegotiable } = parseVndPrice(priceText);
    const { mileage, mileageFormatted } = parseMileage(mileageMatch ? mileageMatch[0] : '');

    const urlMatch = block.match(/href=["']([^"']+)["']/i);
    const detailUrl = urlMatch ? urlMatch[1] : '';
    const image = block.match(/<img[^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1] || '';
    const phone = extractByAttr(block, 'data-phone') || '';
    const cityText = stripTags(block.match(/<li[^>]*class=["'][^"']*seller-location[^"']*["'][^>]*>([\s\S]*?)<\/li>/i)?.[1] || '');

    const sellerType = inferSellerType({ text: sellerText });
    const { phone: parsedPhone, phoneMasked } = parseVnPhone(phone);

    items.push(buildPostItem({
      platform: 'oto_vn',
      externalId,
      title,
      contentParts: [title, priceFormatted, mileageFormatted, transmissionMatch?.[1] || '', fuelMatch?.[1] || ''].filter(Boolean),
      authorId: parsedPhone || `oto_vn:${externalId}`,
      authorName: sellerText || 'Người bán',
      postUrl: detailUrl.startsWith('http') ? detailUrl : `https://www.oto.com.vn${detailUrl}`,
      mediaUrls: image ? [image] : [],
      metadata: {
        brand: '',
        model: title,
        year: yearMatch ? Number(yearMatch[1]) : null,
        mileage,
        mileageFormatted,
        transmission: normalizeTransmission(transmissionMatch?.[1] || ''),
        fuel: normalizeFuel(fuelMatch?.[1] || ''),
        price,
        priceFormatted,
        priceNegotiable,
        sellerType,
        phone: parsedPhone,
        phoneMasked,
        address: '',
        city: cityText,
        detailUrl: detailUrl.startsWith('http') ? detailUrl : `https://www.oto.com.vn${detailUrl}`,
        imageUrls: image ? [image] : [],
        listingDate: null,
        sourcePlatform,
      },
    }));
  }

  return items;
}

function extractOtoVnDetail(html, sourcePlatform = 'oto_vn') {
  const title = stripTags(html.match(/<h1[^>]*class=["'][^"']*title-detail[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const priceText = stripTags(html.match(/<span[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
  const specsBlock = html.match(/<div[^>]*class=["'][^"']*specs[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || '';

  const mileageRaw = specsBlock.match(/(\d+(?:[.,]\d+)?)\s*km/i)?.[0] || '';
  const transmissionRaw = specsBlock.match(/(số tự động|số sàn|số tay|tự động|sàn)/i)?.[0] || '';
  const fuelRaw = specsBlock.match(/(xăng|dầu|điện|hybrid|diesel)/i)?.[0] || '';
  const yearRaw = specsBlock.match(/(19|20)\d{2}/)?.[0] || '';

  const phoneMatch = html.match(/data-phone=["']([^"']+)["']/i) || html.match(/href=["']tel:([^"']+)["']/i);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  const sellerType = inferSellerType({ text: html });
  const { price, priceFormatted, priceNegotiable } = parseVndPrice(priceText);
  const { mileage, mileageFormatted } = parseMileage(mileageRaw);
  const { phone: parsedPhone, phoneMasked } = parseVnPhone(phone);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || '';
  const externalId = canonical.split('/').pop() || 'detail';
  const image = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';

  return [buildPostItem({
    platform: 'oto_vn',
    externalId,
    title,
    contentParts: [title, priceFormatted, mileageFormatted, transmissionRaw, fuelRaw].filter(Boolean),
    authorId: parsedPhone || `oto_vn:${externalId}`,
    authorName: 'Người bán',
    postUrl: canonical,
    mediaUrls: image ? [image] : [],
    metadata: {
      brand: '',
      model: title,
      year: yearRaw ? Number(yearRaw) : null,
      mileage,
      mileageFormatted,
      transmission: normalizeTransmission(transmissionRaw),
      fuel: normalizeFuel(fuelRaw),
      price,
      priceFormatted,
      priceNegotiable,
      sellerType,
      phone: parsedPhone,
      phoneMasked,
      address: '',
      city: '',
      detailUrl: canonical,
      imageUrls: image ? [image] : [],
      listingDate: null,
      sourcePlatform,
    },
  })];
}

// ── Chợ Tốt Xe ────────────────────────────────────────────────────────────

function extractChototXeItems(json, sourcePlatform = 'chotot_xe') {
  const items = [];
  const seen = new Set();
  const ads = Array.isArray(json?.adlist) ? json.adlist : Array.isArray(json?.ads) ? json.ads : Array.isArray(json?.data) ? json.data : [];

  for (const ad of ads) {
    const listId = String(ad.ad_id || ad.list_id || ad.id || '');
    if (!listId || seen.has(listId)) continue;
    seen.add(listId);

    const title = String(ad.subject || ad.title || '').trim();
    const priceRaw = ad.price_string || (ad.price ? String(ad.price) : '');
    const { price, priceFormatted, priceNegotiable } = parseVndPrice(priceRaw);

    const location = [ad.area_name, ad.region_name].filter(Boolean).join(', ');
    const phone = ad.phone || '';
    const { phone: parsedPhone, phoneMasked } = parseVnPhone(phone);

    const sellerType = inferSellerType({ companyAd: Boolean(ad.company_ad || ad.type === 'company') });
    const detailUrl = `https://xe.chotot.com/${listId}.htm`;
    const images = Array.isArray(ad.images) ? ad.images : [];
    const publishedAt = ad.list_time ? new Date(ad.list_time) : null;

    items.push(buildPostItem({
      platform: 'chotot_xe',
      externalId: listId,
      title,
      contentParts: [title, priceFormatted, location].filter(Boolean),
      authorId: parsedPhone || `chotot_xe:${ad.account_oid || listId}`,
      authorName: String(ad.account_name || 'Người bán').trim(),
      postUrl: detailUrl,
      mediaUrls: images,
      publishedAt,
      metadata: {
        brand: '',
        model: title,
        year: null,
        mileage: null,
        mileageFormatted: '',
        transmission: '',
        fuel: '',
        price,
        priceFormatted,
        priceNegotiable,
        sellerType,
        phone: parsedPhone,
        phoneMasked,
        address: location,
        city: ad.region_name || '',
        detailUrl,
        imageUrls: images,
        listingDate: ad.list_time ? new Date(ad.list_time).toISOString() : null,
        sourcePlatform,
      },
    }));
  }

  return items;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Normalize HTML/JSON response to PostItem[] for automotive platforms.
 * @param {string | Object} data
 * @param {'search' | 'list' | 'detail'} kind
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.sourcePlatform]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeAutomotiveResults(data, kind = 'list', options = {}) {
  const platform = options.platform || 'automotive';
  const sourcePlatform = options.sourcePlatform || platform;

  if (platform === 'chotot_xe' || platform === 'chotot') {
    const json = typeof data === 'string' ? JSON.parse(data) : data;
    return extractChototXeItems(json, sourcePlatform);
  }

  const html = typeof data === 'string' ? data : data?.body || data?.data || '';
  if (!html || html.length < 50) return [];

  if (platform === 'bonbanh') {
    return kind === 'detail' ? extractBonBanhDetail(html, sourcePlatform) : extractBonBanhItems(html, sourcePlatform);
  }

  if (platform === 'oto_vn') {
    return kind === 'detail' ? extractOtoVnDetail(html, sourcePlatform) : extractOtoVnItems(html, sourcePlatform);
  }

  // Fallback: try all extractors
  return [
    ...extractBonBanhItems(html, 'bonbanh'),
    ...extractOtoVnItems(html, 'oto_vn'),
  ];
}
