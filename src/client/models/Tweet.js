// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Tweet Data Model
 *
 * Represents a tweet from Twitter's internal GraphQL API.
 * Use Tweet.fromGraphQL(raw) to parse raw API responses.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

/** @typedef {import('../api/parsers.js').Raw} Raw */

/**
 * Parse a Twitter media entity into a normalized object.
 * @param {Raw} media - Raw media entity from legacy.entities.media[]
 * @returns {{id: string, type: string, url: string, preview: string, width: number, height: number, duration: number|null, altText: string|null}|null}
 * @private
 */
function parseMediaEntity(media) {
  if (!media) return null;

  const type = /** @type {string} */ (media.type || 'photo');
  /** @type {{id: string, type: string, url: string, preview: string, width: number, height: number, duration: number|null, altText: string|null}} */
  const result = {
    id: /** @type {string} */ (media.id_str || media.media_key || ''),
    type,
    url: /** @type {string} */ (media.media_url_https || media.media_url || ''),
    preview: /** @type {string} */ (media.media_url_https || media.media_url || ''),
    width: /** @type {number} */ ((/** @type {Raw} */ (media.original_info))?.width || (/** @type {Raw} */ (media.sizes))?.large?.w || 0),
    height: /** @type {number} */ ((/** @type {Raw} */ (media.original_info))?.height || (/** @type {Raw} */ (media.sizes))?.large?.h || 0),
    duration: null,
    altText: /** @type {string|null} */ (media.ext_alt_text || null),
  };

  if ((type === 'video' || type === 'animated_gif') && media.video_info) {
    const variants = (/** @type {Raw[]} */ ((/** @type {Raw} */ (media.video_info)).variants || []))
      .filter((/** @type {Raw} */ v) => v.content_type === 'video/mp4')
      .sort((/** @type {Raw} */ a, /** @type {Raw} */ b) => (/** @type {number} */ (b.bitrate || 0)) - (/** @type {number} */ (a.bitrate || 0)));
    if (variants.length > 0) {
      result.url = /** @type {string} */ (variants[0].url);
    }
    result.duration = ((/** @type {Raw} */ (media.video_info)).duration_millis)
      ? Math.round(/** @type {number} */ ((/** @type {Raw} */ (media.video_info)).duration_millis) / 1000)
      : null;
  }

  return result;
}

/**
 * Parse a poll from a tweet's card data.
 * @param {Raw} card - Raw card data
 * @returns {{id: string, options: Array<{label: string, votes: number}>, endDatetime: string|null, votingStatus: string, totalVotes: number}|null}
 * @private
 */
function parsePollFromCard(card) {
  if (!card) return null;

  const bindingValues = /** @type {Raw} */ (card.legacy)?.binding_values || card.binding_values;
  if (!bindingValues) return null;

  /** @type {Record<string, string>} */
  const vals = {};
  if (Array.isArray(bindingValues)) {
    for (const bv of (/** @type {Raw[]} */ (bindingValues))) {
      if (bv.key && bv.value) {
        const key = /** @type {string} */ (bv.key);
        const rawValue = typeof bv.value === 'string'
          ? { string_value: bv.value }
          : /** @type {Raw} */ (/** @type {unknown} */ (bv.value));
        vals[key] = /** @type {string} */ (rawValue.string_value || rawValue.scribe_value?.value || '');
      }
    }
  } else {
    for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (bindingValues))) {
      const value = /** @type {Raw} */ (val);
      vals[key] = /** @type {string} */ (value?.string_value || (/** @type {Raw} */ (value?.scribe_value))?.value || '');
    }
  }

  const options = [];
  let totalVotes = 0;
  for (let i = 1; i <= 4; i++) {
    const label = vals[`choice${i}_label`];
    if (!label) break;
    const votes = parseInt(vals[`choice${i}_count`] || '0', 10);
    options.push({ label, votes });
    totalVotes += votes;
  }
  if (options.length === 0) return null;

  return {
    id: vals.card_url || '',
    options,
    endDatetime: vals.end_datetime_utc || null,
    votingStatus: vals.counts_are_final === 'true' ? 'closed' : 'open',
    totalVotes,
  };
}

// ============================================================================
// Tweet Class
// ============================================================================

/**
 * Represents a single tweet from Twitter.
 */
export class Tweet {
  constructor() {
    /** @type {string} */
    this.id = '';
    /** @type {string} */
    this.text = '';
    /** @type {string} */
    this.fullText = '';
    /** @type {string} */
    this.username = '';
    /** @type {string} */
    this.userId = '';
    /** @type {Date|null} */
    this.timeParsed = null;
    /** @type {number|null} */
    this.timestamp = null;
    /** @type {string[]} */
    this.hashtags = [];
    /** @type {string[]} */
    this.mentions = [];
    /** @type {string[]} */
    this.urls = [];
    /** @type {Array<{id: string, url: string, alt: string|null}>} */
    this.photos = [];
    /** @type {Array<{id: string, url: string, preview: string, duration: number|null}>} */
    this.videos = [];
    /** @type {Tweet[]} */
    this.thread = [];
    /** @type {string|null} */
    this.inReplyToStatusId = null;
    /** @type {Tweet|null} */
    this.inReplyToStatus = null;
    /** @type {string|null} */
    this.quotedStatusId = null;
    /** @type {Tweet|null} */
    this.quotedStatus = null;
    /** @type {boolean} */
    this.isRetweet = false;
    /** @type {boolean} */
    this.isReply = false;
    /** @type {boolean} */
    this.isQuote = false;
    /** @type {Tweet|null} */
    this.retweetedStatus = null;
    /** @type {number} */
    this.likes = 0;
    /** @type {number} */
    this.retweets = 0;
    /** @type {number} */
    this.replies = 0;
    /** @type {number} */
    this.views = 0;
    /** @type {number} */
    this.bookmarkCount = 0;
    /** @type {Record<string, unknown>|null} */
    this.place = null;
    /** @type {boolean} */
    this.sensitiveContent = false;
    /** @type {string} */
    this.conversationId = '';
    /** @type {Record<string, unknown>|null} */
    this.poll = null;
  }

  /**
   * Create a Tweet from a raw Twitter GraphQL "tweet_results.result" object.
   *
   * @param {Raw} raw - Raw GraphQL tweet result
   * @returns {Tweet|null} Parsed tweet, or null if unparseable/tombstone
   */
  static fromGraphQL(raw) {
    if (!raw) return null;

    // Handle "TweetWithVisibilityResults" wrapper
    if (raw.__typename === 'TweetWithVisibilityResults' && raw.tweet) {
      raw = /** @type {Raw} */ (raw.tweet);
    }

    // Handle tombstone (deleted/unavailable tweets)
    if (raw.__typename === 'TweetTombstone') return null;

    const legacy = /** @type {Raw|undefined} */ (raw.legacy);
    if (!legacy) return null;

    const tweet = new Tweet();

    // Core fields
    tweet.id = /** @type {string} */ (legacy.id_str || raw.rest_id || '');
    tweet.fullText = /** @type {string} */ (legacy.full_text || legacy.text || '');
    tweet.text = tweet.fullText;
    tweet.conversationId = /** @type {string} */ (legacy.conversation_id_str || '');

    // User info from core.user_results
    const userResult = /** @type {Raw|undefined} */ (/** @type {Raw|undefined} */ (raw.core)?.user_results)?.result;
    if (userResult) {
      const userLegacy = /** @type {Raw|undefined} */ (userResult.legacy);
      tweet.username = /** @type {string} */ (userLegacy?.screen_name || '');
      tweet.userId = /** @type {string} */ (userResult.rest_id || userLegacy?.id_str || '');
    }

    // Timestamp
    if (legacy.created_at) {
      tweet.timeParsed = new Date(/** @type {string} */ (legacy.created_at));
      tweet.timestamp = tweet.timeParsed.getTime();
    }

    // Entities
    const entities = /** @type {Raw} */ (legacy.entities || {});
    tweet.hashtags = (/** @type {Raw[]} */ (entities.hashtags || [])).map((/** @type {Raw} */ h) => /** @type {string} */ (h.text)).filter(Boolean);
    tweet.mentions = (/** @type {Raw[]} */ (entities.user_mentions || [])).map((/** @type {Raw} */ m) => /** @type {string} */ (m.screen_name)).filter(Boolean);
    tweet.urls = (/** @type {Raw[]} */ (entities.urls || [])).map((/** @type {Raw} */ u) => /** @type {string} */ (u.expanded_url || u.url)).filter(Boolean);

    // Media (prefer extended_entities for full media info)
    const mediaEntities = (legacy.extended_entities?.media || entities.media || []);
    for (const media of /** @type {Raw[]} */ (mediaEntities)) {
      const parsed = parseMediaEntity(media);
      if (!parsed) continue;
      if (parsed.type === 'photo') {
        tweet.photos.push({ id: parsed.id, url: parsed.url, alt: parsed.altText });
      } else if (parsed.type === 'video' || parsed.type === 'animated_gif') {
        tweet.videos.push({
          id: parsed.id,
          url: parsed.url,
          preview: parsed.preview,
          duration: parsed.duration,
        });
      }
    }

    // Engagement counts
    tweet.likes = Number(legacy.favorite_count || 0) || 0;
    tweet.retweets = Number(legacy.retweet_count || 0) || 0;
    tweet.replies = Number(legacy.reply_count || 0) || 0;
    tweet.bookmarkCount = Number(legacy.bookmark_count || 0) || 0;

    // Views
    const views = /** @type {Raw|undefined} */ (raw.views);
    const viewCount = views?.count;
    tweet.views = viewCount ? Number(viewCount || 0) || 0 : 0;

    // Reply info
    tweet.inReplyToStatusId = /** @type {string|null} */ (legacy.in_reply_to_status_id_str || null);
    tweet.isReply = !!tweet.inReplyToStatusId;

    // Quoted tweet (recursive)
    const quoted = /** @type {Raw|undefined} */ (raw.quoted_status_result);
    const quotedResult = /** @type {Raw|undefined} */ (quoted?.result);
    if (quotedResult) {
      tweet.quotedStatusId = /** @type {string} */ (legacy.quoted_status_id_str || quotedResult.rest_id || null);
      tweet.quotedStatus = Tweet.fromGraphQL(quotedResult);
      tweet.isQuote = true;
    }

    // Retweet (recursive)
    const retweeted = /** @type {Raw|undefined} */ (legacy.retweeted_status_result);
    const retweetResult = /** @type {Raw|undefined} */ (retweeted?.result);
    if (retweetResult) {
      tweet.retweetedStatus = Tweet.fromGraphQL(retweetResult);
      tweet.isRetweet = true;
    }

    // Sensitive content
    tweet.sensitiveContent = /** @type {boolean} */ (legacy.possibly_sensitive || false);

    // Place/geo
    const place = /** @type {Raw|undefined} */ (legacy.place);
    if (place) {
      tweet.place = {
        id: /** @type {string} */ (place.id),
        name: /** @type {string} */ (place.name || place.full_name || ''),
        fullName: /** @type {string} */ (place.full_name || ''),
        country: /** @type {string} */ (place.country || ''),
        countryCode: /** @type {string} */ (place.country_code || ''),
        placeType: /** @type {string} */ (place.place_type || ''),
      };
    }

    // Poll (from card data)
    if (raw.card) {
      tweet.poll = parsePollFromCard(raw.card);
    }

    return tweet;
  }

  /**
   * Permanent URL for this tweet.
   * @returns {string}
   */
  get permanentUrl() {
    if (this.username && this.id) {
      return `https://x.com/${this.username}/status/${this.id}`;
    }
    return '';
  }

  /**
   * JSON-serializable representation.
   * @returns {Record<string, unknown>}
   */
  toJSON() {
    return {
      id: this.id,
      text: this.text,
      fullText: this.fullText,
      username: this.username,
      userId: this.userId,
      timeParsed: this.timeParsed?.toISOString() || null,
      timestamp: this.timestamp,
      hashtags: this.hashtags,
      mentions: this.mentions,
      urls: this.urls,
      photos: this.photos,
      videos: this.videos,
      likes: this.likes,
      retweets: this.retweets,
      replies: this.replies,
      views: this.views,
      bookmarkCount: this.bookmarkCount,
      isRetweet: this.isRetweet,
      isReply: this.isReply,
      isQuote: this.isQuote,
      inReplyToStatusId: this.inReplyToStatusId,
      quotedStatusId: this.quotedStatusId,
      conversationId: this.conversationId,
      sensitiveContent: this.sensitiveContent,
      place: this.place,
      poll: this.poll,
      permanentUrl: this.permanentUrl,
    };
  }
}
