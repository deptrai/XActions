// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/** @typedef {import('./types.js').Raw} Raw */
/**
 * Twitter/X Internal API Endpoint Map
 *
 * @deprecated This module is the legacy Twitter scraper endpoint map. The hybrid
 * crawler in `src/scrapers/social/twitter/` now uses `src/scrapers/social/twitter/schema.js`
 * as the canonical source of truth for GraphQL query IDs, features, field toggles,
 * variable builders, REST paths and rate limits. This file is kept for backward
 * compatibility with the legacy `src/scrapers/twitter/` modules and will be removed
 * in Epic 20.2 (Legacy Decommission Final).
 *
 * These endpoints are reverse-engineered from Twitter's web client.
 * GraphQL query IDs change periodically - update them when Twitter deploys new bundles.
 *
 * Sources:
 *   - the-convocation/twitter-scraper (MIT) - src/api-data.ts
 *   - d60/twikit (MIT) - twikit/client/gql.py, twikit/client/v11.py, twikit/constants.py
 *   - Twitter web client network inspection
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Parameters accepted by the GraphQL variable builders.
 * @typedef {Record<string, unknown>} GraphQLVariablesParams
 * @property {number} [count]
 * @property {string} [cursor]
 * @property {string} [username]
 * @property {string} [userId]
 * @property {string} [tweetId]
 * @property {string} [focalTweetId]
 * @property {string} [query]
 * @property {string} [product]
 * @property {string} [listId]
 * @property {string[]} [seenTweetIds]
 * @property {string} [text]
 * @property {unknown[]} [mediaEntities]
 */

/**
 * Options for validateEndpoints().
 * @typedef {Object} ValidateOptions
 * @property {string[]} [endpoints] - Specific endpoint keys to check
 * @property {typeof globalThis.fetch} [fetch] - Custom fetch implementation
 */

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

/** @deprecated Use `src/scrapers/social/twitter/schema.js` `GRAPHQL_BASE`. */
export const GRAPHQL_BASE = 'https://x.com/i/api/graphql';
/** @deprecated Use `src/scrapers/social/twitter/schema.js` `REST_BASE`. */
export const REST_BASE = 'https://x.com/i/api';
/** @deprecated Use `src/scrapers/social/twitter/schema.js` `API_BASE`. */
export const API_BASE = 'https://api.x.com';

// ---------------------------------------------------------------------------
// Bearer Token (public, embedded in Twitter's web client JS bundle)
// Same token used by the-convocation/twitter-scraper and d60/twikit
// ---------------------------------------------------------------------------

/** @deprecated Use `src/scrapers/social/twitter/schema.js` `BEARER_TOKEN`. */
export const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ---------------------------------------------------------------------------
// GraphQL Query / Mutation IDs
// ---------------------------------------------------------------------------

// Cross-referenced from:
//   - the-convocation/twitter-scraper src/api-data.ts (endpoints object)
//   - d60/twikit twikit/client/gql.py (Endpoint class)
// When both sources provide an ID, the more recent one is preferred.
// Query IDs marked [twikit] or [scraper] indicate their primary source.

/**
 * @type {Record<string, {queryId: string, operationName: string}>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `GRAPHQL`.
 */
export const GRAPHQL = {
  // ---- Queries (user profiles) ----
  UserByScreenName:     { queryId: 'Gb-d6r0vxPOADdG62OEBpQ', operationName: 'UserByScreenName' },     // x.com bundle 2026-09
  UserByRestId:         { queryId: 'xvmVfRLmnr1alc5f2dib0Q', operationName: 'UserByRestId' },         // x.com bundle 2026-09

  // ---- Queries (user timelines) ----
  UserTweets:           { queryId: 'SXVCYB8XHSS25nzIljNtZA', operationName: 'UserTweets' },           // x.com bundle 2026-09
  UserTweetsAndReplies: { queryId: 'qUpkZU6eN8MbtQb7rC_pYg', operationName: 'UserTweetsAndReplies' }, // x.com bundle 2026-09
  UserMedia:            { queryId: 'VyudDWQnr9vJNw7GasFz2g', operationName: 'UserMedia' },             // x.com bundle 2026-09
  UserLikes:            { queryId: 'xA8fDIbrJfy4ojjjXmSR-A', operationName: 'Likes' },                // x.com bundle 2026-09

  // ---- Queries (tweets) ----
  TweetDetail:          { queryId: 'XMOz5h24KAZ86qKffKTLdQ', operationName: 'TweetDetail' },          // x.com bundle 2026-09
  TweetResultByRestId:  { queryId: 'GZsN2Pc4knAoit6pXa4HSA', operationName: 'TweetResultByRestId' },  // x.com bundle 2026-09

  // ---- Queries (search) ----
  SearchTimeline:       { queryId: 'hyPfJYJ_XAtDYoslQc-Rgg', operationName: 'SearchTimeline' },       // x.com bundle 2026-09

  // ---- Queries (relationships) ----
  Followers:            { queryId: 'JNyQdTISpzCkj_1fqxDvFg', operationName: 'Followers' },             // x.com bundle 2026-09
  Following:            { queryId: 'qGZZDF3mp91q7X22s3HxpA', operationName: 'Following' },            // x.com bundle 2026-09

  // ---- Queries (engagement) ----
  Likes:                { queryId: 'LLkw5EcVutJL6y-2gkz22A', operationName: 'Favoriters' },           // twikit fallback
  Retweeters:           { queryId: 'X-XEqG5qHQSAwmvy00xfyQ', operationName: 'Retweeters' },           // twikit fallback

  // ---- Queries (lists) ----
  ListMembers:          { queryId: 'BQp2IEYkgxuSxqbTAr1e1g', operationName: 'ListMembers' },          // twikit fallback
  ListTimeline:         { queryId: 'HjsWc-nwwHKYwHenbHm-tw', operationName: 'ListLatestTweetsTimeline' }, // twikit fallback

  // ---- Queries (bookmarks, auth required) ----
  BookmarkTimeline:     { queryId: 'qToeLeMs43Q8cr7tRYXmaQ', operationName: 'Bookmarks' },            // twikit fallback

  // ---- Queries (timelines) ----
  HomeTimeline:         { queryId: '-X_hcgQzmHGl29-UXxz4sw', operationName: 'HomeTimeline' },          // twikit fallback
  HomeLatestTimeline:   { queryId: 'U0cdisy7QFIoTfu3-Okw0A', operationName: 'HomeLatestTimeline' },    // twikit fallback

  // ---- Mutations (tweets) ----
  CreateTweet:          { queryId: 'WXTdKnLddrQOunD6MhWi3g', operationName: 'CreateTweet' },          // x.com bundle 2026-09
  CreateScheduledTweet: { queryId: 'LCVzRQGxOaGnOnYH01NQXg', operationName: 'CreateScheduledTweet' }, // twikit fallback
  DeleteTweet:          { queryId: 'nxpZCY2K-I6QoFHAHeojFQ', operationName: 'DeleteTweet' },          // x.com bundle 2026-09

  // ---- Mutations (engagement) ----
  FavoriteTweet:   { queryId: 'lI07N6Otwv1PhnEgXILM7A', operationName: 'FavoriteTweet' },             // x.com bundle 2026-09
  UnfavoriteTweet: { queryId: 'ZYKSe-w7KEslx3JhSIk5LA', operationName: 'UnfavoriteTweet' },           // x.com bundle 2026-09
  CreateRetweet:   { queryId: 'mbRO74GrOvSfRcJnlMapnQ', operationName: 'CreateRetweet' },             // x.com bundle 2026-09
  DeleteRetweet:   { queryId: 'ZyZigVsNiFO6v1dEks1eWg', operationName: 'DeleteRetweet' },             // x.com bundle 2026-09

  // ---- Mutations (bookmarks) ----
  CreateBookmark:  { queryId: 'aoDbu3RHznuiSkQ9aNM67Q', operationName: 'CreateBookmark' },            // x.com bundle 2026-09
  DeleteBookmark:  { queryId: 'Wlmlj2-xzyS1GN3a6cj-mQ', operationName: 'DeleteBookmark' },            // x.com bundle 2026-09
};

// ---------------------------------------------------------------------------
// REST Endpoints (v1.1 / v2)
// Source: d60/twikit twikit/client/v11.py
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, string>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `REST`.
 */
export const REST = {
  // Follow / Unfollow (FollowUser / UnfollowUser)
  friendshipsCreate:  '/1.1/friendships/create.json',
  friendshipsDestroy: '/1.1/friendships/destroy.json',

  // Block / Unblock (BlockUser / UnblockUser)
  blocksCreate:  '/1.1/blocks/create.json',
  blocksDestroy: '/1.1/blocks/destroy.json',

  // Mute / Unmute (MuteUser / UnmuteUser)
  mutesCreate:  '/1.1/mutes/users/create.json',
  mutesDestroy: '/1.1/mutes/users/destroy.json',

  // Pin / Unpin
  pinTweet:   '/1.1/account/pin_tweet.json',
  unpinTweet: '/1.1/account/unpin_tweet.json',

  // Guest token
  guestActivate: '/1.1/guest/activate.json',

  // Account
  verifyCredentials: '/1.1/account/verify_credentials.json',

  // Direct Messages (SendDM)
  dmNew:           '/1.1/dm/new2.json',
  dmDestroy:       '/1.1/direct_messages/events/destroy.json',
  dmInbox:         '/1.1/dm/inbox_initial_state.json',
  dmConversation:  '/1.1/dm/conversation',
  dmMarkRead:      '/1.1/dm/conversation',

  // Notifications
  notificationsAll:      '/2/notifications/all.json',
  notificationsVerified: '/2/notifications/verified.json',
  notificationsMentions: '/2/notifications/mentions.json',

  // Trending / Explore (ExploreTrending)
  guide:           '/2/guide.json',
  trendsAvailable: '/1.1/trends/available.json',
  trendsPlace:     '/1.1/trends/place.json',

  // Lists Management
  listsCreate:            '/1.1/lists/create.json',
  listsMembersCreateAll:  '/1.1/lists/members/create_all.json',
  listsMembersDestroyAll: '/1.1/lists/members/destroy_all.json',
};

// ---------------------------------------------------------------------------
// Default GraphQL Feature Flags
// Merged from the-convocation/twitter-scraper api-data.ts and d60/twikit constants.py
// These flags are sent with nearly every GraphQL request by the Twitter web client.
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, boolean>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `DEFAULT_FEATURES`.
 */
export const DEFAULT_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_profile_redirect_enabled: false,
};

/**
 * @type {Record<string, boolean>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `DEFAULT_FIELD_TOGGLES`.
 */
export const DEFAULT_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

// ---------------------------------------------------------------------------
// User Feature Flags (for UserByScreenName / UserByRestId queries)
// Source: d60/twikit constants.py USER_FEATURES
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, boolean>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `USER_FEATURES`.
 */
export const USER_FEATURES = {
  hidden_profile_likes_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

// ---------------------------------------------------------------------------
// Rate Limit Constants (requests per 15-minute window)
// Conservative estimates based on observed Twitter behavior.
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, number>}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `RATE_LIMITS`.
 */
export const RATE_LIMITS = {
  // Queries
  UserByScreenName: 95,
  UserByRestId: 95,
  UserTweets: 50,
  UserTweetsAndReplies: 50,
  UserMedia: 50,
  UserLikes: 75,
  TweetDetail: 150,
  TweetResultByRestId: 150,
  SearchTimeline: 50,
  Followers: 50,
  Following: 50,
  Likes: 75,
  Retweeters: 75,
  ListMembers: 75,
  ListTimeline: 50,
  BookmarkTimeline: 75,
  HomeTimeline: 150,
  HomeLatestTimeline: 150,

  // Mutations
  FavoriteTweet: 500,
  UnfavoriteTweet: 500,
  CreateRetweet: 300,
  DeleteRetweet: 300,
  CreateTweet: 300,
  DeleteTweet: 300,
  CreateBookmark: 500,
  DeleteBookmark: 500,

  // REST endpoints
  friendshipsCreate: 400,
  friendshipsDestroy: 400,
  blocksCreate: 200,
  blocksDestroy: 200,
  mutesCreate: 200,
  mutesDestroy: 200,
  pinTweet: 100,
  unpinTweet: 100,
  dmNew: 200,
  notificationsAll: 180,
  guide: 75,

  // Fallback
  DEFAULT: 180,
};

// ---------------------------------------------------------------------------
// User Agent Strings (realistic Chrome 131–133 on Windows/Mac/Linux, Feb 2026)
// ---------------------------------------------------------------------------

/**
 * @type {string[]}
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `USER_AGENTS`.
 */
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a full GraphQL GET URL with encoded query params.
 *
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `buildGraphQLUrl`.
 * @param {string} queryId
 * @param {string} operationName
 * @param {Record<string, unknown>} variables
 * @param {Record<string, boolean>} [features]
 * @param {Record<string, unknown>} [fieldToggles]
 * @returns {string}
 */
export function buildGraphQLUrl(queryId, operationName, variables, features = DEFAULT_FEATURES, fieldToggles) {
  const params = new URLSearchParams();
  params.set('variables', JSON.stringify(variables));
  params.set('features', JSON.stringify(features));
  if (fieldToggles) {
    params.set('fieldToggles', JSON.stringify(fieldToggles));
  }
  return `${GRAPHQL_BASE}/${queryId}/${operationName}?${params.toString()}`;
}

/**
 * Build the variables object for common GraphQL query types.
 *
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `buildGraphQLVariables`.
 * @param {string} type
 * @param {GraphQLVariablesParams} [params={}]
 * @returns {Record<string, unknown>}
 */
export function buildGraphQLVariables(type, params = {}) {
  const count = params.count ?? 20;
  const cursor = params.cursor;

  switch (type) {
    // ---- User profiles ----
    case 'UserByScreenName':
      return {
        screen_name: params.username,
        withSafetyModeUserFields: false,
      };

    case 'UserByRestId':
      return {
        userId: params.userId,
        withSafetyModeUserFields: true,
      };

    // ---- User timelines ----
    case 'UserTweets': {
      const v = /** @type {Record<string, unknown>} */ ({
        userId: params.userId,
        count,
        includePromotedContent: true,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
        withV2Timeline: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    case 'UserTweetsAndReplies': {
      const v = /** @type {Record<string, unknown>} */ ({
        userId: params.userId,
        count,
        includePromotedContent: true,
        withCommunity: true,
        withVoice: true,
        withV2Timeline: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    case 'UserMedia': {
      const v = /** @type {Record<string, unknown>} */ ({
        userId: params.userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        withV2Timeline: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    case 'UserLikes': {
      const v = /** @type {Record<string, unknown>} */ ({
        userId: params.userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        withV2Timeline: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Tweets ----
    case 'TweetDetail': {
      const v = /** @type {Record<string, unknown>} */ ({
        focalTweetId: params.tweetId,
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withV2Timeline: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    case 'TweetResultByRestId':
      return {
        tweetId: params.tweetId,
        includePromotedContent: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withCommunity: true,
      };

    // ---- Search ----
    case 'SearchTimeline': {
      const v = /** @type {Record<string, unknown>} */ ({
        rawQuery: params.query,
        count,
        querySource: 'typed_query',
        product: params.product ?? 'Top',
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Relationships ----
    case 'Followers':
    case 'Following': {
      const v = /** @type {Record<string, unknown>} */ ({
        userId: params.userId,
        count,
        includePromotedContent: false,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Engagement queries ----
    case 'Likes':
    case 'Retweeters': {
      const v = /** @type {Record<string, unknown>} */ ({
        tweetId: params.tweetId,
        count,
        includePromotedContent: true,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Lists ----
    case 'ListMembers': {
      const v = /** @type {Record<string, unknown>} */ ({
        listId: params.listId,
        count,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    case 'ListTimeline': {
      const v = /** @type {Record<string, unknown>} */ ({
        listId: params.listId,
        count,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Bookmarks ----
    case 'BookmarkTimeline': {
      const v = /** @type {Record<string, unknown>} */ ({
        count,
      });
      if (cursor) v.cursor = cursor;
      return v;
    }

    // ---- Home ----
    case 'HomeTimeline':
    case 'HomeLatestTimeline': {
      const v = /** @type {Record<string, unknown>} */ ({
        count,
        includePromotedContent: true,
        latestControlAvailable: true,
        requestContext: 'launch',
        withCommunity: true,
      });
      if (cursor) v.cursor = cursor;
      if (params.seenTweetIds) v.seenTweetIds = params.seenTweetIds;
      return v;
    }

    // ---- Mutations (tweets) ----
    case 'CreateTweet':
      return {
        tweet_text: params.text ?? '',
        dark_request: false,
        media: {
          media_entities: params.mediaEntities ?? [],
          possibly_sensitive: false,
        },
        semantic_annotation_ids: [],
      };

    case 'DeleteTweet':
      return {
        tweet_id: params.tweetId,
        dark_request: false,
      };

    // ---- Mutations (engagement) ----
    case 'FavoriteTweet':
    case 'UnfavoriteTweet':
      return { tweet_id: params.tweetId };

    case 'CreateRetweet':
      return { tweet_id: params.tweetId, dark_request: false };

    case 'DeleteRetweet':
      return { source_tweet_id: params.tweetId, dark_request: false };

    // ---- Mutations (bookmarks) ----
    case 'CreateBookmark':
    case 'DeleteBookmark':
      return { tweet_id: params.tweetId };

    default:
      return params;
  }
}

/**
 * Validate that GraphQL endpoint query IDs are still active.
 * Makes a lightweight OPTIONS/HEAD probe to confirm the endpoint returns
 * a recognizable response (not 404). Requires a valid auth cookie or guest token.
 *
 * @deprecated Use `src/scrapers/social/twitter/schema.js` `validateEndpoints`.
 * @param {ValidateOptions} [options={}]
 * @returns {Promise<{valid: string[], invalid: string[], errors: Record<string, string>}>}
 */
export async function validateEndpoints(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const endpointKeys = options.endpoints ?? Object.keys(GRAPHQL);
  const results = {
    valid: /** @type {string[]} */ ([]),
    invalid: /** @type {string[]} */ ([]),
    errors: /** @type {Record<string, string>} */ ({}),
  };

  for (const key of endpointKeys) {
    const endpoint = GRAPHQL[key];
    if (!endpoint) {
      results.invalid.push(key);
      results.errors[key] = 'Unknown endpoint key';
      continue;
    }

    const url = `${GRAPHQL_BASE}/${endpoint.queryId}/${endpoint.operationName}`;

    try {
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      // 200, 400 (missing params), or 403 (auth required) all mean the endpoint exists.
      // Only 404 means the query ID is stale.
      if (res.status === 404) {
        results.invalid.push(key);
        results.errors[key] = `HTTP 404 - query ID likely stale`;
      } else {
        results.valid.push(key);
      }
    } catch (err) {
      const error = /** @type {Error} */ (err);
      results.invalid.push(key);
      results.errors[key] = error.message ?? String(error);
    }
  }

  return results;
}
