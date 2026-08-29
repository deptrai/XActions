// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter search normalizer — parse SearchTimeline and user search results.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { tweetToPostItem } from './normalize-tweet.js';

/**
 * Extract tweets and cursor from SearchTimeline response.
 * @param {Record<string, any>} response
 * @param {Object} [context]
 * @param {string} [context.sourceMethod]
 * @param {Record<string, any>} [context.extraMetadata]
 * @returns {{ posts: import('../../../core/types.js').PostItem[], cursor: string | null }}
 */
export function parseSearchTimeline(response, context = {}) {
  const instructions =
    response?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    response?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    response?.data?.instructions ||
    response?.instructions ||
    [];

  /** @type {import('../../../core/types.js').PostItem[]} */
  const posts = [];
  /** @type {string | null} */
  let cursor = null;

  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      if (entry.entryId?.startsWith('cursor-bottom-')) {
        cursor = entry.content?.value ?? entry.content?.itemContent?.value ?? null;
        continue;
      }
      if (entry.entryId?.startsWith('cursor-top-')) continue;

      const tweetResult =
        entry?.content?.itemContent?.tweet_results?.result ??
        entry?.content?.tweet_results?.result ??
        null;
      if (tweetResult) {
        const post = tweetToPostItem(tweetResult, context);
        if (post) posts.push(post);
      }
    }
  }

  return { posts, cursor };
}

/**
 * Parse a user search result entry into a ProfileItem.
 * @param {Record<string, any>} entry
 * @param {Object} [context]
 * @param {Record<string, any>} [context.extraMetadata]
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function userEntryToProfileItem(entry, context = {}) {
  const userResult =
    entry?.content?.itemContent?.user_results?.result ??
    entry?.content?.user_results?.result ??
    null;
  if (!userResult) return null;

  const legacy = userResult.legacy || {};
  const externalId = String(userResult.rest_id || '');
  if (!externalId) return null;

  const username = String(legacy.screen_name || '');
  const name = String(legacy.name || '');

  /** @type {import('../../../core/types.js').ProfileItem} */
  const profile = {
    id: `twitter:${externalId}`,
    platform: 'twitter',
    externalId,
    username,
    name,
    authorName: name,
    bio: String(legacy.description || ''),
    avatar: String(legacy.profile_image_url_https || ''),
    profileUrl: username ? `https://x.com/${username}` : undefined,
    followersCount: Number(legacy.followers_count) || 0,
    followingCount: Number(legacy.friends_count) || 0,
    crawledAt: new Date(),
    metadata: {
      tweetId: externalId,
      isSearchResult: true,
      resultType: 'people',
      ...(context.extraMetadata || {}),
    },
  };

  return profile;
}

/**
 * Extract user profiles from SearchTimeline People product response.
 * @param {Record<string, any>} response
 * @param {Object} [context]
 * @returns {{ users: import('../../../core/types.js').ProfileItem[], cursor: string | null }}
 */
export function parseSearchUsers(response, context = {}) {
  const instructions =
    response?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    response?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    response?.data?.instructions ||
    response?.instructions ||
    [];

  /** @type {import('../../../core/types.js').ProfileItem[]} */
  const users = [];
  /** @type {string | null} */
  let cursor = null;

  for (const instruction of instructions) {
    const entries = instruction.entries || [];
    for (const entry of entries) {
      if (entry.entryId?.startsWith('cursor-bottom-')) {
        cursor = entry.content?.value ?? entry.content?.itemContent?.value ?? null;
        continue;
      }
      if (entry.entryId?.startsWith('cursor-top-')) continue;

      const profile = userEntryToProfileItem(entry, context);
      if (profile) users.push(profile);
    }
  }

  return { users, cursor };
}
