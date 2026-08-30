// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shopee Item & Review Normalizer.
 * Maps Shopee v4 JSON responses into canonical PostItem and CommentItem schemas.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { SHOPEE_IMAGE_CDN, SHOPEE_BASE_URL } from './client.js';

/**
 * Build full Shopee CDN image URL from hash.
 * @param {string} imageHash
 * @returns {string}
 */
export function buildShopeeImageUrl(imageHash) {
  if (!imageHash || typeof imageHash !== 'string') return '';
  if (imageHash.startsWith('http')) return imageHash;
  return `${SHOPEE_IMAGE_CDN}/${imageHash}`;
}

/**
 * Normalize raw Shopee price integer (divided by 100,000).
 * @param {number|string} rawPrice
 * @returns {number}
 */
export function normalizeShopeePrice(rawPrice) {
  const n = Number(rawPrice);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Shopee API stores prices multiplied by 100,000 (e.g. 15000000000 => 150000)
  if (n >= 100000) {
    return Math.round(n / 100000);
  }
  return n;
}

/**
 * Normalize Shopee search/item object to PostItem.
 * @param {Record<string, any>} raw
 * @param {Record<string, any>} [context={}]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeShopeeProduct(raw, context = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw.item_basic || raw.data || raw;
  const itemId = String(item.itemid || item.item_id || '');
  const shopId = String(item.shopid || item.shop_id || '');

  if (!itemId) return null;

  const title = item.name || item.title || '';
  const description = item.description || title;
  const price = normalizeShopeePrice(item.price || item.price_min);
  const originalPrice = normalizeShopeePrice(item.price_before_discount || item.price_max_before_discount || item.price);
  const soldCount = Number(item.historical_sold || item.sold || 0);
  const rating = Number(item.item_rating?.rating_star ?? item.rating_star ?? 0);
  const stock = Number(item.stock || 0);
  const discountPercent = item.discount || (originalPrice > price ? `${Math.round((1 - price / originalPrice) * 100)}%` : null);
  const location = item.shop_location || '';

  const rawImages = Array.isArray(item.images) ? item.images : (item.image ? [item.image] : []);
  const mediaUrls = rawImages.map(buildShopeeImageUrl).filter(Boolean);

  const productUrl = `${SHOPEE_BASE_URL}/product/${shopId}/${itemId}`;
  const now = new Date();

  return /** @type {import('../../../core/types.js').PostItem} */ ({
    id: `shopee:${itemId}`,
    platform: 'shopee',
    externalId: itemId,
    category: 'ecom',
    authorId: shopId ? `shopee:shop:${shopId}` : '',
    authorName: item.shop_name || location || `Shop ${shopId}`,
    authorAvatar: null,
    authorUrl: shopId ? `${SHOPEE_BASE_URL}/shop/${shopId}` : null,
    postUrl: productUrl,
    content: description ? `${title}\n\n${description}` : title,
    mediaUrls,
    likesCount: Number(item.liked_count || 0),
    repostsCount: 0,
    repliesCount: Number(item.item_rating?.total_rating_count || 0),
    viewsCount: Number(item.views || 0),
    publishedAt: item.ctime ? new Date(Number(item.ctime) * 1000) : now,
    crawledAt: now,
    metadata: {
      itemId,
      shopId,
      title,
      price,
      originalPrice,
      currency: 'VND',
      soldCount,
      rating,
      stock,
      discountPercent,
      location,
      sourceMethod: context.sourceMethod || 'search_products',
      ...context.extraMetadata,
    },
  });
}

/**
 * Normalize Shopee review object to CommentItem.
 * @param {Record<string, any>} rawReview
 * @param {string} itemId
 * @returns {import('../../../core/types.js').CommentItem | null}
 */
export function normalizeShopeeReview(rawReview, itemId) {
  if (!rawReview || typeof rawReview !== 'object') return null;

  const reviewId = String(rawReview.cmtid || rawReview.id || `${Date.now()}-${Math.random()}`);
  const authorName = rawReview.author_username || `user_${rawReview.userid || ''}`;
  const content = rawReview.comment || '';
  const rating = Number(rawReview.rating_star || 5);
  const now = new Date();
  const publishedAt = rawReview.mtime || rawReview.ctime ? new Date(Number(rawReview.mtime || rawReview.ctime) * 1000) : now;

  const rawImages = Array.isArray(rawReview.images) ? rawReview.images : [];
  const mediaUrls = rawImages.map(buildShopeeImageUrl).filter(Boolean);

  return /** @type {import('../../../core/types.js').CommentItem} */ ({
    id: `shopee:review:${reviewId}`,
    platform: 'shopee',
    externalId: reviewId,
    postId: `shopee:${itemId}`,
    parentCommentId: null,
    depth: 0,
    authorId: String(rawReview.userid || ''),
    authorName,
    authorAvatar: rawReview.author_portrait ? buildShopeeImageUrl(rawReview.author_portrait) : null,
    content,
    mediaUrls,
    likesCount: Number(rawReview.like_count || 0),
    publishedAt,
    crawledAt: now,
    metadata: {
      rating,
      modelName: rawReview.product_items?.[0]?.model_name || '',
    },
  });
}
