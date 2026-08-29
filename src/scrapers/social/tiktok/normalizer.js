// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for TikTok Scraper (Story 15.2).
 * Transforms raw TikTok Web API / SSR payloads into PostItem and CommentItem.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CATEGORIES, generatePostId, generateCommentId } from '../../../core/types.js';

/**
 * Parse human-readable numbers into integers (e.g. "1.2K" -> 1200, "3.5M" -> 3500000, "1,234" -> 1234).
 * @param {string | number | undefined | null} input
 * @returns {number}
 */
export function parseHumanCount(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.floor(input) : 0;
  }
  if (!input || typeof input !== 'string') {
    return 0;
  }

  const raw = input.trim().replace(/,/g, '');
  const euroMatch = raw.match(/^(\d{1,3}(?:\.\d{3})+)([KkMmBb]?)/i);
  if (euroMatch) {
    const base = parseInt(euroMatch[1].replace(/\./g, ''), 10);
    const suffix = (euroMatch[2] || '').toUpperCase();
    if (suffix === 'K') return Math.floor(base * 1000);
    if (suffix === 'M') return Math.floor(base * 1000000);
    if (suffix === 'B') return Math.floor(base * 1000000000);
    return Math.min(base, Number.MAX_SAFE_INTEGER);
  }

  const match = raw.match(/^([\d.]+)\s*([KkMmBb]?)/i);
  if (!match) {
    const num = Number(raw);
    return Number.isFinite(num) ? Math.floor(num) : 0;
  }

  const base = parseFloat(match[1]);
  if (isNaN(base)) return 0;

  const suffix = (match[2] || '').toUpperCase();
  let multiplier = 1;
  if (suffix === 'K') multiplier = 1000;
  if (suffix === 'M') multiplier = 1000000;
  if (suffix === 'B') multiplier = 1000000000;

  const result = Math.floor(base * multiplier);
  return Math.min(result, Number.MAX_SAFE_INTEGER);
}

/**
 * Convert a Unix timestamp (seconds or ms) to a Date.
 * @param {unknown} ts
 * @returns {Date | undefined}
 */
export function parseTimestamp(ts) {
  if (ts === undefined || ts === null) return undefined;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Extract the best video / cover URL from a TikTok video object.
 * @param {Record<string, any>} video
 * @returns {{ videoUrl: string | undefined, coverUrl: string | undefined, videoWidth: number, videoHeight: number, duration: number }}
 */
export function extractTikTokMedia(video) {
  const videoUrl =
    video?.playAddr?.urlList?.[0] ||
    video?.downloadAddr?.urlList?.[0] ||
    video?.playAddr?.urlList?.map((/** @type {string} */ u) => u.replace(/&/g, '&'))[0] ||
    undefined;

  const coverUrl =
    video?.cover?.urlList?.[0] ||
    video?.originCover?.urlList?.[0] ||
    video?.dynamicCover?.urlList?.[0] ||
    undefined;

  return {
    videoUrl,
    coverUrl,
    videoWidth: Number(video?.width) || 0,
    videoHeight: Number(video?.height) || 0,
    duration: Number(video?.duration) || 0,
  };
}

/**
 * Extract hashtags from a TikTok description or item struct.
 * @param {Record<string, any>} item
 * @returns {string[]}
 */
export function extractHashtags(item) {
  /** @type {string[]} */
  const hashtags = [];
  const desc = typeof item.desc === 'string' ? item.desc : '';
  const regex = /#([a-zA-Z0-9_À-ɏЀ-ӿ]+)/g;
  let m;
  while ((m = regex.exec(desc)) !== null) {
    if (!hashtags.includes(m[1])) hashtags.push(m[1]);
  }
  if (Array.isArray(item.cha_list)) {
    for (const ch of item.cha_list) {
      const tag = typeof ch === 'string' ? ch : ch?.cha_name || ch?.title || '';
      if (tag && !hashtags.includes(tag)) hashtags.push(tag);
    }
  }
  if (Array.isArray(item.text_extra)) {
    for (const extra of item.text_extra) {
      const tag = extra?.hashtag_name || extra?.text;
      if (tag && !hashtags.includes(tag)) hashtags.push(tag);
    }
  }
  return hashtags;
}

/**
 * Extract author info from a TikTok item.
 * @param {Record<string, any>} item
 * @returns {{ authorId: string, authorName: string, authorAvatar: string | undefined, authorUrl: string | undefined }}
 */
export function extractAuthor(item) {
  const author = item.author || item.author_info || item.user || {};
  const authorId = String(author.id || author.uid || author.author_id || author.sec_uid || '');
  const authorName = String(author.nickname || author.unique_id || author.username || author.handle || '');
  const authorAvatar = author.avatar_thumb?.urlList?.[0] || author.avatar_larger?.urlList?.[0] || undefined;
  const authorUrl = authorName ? `https://www.tiktok.com/@${authorName}` : undefined;
  return { authorId, authorName, authorAvatar, authorUrl };
}

/**
 * Build a canonical TikTok post URL from author and aweme id.
 * @param {Record<string, any>} item
 * @returns {string | undefined}
 */
export function buildTikTokPostUrl(item) {
  const author = item.author || item.author_info || item.user || {};
  const authorName = String(author.unique_id || author.username || author.handle || '');
  const awemeId = String(item.aweme_id || item.id || item.item_id || '');
  if (authorName && awemeId) {
    return `https://www.tiktok.com/@${authorName}/video/${awemeId}`;
  }
  return undefined;
}

/**
 * Normalize a raw TikTok item into a PostItem.
 * @param {Record<string, any>} raw
 * @param {string} [sourceMethod]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeTikTokPost(raw, sourceMethod = 'api') {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw.itemInfo?.itemStruct || raw.item || raw;
  const awemeId = String(item.aweme_id || item.id || item.item_id || '');
  if (!awemeId) return null;

  const { authorId, authorName, authorAvatar, authorUrl } = extractAuthor(item);
  const content = String(item.desc || item.title || '');
  const { videoUrl, coverUrl, videoWidth, videoHeight, duration } = extractTikTokMedia(item.video);

  const stats = item.statistics || item.stats || {};
  const likesCount = parseHumanCount(stats.digg_count ?? stats.like_count ?? stats.likes);
  const repostsCount = parseHumanCount(stats.share_count ?? stats.repost_count ?? stats.reshare);
  const repliesCount = parseHumanCount(stats.comment_count ?? stats.comments);
  const viewsCount = parseHumanCount(stats.play_count ?? stats.views);

  const hashtags = extractHashtags(item);
  const music = item.music || {};
  const postUrl = buildTikTokPostUrl(item) || `https://www.tiktok.com/video/${awemeId}`;
  const publishedAt = parseTimestamp(item.create_time || item.createTime);

  /** @type {import('../../../core/types.js').PostItem} */
  const post = {
    id: generatePostId('tiktok', awemeId),
    externalId: awemeId,
    platform: 'tiktok',
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls: videoUrl ? [videoUrl] : (coverUrl ? [coverUrl] : []),
    likesCount,
    repostsCount,
    repliesCount,
    viewsCount,
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      sourceMethod,
      awemeId,
      duration,
      hashtags,
      videoHeight,
      videoWidth,
      musicId: String(music.id || music.mid || ''),
      musicTitle: String(music.title || ''),
      region: String(item.region || ''),
      coverUrl,
    },
  };

  return post;
}

/**
 * Normalize a raw TikTok comment node into a CommentItem.
 * @param {Record<string, any>} raw
 * @param {string} postExternalId
 * @param {Object} [options]
 * @param {string} [options.parentCommentId]
 * @param {number} [options.depth]
 * @param {string} [options.sourceMethod]
 * @returns {import('../../../core/types.js').CommentItem | null}
 */
export function normalizeTikTokComment(raw, postExternalId, options = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const comment = raw.comment || raw;
  const commentId = String(comment.cid || comment.comment_id || comment.id || '');
  if (!commentId) return null;

  const user = comment.user || comment.user_info || {};
  const authorId = String(user.id || user.uid || user.sec_uid || '');
  const authorName = String(user.nickname || user.unique_id || user.username || '');
  const authorAvatar = user.avatar_thumb?.urlList?.[0] || user.avatar_larger?.urlList?.[0] || undefined;
  const content = String(comment.text || comment.content || '');

  const likesCount = parseHumanCount(comment.digg_count || comment.like_count || 0);
  const subCommentsCount = parseHumanCount(comment.reply_comment_total || comment.reply_total || 0);
  const publishedAt = parseTimestamp(comment.create_time);

  // Allow CommentTreeExtractor to inject parent/depth via raw properties
  // when the platform-agnostic normalizeFn signature only passes (raw, postId).
  let parentCommentId = options.parentCommentId ?? raw.parentId ?? raw.parentCommentId ?? raw.parent_id;
  const depth = options.depth ?? raw.depth ?? 0;

  // CommentTreeExtractor passes the parent external id in raw.parentId.
  // Convert it to the normalized composite id so the tree can attach.
  if (parentCommentId && typeof parentCommentId === 'string' && !parentCommentId.startsWith('tiktok:')) {
    parentCommentId = generateCommentId('tiktok', postExternalId, parentCommentId);
  }

  /** @type {import('../../../core/types.js').CommentItem} */
  const item = {
    id: generateCommentId('tiktok', postExternalId, commentId),
    externalId: commentId,
    platform: 'tiktok',
    postId: generatePostId('tiktok', postExternalId),
    parentCommentId,
    depth,
    authorId,
    authorName,
    authorAvatar,
    content,
    likesCount,
    subCommentsCount,
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      sourceMethod: options.sourceMethod || 'api',
    },
  };

  return item;
}

/**
 * Normalize a TikTok search response into an array of PostItem + pageInfo.
 * @param {Record<string, any>} res
 * @returns {{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }}
 */
export function normalizeTikTokSearchResponse(res) {
  if (!res || typeof res !== 'object') {
    return { posts: [], pageInfo: { has_next_page: false, end_cursor: null } };
  }

  /** @type {import('../../../core/types.js').PostItem[]} */
  const posts = [];
  const seen = new Set();

  const items =
    res.item_list ||
    res.itemList ||
    res.data?.item_list ||
    res.data?.itemList ||
    res.data?.[0]?.item_list ||
    [];

  for (const raw of items) {
    const item = raw.item || raw;
    const post = normalizeTikTokPost(item, 'search');
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }

  const pageInfo = {
    has_next_page: Boolean(res.has_more || res.hasMore),
    end_cursor: res.cursor !== undefined ? String(res.cursor) : (res.has_more ? String(res.cursor) : null),
  };

  return { posts, pageInfo };
}

/**
 * Normalize a TikTok hashtag feed response.
 * @param {Record<string, any>} res
 * @returns {{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }}
 */
export function normalizeTikTokHashtagResponse(res) {
  return normalizeTikTokSearchResponse(res);
}

/**
 * Normalize a TikTok item detail response.
 * @param {Record<string, any>} res
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeTikTokItemDetail(res) {
  if (!res || typeof res !== 'object') return null;
  const item = res.itemInfo?.itemStruct || res.item || res.itemInfo || res;
  return normalizeTikTokPost(item, 'item_detail');
}

/**
 * Normalize a TikTok comment list response.
 * @param {Record<string, any>} res
 * @param {string} postExternalId
 * @param {Object} [options]
 * @param {string} [options.parentCommentId]
 * @param {number} [options.depth]
 * @returns {{ comments: import('../../../core/types.js').CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }}
 */
export function normalizeTikTokCommentResponse(res, postExternalId, options = {}) {
  if (!res || typeof res !== 'object') {
    return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
  }

  /** @type {import('../../../core/types.js').CommentItem[]} */
  const comments = [];
  const seen = new Set();

  const items =
    res.comments ||
    res.comment_list ||
    res.commentList ||
    res.data?.comments ||
    res.data?.comment_list ||
    res.data?.commentList ||
    [];

  for (const raw of items) {
    const comment = normalizeTikTokComment(raw, postExternalId, {
      ...options,
      sourceMethod: 'comment_list',
    });
    if (!comment || seen.has(comment.id)) continue;
    seen.add(comment.id);
    comments.push(comment);
  }

  const pageInfo = {
    has_next_page: Boolean(res.has_more || res.hasMore),
    end_cursor: res.cursor !== undefined ? String(res.cursor) : null,
  };

  return { comments, pageInfo };
}
