// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok Shop Product Normalizer.
 * Maps TikTok Shop API product objects into canonical PostItem schema.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export const TIKTOK_SHOP_BASE_URL = 'https://affiliate.tiktok.com';

/**
 * Parse a numeric price value, ignoring currency symbols and commas.
 * @param {string | number | undefined | null} rawPrice
 * @returns {number}
 */
export function normalizeTikTokShopPrice(rawPrice) {
  if (typeof rawPrice === 'number') {
    return Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : 0;
  }
  if (!rawPrice || typeof rawPrice !== 'string') return 0;

  // Vietnamese-style prices may use dots as thousand separators (e.g., "149.000").
  // Remove all non-digit characters, then treat dots as thousand separators if present.
  const dotCount = (rawPrice.match(/\./g) || []).length;
  let cleaned;
  if (dotCount >= 1) {
    cleaned = rawPrice.replace(/[^\d.]/g, '').replace(/\./g, '');
  } else {
    cleaned = rawPrice.replace(/[^\d.]/g, '');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * Normalize a TikTok Shop product record into PostItem.
 * @param {Record<string, any>} raw
 * @param {Record<string, any>} [context={}]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeTikTokShopProduct(raw, context = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw.product || raw;
  const productId = String(item.product_id || item.productId || item.id || '');
  const shopId = String(item.shop_id || item.shopId || '');

  if (!productId) return null;

  const title = String(item.product_name || item.productName || item.title || '');
  const description = String(item.description || item.product_desc || title);
  const price = normalizeTikTokShopPrice(item.sale_price ?? item.salePrice ?? item.price);
  const originalPrice = normalizeTikTokShopPrice(item.original_price ?? item.originalPrice ?? price);
  const soldCount = Number(item.sold_count ?? item.soldCount ?? item.sales ?? 0);
  const commissionRate = Number(item.commission_rate ?? item.commissionRate ?? 0);
  const commissionAmount = normalizeTikTokShopPrice(item.commission_amount ?? item.commissionAmount);
  const rating = Number(item.product_rating ?? item.rating ?? item.rating_star ?? 0);
  const shopName = String(item.shop_name || item.shopName || `Shop ${shopId}`);

  const rawImages = Array.isArray(item.images) ? item.images : (item.image ? [item.image] : []);
  const mediaUrls = rawImages
    .map((/** @type {any} */ img) => (typeof img === 'string' ? img : img?.url))
    .filter((/** @type {any} */ url) => typeof url === 'string' && url.length > 0);

  const productUrl = item.product_url || item.productUrl || `${TIKTOK_SHOP_BASE_URL}/product/${productId}`;
  const now = new Date();

  return /** @type {import('../../../core/types.js').PostItem} */ ({
    id: `tiktokshop:${productId}`,
    platform: 'tiktokshop',
    externalId: productId,
    category: 'ecom',
    authorId: shopId ? `tiktokshop:shop:${shopId}` : '',
    authorName: shopName,
    authorAvatar: undefined,
    authorUrl: shopId ? `${TIKTOK_SHOP_BASE_URL}/shop/${shopId}` : null,
    postUrl: productUrl,
    content: description ? `${title}\n\n${description}` : title,
    mediaUrls,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: null,
    crawledAt: now,
    metadata: {
      productId,
      shopId,
      shopName,
      price,
      originalPrice,
      currency: 'VND',
      soldCount,
      commissionRate,
      commissionAmount,
      rating,
      sourceMethod: context.sourceMethod || 'top_products',
      ...context.extraMetadata,
    },
  });
}

/**
 * Build pageInfo from a paginated TikTok Shop response.
 * @param {Record<string, any>} response
 * @param {number} [pageSize]
 * @returns {{ has_next_page: boolean, end_cursor: string | null }}
 */
export function buildTikTokShopPageInfo(response, pageSize) {
  const data = response?.data || response;

  const hasMore = Boolean(data?.has_more ?? data?.hasMore);
  const nextCursor = data?.next_cursor ?? data?.nextCursor ?? data?.cursor ?? null;
  const products = data?.products || [];

  // Infer has_next_page from filled page and non-null cursor.
  const inferredHasNext = Boolean(hasMore || (nextCursor && products.length > 0 && products.length === pageSize));

  return {
    has_next_page: inferredHasNext,
    end_cursor: nextCursor ? String(nextCursor) : null,
  };
}
