// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * normalize-bookmarks.js — Normalization functions for Twitter/X BookmarkTimeline responses.
 * Parses GraphQL BookmarkTimeline responses into standardized PostItem objects with
 * bookmark metadata.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseTimelineInstructions } from '../../twitter/http/tweets.js';
import { parseTwitterTweetToPostItem } from './normalize-thread.js';

/** @typedef {import('../../../core/types.js').PostItem} PostItem */

/**
 * Normalize a Twitter BookmarkTimeline GraphQL response into PostItems.
 *
 * @param {Record<string, any>} response
 * @returns {{
 *   posts: PostItem[],
 *   pageInfo: { end_cursor: string | null, has_next_page: boolean }
 * }}
 */
export function normalizeBookmarksResponse(response) {
  const root = response?.data !== undefined ? response.data : response;
  const instructions =
    root?.bookmark_timeline_v2?.timeline?.instructions ??
    root?.data?.bookmark_timeline_v2?.timeline?.instructions ??
    root?.bookmark_timeline?.timeline?.instructions ??
    root?.data?.bookmark_timeline?.timeline?.instructions ??
    root?.instructions ??
    root?.data?.instructions ??
    [];

  const { tweets, cursor } = parseTimelineInstructions(instructions);
  const validTweets = tweets.filter((t) => t && t.id && !t.tombstone);
  const posts = validTweets.map((t) => parseTwitterTweetToPostItem(t, 'bookmarks', null));

  return {
    posts,
    pageInfo: {
      end_cursor: cursor,
      has_next_page: Boolean(cursor),
    },
  };
}
