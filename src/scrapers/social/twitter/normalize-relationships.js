// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * normalize-relationships.js — Normalization functions for Twitter/X relationship & engagement responses.
 * Parses GraphQL Favoriters/Likers responses into standardized ProfileItem & PostItem objects.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseUserList } from '../../twitter/http/relationships.js';

/** @typedef {import('../../../core/types.js').ProfileItem} ProfileItem */
/** @typedef {import('../../../core/types.js').PostItem} PostItem */

/**
 * Transform a raw parsed user record into a standardized ProfileItem.
 *
 * @param {Record<string, any>} user
 * @param {Object} [metadata={}]
 * @returns {ProfileItem}
 */
export function normalizeUserProfile(user, metadata = {}) {
  const externalId = String(user.id || user.rest_id || '');
  const username = user.username || '';
  const avatar = user.avatar
    ? String(user.avatar).replace('_normal', '_400x400')
    : undefined;

  return {
    id: `twitter:${externalId}`,
    platform: 'twitter',
    externalId,
    username: username || undefined,
    name: user.name || username || 'Twitter User',
    bio: user.bio || undefined,
    avatar,
    profileUrl: username ? `https://x.com/${username}` : undefined,
    followersCount: Number(user.followersCount) || 0,
    followingCount: Number(user.followingCount) || 0,
    metadata: {
      ...metadata,
      verified: Boolean(user.verified),
      protected: Boolean(user.protected),
    },
    crawledAt: new Date(),
  };
}

/**
 * Convert a ProfileItem to a PostItem for storage in PrismaStore.
 *
 * @param {ProfileItem} profile
 * @returns {PostItem}
 */
export function profileItemToPostItem(profile) {
  const meta = /** @type {Record<string, any>} */ (profile.metadata || {});
  const externalId = String(profile.externalId || profile.id.replace(/^twitter:/, ''));

  return {
    id: `twitter:${externalId}`,
    platform: 'twitter',
    externalId,
    category: 'social',
    authorId: externalId,
    authorName: profile.name || profile.username || 'Twitter User',
    authorAvatar: profile.avatar || undefined,
    authorUrl: profile.profileUrl || (profile.username ? `https://x.com/${profile.username}` : undefined),
    postUrl: profile.profileUrl || (profile.username ? `https://x.com/${profile.username}` : undefined),
    content: profile.bio || profile.name || '',
    mediaUrls: profile.avatar ? [profile.avatar] : [],
    likesCount: profile.followersCount || 0,
    repostsCount: 0,
    repliesCount: profile.followingCount || 0,
    viewsCount: 0,
    publishedAt: null,
    crawledAt: profile.crawledAt || new Date(),
    metadata: {
      ...meta,
      tweetId: String(meta.tweetId || externalId),
      username: profile.username,
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
    },
  };
}

/**
 * Normalize a Twitter Favoriters (who liked a tweet) GraphQL response.
 *
 * @param {Record<string, any>} response
 * @param {string} [tweetId='']
 * @returns {{
 *   likers: ProfileItem[],
 *   pageInfo: { end_cursor: string | null, has_next_page: boolean }
 * }}
 */
export function normalizeLikersResponse(response, tweetId = '') {
  const root = response?.data !== undefined ? response.data : response;
  const instructions =
    root?.favoriters_timeline?.timeline?.instructions ??
    root?.data?.favoriters_timeline?.timeline?.instructions ??
    root?.instructions ??
    root?.data?.instructions ??
    [];

  const { users, cursor } = parseUserList(instructions);

  const seenUsernames = new Set();
  const likers = [];

  for (const u of users) {
    if (!u || !u.username || seenUsernames.has(u.username.toLowerCase())) continue;
    seenUsernames.add(u.username.toLowerCase());
    likers.push(
      normalizeUserProfile(u, {
        isLiker: true,
        tweetId: tweetId || undefined,
        sourceMethod: 'likes',
      })
    );
  }

  return {
    likers,
    pageInfo: {
      end_cursor: cursor,
      has_next_page: Boolean(cursor),
    },
  };
}
