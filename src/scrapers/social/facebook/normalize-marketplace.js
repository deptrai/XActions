// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { generatePostId } from '../../../core/types.js';

/**
 * NFR-11: Strip phone numbers and email addresses from text fields before returning/storing.
 */
const PII_PHONE_RE = /(?<![\w/:])(?:\+?\d[\d\s\-().]{6,}\d)(?![\w/])/g;
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
  const listingId = rawId ? String(rawId).trim() : '';
  if (!listingId) return null;

  const rawTitle = node.marketplace_listing_title || node.title || node.name || '';
  const title = stripPii(rawTitle);

  const priceObj = node.listing_price || node.price || {};
  let price = typeof priceObj === 'string'
    ? priceObj
    : (priceObj.formatted_amount || priceObj.amount || (typeof node.price === 'string' ? node.price : null));
  let currency = priceObj.currency || null;

  const locationObj = node.location || {};
  const location = locationObj.reverse_geocode?.city || locationObj.name || (typeof node.location === 'string' ? node.location : null);

  const photoObj = node.primary_listing_photo || node.photo || node.image || {};
  const image = photoObj.image?.uri || photoObj.uri || (typeof node.image === 'string' ? node.image : null);
  const mediaUrls = image ? [image] : [];

  const sellerObj = node.seller || {};
  const sellerId = String(sellerObj.id || sellerObj.profile_id || node.sellerId || '');
  const sellerName = stripPii(sellerObj.name || node.seller || 'Facebook Seller');
  const sellerUrl = sellerObj.url || (sellerId ? `https://www.facebook.com/${sellerId}` : (node.sellerUrl || null));

  const rawTime = node.creation_time || node.creationTime || node.published_time;
  let publishedAt = undefined;
  if (rawTime) {
    if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime > 0) {
      publishedAt = new Date(rawTime > 1e11 ? rawTime : rawTime * 1000);
    } else if (typeof rawTime === 'string') {
      const parsedNum = Number(rawTime);
      if (Number.isFinite(parsedNum) && parsedNum > 0) {
        publishedAt = new Date(parsedNum > 1e11 ? parsedNum : parsedNum * 1000);
      } else {
        const parsedDate = new Date(rawTime);
        if (!isNaN(parsedDate.getTime())) publishedAt = parsedDate;
      }
    }
  }

  const postUrl = node.listingUrl || `https://www.facebook.com/marketplace/item/${listingId}`;

  /** @type {import('../../../core/types.js').PostItem} */
  return {
    id: generatePostId('facebook', listingId),
    externalId: listingId,
    platform: 'facebook',
    category: 'ecom',
    authorId: sellerId,
    authorName: sellerName,
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
      seller: sellerName,
      sellerUrl,
      sellerId: sellerId || null,
      category: node.category || null,
      categoryId: node.categoryId || null,
      listingUrl: postUrl,
      sourceMethod,
      rawId: listingId,
      creationTime: typeof rawTime === 'number' ? rawTime : (publishedAt ? Math.floor(publishedAt.getTime() / 1000) : null),
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
