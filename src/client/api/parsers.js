// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — GraphQL/REST Response Parsers
 *
 * Shared utilities for extracting Tweets, Profiles, cursors and lists from
 * raw Twitter API responses.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Tweet } from '../models/Tweet.js';
import { Profile } from '../models/Profile.js';

// ============================================================================
// Shared Type Definitions
// ============================================================================

/**
 * A recursive, permissive raw-data type for Twitter API responses.
 *
 * @typedef {Record<string, unknown> & {
 *   entryId?: string;
 *   type?: string;
 *   cursorType?: string;
 *   value?: string;
 *   flowToken?: string;
 *   subtaskId?: string;
 *   id?: string;
 *   id_str?: string;
 *   rest_id?: string;
 *   __typename?: string;
 *   text?: string;
 *   full_text?: string;
 *   name?: string;
 *   screen_name?: string;
 *   description?: string;
 *   location?: string;
 *   url?: string;
 *   profile_image_url_https?: string;
 *   profile_banner_url?: string;
 *   displayName?: string;
 *   username?: string;
 *   message?: string;
 *   created_at?: string;
 *   time?: string;
 *   sort_timestamp?: string;
 *   conversation_id_str?: string;
 *   rawQuery?: string;
 *   querySource?: string;
 *   product?: string;
 *   code?: number;
 *   favorite_count?: number;
 *   retweet_count?: number;
 *   reply_count?: number;
 *   bookmark_count?: number;
 *   quote_count?: number;
 *   followers_count?: number;
 *   friends_count?: number;
 *   statuses_count?: number;
 *   favourites_count?: number;
 *   listed_count?: number;
 *   media_count?: number;
 *   count?: number;
 *   w?: number;
 *   h?: number;
 *   day?: number;
 *   month?: number;
 *   year?: number;
 *   rank?: number;
 *   bitrate?: number;
 *   duration_millis?: number;
 *   width?: number;
 *   height?: number;
 *   view_count?: number;
 *   verified?: boolean;
 *   is_blue_verified?: boolean;
 *   protected?: boolean;
 *   possibly_sensitive?: boolean;
 *   can_dm?: boolean;
 *   valid?: boolean;
 *   data?: Raw;
 *   user?: Raw;
 *   legacy?: Raw;
 *   core?: Raw;
 *   views?: Raw;
 *   card?: Raw;
 *   affiliates_highlighted_label?: Raw;
 *   business_account?: Raw;
 *   affiliates_count?: number;
 *   birthdate?: Raw;
 *   content?: Raw;
 *   item?: Raw;
 *   itemContent?: Raw;
 *   conversation?: Raw;
 *   conversation_timeline?: Raw;
 *   inbox_initial_state?: Raw;
 *   list?: Raw;
 *   listInfo?: Raw;
 *   timelineModule?: Raw;
 *   errors?: Raw[];
 *   entries?: Raw[];
 *   items?: Raw[];
 *   instructions?: Raw[];
 *   subtasks?: Raw[];
 *   tabs?: Raw[];
 *   trends?: Raw[];
 *   explore_tabs?: Raw[];
 *   conversations?: Record<string, Raw>;
 *   participants?: Record<string, boolean>;
 *   tweet_results?: { result?: Raw };
 *   user_results?: { result?: Raw };
 *   list_results?: { result?: Raw };
 *   conversation_results?: { result?: Raw };
 *   tweet?: Raw;
 *   retweeted_status_result?: Raw;
 *   quoted_status_result?: Raw;
 *   create_tweet?: Raw;
 *   message_data?: Raw;
 *   last_message?: Raw;
 *   media?: Raw[];
 *   original_info?: Raw;
 *   sizes?: Raw;
 *   large?: Raw;
 *   thumb?: Raw;
 *   small?: Raw;
 *   medium?: Raw;
 *   entities?: Raw;
 *   extended_entities?: Raw;
 *   media_url?: string;
 *   media_url_https?: string;
 *   media_key?: string;
 *   ext_alt_text?: string;
 *   video_info?: Raw;
 *   variants?: Raw[];
 *   expanded_url?: string;
 *   display_url?: string;
 *   indices?: number[];
 *   hashtags?: Raw[];
 *   urls?: Raw[];
 *   user_mentions?: Raw[];
 *   symbols?: Raw[];
 *   mediaEntities?: Raw[];
 *   edit_control?: Raw;
 *   edit_eligible?: boolean;
 *   edit_perspective?: Raw;
 *   editing_allowed_by_user_ids?: boolean;
 *   source?: Raw;
 *   unmention_data?: Raw;
 *   is_translatable?: boolean;
 *   views_count?: string;
 *   commerce?: Raw;
 *   vibe?: Raw;
 *   quick_promote_eligibility?: Raw;
 *   voice_info?: Raw;
 *   birdwatch_pivot?: Raw;
 *   is_edit_history_enabled?: boolean;
 *   is_lifeline_alert?: boolean;
 *   crop_count?: string;
 *   reply_counts?: Raw;
 *   counts?: Raw;
 *   retweeters_results?: Raw;
 *   favoriters_results?: Raw;
 *   timeline?: Raw;
 *   timeline_v2?: Raw;
 *   instructionsTop?: Raw;
 *   searchCursor?: Raw;
 *   cursor?: Raw;
 *   trend?: Raw;
 *   trendMetadata?: Raw;
 *   domain?: string;
 *   groupType?: string;
 *   disclaimer?: string;
 *   category?: Raw;
 *   country?: Raw;
 *   place?: Raw;
 *   explore_trends?: Raw;
 *   modules?: Raw;
 *   displayTreatment?: Raw;
 *   centerMode?: string;
 *   clientEventInfo?: string;
 *   impressionData?: string;
 *   metadata?: Raw;
 *   result?: Raw;
 *   results?: Raw[];
 *   variables?: Raw;
 *   features?: Raw;
 *   fieldToggles?: Raw;
 *   status?: Raw;
 *   headers?: Record<string, string>;
 *   httpStatus?: number;
 *   response?: Raw;
 *   reason?: string;
 *   statusText?: string;
 *   ok?: boolean;
 *   authenticated?: boolean;
 *   sessions?: Record<string, Raw>;
 *   activeSession?: string | null;
 *   created?: string;
 *   lastUsed?: string;
 *   cookies?: Record<string, string>;
 *   guest_token?: string;
 *   subtask_id?: string;
 *   subtask?: string;
 *   settings_list?: Raw;
 *   enter_text?: Raw;
 *   enter_password?: Raw;
 *   check_logged_in_account?: Raw;
 *   response_data?: Raw;
 *   text_data?: Raw;
 *   result_data?: string;
 *   input_flow_data?: Raw;
 *   flow_context?: Raw;
 *   start_location?: Raw;
 *   debug_overrides?: Raw;
 *   subtask_versions?: Raw;
 *   member_count?: number;
 *   subscriber_count?: number;
 *   is_member?: boolean;
 *   is_subscriber?: boolean;
 *   mode?: string;
 *   creator_results?: Raw;
 *   sender_id?: string;
 *   recipient_id?: string;
 *   attachment?: Raw;
 *   in_reply_to_status_id_str?: string;
 *   in_reply_to_user_id_str?: string;
 *   in_reply_to_screen_name?: string;
 *   quoted_status_id_str?: string;
 *   full_name?: string;
 *   country_code?: string;
 *   place_type?: string;
 *   visibility?: string;
 *   label?: string;
 *   userLabelType?: string;
 *   pinned_tweet_ids_str?: string[];
 *   pinned_tweet_ids?: Raw[];
 *   binding_values?: Raw[] | Record<string, Raw>;
 *   key?: string;
 *   string_value?: string;
 *   scribe_value?: { value?: string };
 *   content_type?: string;
 *   initial_favorite_count?: string;
 *   initial_quote_count?: string;
 *   initial_reply_count?: string;
 *   initial_retweet_count?: string;
 * }} Raw
 */

/**
 * Minimal HTTP client interface used by the API modules.
 *
 * @typedef {Object} HttpClient
 * @property {(url: string) => Promise<Raw>} get
 * @property {(url: string, body?: unknown, extraHeaders?: Record<string, string>) => Promise<Raw>} post
 */

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve a dot-separated path on an object.
 * @param {Raw} obj
 * @param {string} path - e.g. 'data.user.result.timeline_v2.timeline'
 * @returns {unknown}
 * @private
 */
function resolvePath(obj, path) {
  /** @type {unknown} */
  let current = obj;
  for (const key of path.split('.')) {
    if (current == null) {
      return undefined;
    }
    current = /** @type {Record<string, unknown>} */ (current)[key];
  }
  return current;
}

// ============================================================================
// Timeline / Cursor / Tweet / Profile / List Parsing
// ============================================================================

/**
 * Parse timeline entries and cursor from a GraphQL response.
 *
 * @param {Raw} data - Raw GraphQL response
 * @param {string} timelinePath - Dot-path to the timeline object (e.g. 'data.user.result.timeline_v2.timeline')
 * @returns {{ entries: Raw[], cursor: string|null }}
 */
export function parseTimelineEntries(data, timelinePath) {
  const timeline = /** @type {Raw} */ (resolvePath(data, timelinePath));
  /** @type {Raw[]} */
  const instructions = /** @type {Raw[]} */ (timeline?.instructions || []);

  /** @type {Raw[]} */
  let entries = [];
  /** @type {string|null} */
  let cursor = null;

  for (const instruction of instructions) {
    if (instruction.type === 'TimelineAddEntries') {
      const addEntries = /** @type {Raw[]} */ (instruction.entries || []);
      entries = addEntries;
    } else if (instruction.type === 'TimelineReplaceEntry') {
      // Handle cursor replacement entries
      const replaceEntry = /** @type {Raw} */ (instruction.entry);
      if (replaceEntry?.content?.cursorType === 'Bottom') {
        const bottomValue = /** @type {string|undefined} */ (replaceEntry.content?.value);
        if (bottomValue) cursor = bottomValue;
      }
    }
  }

  // Extract bottom cursor from entries if not found in replace instructions
  if (!cursor) {
    for (const entry of entries) {
      const entryId = /** @type {string|undefined} */ (entry.entryId);
      const value = /** @type {string|undefined} */ (entry.content?.value);
      if (entryId?.startsWith('cursor-bottom') && value) {
        cursor = value;
      }
    }
  }

  return { entries, cursor };
}

/**
 * Parse a single timeline entry into a Tweet.
 *
 * @param {Raw} entry - A timeline entry object
 * @returns {Tweet|null}
 */
export function parseTweetEntry(entry) {
  const tweetResult = /** @type {Raw|undefined} */ (entry?.content?.itemContent?.tweet_results?.result);
  if (!tweetResult) return null;

  let result = tweetResult;
  // Unwrap TweetWithVisibilityResults
  if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
    result = /** @type {Raw} */ (result.tweet);
  }

  return Tweet.fromGraphQL(result);
}

/**
 * Parse a conversation module entry (multi-tweet thread) into an array of Tweets.
 *
 * @param {Raw} entry - A TimelineTimelineModule entry
 * @returns {Tweet[]}
 */
export function parseModuleEntry(entry) {
  const items = /** @type {Raw[]} */ (entry?.content?.items || []);
  const tweets = [];

  for (const item of items) {
    const tweetResult = /** @type {Raw|undefined} */ (item?.item?.itemContent?.tweet_results?.result);
    if (!tweetResult) continue;

    let result = tweetResult;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
      result = /** @type {Raw} */ (result.tweet);
    }

    const tweet = Tweet.fromGraphQL(result);
    if (tweet) tweets.push(tweet);
  }

  return tweets;
}

/**
 * Parse a single timeline entry into a Profile.
 *
 * @param {Raw} entry - A timeline entry object
 * @returns {Profile|null}
 */
export function parseUserEntry(entry) {
  const userResult = /** @type {Raw|undefined} */ (entry?.content?.itemContent?.user_results?.result);
  if (!userResult) return null;

  return Profile.fromGraphQL(userResult);
}

/**
 * Extract a cursor value from timeline entries.
 *
 * @param {Raw[]} entries - Array of timeline entries
 * @param {'top'|'bottom'} direction - Cursor direction
 * @returns {string|null}
 */
export function extractCursor(entries, direction = 'bottom') {
  for (const entry of entries) {
    const entryId = /** @type {string|undefined} */ (entry.entryId);
    const value = /** @type {string|undefined} */ (entry.content?.value);
    if (entryId?.startsWith(`cursor-${direction}`) && value) {
      return value;
    }
  }
  return null;
}
