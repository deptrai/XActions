// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for Bluesky Scraper (Story 23.2).
 * Normalizes AT Protocol actor profiles, feeds, search posts, and trending topics
 * into standard ProfileItem and PostItem schemas.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CATEGORIES } from '../../../core/types.js';

/**
 * Generate namespaced profile identifier for Bluesky.
 * format: `bluesky:${did|handle}`
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedBlueskyId(externalId) {
  return `bluesky:${String(externalId || '').trim()}`;
}

/**
 * Normalize raw Bluesky actor profile object to standard ProfileItem.
 * @param {Record<string, any>} raw
 * @param {Object} [meta]
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeBlueskyProfile(raw, meta = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid raw profile payload: expected object');
  }

  const did = String(raw.did || '').trim();
  const handle = String(raw.handle || '').replace(/^@/, '').trim();
  const externalId = did || handle;
  const username = handle || did;
  const name = String(raw.displayName || raw.name || handle || did).trim();
  const bio = String(raw.description || raw.bio || '').trim();
  const avatar = raw.avatar ? String(raw.avatar).trim() : undefined;
  const banner = raw.banner ? String(raw.banner).trim() : undefined;
  const profileUrl = handle ? `https://bsky.app/profile/${handle}` : (did ? `https://bsky.app/profile/${did}` : undefined);

  const followersCount = typeof raw.followersCount === 'number' ? raw.followersCount : undefined;
  const followingCount = typeof raw.followsCount === 'number' ? raw.followsCount : undefined;
  const postsCount = typeof raw.postsCount === 'number' ? raw.postsCount : undefined;

  /** @type {import('../../../core/types.js').ProfileItem} */
  return {
    id: namespacedBlueskyId(externalId),
    platform: 'bluesky',
    externalId,
    username,
    name,
    authorName: name,
    bio,
    avatar,
    profileUrl,
    followersCount,
    followingCount,
    metadata: {
      did,
      handle,
      banner,
      postsCount,
      joined: raw.createdAt || null,
      labels: Array.isArray(raw.labels) ? raw.labels.map((l) => (typeof l === 'string' ? l : l?.val)).filter(Boolean) : [],
      isProfile: true,
      ...meta,
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize follower or following entry to ProfileItem.
 * @param {Record<string, any>} raw
 * @param {'follower' | 'following'} connectionType
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeBlueskyConnection(raw, connectionType = 'follower') {
  const isFollower = connectionType === 'follower';
  const isFollowing = connectionType === 'following';
  const profile = normalizeBlueskyProfile(raw, {
    isProfile: false,
    isFollower,
    isFollowing,
  });
  return profile;
}

/**
 * Convert a ProfileItem to PostItem schema for storage / crawler compatibility.
 * @param {import('../../../core/types.js').ProfileItem} profile
 * @returns {import('../../../core/types.js').PostItem}
 */
export function profileItemToPostItem(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid profile item: expected object');
  }

  const id = profile.id || namespacedBlueskyId(profile.externalId || profile.username || '');
  const externalId = String(profile.externalId || profile.username || '');
  const authorId = externalId;
  const authorName = String(profile.name || profile.username || 'Bluesky User');
  const authorAvatar = profile.avatar || null;
  const authorUrl = profile.profileUrl || `https://bsky.app/profile/${profile.username || externalId}`;
  const postUrl = authorUrl;
  const content = profile.bio || authorName || 'Bluesky Profile';
  const mediaUrls = profile.avatar ? [profile.avatar] : [];
  const likesCount = typeof profile.followersCount === 'number' ? profile.followersCount : 0;
  const repostsCount = typeof profile.followingCount === 'number' ? profile.followingCount : 0;

  return {
    id,
    platform: 'bluesky',
    externalId,
    category: CATEGORIES.PROFILE || 'profile',
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls,
    likesCount,
    repostsCount,
    repliesCount: 0,
    metadata: {
      isProfile: true,
      ...(profile.metadata || {}),
    },
    crawledAt: profile.crawledAt || new Date(),
  };
}

/**
 * Normalize raw AT Protocol post (from feed or search) into PostItem.
 * @param {Record<string, any>} rawItem
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeBlueskyPost(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') {
    throw new Error('Invalid post payload: expected object');
  }

  // feed item shape: { post: { ... }, reason: { ... } }
  // or direct post shape: { uri, cid, author, record, ... }
  const post = rawItem.post || rawItem;
  const record = (typeof post.record === 'object' && post.record !== null) ? post.record : {};
  const author = (typeof post.author === 'object' && post.author !== null) ? post.author : {};

  const postUri = String(post.uri || '').trim();
  const uriParts = postUri.split('/');
  const rkey = uriParts[uriParts.length - 1] || '';
  const externalId = postUri || (rkey ? `${author.handle || author.did}:${rkey}` : String(Date.now()));
  const authorHandle = String(author.handle || '').replace(/^@/, '');
  const authorDid = String(author.did || '');
  const authorName = String(author.displayName || authorHandle || authorDid || 'Bluesky User');
  const authorAvatar = author.avatar ? String(author.avatar) : null;
  const authorUrl = authorHandle ? `https://bsky.app/profile/${authorHandle}` : undefined;
  const postUrl = authorHandle && rkey ? `https://bsky.app/profile/${authorHandle}/post/${rkey}` : undefined;

  const content = String(record.text || post.text || '');

  // Parse media images from embed
  const mediaUrls = [];
  const embed = record.embed || post.embed;
  if (embed && Array.isArray(embed.images)) {
    for (const img of embed.images) {
      if (img?.thumb) mediaUrls.push(String(img.thumb));
      else if (img?.fullsize) mediaUrls.push(String(img.fullsize));
      else {
        const ref = img?.image?.ref?.$link;
        if (ref && authorDid) {
          mediaUrls.push(`https://cdn.bsky.app/img/feed_thumbnail/plain/${authorDid}/${ref}@jpeg`);
        }
      }
    }
  }

  const publishedAt = record.createdAt ? new Date(record.createdAt) : null;
  const likesCount = typeof post.likeCount === 'number' ? post.likeCount : 0;
  const repostsCount = typeof post.repostCount === 'number' ? post.repostCount : 0;
  const repliesCount = typeof post.replyCount === 'number' ? post.replyCount : 0;

  return {
    id: namespacedBlueskyId(externalId),
    platform: 'bluesky',
    externalId,
    category: CATEGORIES.POST || 'post',
    authorId: authorDid || authorHandle,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls,
    likesCount,
    repostsCount,
    repliesCount,
    metadata: {
      uri: postUri,
      cid: post.cid || null,
      rkey,
      isRepost: Boolean(rawItem.reason),
      repostedBy: rawItem.reason?.by?.handle || null,
      labels: Array.isArray(post.labels) ? post.labels.map((l) => (typeof l === 'string' ? l : l?.val)).filter(Boolean) : [],
      indexedAt: post.indexedAt || null,
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

/**
 * Normalize trending topic item to PostItem.
 * Endpoint: app.bsky.unspecced.getTrendingTopics
 * Payload: { topics: [{ topic, displayName, description, link }] }
 * @param {Record<string, any>} rawTopic
 * @param {number} [rank=1]
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeBlueskyTrendingTopic(rawTopic, rank = 1) {
  if (!rawTopic || typeof rawTopic !== 'object') {
    throw new Error('Invalid trending topic payload: expected object');
  }

  const topic = String(rawTopic.topic || rawTopic.displayName || `trend_${rank}`).trim();
  const displayName = String(rawTopic.displayName || topic).trim();
  const description = String(rawTopic.description || '').trim();
  const externalId = `trend:${encodeURIComponent(topic)}`;
  const link = rawTopic.link ? String(rawTopic.link) : `https://bsky.app/search?q=${encodeURIComponent(topic)}`;

  return {
    id: namespacedBlueskyId(externalId),
    platform: 'bluesky',
    externalId,
    category: CATEGORIES.TRENDING || 'trending',
    authorId: 'bluesky_system',
    authorName: 'Bluesky Trends',
    authorAvatar: null,
    authorUrl: 'https://bsky.app',
    postUrl: link,
    content: description ? `${displayName} — ${description}` : displayName,
    mediaUrls: [],
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    metadata: {
      topic,
      displayName,
      description,
      rank,
      link,
      isTrend: true,
    },
    publishedAt: new Date(),
    crawledAt: new Date(),
  };
}
