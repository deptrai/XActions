// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTube schema helpers, duration parser, and ID generators.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Generate namespaced YouTube ID.
 * @param {string} externalId
 * @param {string} [prefix]
 * @returns {string}
 */
export function namespacedYouTubeId(externalId, prefix) {
  if (!externalId) return `youtube:unknown:${Date.now()}`;
  const cleanId = String(externalId).trim();
  return prefix ? `youtube:${prefix}:${cleanId}` : `youtube:${cleanId}`;
}

/**
 * Generate namespaced YouTube comment ID: youtube:${videoId}:${commentId}
 * @param {string} videoId
 * @param {string} commentId
 * @returns {string}
 */
export function namespacedCommentId(videoId, commentId) {
  const v = String(videoId || '').trim();
  const c = String(commentId || '').trim();
  return `youtube:${v}:${c}`;
}

/**
 * Parse ISO 8601 duration string into seconds.
 * Example: PT4M25S -> 265, PT1H2M10S -> 3730, PT45S -> 45
 * @param {string} duration
 * @returns {number | null}
 */
export function parseIsoDuration(duration) {
  if (!duration || typeof duration !== 'string') return null;

  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;

  const days = parseInt(match[1] || '0', 10);
  const hours = parseInt(match[2] || '0', 10);
  const minutes = parseInt(match[3] || '0', 10);
  const seconds = parseInt(match[4] || '0', 10);

  if (!match[1] && !match[2] && !match[3] && !match[4]) {
    return null;
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Extract highest quality thumbnail URL from thumbnails object.
 * Hierarchy: maxres > standard > high > medium > default
 * @param {Record<string, { url?: string }>} [thumbnails={}]
 * @returns {string | null}
 */
export function extractBestThumbnail(thumbnails = {}) {
  if (!thumbnails || typeof thumbnails !== 'object') return null;
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null
  );
}

/**
 * Parse YouTube date string or timestamp into Date.
 * @param {unknown} dateVal
 * @returns {Date | null}
 */
export function parseYouTubeDate(dateVal) {
  if (!dateVal) return null;
  const d = new Date(/** @type {string | number} */ (dateVal));
  return Number.isNaN(d.getTime()) ? null : d;
}
