// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { generatePostId } from '../../../core/types.js';

/**
 * NFR-11: Strip phone numbers and email addresses from text fields before returning/storing.
 */
const PII_PHONE_RE = /(?<![\w/:])(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}(?![\w/])/g;
const PII_EMAIL_RE = /(^|[^\w/:])[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stripPii(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(PII_PHONE_RE, '')
    .replace(PII_EMAIL_RE, (match, prefix) => (prefix || ''))
    .trim();
}

/**
 * Resolve a scalar listing id, handling object ids safely.
 * @param {unknown} rawId
 * @returns {string | null}
 */
function resolveListingId(rawId) {
  if (rawId == null) return null;
  if (typeof rawId === 'string' || typeof rawId === 'number') {
    const s = String(rawId).trim();
    return s || null;
  }
  if (typeof rawId === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (rawId);
    for (const key of ['id', 'listingId', 'postId']) {
      const v = obj[key];
      if (v != null && (typeof v === 'string' || typeof v === 'number')) {
        const s = String(v).trim();
        if (s) return s;
      }
    }
    return null;
  }
  return null;
}

/**
 * Extract a human-readable price and currency from common Marketplace price shapes.
 * Objects without a known scalar field are treated as unknown (null), never coerced to '[object Object]'.
 * @param {unknown} raw
 * @returns {{ price: string | null, currency: string | null }}
 */
function extractPrice(raw) {
  if (raw == null) return { price: null, currency: null };
  if (typeof raw === 'string' || typeof raw === 'number') {
    return { price: String(raw), currency: null };
  }
  if (typeof raw === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    const currency = typeof obj.currency === 'string' ? obj.currency : null;
    if (typeof obj.formatted_amount === 'string' || typeof obj.formatted_amount === 'number') {
      return { price: String(obj.formatted_amount), currency };
    }
    if (typeof obj.amount === 'string' || typeof obj.amount === 'number') {
      return { price: String(obj.amount), currency };
    }
    if (typeof obj.value === 'string' || typeof obj.value === 'number') {
      return { price: String(obj.value), currency };
    }
    return { price: null, currency };
  }
  return { price: null, currency: null };
}

/**
 * Parse creation time into safe Date and epoch timestamp (seconds).
 * @param {unknown} raw
 * @returns {{ publishedAt: Date | undefined, ts: number | null }}
 */
function parseCreationTime(raw) {
  if (raw == null) return { publishedAt: undefined, ts: null };
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    const ms = num > 1e11 ? num : num * 1000;
    return { publishedAt: new Date(ms), ts: Math.floor(ms / 1000) };
  }
  const d = new Date(String(raw));
  if (!Number.isNaN(d.getTime())) {
    return { publishedAt: d, ts: Math.floor(d.getTime() / 1000) };
  }
  return { publishedAt: undefined, ts: null };
}

/**
 * Normalize a raw Facebook Marketplace listing from GraphQL or browser fallback into a standard PostItem.
 *
 * @param {Record<string, any>} raw
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeFacebookMarketplaceListing(raw, sourceMethod = 'graphql') {
  if (!raw || typeof raw !== 'object') return null;

  const node = raw.listing || raw.node?.listing || raw.node || raw;
  const rawId = node.id || node.listing_id || node.target_id || raw.id;
  const listingId = resolveListingId(rawId);
  if (!listingId) return null;

  const rawTitle = node.marketplace_listing_title || node.title || node.name || '';
  const title = stripPii(rawTitle);

  const { price, currency } = extractPrice(node.listing_price || node.price);

  const locationObj = node.location || {};
  const location = locationObj.reverse_geocode?.city || locationObj.name || (typeof node.location === 'string' ? node.location : null);

  const extractUrl = (/** @type {any} */ v) => (typeof v === 'string' ? v : (v?.uri || v?.url || null));
  const rawImages = [
    node.primary_listing_photo?.image?.uri,
    node.primary_listing_photo?.uri,
    node.photo?.image?.uri,
    node.photo?.uri,
    node.image,
    ...(Array.isArray(node.images) ? node.images : []),
  ];
  const mediaUrls = rawImages.map(extractUrl).filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i);

  const sellerObj = node.seller || node.story?.actors?.[0] || {};
  const sellerId = String(sellerObj.id || sellerObj.profile_id || node.sellerId || '');
  const rawSellerName = sellerObj.name || node.seller || (sellerId ? '' : 'Facebook Seller');
  const sellerName = stripPii(rawSellerName);
  const sellerUrl = sellerObj.url || (sellerId ? `https://www.facebook.com/${sellerId}` : (node.sellerUrl || null));

  const rawTime = node.creation_time || node.creationTime || node.published_time;
  const { publishedAt, ts } = parseCreationTime(rawTime);

  const postUrl = node.listingUrl || `https://www.facebook.com/marketplace/item/${listingId}`;
  const category = node.category?.name || node.category_name || (typeof node.category === 'string' ? node.category : null);
  const categoryId = node.category?.id || node.category_id || (node.categoryId ? String(node.categoryId) : null);

  /** @type {import('../../../core/types.js').PostItem} */
  return {
    id: generatePostId('facebook', listingId),
    externalId: listingId,
    platform: 'facebook',
    category: 'ecom',
    authorId: sellerId || listingId,
    authorName: sellerName || (sellerId ? `Seller ${sellerId}` : 'Facebook Seller'),
    authorAvatar: sellerObj.profile_picture?.uri || undefined,
    content: title,
    mediaUrls,
    publishedAt,
    crawledAt: new Date(),
    postUrl,
    metadata: {
      isMarketplace: true,
      price,
      currency,
      location,
      seller: sellerName || null,
      sellerUrl,
      sellerId: sellerId || null,
      category,
      categoryId,
      listingUrl: postUrl,
      sourceMethod,
      rawId: listingId,
      creationTime: ts,
    },
  };
}

/**
 * Adapter converting a marketplace listing into PostItem.
 *
 * @param {Record<string, any>} listing
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function marketplaceListingToPostItem(listing, sourceMethod = 'graphql') {
  return normalizeFacebookMarketplaceListing(listing, sourceMethod);
}

