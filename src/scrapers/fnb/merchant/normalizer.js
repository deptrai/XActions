// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant HTML/JSON → PostItem normalizer for PasGo, Foody, and Riviu.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';
import { parseVnPhone, parseRating, parseReviewCount, parseOpeningDate, isNewlyOpened } from './schema.js';

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

function buildPostItem(input) {
  const {
    platform,
    externalId,
    title = '',
    contentParts = [],
    authorId = '',
    authorName = '',
    postUrl = '',
    mediaUrls = [],
    publishedAt = null,
    metadata = {},
  } = input;

  return {
    id: generatePostId(platform, externalId),
    platform,
    externalId,
    category: 'fnb_merchant',
    authorId,
    authorName,
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

// ── PasGo ─────────────────────────────────────────────────────────────────

function extractPasGoItems(html, sourcePlatform = 'pasgo') {
  const items = [];
  const seen = new Set();

  // Parse JSON-LD Restaurant blocks
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const json = script.replace(/<script[^>]*>|<\/script>/gi, '');
        const data = JSON.parse(json);
        const list = Array.isArray(data) ? data : [data];
        for (const ld of list) {
          if (ld['@type'] !== 'Restaurant' && !ld['@type']?.includes('Restaurant')) continue;

          const externalId = ld.url ? String(ld.url).split('/').pop() || `pasgo-${seen.size}` : `pasgo-${seen.size}`;
          if (seen.has(externalId)) continue;
          seen.add(externalId);

          const title = stripTags(ld.name || '');
          const addressObj = typeof ld.address === 'object' ? ld.address : {};
          const address = stripTags(addressObj.streetAddress || ld.address || '');
          const city = stripTags(addressObj.addressLocality || '');
          const district = stripTags(addressObj.addressRegion || '');
          const { phone, phoneMasked } = parseVnPhone(ld.telephone || '');
          const rating = parseRating(ld.aggregateRating?.ratingValue);
          const reviewCount = parseReviewCount(ld.aggregateRating?.reviewCount);
          const cuisine = Array.isArray(ld.servesCuisine) ? ld.servesCuisine : ld.servesCuisine ? [ld.servesCuisine] : [];
          const lat = parseFloat(ld.geo?.latitude);
          const lng = parseFloat(ld.geo?.longitude);

          items.push(buildPostItem({
            platform: 'pasgo',
            externalId,
            title,
            contentParts: [title, address].filter(Boolean),
            authorId: phone || `pasgo:${externalId}`,
            authorName: phone ? `Hotline: ${phone}` : 'Chủ quán',
            postUrl: ld.url || '',
            mediaUrls: ld.image ? [ld.image] : [],
            metadata: {
              restaurantName: title,
              manager: '',
              hotline: phone,
              phone,
              phoneMasked,
              address,
              city,
              district,
              gpsLat: Number.isFinite(lat) ? lat : null,
              gpsLng: Number.isFinite(lng) ? lng : null,
              menuItems: cuisine,
              rating,
              reviewCount,
              cuisine,
              detailUrl: ld.url || '',
              sourcePlatform,
            },
          }));
        }
      } catch {
        // Invalid JSON-LD, skip
      }
    }
  }

  // Fallback: parse schema.org/Restaurant microdata
  if (!items.length) {
    const blocks = html.match(/<[^>]*itemtype=["']http:\/\/schema\.org\/Restaurant["'][^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const block of blocks) {
      const name = extractItemProp(block, 'name');
      if (!name) continue;

      const address = extractItemProp(block, 'streetAddress') || extractItemProp(block, 'address');
      const phone = extractItemProp(block, 'telephone');
      const parsed = parseVnPhone(phone);
      const rating = parseRating(extractItemProp(block, 'ratingValue'));
      const reviewCount = parseReviewCount(extractItemProp(block, 'reviewCount'));
      const cuisine = [extractItemProp(block, 'servesCuisine')].filter(Boolean);

      const lat = parseFloat(extractItemProp(block, 'latitude'));
      const lng = parseFloat(extractItemProp(block, 'longitude'));
      const urlMatch = block.match(/href=["']([^"']+)["']/i);
      const detailUrl = urlMatch ? urlMatch[1] : '';
      const externalId = detailUrl ? detailUrl.split('/').pop() || `pasgo-${seen.size}` : `pasgo-${seen.size}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      items.push(buildPostItem({
        platform: 'pasgo',
        externalId,
        title: name,
        contentParts: [name, address].filter(Boolean),
        authorId: parsed.phone || `pasgo:${externalId}`,
        authorName: parsed.phone ? `Hotline: ${parsed.phone}` : 'Chủ quán',
        postUrl: detailUrl,
        mediaUrls: [],
        metadata: {
          restaurantName: name,
          manager: '',
          hotline: parsed.phone,
          phone: parsed.phone,
          phoneMasked: parsed.phoneMasked,
          address,
          city: '',
          district: '',
          gpsLat: Number.isFinite(lat) ? lat : null,
          gpsLng: Number.isFinite(lng) ? lng : null,
          menuItems: cuisine,
          rating,
          reviewCount,
          cuisine,
          detailUrl,
          sourcePlatform,
        },
      }));
    }
  }

  return items;
}

function extractPasGoDetail(html, sourcePlatform = 'pasgo') {
  const items = extractPasGoItems(html, sourcePlatform);
  return items.slice(0, 1);
}

function extractItemProp(html, prop) {
  const m = html.match(new RegExp(`itemprop=["']${prop}["'][^>]*>([^<]+)`, 'i'));
  return m ? stripTags(m[1]) : '';
}

// ── Foody ─────────────────────────────────────────────────────────────────

function extractFoodyItems(html, sourcePlatform = 'foody', filter = {}) {
  const items = [];
  const seen = new Set();

  const jsonDataMatch = html.match(/var\s+jsonData\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (!jsonDataMatch) return items;

  let data;
  try {
    // Foody often emits unquoted keys in the embedded JS object, so quote them before JSON.parse.
    const quoted = jsonDataMatch[1].replace(/([{,\s])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    data = JSON.parse(quoted);
  } catch {
    return items;
  }

  const searchItems = Array.isArray(data?.searchItems) ? data.searchItems : [];
  const days = Number(filter.days) || 30;

  for (const item of searchItems) {
    const externalId = String(item.Id || '');
    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);

    if (filter.kind === 'newly_opened') {
      const openingDate = parseOpeningDate(item.OpeningDate || '');
      if (!isNewlyOpened(openingDate, days) && !item.IsNew) continue;
    }

    if (filter.district && item.District) {
      const district = stripTags(item.District).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      const filterDistrict = String(filter.district).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      if (!district.includes(filterDistrict) && !filterDistrict.includes(district)) continue;
    }

    const title = stripTags(item.Name || '');
    const address = stripTags(item.Address || '');
    const city = stripTags(item.City || '');
    const district = stripTags(item.District || '');
    const { phone, phoneMasked } = parseVnPhone(item.Phone || '');
    const rating = parseRating(item.AvgRating);
    const reviewCount = parseReviewCount(item.TotalReview);
    const cuisine = Array.isArray(item.Cuisines) ? item.Cuisines : [];
    const lat = parseFloat(item.Latitude);
    const lng = parseFloat(item.Longitude);

    items.push(buildPostItem({
      platform: 'foody',
      externalId,
      title,
      contentParts: [title, address].filter(Boolean),
      authorId: phone || `foody:${externalId}`,
      authorName: phone ? `Hotline: ${phone}` : 'Chủ quán',
      postUrl: item.DetailUrl || '',
      mediaUrls: [],
      metadata: {
        restaurantName: title,
        manager: '',
        hotline: phone,
        phone,
        phoneMasked,
        address,
        city,
        district,
        gpsLat: Number.isFinite(lat) ? lat : null,
        gpsLng: Number.isFinite(lng) ? lng : null,
        menuItems: cuisine,
        rating,
        reviewCount,
        cuisine,
        detailUrl: item.DetailUrl || '',
        sourcePlatform,
      },
    }));
  }

  return items;
}

function extractFoodyDetail(html, sourcePlatform = 'foody') {
  return extractFoodyItems(html, sourcePlatform, {});
}

// ── Riviu ─────────────────────────────────────────────────────────────────

function extractRiviuItems(html, sourcePlatform = 'riviu') {
  const items = [];
  const seen = new Set();

  // Riviu restaurant card patterns — match the inner content of each card element.
  const blocks = html.match(/<div[^>]*class=["'][^"']*restaurant-card[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class=["'][^"']*restaurant-card|<\/div>)/gi) ||
    html.match(/<article[^>]*class=["'][^"']*restaurant[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi) ||
    html.match(/<div[^>]*class=["'][^"']*location-card[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class=["'][^"']*location-card|<\/div>)/gi) ||
    [];

  for (const block of blocks) {
    const nameMatch = block.match(/class=["'][^"']*restaurant-name[^"']*["'][^>]*>([^<]+)/i) ||
      block.match(/<h3[^>]*>([^<]+)<\/h3>/i);
    const name = nameMatch ? stripTags(nameMatch[1]) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const addressMatch = block.match(/class=["'][^"']*address[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const address = addressMatch ? stripTags(addressMatch[1]) : '';

    const ratingMatch = block.match(/class=["'][^"']*rating[^"']*["'][^>]*>([^<]+)/i) ||
      block.match(/class=["'][^"']*score[^"']*["'][^>]*>([^<]+)/i);
    const rating = parseRating(ratingMatch ? stripTags(ratingMatch[1]) : '');

    const reviewMatch = block.match(/class=["'][^"']*review-count[^"']*["'][^>]*>([^<]+)/i);
    const reviewCount = parseReviewCount(reviewMatch ? stripTags(reviewMatch[1]) : '');

    const phoneMatch = block.match(/class=["'][^"']*phone[^"']*["'][^>]*>([^<]+)/i) ||
      block.match(/href=["']tel:([^"']+)["']/i);
    const phone = phoneMatch ? (phoneMatch[2] ? stripTags(phoneMatch[2]) : phoneMatch[1]) : '';
    const parsed = parseVnPhone(phone);

    const urlMatch = block.match(/href=["']([^"']*\/nha-hang\/[^"']*)["']/i);
    const detailUrl = urlMatch ? urlMatch[1] : '';
    const externalId = detailUrl ? detailUrl.split('/').pop() || `riviu-${seen.size - 1}` : `riviu-${seen.size - 1}`;

    items.push(buildPostItem({
      platform: 'riviu',
      externalId,
      title: name,
      contentParts: [name, address].filter(Boolean),
      authorId: parsed.phone || `riviu:${externalId}`,
      authorName: parsed.phone ? `Hotline: ${parsed.phone}` : 'Chủ quán',
      postUrl: detailUrl.startsWith('http') ? detailUrl : `https://riviu.vn${detailUrl}`,
      mediaUrls: [],
      metadata: {
        restaurantName: name,
        manager: '',
        hotline: parsed.phone,
        phone: parsed.phone,
        phoneMasked: parsed.phoneMasked,
        address,
        city: '',
        district: '',
        gpsLat: null,
        gpsLng: null,
        menuItems: [],
        rating,
        reviewCount,
        cuisine: [],
        detailUrl: detailUrl.startsWith('http') ? detailUrl : `https://riviu.vn${detailUrl}`,
        sourcePlatform,
      },
    }));
  }

  // Fallback: any link to /nha-hang/ in the page
  if (!items.length) {
    const anchors = html.match(/href=["']([^"']*\/nha-hang\/[^"']*)["'][^>]*>([^<]+)/gi) || [];
    for (const anchor of anchors) {
      const m = anchor.match(/href=["']([^"']*\/nha-hang\/[^"']*)["'][^>]*>([^<]+)/i);
      if (!m) continue;
      const detailUrl = m[1];
      const name = stripTags(m[2]).trim();
      if (!name) continue;
      const externalId = detailUrl.split('/').pop() || `riviu-${seen.size}`;
      if (seen.has(name)) continue;
      seen.add(name);

      items.push(buildPostItem({
        platform: 'riviu',
        externalId,
        title: name,
        contentParts: [name],
        authorId: `riviu:${externalId}`,
        authorName: 'Chủ quán',
        postUrl: detailUrl.startsWith('http') ? detailUrl : `https://riviu.vn${detailUrl}`,
        mediaUrls: [],
        metadata: {
          restaurantName: name,
          manager: '',
          hotline: null,
          phone: null,
          phoneMasked: false,
          address: '',
          city: '',
          district: '',
          gpsLat: null,
          gpsLng: null,
          menuItems: [],
          rating: null,
          reviewCount: null,
          cuisine: [],
          detailUrl: detailUrl.startsWith('http') ? detailUrl : `https://riviu.vn${detailUrl}`,
          sourcePlatform,
        },
      }));
    }
  }

  return items;
}

function extractRiviuDetail(html, sourcePlatform = 'riviu') {
  const items = extractRiviuItems(html, sourcePlatform);
  return items.slice(0, 1);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Normalize HTML/JSON response to PostItem[] for F&B merchant platforms.
 * @param {string | Object} data
 * @param {'search' | 'newly_opened' | 'search_by_district' | 'detail'} kind
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.sourcePlatform]
 * @param {string} [options.district]
 * @param {number} [options.days]
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function normalizeFnbMerchantResults(data, kind = 'search', options = {}) {
  const platform = options.platform || 'pasgo';
  const sourcePlatform = options.sourcePlatform || platform;

  if (platform === 'foody') {
    const html = typeof data === 'string' ? data : data?.body || data?.data || '';
    const filter = {
      kind,
      district: options.district,
      days: options.days,
    };
    return kind === 'detail' ? extractFoodyDetail(html, sourcePlatform) : extractFoodyItems(html, sourcePlatform, filter);
  }

  if (platform === 'riviu') {
    const html = typeof data === 'string' ? data : data?.body || data?.data || '';
    return kind === 'detail' ? extractRiviuDetail(html, sourcePlatform) : extractRiviuItems(html, sourcePlatform);
  }

  const html = typeof data === 'string' ? data : data?.body || data?.data || '';
  if (!html || html.length < 50) return [];

  if (kind === 'detail') {
    return extractPasGoDetail(html, sourcePlatform);
  }
  return extractPasGoItems(html, sourcePlatform);
}

// Backward-compatible alias
export const normalizeFnbResults = normalizeFnbMerchantResults;
