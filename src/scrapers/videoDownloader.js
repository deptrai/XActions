// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Video & Media Downloader module for Medirus (Story 31.1).
 * Delegates extraction and normalization to UniversalMediaPipeline.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { UniversalMediaPipeline, extractMedia } from './social/media-pipeline.js';

/**
 * Extract downloadable media from a social media post URL.
 *
 * @param {string} postUrl - Full URL to the post or tweet
 * @param {Object} [options={}] - Extraction options
 * @param {string} [options.platform] - Explicit platform name
 * @param {'highest' | 'lowest' | 'all'} [options.quality='highest'] - Quality preference
 * @param {any} [options.post] - Raw post object
 * @param {any} [options.rawData] - Raw post data
 * @returns {Promise<{ success: boolean, media: Array<any>, bestUrl: string | null, error?: string }>}
 */
export async function downloadMedia(postUrl, options = {}) {
  if (!postUrl || typeof postUrl !== 'string') {
    return { success: false, media: [], bestUrl: null, error: 'postUrl must be a non-empty string' };
  }

  const mediaList = await extractMedia({
    postUrl,
    platform: options.platform,
    post: options.post || options.rawData,
    options,
  });

  const bestMedia = mediaList.find((m) => m.type === 'video') || mediaList[0] || null;

  return {
    success: mediaList.length > 0,
    media: mediaList,
    bestUrl: bestMedia?.url || null,
  };
}

export { UniversalMediaPipeline, extractMedia };
export default downloadMedia;
