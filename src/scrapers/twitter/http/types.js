// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared JSDoc type definitions for the Twitter HTTP scraper slice.
 *
 * These types are consumed by the checkJs TypeScript pass; they do not emit
 * any runtime code.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Recursive, permissive type for raw Twitter API responses.
 * @typedef {Record<string, unknown> & {
 *   entryId?: string;
 *   type?: string;
 *   cursorType?: string;
 *   value?: string;
 *   flowToken?: string;
 *   flow_token?: string;
 *   subtaskId?: string;
 *   id?: string | null;
 *   id_str?: string;
 *   rest_id?: string;
 *   __typename?: string;
 *   text?: string;
 *   full_text?: string;
 *   name?: string | null;
 *   screen_name?: string;
 *   description?: string | Raw;
 *   location?: string;
 *   url?: string | Raw;
 *   profile_image_url_https?: string;
 *   profile_banner_url?: string;
 *   displayName?: string;
 *   username?: string | null;
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
 *   media?: number | Raw[];
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
 *   hashtags?: (string | Raw)[];
 *   urls?: Raw[];
 *   user_mentions?: Raw[];
 *   symbols?: Raw[];
 *   mediaEntities?: Raw[];
 *   edit_control?: Raw;
 *   edit_eligible?: boolean;
 *   edit_perspective?: Raw;
 *   editing_allowed_by_user_ids?: boolean;
 *   source?: string;
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
 *   cursor?: string | null;
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
 *   user_id?: string;
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
 *   entry?: Raw;
 *   moduleItems?: Raw[];
 *   inReplyTo?: Raw | null;
 *   author?: Raw;
 *   metrics?: Raw;
 *   quotedTweet?: Raw | null;
 *   retweetOf?: Raw | null;
 *   createdAt?: string | null;
 *   tombstone?: Raw | boolean;
 *   mediaType?: string;
 *   isAuthenticated?: boolean;
 *   tweetId?: string | null;
 *   userId?: string | null;
 *   ext_views?: Raw;
 *   threaded_conversation_with_injections_v2?: Raw;
 *   search_by_raw_query?: Raw;
 *   search_timeline?: Raw;
 *   tweetResult?: Raw;
 *   processing_info?: { state?: string; progress_percent?: number; check_after_secs?: number; error?: { message?: string; }; } | Raw;
 *   progress_percent?: number;
 *   check_after_secs?: number;
 *   state?: string;
 *   error?: { message?: string; };
 *   website?: string | null;
 *   joined?: string | null;
 *   birthday?: string | null;
 *   bio?: string | null;
 *   following?: number;
 *   followers?: number;
 *   tweets?: number;
 *   likes?: number;
 *   unread_count?: number;
 *   media_id_string?: string;
 *   media_id?: number;
 *   created_timestamp?: string;
 *   conversation_id?: string;
 *   min_entry_id?: string;
 *   reactions?: Raw[];
 *   avatar?: string | null;
 *   header?: string | null;
 *   pinnedTweetId?: string | null;
 *   bioEntities?: Raw;
 * }} Raw
 */

/**
 * Options accepted by TwitterHttpClient.
 * @typedef {Object} TwitterHttpClientOptions
 * @property {string} [cookies]
 * @property {string} [proxy]
 * @property {'wait'|'error'|RateLimitStrategy} [rateLimitStrategy]
 * @property {number} [maxRetries]
 * @property {string|'rotate'} [userAgent]
 * @property {typeof globalThis.fetch} [fetch]
 * @property {boolean} [debug]
 */

/**
 * Strategy object for handling rate limits.
 * @typedef {Object} RateLimitStrategy
 * @property {(info: RateLimitInfo) => Promise<void>} onRateLimit
 */

/**
 * Rate limit information passed to a strategy.
 * @typedef {Object} RateLimitInfo
 * @property {number} [resetAt]
 * @property {number} [limit]
 * @property {number} [remaining]
 * @property {string} [endpoint]
 * @property {number} [retryCount]
 * @property {number} [status]
 */

/**
 * Options for TwitterHttpClient.graphql().
 * @typedef {Object} GraphqlOptions
 * @property {Record<string, boolean>} [features]
 * @property {boolean} [mutation]
 * @property {number} [limit]
 * @property {(info: { fetched: number, limit: number|null }) => void} [onProgress]
 */

/**
 * Options for TwitterHttpClient.rest().
 * @typedef {Object} RestOptions
 * @property {string} [method]
 * @property {Record<string, string>|string} [body]
 * @property {Record<string, string>} [form]
 * @property {Record<string, string>} [multipart]
 * @property {Record<string, string>} [params]
 * @property {Record<string, string>} [headers]
 */

/**
 * Options for TwitterHttpClient.request() and TwitterHttpClient.rest().
 * @typedef {Object} RequestOptions
 * @property {string} [method]
 * @property {Record<string, unknown>|string} [body]
 * @property {Record<string, string>} [headers]
 * @property {boolean} [authenticated]
 * @property {Record<string, string>} [form]
 * @property {Record<string, string>} [multipart]
 * @property {Record<string, string>} [params]
 */

/**
 * Parsed tweet object returned by parseTweetData / the scrapers.
 * @typedef {Object} ParsedTweet
 * @property {string|null} id
 * @property {string} text
 * @property {string|null} createdAt
 * @property {Raw} author
 * @property {Raw} metrics
 * @property {Raw[]} media
 * @property {Raw|null} quotedTweet
 * @property {Raw|null} inReplyTo
 * @property {Raw[]} urls
 * @property {string[]} hashtags
 * @property {Raw[]} mentions
 * @property {boolean} isReply
 * @property {boolean} isRetweet
 * @property {Raw|null} retweetOf
 * @property {string|null} lang
 * @property {string} source
 * @property {string} platform
 * @property {boolean} [tombstone]
 */

/**
 * Parsed user profile returned by parseUserData.
 * @typedef {Object} ParsedProfile
 * @property {string|null} id
 * @property {string} name
 * @property {string} username
 * @property {string} bio
 * @property {string} location
 * @property {string|null} website
 * @property {string|null} joined
 * @property {string|null} birthday
 * @property {number} following
 * @property {number} followers
 * @property {number} tweets
 * @property {number} likes
 * @property {number} media
 * @property {string|null} avatar
 * @property {string|null} header
 * @property {boolean} verified
 * @property {boolean} protected
 * @property {string|null} pinnedTweetId
 * @property {Raw} bioEntities
 * @property {string} platform
 */

/**
 * Parsed user object returned by relationship parsers.
 * @typedef {Object} ParsedUser
 * @property {string|null} id
 * @property {string|null} username
 * @property {string|null} name
 * @property {string|null} bio
 * @property {boolean} verified
 * @property {string|null} avatar
 * @property {number} followersCount
 * @property {number} followingCount
 * @property {boolean} protected
 * @property {string} platform
 */

/**
 * Post / reply / quote tweet options.
 * @typedef {Object} PostTweetOptions
 * @property {string} [replyTo]
 * @property {string[]} [mediaIds]
 * @property {string} [quoteTweetId]
 * @property {boolean} [sensitive]
 * @property {boolean} [premium]
 * @property {string[]} [excludeReplyUserIds]
 */

/**
 * Variables for the CreateTweet GraphQL mutation.
 * @typedef {Object} CreateTweetVariables
 * @property {string} tweet_text
 * @property {boolean} dark_request
 * @property {{ media_entities: { media_id: string, tagged_users: [] }[], possibly_sensitive: boolean }} media
 * @property {[]} semantic_annotation_ids
 * @property {{ in_reply_to_tweet_id: string, exclude_reply_user_ids: string[] }} [reply]
 * @property {string} [attachment_url]
 */

/**
 * Search tweets options.
 * @typedef {Object} SearchOptions
 * @property {number} [limit=100]
 * @property {string} [type='Latest']
 * @property {string|null} [cursor]
 * @property {(info: { fetched: number, limit: number }) => void} [onProgress]
 * @property {string} [since]
 * @property {string} [until]
 * @property {string} [from]
 * @property {string} [to]
 * @property {number} [minLikes]
 * @property {number} [minRetweets]
 * @property {string} [lang]
 * @property {string} [filter]
 */

/**
 * Options for buildAdvancedQuery.
 * @typedef {Object} SearchQueryOptions
 * @property {string} [keywords]
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [since]
 * @property {string} [until]
 * @property {number} [minLikes]
 * @property {number} [minRetweets]
 * @property {number} [minReplies]
 * @property {string} [lang]
 * @property {string|string[]} [filter]
 * @property {string|string[]} [exclude]
 * @property {string} [near]
 * @property {string} [within]
 * @property {string} [url]
 * @property {string} [mentioning]
 * @property {string} [listId]
 */

/**
 * Options for scrapeTweets and scrapeTweetsAndReplies.
 * @typedef {Object} TweetOptions
 * @property {number} [limit=100]
 * @property {boolean} [includeReplies=false]
 * @property {string|null} [cursor]
 * @property {(info: { fetched: number, limit: number }) => void} [onProgress]
 */

/**
 * Options for thread scraping.
 * @typedef {Object} ThreadOptions
 * @property {string} [cursor]
 * @property {boolean} [allAuthors=false]
 * @property {number} [limit=200]
 * @property {'relevance'|'recency'} [sortBy='relevance']
 * @property {(info: { fetched: number, limit: number }) => void} [onProgress]
 * @property {number} [maxDepth=50]
 */

/**
 * Options for relationship scrapers.
 * @typedef {Object} RelationshipOptions
 * @property {number} [limit=1000]
 * @property {string|null} [cursor]
 * @property {(info: { phase?: string, fetched?: number, limit?: number, page?: number, stats?: Raw }) => void} [onProgress]
 */

/**
 * Options for non-follower detection.
 * @typedef {Object} NonFollowerOptions
 * @property {number} [limit]
 * @property {(info: { phase: string, fetched?: number, limit?: number }) => void} [onProgress]
 */

/**
 * Options for uploadMedia / uploadImage / uploadVideo.
 * @typedef {Object} MediaUploadOptions
 * @property {string} [mediaType]
 * @property {string} [altText]
 * @property {(info: { phase: string, percent: number }) => void} [onProgress]
 */

/**
 * Options for downloadMedia.
 * @typedef {Object} DownloadOptions
 * @property {(info: { downloaded: number, total: number|null }) => void} [onProgress]
 */

/**
 * Convenience scraper object returned by createHttpScraper().
 * @typedef {Object} HttpScraper
 * @property {import('./client.js').TwitterHttpClient} client
 *
 * @property {(username: string, options?: TweetOptions) => Promise<unknown>} scrapeTweets
 * @property {(username: string, options?: TweetOptions) => Promise<unknown>} scrapeTweetsAndReplies
 * @property {(tweetId: string) => Promise<unknown>} scrapeTweetById
 * @property {(tweetId: string, options?: ThreadOptions) => Promise<unknown>} scrapeThread
 * @property {(tweetId: string, options?: ThreadOptions) => Promise<unknown>} scrapeFullThread
 * @property {(tweetId: string, options?: ThreadOptions) => Promise<unknown>} scrapeConversation
 *
 * @property {(username: string) => Promise<unknown>} scrapeProfile
 * @property {(userId: string) => Promise<unknown>} scrapeProfileById
 *
 * @property {(username: string, options?: RelationshipOptions) => Promise<unknown>} scrapeFollowers
 * @property {(username: string, options?: RelationshipOptions) => Promise<unknown>} scrapeFollowing
 * @property {(username: string, options?: NonFollowerOptions) => Promise<unknown>} scrapeNonFollowers
 * @property {(tweetId: string, options?: RelationshipOptions) => Promise<unknown>} scrapeLikers
 * @property {(tweetId: string, options?: RelationshipOptions) => Promise<unknown>} scrapeRetweeters
 * @property {(listId: string, options?: RelationshipOptions) => Promise<unknown>} scrapeListMembers
 *
 * @property {(text: string, options?: PostTweetOptions) => Promise<unknown>} postTweet
 * @property {(tweets: Array<string | { text: string, mediaIds?: string[] }>, options?: PostTweetOptions) => Promise<unknown>} postThread
 * @property {(tweetId: string) => Promise<unknown>} deleteTweet
 * @property {(tweetId: string, text: string, options?: PostTweetOptions) => Promise<unknown>} replyToTweet
 * @property {(tweetId: string, text: string, options?: PostTweetOptions) => Promise<unknown>} quoteTweet
 * @property {(text: string, scheduledAt: string|number|Date, options?: PostTweetOptions) => Promise<unknown>} schedulePost
 *
 * @property {(tweetId: string) => Promise<unknown>} likeTweet
 * @property {(tweetId: string) => Promise<unknown>} unlikeTweet
 * @property {(tweetId: string) => Promise<unknown>} retweet
 * @property {(tweetId: string) => Promise<unknown>} unretweet
 * @property {(userId: string) => Promise<unknown>} followUser
 * @property {(userId: string) => Promise<unknown>} unfollowUser
 * @property {(username: string) => Promise<unknown>} followByUsername
 * @property {(userId: string) => Promise<unknown>} blockUser
 * @property {(userId: string) => Promise<unknown>} unblockUser
 * @property {(userId: string) => Promise<unknown>} muteUser
 * @property {(userId: string) => Promise<unknown>} unmuteUser
 * @property {(tweetId: string) => Promise<unknown>} bookmarkTweet
 * @property {(tweetId: string) => Promise<unknown>} unbookmarkTweet
 * @property {(tweetId: string) => Promise<unknown>} pinTweet
 * @property {(tweetId: string) => Promise<unknown>} unpinTweet
 * @property {(userIds: string[], options?: Record<string, unknown>) => Promise<unknown>} bulkUnfollow
 * @property {(tweetIds: string[], options?: Record<string, unknown>) => Promise<unknown>} bulkLike
 * @property {(userIds: string[], options?: Record<string, unknown>) => Promise<unknown>} bulkBlock
 *
 * @property {(input: string|Buffer, options?: MediaUploadOptions) => Promise<unknown>} uploadMedia
 * @property {(input: string|Buffer, options?: MediaUploadOptions) => Promise<unknown>} uploadImage
 * @property {(input: string|Buffer, options?: MediaUploadOptions) => Promise<unknown>} uploadVideo
 * @property {(input: string|Buffer, options?: MediaUploadOptions) => Promise<unknown>} uploadGif
 * @property {(mediaId: string, altText: string) => Promise<unknown>} setAltText
 * @property {(username: string, options?: { limit?: number, cursor?: string|null }) => Promise<unknown>} scrapeMedia
 * @property {(url: string, destPath: string, options?: DownloadOptions) => Promise<unknown>} downloadMedia
 * @property {(tweetId: string) => Promise<unknown>} getVideoUrl
 */

export {};
