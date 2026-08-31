// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter media normalizer — converts raw GraphQL media entities into PostItem metadata.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseTweetData } from '../../twitter/http/tweets.js';

/**
 * @typedef {Object} MediaVariant
 * @property {number} bitrate
 * @property {string} contentType
 * @property {string} url
 */

/**
 * @typedef {Object} MediaObject
 * @property {string} type - 'photo' | 'video' | 'animated_gif'
 * @property {string} url - best/fallback URL
 * @property {string} thumbnailUrl
 * @property {number} width
 * @property {number} height
 * @property {number|null} durationMs
 * @property {number|null} bitrate
 * @property {string} contentType
 * @property {MediaVariant[]|null} variants
 * @property {string|null} altText
 * @property {string} mediaKey
 */

/**
 * Select the best-quality URL for a media entity.
 * For photos: append ?format=jpg&name=orig (fallback name=large).
 * For videos / GIFs: highest bitrate MP4, fallback .m3u8 playlist.
 *
 * @param {Record<string, any>} media
 * @returns {{ url: string, bitrate: number|null, contentType: string }}
 */
function selectBestMediaUrl(media) {
  const type = media.type;

  if (type === 'photo') {
    const base = media.media_url_https || media.media_url || '';
    let url = base;
    try {
      const parsed = new URL(base);
      if (!parsed.searchParams.has('format')) {
        parsed.searchParams.set('format', 'jpg');
        parsed.searchParams.set('name', 'orig');
        url = parsed.toString();
      }
    } catch {
      url = base;
    }
    return { url, bitrate: null, contentType: 'image/jpeg' };
  }

  const variants = Array.isArray(media.video_info?.variants)
    ? media.video_info.variants.filter((/** @type {any} */ v) => v && typeof v === 'object')
    : [];
  const mp4Variants = variants
    .filter((/** @type {Record<string, any>} */ v) => v.content_type === 'video/mp4' && v.url)
    .sort((/** @type {Record<string, any>} */ a, /** @type {Record<string, any>} */ b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4Variants.length > 0) {
    const best = mp4Variants[0];
    return {
      url: String(best.url),
      bitrate: typeof best.bitrate === 'number' ? best.bitrate : null,
      contentType: 'video/mp4',
    };
  }

  // Fallback to HLS playlist if no MP4 variants available
  const hls = variants.find((/** @type {Record<string, any>} */ v) => {
    if (!v?.url) return false;
    try {
      const parsed = new URL(String(v.url));
      return parsed.pathname.endsWith('.m3u8');
    } catch {
      return false;
    }
  });
  if (hls) {
    return {
      url: String(hls.url),
      bitrate: null,
      contentType: 'application/x-mpegURL',
    };
  }

  const base = media.media_url_https || media.media_url || '';
  return { url: base, bitrate: null, contentType: 'video/mp4' };
}

/**
 * Parse a single raw media entity into a structured MediaObject.
 *
 * @param {Record<string, any>} media
 * @returns {MediaObject}
 */
export function parseMediaEntity(media) {
  if (!media || typeof media !== 'object') {
    throw new TypeError('parseMediaEntity requires a media object');
  }

  const type = media.type || 'photo';
  const { url, bitrate, contentType } = selectBestMediaUrl(media);
  const originalInfo = media.original_info || {};
  const aspectRatio = Array.isArray(media.video_info?.aspect_ratio)
    ? media.video_info.aspect_ratio
    : [originalInfo.width || 16, originalInfo.height || 9];

  let variants = null;
  if (type !== 'photo' && Array.isArray(media.video_info?.variants)) {
    variants = media.video_info.variants
      .filter((/** @type {Record<string, any>} */ v) => v && typeof v === 'object' && v.url)
      .map((/** @type {Record<string, any>} */ v) => ({
        bitrate: typeof v.bitrate === 'number' ? v.bitrate : 0,
        contentType: v.content_type || 'video/mp4',
        url: String(v.url),
      }))
      .sort((/** @type {MediaVariant} */ a, /** @type {MediaVariant} */ b) => b.bitrate - a.bitrate);
  }

  const durationMs =
    typeof media.video_info?.duration_millis === 'number'
      ? media.video_info.duration_millis
      : null;

  return {
    type,
    url,
    thumbnailUrl: media.media_url_https || media.media_url || '',
    width: originalInfo.width || (type === 'photo' ? media.sizes?.large?.w : aspectRatio[0]) || 0,
    height: originalInfo.height || (type === 'photo' ? media.sizes?.large?.h : aspectRatio[1]) || 0,
    durationMs,
    bitrate,
    contentType,
    variants,
    altText: media.ext_alt_text || null,
    mediaKey: String(media.id_str || media.media_key || ''),
  };
}

/**
 * Build a flat array of best/fallback URLs from media objects.
 *
 * @param {MediaObject[]} mediaArray
 * @returns {string[]}
 */
export function mediaObjectsToUrls(mediaArray) {
  if (!Array.isArray(mediaArray)) return [];
  return mediaArray
    .filter((/** @type {any} */ m) => m && typeof m === 'object')
    .map((/** @type {MediaObject} */ m) => m.url)
    .filter(Boolean);
}

/**
 * Convert a raw tweet (with media) into a PostItem with detailed metadata.media.
 *
 * @param {Record<string, any>} rawTweet
 * @param {Object} [context]
 * @param {string} [context.sourceMethod]
 * @param {Record<string, any>} [context.extraMetadata]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function tweetMediaToPostItem(rawTweet, context = {}) {
  const parsed = parseTweetData(rawTweet);
  if (!parsed || !parsed.id) return null;

  const rawMedia = Array.isArray(parsed.media) ? parsed.media : [];
  const mediaArray = rawMedia
    .filter((/** @type {any} */ m) => m && typeof m === 'object')
    .map((m) => parseMediaEntity(m));

  const isMedia = mediaArray.length > 0;
  const post = {
    id: `twitter:${parsed.id}`,
    platform: 'twitter',
    externalId: String(parsed.id),
    category: 'social',
    authorId: String(parsed.author?.id || ''),
    authorName: String(parsed.author?.name || ''),
    authorAvatar: parsed.author?.avatar || undefined,
    authorUrl: parsed.author?.username ? `https://x.com/${parsed.author.username}` : undefined,
    postUrl: `https://x.com/${parsed.author?.username || 'i'}/status/${parsed.id}`,
    content: parsed.text || '',
    mediaUrls: mediaObjectsToUrls(mediaArray),
    likesCount: Number(parsed.metrics?.likes) || 0,
    repostsCount: Number(parsed.metrics?.retweets) || 0,
    repliesCount: Number(parsed.metrics?.replies) || 0,
    viewsCount: Number(parsed.metrics?.views) || 0,
    publishedAt: parsed.createdAt ? new Date(parsed.createdAt) : null,
    crawledAt: new Date(),
    metadata: {
      tweetId: String(parsed.id),
      replyCount: Number(parsed.metrics?.replies) || 0,
      retweetCount: Number(parsed.metrics?.retweets) || 0,
      likeCount: Number(parsed.metrics?.likes) || 0,
      quoteCount: Number(parsed.metrics?.quotes) || 0,
      bookmarkCount: Number(parsed.metrics?.bookmarks) || 0,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions.map((m) => m.username || m).filter(Boolean) : [],
      lang: parsed.lang || null,
      isRetweet: Boolean(parsed.isRetweet),
      isReply: Boolean(parsed.isReply),
      isQuote: Boolean(parsed.quotedTweet),
      isMedia,
      mediaType: mediaArray.length > 0 ? mediaArray[0].type : null,
      media: mediaArray,
      sourceMethod: context.sourceMethod || 'media',
      ...(context.extraMetadata || {}),
    },
  };

  return post;
}
