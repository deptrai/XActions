// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * UniversalMediaPipeline — Unified media extraction across social platforms (Story 31.1).
 *
 * Extracts and normalizes media (photos, videos, audio, carousels, HLS/DASH)
 * from Twitter, Bluesky, Mastodon, Threads, Facebook, and TikTok.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../core/error-envelope.js';
import { parseMediaEntity } from './twitter/normalize-media.js';

/**
 * @typedef {Object} MediaVariant
 * @property {string} url
 * @property {number|null} bitrate
 * @property {string} contentType
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} MediaObject
 * @property {'photo' | 'video' | 'animated_gif' | 'audio' | 'carousel'} type
 * @property {string} url - Primary/best-quality direct download URL
 * @property {string} thumbnailUrl - Preview or poster image URL
 * @property {number|null} width
 * @property {number|null} height
 * @property {number|null} durationMs
 * @property {number|null} bitrate
 * @property {string} contentType
 * @property {MediaVariant[]} variants
 * @property {string|null} [altText]
 * @property {string|null} [title]
 * @property {MediaObject[]} [items] - Child items for carousels
 * @property {Record<string, any>} [metadata]
 */

/**
 * Detect platform name from URL.
 * @param {string} url
 * @returns {string}
 */
export function detectPlatformFromUrl(url) {
  if (typeof url !== 'string') return 'twitter';
  const lower = url.toLowerCase();
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('bsky.app') || lower.includes('bsky.social')) return 'bluesky';
  if (lower.includes('threads.net')) return 'threads';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('mastodon') || lower.includes('mstdn') || lower.includes('fosstodon')) return 'mastodon';
  return 'twitter';
}

/**
 * Extract media from Twitter/X payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractTwitterMedia(payload = {}) {
  // If payload already has normalized MediaObjects (from normalizeTweetMedia)
  if (Array.isArray(payload.media)) {
    return payload.media.map((m) => ({
      type: m.type || 'photo',
      url: m.url || m.mediaUrl || '',
      thumbnailUrl: m.thumbnailUrl || m.url || '',
      width: m.width || null,
      height: m.height || null,
      durationMs: m.durationMs || null,
      bitrate: m.bitrate || null,
      contentType: m.contentType || (m.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      variants: Array.isArray(m.variants) ? m.variants : [],
      altText: m.altText || null,
      title: null,
      metadata: m.metadata || {},
    }));
  }

  // Handle raw tweet entities / extended_entities
  const rawEntities = payload.extended_entities?.media || payload.entities?.media || [];
  if (Array.isArray(rawEntities) && rawEntities.length > 0) {
    const parsedMedia = rawEntities.map((e) => parseMediaEntity(e));
    return extractTwitterMedia({ media: parsedMedia });
  }

  // Handle audio space
  if (payload.space || payload.audioSpace) {
    const space = payload.space || payload.audioSpace;
    const streamUrl = space.streamUrl || space.media_key || '';
    return [{
      type: 'audio',
      url: streamUrl,
      thumbnailUrl: space.metadata?.creator_avatar || '',
      width: null,
      height: null,
      durationMs: space.durationMs || null,
      bitrate: null,
      contentType: 'application/x-mpegURL',
      variants: streamUrl ? [{ url: streamUrl, bitrate: null, contentType: 'application/x-mpegURL' }] : [],
      title: space.title || 'X Space Audio',
      metadata: { spaceId: space.id || space.rest_id },
    }];
  }

  return [];
}

/**
 * Extract media from Bluesky AT Protocol payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractBlueskyMedia(payload = {}) {
  const results = [];
  const embed = payload.embed || payload.post?.embed || payload.record?.embed || {};
  const embedType = embed.$type || '';

  // 1. Images embed (app.bsky.embed.images)
  if (embedType === 'app.bsky.embed.images' || Array.isArray(embed.images)) {
    const images = embed.images || [];
    for (const img of images) {
      const fullUrl = img.fullsize || img.thumb || (img.image?.ref ? `https://cdn.bsky.app/img/feed_fullsize/plain/${payload.authorDid || 'did'}/${img.image.ref.$link || img.image.ref}` : '');
      const thumbUrl = img.thumb || fullUrl;
      results.push({
        type: 'photo',
        url: fullUrl,
        thumbnailUrl: thumbUrl,
        width: img.aspectRatio?.width || null,
        height: img.aspectRatio?.height || null,
        durationMs: null,
        bitrate: null,
        contentType: 'image/jpeg',
        variants: [{ url: fullUrl, bitrate: null, contentType: 'image/jpeg' }],
        altText: img.alt || null,
        metadata: { cid: img.image?.ref?.$link || null },
      });
    }
  }

  // 2. Video embed (app.bsky.embed.video)
  if (embedType === 'app.bsky.embed.video' || embed.video) {
    const playlistUrl = embed.playlist || '';
    const thumbUrl = embed.thumbnail || '';
    results.push({
      type: 'video',
      url: playlistUrl,
      thumbnailUrl: thumbUrl,
      width: embed.aspectRatio?.width || null,
      height: embed.aspectRatio?.height || null,
      durationMs: null,
      bitrate: null,
      contentType: 'application/x-mpegURL',
      variants: playlistUrl ? [{ url: playlistUrl, bitrate: null, contentType: 'application/x-mpegURL' }] : [],
      altText: embed.alt || null,
      metadata: { cid: embed.video?.ref?.$link || null },
    });
  }

  return results;
}

/**
 * Extract media from Mastodon REST status payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractMastodonMedia(payload = {}) {
  const results = [];
  const attachments = payload.media_attachments || payload.mediaAttachments || [];

  for (const att of attachments) {
    const type = att.type === 'image' ? 'photo' : (att.type === 'gifv' ? 'animated_gif' : (att.type === 'audio' ? 'audio' : 'video'));
    const url = att.url || att.remote_url || '';
    const thumbUrl = att.preview_url || url;
    const width = att.meta?.original?.width || null;
    const height = att.meta?.original?.height || null;
    const durationMs = att.meta?.original?.duration ? Math.round(att.meta.original.duration * 1000) : null;
    const bitrate = att.meta?.original?.bitrate || null;

    results.push({
      type,
      url,
      thumbnailUrl: thumbUrl,
      width,
      height,
      durationMs,
      bitrate,
      contentType: type === 'photo' ? 'image/jpeg' : (type === 'audio' ? 'audio/mpeg' : 'video/mp4'),
      variants: [{ url, bitrate, contentType: type === 'photo' ? 'image/jpeg' : 'video/mp4' }],
      altText: att.description || null,
      metadata: { attachmentId: att.id },
    });
  }

  return results;
}

/**
 * Extract media from Threads payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractThreadsMedia(payload = {}) {
  const results = [];

  // Carousel
  if (Array.isArray(payload.carousel_media)) {
    const carouselItems = payload.carousel_media.flatMap((m) => extractThreadsMedia(m));
    if (carouselItems.length > 0) {
      return [{
        type: 'carousel',
        url: carouselItems[0].url,
        thumbnailUrl: carouselItems[0].thumbnailUrl,
        width: carouselItems[0].width,
        height: carouselItems[0].height,
        durationMs: null,
        bitrate: null,
        contentType: 'multipart/mixed',
        variants: [],
        items: carouselItems,
        metadata: { itemCount: carouselItems.length },
      }];
    }
  }

  // Videos
  if (Array.isArray(payload.video_versions) && payload.video_versions.length > 0) {
    const sorted = [...payload.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
    const best = sorted[0];
    const thumb = payload.image_versions2?.candidates?.[0]?.url || '';
    return [{
      type: 'video',
      url: best.url,
      thumbnailUrl: thumb,
      width: best.width || null,
      height: best.height || null,
      durationMs: null,
      bitrate: null,
      contentType: 'video/mp4',
      variants: sorted.map((v) => ({ url: v.url, bitrate: null, contentType: 'video/mp4', width: v.width, height: v.height })),
      metadata: {},
    }];
  }

  // Single Image
  if (Array.isArray(payload.image_versions2?.candidates) && payload.image_versions2.candidates.length > 0) {
    const candidates = payload.image_versions2.candidates;
    const best = candidates[0];
    return [{
      type: 'photo',
      url: best.url,
      thumbnailUrl: candidates[candidates.length - 1]?.url || best.url,
      width: best.width || null,
      height: best.height || null,
      durationMs: null,
      bitrate: null,
      contentType: 'image/jpeg',
      variants: candidates.map((c) => ({ url: c.url, bitrate: null, contentType: 'image/jpeg', width: c.width, height: c.height })),
      metadata: {},
    }];
  }

  return results;
}

/**
 * Extract media from Facebook payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractFacebookMedia(payload = {}) {
  const results = [];
  const mediaUrls = payload.mediaUrls || [];

  for (const item of mediaUrls) {
    const isVideo = typeof item === 'object' ? item.type === 'video' : /\.(mp4|m3u8|mov)/i.test(String(item));
    const url = typeof item === 'object' ? (item.url || item.src) : String(item);
    results.push({
      type: isVideo ? 'video' : 'photo',
      url,
      thumbnailUrl: url,
      width: null,
      height: null,
      durationMs: null,
      bitrate: null,
      contentType: isVideo ? 'video/mp4' : 'image/jpeg',
      variants: [{ url, bitrate: null, contentType: isVideo ? 'video/mp4' : 'image/jpeg' }],
      metadata: {},
    });
  }

  return results;
}

/**
 * Extract media from TikTok payload.
 * @param {Record<string, any>} payload
 * @returns {MediaObject[]}
 */
export function extractTikTokMedia(payload = {}) {
  const results = [];
  const video = payload.video || payload.itemStruct?.video || {};
  const music = payload.music || payload.itemStruct?.music || {};

  // Video
  const playUrl = video.playAddr || video.downloadAddr || video.play_addr?.url_list?.[0] || '';
  if (playUrl) {
    results.push({
      type: 'video',
      url: playUrl,
      thumbnailUrl: video.cover || video.originCover || '',
      width: video.width || null,
      height: video.height || null,
      durationMs: video.duration ? video.duration * 1000 : null,
      bitrate: video.bitrate || null,
      contentType: 'video/mp4',
      variants: [{ url: playUrl, bitrate: video.bitrate || null, contentType: 'video/mp4' }],
      metadata: { definition: video.definition || 'HD' },
    });
  }

  // Audio track
  const audioUrl = music.playUrl || music.play_url?.url_list?.[0] || '';
  if (audioUrl) {
    results.push({
      type: 'audio',
      url: audioUrl,
      thumbnailUrl: music.coverLarge || music.coverMedium || '',
      width: null,
      height: null,
      durationMs: music.duration ? music.duration * 1000 : null,
      bitrate: null,
      contentType: 'audio/mpeg',
      variants: [{ url: audioUrl, bitrate: null, contentType: 'audio/mpeg' }],
      title: music.title || 'Original Sound',
      metadata: { authorName: music.authorName },
    });
  }

  return results;
}

/**
 * Main UniversalMediaPipeline class.
 */
export class UniversalMediaPipeline {
  /**
   * Extract and normalize media from any supported social platform.
   *
   * @param {Object} params
   * @param {string} [params.platform] - Platform name (twitter, bluesky, mastodon, threads, facebook, tiktok)
   * @param {string} [params.postUrl] - URL of the post (optional, auto-detects platform if omitted)
   * @param {Record<string, any>} [params.post] - PostItem or raw payload
   * @param {Record<string, any>} [params.options]
   * @returns {Promise<MediaObject[]>}
   */
  static async extractMedia(params = {}) {
    const postUrl = params.postUrl || params.url;
    const platform = (params.platform || (postUrl ? detectPlatformFromUrl(postUrl) : 'twitter')).toLowerCase();
    let payload = params.post || params.rawData || {};

    // Validate postUrl early — emit XACT_4001 envelope for invalid input (Story 31.1 fix).
    if (!params.post && !params.rawData) {
      if (!postUrl || typeof postUrl !== 'string' || !/^https?:\/\//i.test(postUrl)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `x_download_media requires a valid http(s) postUrl, got: ${JSON.stringify(postUrl)}`,
          suggestedAction: SuggestedActions.FIX_ARGS,
          platform,
        });
      }
    }

    // If payload is empty but postUrl is given, fetch via scrape() using the
    // platform's real single-post read action. post_detail only exists on
    // instagram/medium/reddit/threads/tiktok — map the others to their
    // equivalent read action (Story 31.1 fix; was a silent catch{} → empty {}).
    if (Object.keys(payload).length === 0 && postUrl) {
      const POST_DETAIL_ACTION = {
        twitter: 'thread',   // reads rootTweet (+replies) — works guest for root
        x: 'thread',
        bluesky: 'post_detail',
        bsky: 'post_detail',
        mastodon: 'post_detail',
        masto: 'post_detail',
        facebook: 'post_detail',
        fb: 'post_detail',
        threads: 'post_detail',
        tiktok: 'post_detail',
        instagram: 'post_detail',
      };
      const action = POST_DETAIL_ACTION[platform] || 'post_detail';
      try {
        const { scrape } = await import('../index.js');
        const scraped = await scrape(platform, action, { url: postUrl, postUrl, postId: postUrl, tweetId: postUrl });
        payload = scraped?.post || scraped?.rootTweet || scraped?.posts?.[0] || scraped || {};
      } catch (err) {
        // Re-throw as XACT_4001 with the underlying reason preserved — never
        // silently fall back to an empty payload (was `catch {}`).
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Failed to fetch post for media extraction on ${platform}: ${err?.message || err}`,
          suggestedAction: SuggestedActions.FIX_ARGS,
          platform,
          cause: err,
        });
      }
    }

    switch (platform) {
      case 'twitter':
      case 'x':
        return extractTwitterMedia(payload);

      case 'bluesky':
      case 'bsky':
        return extractBlueskyMedia(payload);

      case 'mastodon':
      case 'masto':
        return extractMastodonMedia(payload);

      case 'threads':
        return extractThreadsMedia(payload);

      case 'facebook':
      case 'fb':
        return extractFacebookMedia(payload);

      case 'tiktok':
        return extractTikTokMedia(payload);

      default:
        return extractTwitterMedia(payload);
    }
  }
}

/**
 * Functional helper for quick media extraction.
 * @param {Object} params
 * @returns {Promise<MediaObject[]>}
 */
export async function extractMedia(params = {}) {
  return await UniversalMediaPipeline.extractMedia(params);
}
