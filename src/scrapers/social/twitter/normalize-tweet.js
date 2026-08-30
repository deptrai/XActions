// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter tweet normalizer — converts GraphQL tweet result into PostItem.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { parseTweetData } from '../../twitter/http/tweets.js';

/**
 * Convert a raw Twitter GraphQL tweet result into a universal PostItem.
 * @param {Record<string, any>} rawTweet
 * @param {Object} [context]
 * @param {string} [context.sourceMethod]
 * @param {Record<string, any>} [context.extraMetadata]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function tweetToPostItem(rawTweet, context = {}) {
  const parsed = parseTweetData(rawTweet);
  if (!parsed || !parsed.id) return null;

  const author = parsed.author || {};
  const metrics = parsed.metrics || {};
  const media = /** @type {string[]} */ (Array.isArray(parsed.media) ? parsed.media.map((m) => m.videoUrl || m.url).filter(Boolean) : []);
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
  const mentions = Array.isArray(parsed.mentions) ? parsed.mentions.map((m) => m.username || m).filter(Boolean) : [];

  /** @type {import('../../../core/types.js').PostItem} */
  const post = {
    id: `twitter:${parsed.id}`,
    platform: 'twitter',
    externalId: String(parsed.id),
    category: 'social',
    authorId: String(author.id || ''),
    authorName: String(author.name || ''),
    authorAvatar: author.avatar || undefined,
    authorUrl: author.username ? `https://x.com/${author.username}` : undefined,
    postUrl: `https://x.com/${author.username || 'i'}/status/${parsed.id}`,
    content: parsed.text || '',
    mediaUrls: media,
    likesCount: Number(metrics.likes) || 0,
    repostsCount: Number(metrics.retweets) || 0,
    repliesCount: Number(metrics.replies) || 0,
    viewsCount: Number(metrics.views) || 0,
    publishedAt: parsed.createdAt ? new Date(parsed.createdAt) : null,
    crawledAt: new Date(),
    metadata: {
      tweetId: String(parsed.id),
      replyCount: Number(metrics.replies) || 0,
      retweetCount: Number(metrics.retweets) || 0,
      likeCount: Number(metrics.likes) || 0,
      quoteCount: Number(metrics.quotes) || 0,
      bookmarkCount: Number(metrics.bookmarks) || 0,
      hashtags,
      mentions,
      lang: parsed.lang || 'und',
      isRetweet: Boolean(parsed.isRetweet),
      isReply: Boolean(parsed.isReply),
      isQuote: Boolean(parsed.quotedTweet),
      sourceMethod: context.sourceMethod || 'twitter',
      ...(context.extraMetadata || {}),
    },
  };

  return post;
}

/**
 * Parse a single timeline entry into a PostItem if it contains a tweet result.
 * @param {Record<string, any>} entry
 * @param {Object} [context]
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function entryToPostItem(entry, context = {}) {
  const tweetResult =
    entry?.content?.itemContent?.tweet_results?.result ??
    entry?.content?.tweet_results?.result ??
    null;
  if (!tweetResult) return null;
  return tweetToPostItem(tweetResult, context);
}
