// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for Meta Threads Scraper (Story 15.1.1).
 * Transforms raw GraphQL / SSR payloads to ProfileItem & PostItem.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CATEGORIES } from '../../../core/types.js';

/**
 * Generate namespaced profile identifier for Threads.
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedProfileId(externalId) {
  return `threads:${String(externalId || '').trim()}`;
}

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

  const clean = input.trim().replace(/,/g, '');
  const match = clean.match(/^([\d.]+)\s*([KkMmBb]?)/i);
  if (!match) {
    const num = Number(clean);
    return Number.isFinite(num) ? Math.floor(num) : 0;
  }

  const base = parseFloat(match[1]);
  if (isNaN(base)) return 0;

  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'K') return Math.floor(base * 1000);
  if (suffix === 'M') return Math.floor(base * 1000000);
  if (suffix === 'B') return Math.floor(base * 1000000000);
  return Math.floor(base);
}

/**
 * Normalize raw Threads GraphQL or SSR user object to standard ProfileItem.
 * @param {Record<string, any>} raw
 * @param {'graphql' | 'ssr'} [sourceMethod='graphql']
 * @returns {Record<string, any>}
 */
export function normalizeThreadsProfile(raw, sourceMethod = 'graphql') {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid raw profile payload: expected object');
  }

  const user = raw.userData?.user || raw.user || raw;
  const userId = String(user.id || user.pk || user.user_id || raw.userId || raw.id || '').trim();
  const username = String(user.username || raw.username || '').replace(/^@/, '').trim();
  const name = String(user.full_name || user.name || raw.name || username).trim();
  const bio = String(user.biography || user.bio || raw.bio || '').trim();
  const avatar = user.profile_pic_url || user.hd_profile_pic_url_info?.url || raw.avatar || null;
  const isVerified = Boolean(user.is_verified || user.isVerified || raw.isVerified);

  const rawFollowers = user.follower_count ?? user.followersCount ?? user.followers ?? raw.followersCount;
  const followersCount = parseHumanCount(rawFollowers);

  const rawFollowing = user.following_count ?? user.friends_count ?? user.followingCount ?? user.following ?? raw.followingCount;
  const followingCount = parseHumanCount(rawFollowing);

  const profileUrl = `https://www.threads.net/@${username}`;
  const id = namespacedProfileId(userId || username);

  return {
    id,
    platform: 'threads',
    externalId: userId || username,
    name,
    username,
    bio,
    avatar,
    profileUrl,
    followersCount,
    followingCount,
    metadata: {
      isProfile: true,
      isFollower: false,
      isFollowing: false,
      sourceMethod,
      isVerified,
      userId: userId || username,
      username,
      followersCount,
      followingCount,
    },
  };
}

/**
 * Normalize a follower or following connection edge to ProfileItem.
 * @param {Record<string, any>} raw
 * @param {'graphql' | 'ssr'} [sourceMethod='graphql']
 * @param {'follower' | 'following'} [connectionType='follower']
 * @returns {Record<string, any>}
 */
export function normalizeThreadsConnection(raw, sourceMethod = 'graphql', connectionType = 'follower') {
  const profile = normalizeThreadsProfile(raw, sourceMethod);
  const isFollower = connectionType === 'follower';
  const isFollowing = connectionType === 'following';

  return {
    ...profile,
    metadata: {
      ...profile.metadata,
      isProfile: false,
      isFollower,
      isFollowing,
    },
  };
}

/**
 * Convert a ProfileItem to PostItem schema for persistence into Prisma Post table.
 * @param {Record<string, any>} profile
 * @returns {import('../../../core/types.js').PostItem}
 */
export function profileItemToPostItem(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid profile item: expected object');
  }

  const id = profile.id || namespacedProfileId(profile.externalId || profile.username);
  const externalId = String(profile.externalId || profile.username || '');
  const authorId = externalId;
  const authorName = String(profile.name || profile.username || '');
  const authorAvatar = profile.avatar || undefined;
  const authorUrl = profile.profileUrl || `https://www.threads.net/@${profile.username}`;
  const postUrl = authorUrl;
  const content = profile.bio || authorName || 'Threads Profile';
  const mediaUrls = profile.avatar ? [profile.avatar] : [];
  const likesCount = typeof profile.followersCount === 'number' ? profile.followersCount : 0;
  const repliesCount = typeof profile.followingCount === 'number' ? profile.followingCount : 0;

  const metadata = {
    isProfile: Boolean(profile.metadata?.isProfile ?? true),
    isFollower: Boolean(profile.metadata?.isFollower ?? false),
    isFollowing: Boolean(profile.metadata?.isFollowing ?? false),
    sourceMethod: profile.metadata?.sourceMethod || 'graphql',
    isVerified: Boolean(profile.metadata?.isVerified ?? false),
    userId: profile.metadata?.userId || externalId,
    username: profile.username || '',
    followersCount: likesCount,
    followingCount: repliesCount,
  };

  return {
    id,
    platform: 'threads',
    externalId,
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls,
    likesCount,
    repostsCount: 0,
    repliesCount,
    viewsCount: 0,
    metadata,
    publishedAt: undefined,
    crawledAt: new Date(),
  };
}
