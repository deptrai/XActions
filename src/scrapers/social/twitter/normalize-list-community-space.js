// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * normalize-list-community-space.js — Normalization functions for Twitter/X
 * lists, communities, and Spaces responses.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseUserList, parseUserEntry } from '../../twitter/http/relationships.js';

/** @typedef {import('../../../core/types.js').ProfileItem} ProfileItem */
/** @typedef {import('../../../core/types.js').PostItem} PostItem */

/**
 * Transform a raw parsed user record into a standardized ProfileItem.
 *
 * @param {Record<string, any>} user
 * @param {Object} [metadata={}]
 * @returns {ProfileItem}
 */
export function normalizeUserProfileFromList(user, metadata = {}) {
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
 * Extract instructions from a generic Twitter GraphQL timeline response.
 * Supports multiple root keys: list_members_timeline, favoriters_timeline,
 * community_members_timeline, and generic data.instructions fallbacks.
 *
 * @param {Record<string, any>} response
 * @returns {Record<string, any>[]}
 */
function extractInstructions(response) {
  const root = response?.data !== undefined ? response.data : response;

  const candidates = [
    root?.list_members_timeline?.timeline?.instructions,
    root?.community_members_timeline?.timeline?.instructions,
    root?.data?.list_members_timeline?.timeline?.instructions,
    root?.data?.community_members_timeline?.timeline?.instructions,
    root?.data?.instructions,
    root?.instructions,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

/**
 * Normalize a Twitter list members or community members response.
 *
 * @param {Record<string, any>} response
 * @param {Object} context
 * @param {string} context.sourceMethod
 * @param {string} [context.groupId]
 * @returns {{
 *   members: ProfileItem[],
 *   pageInfo: { end_cursor: string | null, has_next_page: boolean }
 * }}
 */
export function normalizeListOrCommunityMembersResponse(response, context = { sourceMethod: 'list_members' }) {
  const instructions = extractInstructions(response);
  const { users, cursor } = parseUserList(instructions);

  const seenUsernames = new Set();
  const members = [];

  for (const u of users) {
    if (!u || !u.username || seenUsernames.has(u.username.toLowerCase())) continue;
    seenUsernames.add(u.username.toLowerCase());

    const meta = { ...context };
    if (context.groupId) {
      meta.groupId = context.groupId;
    }

    members.push(normalizeUserProfileFromList(u, meta));
  }

  return {
    members,
    pageInfo: {
      end_cursor: cursor,
      has_next_page: Boolean(cursor),
    },
  };
}

/**
 * Parse a single AudioSpace entry into a PostItem.
 *
 * @param {Record<string, any>} space
 * @param {Object} [context={}]
 * @returns {PostItem | null}
 */
export function audioSpaceToPostItem(space, context = {}) {
  const spaceId = space?.id || space?.rest_id || '';
  if (!spaceId) return null;

  const host = space?.host || space?.creator_results?.result || {};
  const legacy = host?.legacy || {};
  const hostUsername = legacy.screen_name || host?.username || '';
  const hostName = legacy.name || host?.name || hostUsername || '';
  const hostAvatar = String(legacy.profile_image_url_https || host?.avatar || '').replace('_normal', '_400x400') || undefined;

  return {
    id: `twitter:spaces:${spaceId}`,
    platform: 'twitter',
    externalId: spaceId,
    category: 'social',
    authorId: host.rest_id || host.id || '',
    authorName: hostName,
    authorAvatar: hostAvatar,
    authorUrl: hostUsername ? `https://x.com/${hostUsername}` : undefined,
    postUrl: `https://x.com/i/spaces/${spaceId}`,
    content: String(space.title || space.description || space.ariaLabel || ''),
    mediaUrls: [],
    likesCount: Number(space.participant_count || 0),
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: Number(space.total_participated || space.participant_count || 0),
    publishedAt: space.started_at ? new Date(space.started_at) : null,
    crawledAt: new Date(),
    metadata: {
      ...context,
      tweetId: spaceId,
      isSpace: true,
      spaceState: String(space.state || 'live'),
      participantCount: Number(space.participant_count || 0),
      startedAt: space.started_at || null,
      sourceMethod: 'spaces',
    },
  };
}

/**
 * Extract space entries from a Twitter search/timeline response.
 *
 * @param {Record<string, any>} response
 * @returns {{
 *   posts: PostItem[],
 *   pageInfo: { end_cursor: string | null, has_next_page: boolean }
 * }}
 */
export function normalizeSpacesResponse(response) {
  const root = response?.data !== undefined ? response.data : response;

  const instructions =
    root?.search_spaces?.search_timeline?.timeline?.instructions ||
    root?.data?.search_spaces?.search_timeline?.timeline?.instructions ||
    root?.data?.instructions ||
    root?.instructions ||
    [];

  const posts = [];
  let cursor = null;
  const seenIds = new Set();

  for (const instruction of instructions) {
    const entries = instruction.entries ?? [];
    for (const entry of entries) {
      const entryId = String(entry.entryId ?? entry.entry_id ?? '');

      if (entryId.startsWith('cursor-bottom-')) {
        cursor =
          entry.content?.value ??
          entry.content?.itemContent?.value ??
          null;
        continue;
      }

      if (entryId.startsWith('cursor-top-')) continue;

      // Direct audio space in itemContent
      const candidates = [
        entry?.content?.itemContent?.audioSpace_results?.result,
        entry?.content?.itemContent?.audioSpace?.results?.result,
        entry?.content?.audioSpace_results?.result,
      ];

      // Module items
      if (Array.isArray(entry?.content?.items)) {
        for (const moduleItem of entry.content.items) {
          candidates.push(
            moduleItem?.item?.itemContent?.audioSpace_results?.result,
            moduleItem?.item?.itemContent?.audioSpace?.results?.result,
            moduleItem?.item?.audioSpace_results?.result,
          );
        }
      }

      for (const space of candidates) {
        if (!space || seenIds.has(space.id)) continue;
        seenIds.add(space.id);
        const post = audioSpaceToPostItem(space);
        if (post) posts.push(post);
      }
    }
  }

  return {
    posts,
    pageInfo: {
      end_cursor: cursor,
      has_next_page: Boolean(cursor),
    },
  };
}

/**
 * Parse a list of user results directly (for community/list fallback responses).
 *
 * @param {Record<string, any>[]} users
 * @param {Object} context
 * @param {string} context.sourceMethod
 * @param {string} [context.groupId]
 * @returns {ProfileItem[]}
 */
export function normalizeUserList(users, context = { sourceMethod: 'list_members' }) {
  const seenUsernames = new Set();
  const members = [];

  for (const u of users) {
    const parsed = parseUserEntry(u);
    if (!parsed || !parsed.username || seenUsernames.has(parsed.username.toLowerCase())) continue;
    seenUsernames.add(parsed.username.toLowerCase());

    const meta = { ...context };
    if (context.groupId) meta.groupId = context.groupId;

    members.push(normalizeUserProfileFromList(parsed, meta));
  }

  return members;
}
