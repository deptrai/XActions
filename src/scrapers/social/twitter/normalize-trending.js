// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter trending normalizer — converts REST trends into PostItem.
 * @author nich (@nichxbt)
 * @license MIT
 */

import crypto from 'node:crypto';

/**
 * Hash a trend name with woeid for stable unique id.
 * @param {number} woeid
 * @param {string} name
 * @returns {string}
 */
export function hashTrendId(woeid, name) {
  const hash = crypto.createHash('sha256').update(`${woeid}:${name}`).digest('hex').slice(0, 16);
  return `twitter:trend:${woeid}:${hash}`;
}

/**
 * Convert a raw trend entry into a PostItem.
 * @param {Record<string, any>} trend
 * @param {number} woeid
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function trendToPostItem(trend, woeid) {
  if (!trend || typeof trend !== 'object') return null;

  const name = String(trend.name || '');
  if (!name) return null;

  const externalId = crypto.createHash('sha256').update(`${woeid}:${name}`).digest('hex').slice(0, 16);
  const id = `twitter:trend:${woeid}:${externalId}`;
  const isPromoted = Boolean(trend.promoted_content);

  /** @type {import('../../../core/types.js').PostItem} */
  const post = /** @type {any} */ ({
    id,
    platform: 'twitter',
    externalId,
    category: /** @type {any} */ (isPromoted ? 'promoted' : null),
    authorId: 'trending',
    authorName: 'Twitter Trending',
    authorAvatar: undefined,
    authorUrl: undefined,
    postUrl: trend.url || null,
    content: name,
    name,
    tweetCount: trend.tweet_volume != null ? Number(trend.tweet_volume) : null,
    url: trend.url || null,
    mediaUrls: [],
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: null,
    crawledAt: new Date(),
    metadata: {
      tweetId: externalId,
      isSearchResult: true,
      isTrending: true,
      trendWoeid: woeid,
      tweetCount: trend.tweet_volume != null ? Number(trend.tweet_volume) : null,
      trendUrl: trend.url || null,
      category: isPromoted ? 'promoted' : null,
      isPromoted,
      sourceMethod: 'trending',
    },
  });

  return post;
}

/**
 * Parse trends/place.json response.
 * @param {any} response
 * @param {number} woeid
 * @returns {import('../../../core/types.js').PostItem[]}
 */
export function parseTrends(response, woeid) {
  const location = Array.isArray(response) ? response[0] : response;
  const trends = Array.isArray(location?.trends) ? location.trends : [];
  return /** @type {import('../../../core/types.js').PostItem[]} */ (
    trends.map((/** @type {any} */ t) => trendToPostItem(t, woeid)).filter(Boolean)
  );
}
