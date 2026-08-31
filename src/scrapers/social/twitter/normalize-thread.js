// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * normalize-thread.js — Normalization functions for Twitter/X thread & conversation responses.
 * Parses GraphQL TweetDetail responses into standardized PostItem objects with
 * thread metadata and conversation tree linkage.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { parseTweetData } from '../../twitter/http/tweets.js';
import { parseConversationModule, reconstructThread } from '../../twitter/http/thread.js';

/** @typedef {import('../../../core/types.js').PostItem} PostItem */

/**
 * Deduplicate raw tweets by id.
 * @param {Array<Record<string, any>>} tweets
 * @returns {Array<Record<string, any>>}
 */
function deduplicateRawTweets(tweets) {
  const seen = new Set();
  return tweets.filter((t) => {
    if (!t || !t.id || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/**
 * Transform a parsed Twitter tweet record into a standardized PostItem.
 *
 * @param {Record<string, any>} input
 * @param {string} [sourceMethod='thread']
 * @param {string | null} [conversationId=null]
 * @returns {PostItem}
 */
export function parseTwitterTweetToPostItem(input, sourceMethod = 'thread', conversationId = null) {
  if (!input) {
    throw new Error('Invalid tweet input: missing tweet object');
  }

  // If raw GraphQL tweet passed in, parse it first
  const parsed = input.__typename || input.rest_id
    ? parseTweetData(input) || input
    : input;

  const tweetId = parsed.id || parsed.rest_id;
  if (!tweetId) {
    throw new Error('Invalid parsed tweet: missing id');
  }

  const id = `twitter:${tweetId}`;
  const author = parsed.author || {};
  const metrics = parsed.metrics || {};
  const inReplyTo = parsed.inReplyTo || null;
  const parentTweetId = inReplyTo?.tweetId || null;
  const isReply = Boolean(inReplyTo);
  const media = Array.isArray(parsed.media) ? parsed.media : [];
  const mediaUrls = media.map((m) => m?.url || m?.videoUrl).filter(Boolean);

  const authorUsername = author.username || '';
  const authorName = authorUsername || author.name || 'Twitter User';
  const authorUrl = authorUsername ? `https://x.com/${authorUsername}` : undefined;
  const postUrl = authorUsername && tweetId ? `https://x.com/${authorUsername}/status/${tweetId}` : undefined;

  let publishedAt = null;
  if (parsed.createdAt) {
    const d = new Date(parsed.createdAt);
    if (!Number.isNaN(d.getTime())) {
      publishedAt = d;
    }
  }

  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
  const mentions = Array.isArray(parsed.mentions)
    ? parsed.mentions.map((m) => (typeof m === 'string' ? m : m?.username)).filter(Boolean)
    : [];

  return {
    id,
    platform: 'twitter',
    externalId: String(tweetId),
    category: 'social',
    authorId: String(author.id || ''),
    authorName,
    authorAvatar: author.avatar || undefined,
    authorUrl,
    postUrl,
    content: parsed.text || '',
    mediaUrls,
    likesCount: Number(metrics.likes) || 0,
    repostsCount: Number(metrics.retweets) || 0,
    repliesCount: Number(metrics.replies) || 0,
    viewsCount: Number(metrics.views) || 0,
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      tweetId: String(tweetId),
      parentTweetId: parentTweetId ? String(parentTweetId) : null,
      conversationId: conversationId ? String(conversationId) : (parentTweetId ? String(parentTweetId) : String(tweetId)),
      isReply,
      isThread: sourceMethod === 'thread',
      isRetweet: Boolean(parsed.isRetweet),
      isBookmarked: sourceMethod === 'bookmarks',
      replyCount: Number(metrics.replies) || 0,
      retweetCount: Number(metrics.retweets) || 0,
      likeCount: Number(metrics.likes) || 0,
      quoteCount: Number(metrics.quotes) || 0,
      bookmarkCount: Number(metrics.bookmarks) || 0,
      hashtags,
      mentions,
      lang: parsed.lang || undefined,
      sourceMethod,
    },
  };
}

/**
 * Extract parsed tweets and pagination cursors from a TweetDetail response.
 *
 * @param {Record<string, any>} response
 * @returns {{ tweets: Array<Record<string, any>>, cursors: Array<{ type: string, value: string }> }}
 */
export function extractTweetDetailEntries(response) {
  const allTweets = [];
  /** @type {Array<{ type: string, value: string }>} */
  const allCursors = [];

  const root = response?.data !== undefined ? response.data : response;
  const instructions =
    root?.threaded_conversation_with_injections_v2?.instructions ??
    root?.data?.threaded_conversation_with_injections_v2?.instructions ??
    root?.instructions ??
    root?.data?.instructions ??
    [];

  for (const instruction of instructions) {
    const type = instruction.type || instruction.__typename;

    if (type === 'TimelineAddEntries') {
      const entries = instruction.entries || [];
      for (const entry of entries) {
        const entryId = entry.entryId || '';
        const entryType = entry.content?.__typename || entry.content?.entryType || '';

        // Single tweet entry
        if (entryType === 'TimelineTimelineItem' || entryId.startsWith('tweet-')) {
          const tweetResult =
            entry.content?.itemContent?.tweet_results?.result ?? null;
          if (tweetResult) {
            const parsed = parseTweetData(tweetResult);
            if (parsed && (parsed.id || parsed.tombstone)) {
              allTweets.push(parsed);
            }
          }

          const cursorValue = entry.content?.itemContent?.value;
          const cursorType =
            entry.content?.itemContent?.cursorType ??
            entry.content?.cursorType;
          if (cursorValue && cursorType) {
            allCursors.push({ type: String(cursorType), value: String(cursorValue) });
          }
          continue;
        }

        // Conversation module
        if (
          entryType === 'TimelineTimelineModule' ||
          entryId.startsWith('conversationthread-')
        ) {
          const { tweets, cursors } = parseConversationModule(entry.content || {});
          allTweets.push(...tweets);
          if (Array.isArray(cursors)) {
            for (const c of cursors) {
              if (c?.value) {
                allCursors.push({ type: String(c.type || 'ShowMore'), value: String(c.value) });
              }
            }
          }
          continue;
        }

        // Cursor entry
        if (entryId.startsWith('cursor-')) {
          const value =
            entry.content?.value ??
            entry.content?.itemContent?.value ??
            null;
          const cursorType =
            entry.content?.cursorType ??
            entry.content?.itemContent?.cursorType ??
            (entryId.includes('bottom') ? 'Bottom' : 'ShowMore');
          if (value) {
            allCursors.push({ type: String(cursorType), value: String(value) });
          }
        }
      }
    }

    // TimelineAddToModule
    if (type === 'TimelineAddToModule') {
      const moduleItems = instruction.moduleItems || [];
      for (const item of moduleItems) {
        const tweetResult = item?.item?.itemContent?.tweet_results?.result;
        if (tweetResult) {
          const parsed = parseTweetData(tweetResult);
          if (parsed && (parsed.id || parsed.tombstone)) {
            allTweets.push(parsed);
          }
        }
      }
    }
  }

  return {
    tweets: deduplicateRawTweets(allTweets),
    cursors: allCursors,
  };
}

/**
 * Normalize a TweetDetail GraphQL response into PostItems with tree structure.
 *
 * @param {Record<string, any>} response
 * @returns {{
 *   posts: PostItem[],
 *   rootTweet: PostItem | null,
 *   authorReplies: PostItem[],
 *   conversation: PostItem[],
 *   pageInfo: { cursors: Array<{ type: string, value: string }>, end_cursor: string | null, has_next_page: boolean }
 * }}
 */
export function normalizeThreadResponse(response) {
  const { tweets, cursors } = extractTweetDetailEntries(response);
  const validTweets = tweets.filter((t) => t && t.id && !t.tombstone);
  const reconstructed = reconstructThread(validTweets);

  const rootId = reconstructed.rootTweet?.id ? String(reconstructed.rootTweet.id) : null;
  const rootPost = reconstructed.rootTweet
    ? parseTwitterTweetToPostItem(reconstructed.rootTweet, 'thread', rootId)
    : null;

  const posts = validTweets.map((t) => parseTwitterTweetToPostItem(t, 'thread', rootId));
  const authorReplies = (reconstructed.authorReplies || []).map((t) =>
    parseTwitterTweetToPostItem(t, 'thread', rootId)
  );
  const conversation = (reconstructed.conversation || []).map((t) =>
    parseTwitterTweetToPostItem(t, 'thread', rootId)
  );

  const bottomCursor = cursors.find(
    (c) => c.type === 'Bottom' || c.type === 'TimelineTimelineCursor' || c.type === 'ShowMoreThreads'
  )?.value || null;

  return {
    posts,
    rootTweet: rootPost,
    authorReplies,
    conversation,
    pageInfo: {
      cursors,
      end_cursor: bottomCursor,
      has_next_page: Boolean(bottomCursor),
    },
  };
}

export { reconstructThread };
