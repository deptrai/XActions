// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter search normalizer — parse SearchTimeline and user search results.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { tweetToPostItem } from './normalize-tweet.js';
import { extractUserCoreFields } from '../../twitter/http/user-helpers.js';

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

      // Tweet result may live directly in the entry or inside a module's items list.
      const candidates = [
        entry?.content?.itemContent?.tweet_results?.result,
        entry?.content?.tweet_results?.result,
      ];
      if (Array.isArray(entry?.content?.items)) {
        for (const moduleItem of entry.content.items) {
          candidates.push(
            moduleItem?.item?.itemContent?.tweet_results?.result,
            moduleItem?.itemContent?.tweet_results?.result,
          );
        }
      }
      for (const tweetResult of candidates) {
        if (!tweetResult) continue;
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

  const core = extractUserCoreFields(userResult);
  const externalId = String(core.restId || '');
  if (!externalId) return null;

  const username = core.username;
  const name = core.name;

  /** @type {import('../../../core/types.js').ProfileItem} */
  const profile = {
    id: `twitter:${externalId}`,
    platform: 'twitter',
    externalId,
    username,
    name,
    authorName: name,
    bio: core.bio || '',
    avatar: core.avatar || '',
    profileUrl: username ? `https://x.com/${username}` : undefined,
    followersCount: core.followers,
    followingCount: core.following,
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

      // User result may live directly in the entry or inside a module's items list.
      const candidates = [
        entry,
      ];
      if (Array.isArray(entry?.content?.items)) {
        for (const moduleItem of entry.content.items) {
          candidates.push(moduleItem?.item ?? moduleItem);
        }
      }
      for (const candidate of candidates) {
        const profile = userEntryToProfileItem(candidate, context);
        if (profile) users.push(profile);
      }
    }
  }

  return { users, cursor };
}
