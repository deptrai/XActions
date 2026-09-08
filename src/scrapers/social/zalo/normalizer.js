// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Zalo OA Normalizers — transforms raw Zalo OpenAPI payloads to
 * standardized PostItem and ProfileItem domain models.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { namespacedZaloId, parseZaloDate, stripHtml } from './schema.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 * @typedef {import('../../../core/types.js').ProfileItem} ProfileItem
 */

/**
 * Normalize Zalo OA article into PostItem.
 * @param {Record<string, unknown>} article
 * @param {Record<string, unknown>} [context={}]
 * @returns {PostItem}
 */
export function normalizeZaloArticle(article, context = {}) {
  const externalId = String(article.id || article.article_id || '');
  const id = namespacedZaloId(externalId);
  const rawBody = typeof article.body === 'string' ? article.body : '';
  const rawDesc = typeof article.description === 'string' ? article.description : '';
  const cleanBody = stripHtml(rawBody);
  const cleanDesc = stripHtml(rawDesc);
  const title = typeof article.title === 'string' ? article.title.trim() : '';

  const content = cleanBody || cleanDesc || title;

  const mediaUrls = [];
  if (typeof article.cover === 'string' && article.cover.trim()) {
    mediaUrls.push(article.cover.trim());
  }
  if (typeof article.thumb === 'string' && article.thumb.trim() && !mediaUrls.includes(article.thumb.trim())) {
    mediaUrls.push(article.thumb.trim());
  }

  const oaId = String(context.oaId || article.oa_id || 'zalo_oa');
  const oaName = String(article.author || context.oaName || 'Zalo Official Account');
  const oaAvatar = typeof context.oaAvatar === 'string' ? context.oaAvatar : null;

  return {
    id,
    platform: 'zalo',
    externalId,
    title: title || undefined,
    category: 'social',
    authorId: oaId,
    authorName: oaName,
    authorAvatar: oaAvatar,
    authorUrl: context.oaId ? `https://oa.zalo.me/${context.oaId}` : undefined,
    postUrl: externalId ? `https://oa.zalo.me/article/${externalId}` : undefined,
    content,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    metadata: {
      status: article.status ?? 'show',
      type: article.type ?? 'normal',
      description: cleanDesc || undefined,
      originalAuthor: article.author || undefined,
      sourcePlatform: 'zalo',
    },
    publishedAt: parseZaloDate(article.create_date) || null,
    crawledAt: new Date(),
  };
}

/**
 * Normalize Zalo OA follower user into ProfileItem.
 * @param {Record<string, unknown>} user
 * @param {Record<string, unknown>} [context={}]
 * @returns {ProfileItem}
 */
export function normalizeZaloFollower(user, context = {}) {
  const userId = String(user.user_id || user.id || '');
  const id = namespacedZaloId(userId);
  const displayName = typeof user.display_name === 'string' ? user.display_name : (user.name || `Zalo User ${userId}`);
  const avatar = typeof user.avatar === 'string' ? user.avatar : null;

  return {
    id,
    platform: 'zalo',
    externalId: userId,
    name: displayName,
    authorName: displayName,
    avatar,
    profileUrl: `https://zalo.me/${userId}`,
    metadata: {
      followedOaId: context.oaId || undefined,
      userGender: user.user_gender || undefined,
      sourcePlatform: 'zalo',
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize Zalo OA Info into ProfileItem.
 * @param {Record<string, unknown>} oaData
 * @param {Record<string, unknown>} [context={}]
 * @returns {ProfileItem}
 */
export function normalizeZaloOaProfile(oaData, context = {}) {
  const oaId = String(oaData.oa_id || context.oaId || '');
  const id = namespacedZaloId(oaId);
  const name = typeof oaData.name === 'string' ? oaData.name.trim() : `Zalo OA ${oaId}`;
  const bio = typeof oaData.description === 'string' ? stripHtml(oaData.description) : '';
  const avatar = typeof oaData.avatar === 'string' ? oaData.avatar.trim() : null;
  const followersCount = typeof oaData.num_follower === 'number' ? oaData.num_follower : 0;

  return {
    id,
    platform: 'zalo',
    externalId: oaId,
    name,
    authorName: name,
    bio,
    avatar,
    profileUrl: `https://oa.zalo.me/${oaId}`,
    followersCount,
    metadata: {
      cover: typeof oaData.cover === 'string' ? oaData.cover.trim() : null,
      isVerified: Boolean(oaData.is_verified),
      packageName: oaData.package_name || undefined,
      category: oaData.category || undefined,
      sourcePlatform: 'zalo',
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize Zalo Marketplace / Shop product into PostItem.
 * @param {Record<string, unknown>} product
 * @param {Record<string, unknown>} [context={}]
 * @returns {PostItem}
 */
export function normalizeZaloProduct(product, context = {}) {
  const productId = String(product.id || product.product_id || '');
  const id = namespacedZaloId(productId, 'product');
  const title = typeof product.name === 'string' ? product.name.trim() : '';
  const rawDesc = typeof product.description === 'string' ? product.description : '';
  const content = stripHtml(rawDesc) || title;

  const mediaUrls = Array.isArray(product.photos)
    ? product.photos.filter((p) => typeof p === 'string' && p.trim())
    : [];

  const oaId = String(context.oaId || 'zalo_oa');
  const oaName = String(context.oaName || 'Zalo OA Shop');

  return {
    id,
    platform: 'zalo',
    externalId: productId,
    title: title || undefined,
    category: 'social',
    authorId: oaId,
    authorName: oaName,
    authorAvatar: typeof context.oaAvatar === 'string' ? context.oaAvatar : null,
    authorUrl: context.oaId ? `https://oa.zalo.me/${context.oaId}` : undefined,
    content,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    metadata: {
      price: typeof product.price === 'number' ? product.price : undefined,
      code: product.code || undefined,
      status: product.status !== undefined ? product.status : 1,
      isProduct: true,
      categoryId: product.category_id || undefined,
      sourcePlatform: 'zalo',
    },
    publishedAt: parseZaloDate(product.created_at) || null,
    crawledAt: new Date(),
  };
}

/**
 * Main transformation entrypoint for Zalo responses.
 * @param {Record<string, unknown>} rawPayload
 * @param {string} action
 * @param {Record<string, unknown>} [context={}]
 * @returns {Record<string, unknown>}
 */
export function normalizeZaloResults(rawPayload, action, context = {}) {
  const data = /** @type {Record<string, unknown>} */ (rawPayload?.data ?? rawPayload ?? {});

  switch (action) {
    case 'oa_posts':
    case 'posts':
    case 'articles':
    case 'feed': {
      const medias = Array.isArray(data.medias) ? data.medias : [];
      const posts = medias.map((m) => normalizeZaloArticle(m, context));
      const total = typeof data.total === 'number' ? data.total : posts.length;
      const offset = typeof context.offset === 'number' ? context.offset : 0;
      const limit = typeof context.limit === 'number' ? context.limit : posts.length;
      const has_next_page = offset + posts.length < total;

      return {
        posts,
        pageInfo: {
          total,
          offset,
          limit,
          has_next_page,
        },
      };
    }

    case 'oa_followers':
    case 'followers': {
      const users = Array.isArray(data.users) ? data.users : [];
      const profiles = users.map((u) => normalizeZaloFollower(u, context));
      const total = typeof data.total === 'number' ? data.total : profiles.length;
      const offset = typeof context.offset === 'number' ? context.offset : 0;
      const count = typeof context.count === 'number' ? context.count : profiles.length;
      const has_next_page = offset + profiles.length < total;

      return {
        profiles,
        pageInfo: {
          total,
          offset,
          count,
          has_next_page,
        },
      };
    }

    case 'oa_detail':
    case 'oa_info':
    case 'detail':
    case 'profile':
    case 'info': {
      const profile = normalizeZaloOaProfile(data, context);
      return { profile };
    }

    case 'marketplace_products':
    case 'marketplace_search':
    case 'products':
    case 'marketplace': {
      const rawProducts = Array.isArray(data.products) ? data.products : [];
      const posts = rawProducts.map((p) => normalizeZaloProduct(p, context));
      const total = typeof data.total === 'number' ? data.total : posts.length;
      const offset = typeof context.offset === 'number' ? context.offset : 0;
      const limit = typeof context.limit === 'number' ? context.limit : posts.length;
      const has_next_page = offset + posts.length < total;

      return {
        posts,
        pageInfo: {
          total,
          offset,
          limit,
          has_next_page,
        },
      };
    }

    default:
      return { data };
  }
}
