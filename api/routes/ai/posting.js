// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Posting Endpoints
 *
 * Tweet creation, scheduling, deletion, bookmarks, articles.
 * All write operations are queued and processed asynchronously.
 *
 * @module api/routes/ai/posting
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * @typedef {Object} ScrapedUser
 * @property {string} [username]
 * @property {string} [name]
 * @property {string} [displayName]
 * @property {string} [bio]
 * @property {boolean} [verified]
 * @property {boolean} [followsBack]
 * @property {boolean} [followsYou]
 * @property {string} [profileImage]
 * @property {string} [profileImageUrl]
 * @property {string} [followers]
 * @property {string} [following]
 */

/**
 * @typedef {Object} ScrapedTweet
 * @property {string} [id]
 * @property {string} [text]
 * @property {string} [timestamp]
 * @property {string} [createdAt]
 * @property {string} [url]
 * @property {string} [likes]
 * @property {string} [retweets]
 * @property {string} [replies]
 * @property {string} [views]
 * @property {string} [quotes]
 * @property {string} [bookmarks]
 * @property {unknown[]} [media]
 * @property {boolean} [isReply]
 * @property {boolean} [isRetweet]
 * @property {boolean} [isQuote]
 * @property {string} [replyToUser]
 * @property {string} [quotedTweetId]
 * @property {ScrapedUser} [author]
 */

/**
 * @typedef {Object} ScrapedMedia
 * @property {string} [type]
 * @property {string} [url]
 * @property {string} [thumbnailUrl]
 * @property {string} [tweetId]
 * @property {string} [tweetUrl]
 * @property {string} [timestamp]
 * @property {Record<string, unknown>} [dimensions]
 * @property {number} [duration]
 */

/**
 * @typedef {Object} ScrapedBookmark
 * @property {string} [id]
 * @property {string} [text]
 * @property {ScrapedUser} [author]
 * @property {string} [timestamp]
 * @property {string} [createdAt]
 * @property {string} [likes]
 * @property {string} [retweets]
 * @property {string} [replies]
 * @property {string} [url]
 * @property {string} [bookmarkedAt]
 */

/**
 * @typedef {Object} VideoVariant
 * @property {string} url
 * @property {string} [quality]
 * @property {string} [contentType]
 * @property {number} [bitrate]
 */


const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const errorResponse = (res, statusCode, error, message, extras = {}) =>
  res.status(statusCode).json({
    success: false, error, message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });

const successResponse = (res, data, meta = {}) =>
  res.json({ success: true, data, meta: { processedAt: new Date().toISOString(), ...meta } });

// Session middleware
router.use((req, res, next) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!sessionCookie) {
    return res.status(400).json({
      error: 'SESSION_REQUIRED',
      code: 'E_SESSION_MISSING',
      message: 'X/Twitter session cookie is required',
      hint: 'Include sessionCookie in request body or X-Session-Cookie header',
    });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/posting/tweet
 * Post a single tweet
 */
router.post('/tweet', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const replyToTweetId = /** @type {string | undefined} */ (req.body.replyToTweetId);
  const mediaUrls = /** @type {string[] | undefined} */ (req.body.mediaUrls) ?? [];

  if (!text) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'text is required',
      schema: {
        text: { type: 'string', required: true, maxLength: 280 },
        replyToTweetId: { type: 'string', description: 'Tweet ID to reply to' },
        mediaUrls: { type: 'array', description: 'Media URLs to attach' },
      },
    });
  }

  if (text.length > 280) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'text exceeds 280 characters' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'postTweet',
      config: { text, replyToTweetId: replyToTweetId || null, mediaUrls, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'post-tweet',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    }, { note: 'Tweet will be posted within seconds' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/thread
 * Post a multi-tweet thread
 */
router.post('/thread', async (req, res) => {
  const tweets = /** @type {string | undefined} */ (req.body.tweets);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;

  if (!Array.isArray(tweets) || tweets.length < 2) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'tweets must be an array of at least 2 strings',
      schema: {
        tweets: { type: 'array', items: 'string', minItems: 2, maxItems: 25 },
        delayMs: { type: 'number', default: 2000, description: 'Delay between tweets' },
      },
    });
  }

  const effectiveDelay = Math.max(parseInt(String(delayMs), 10) || 2000, 1500);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'postThread',
      config: { tweets: tweets.slice(0, 25), delayMs: effectiveDelay, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    const estimatedSeconds = Math.ceil((tweets.length * effectiveDelay) / 1000);
    return successResponse(res, {
      operationId, status: 'queued', type: 'post-thread',
      config: { tweetCount: tweets.length, delayMs: effectiveDelay },
      estimatedDuration: `~${estimatedSeconds}s`,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/poll
 * Create a poll tweet
 */
router.post('/poll', async (req, res) => {
  const question = /** @type {string | undefined} */ (req.body.question);
  const options = /** @type {string | undefined} */ (req.body.options);
  const durationMinutes = /** @type {string | number | undefined} */ (req.body.durationMinutes) ?? 1440;

  if (!question) return res.status(400).json({ error: 'INVALID_INPUT', message: 'question is required' });
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'options must be 2–4 choices' });
  }

  const effectiveDuration = Math.min(Math.max(parseInt(String(durationMinutes), 10) || 1440, 5), 10080);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'createPoll',
      config: { question, options, durationMinutes: effectiveDuration, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'create-poll',
      config: { question, optionCount: options.length, durationMinutes: effectiveDuration },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/schedule
 * Schedule a tweet for later
 */
router.post('/schedule', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const scheduledAt = /** @type {string | undefined} */ (req.body.scheduledAt);
  const timezone = /** @type {string | undefined} */ (req.body.timezone) ?? 'UTC';

  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });
  if (!scheduledAt) return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt (ISO 8601) is required' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt must be a valid future ISO 8601 datetime' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'scheduleTweet',
      config: { text, scheduledAt: scheduledDate.toISOString(), timezone, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'schedule-tweet',
      config: { scheduledAt: scheduledDate.toISOString(), timezone },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/delete
 * Delete a tweet
 */
router.post('/delete', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);

  if (!tweetUrl && !tweetId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });
  }

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  if (!effectiveTweetId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Could not extract tweet ID from URL' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'deleteTweet',
      config: { tweetId: effectiveTweetId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'delete-tweet',
      tweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    }, { warning: 'Deleted tweets cannot be recovered' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/reply
 * Reply to a tweet
 */
router.post('/reply', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);

  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });
  if (!tweetUrl && !tweetId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'replyTweet',
      config: { text, tweetId: effectiveTweetId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'reply-tweet',
      replyToTweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/bookmark
 * Bookmark a tweet
 */
router.post('/bookmark', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);

  if (!tweetUrl && !tweetId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'bookmarkTweet',
      config: { tweetId: effectiveTweetId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'bookmark-tweet',
      tweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/bookmarks
 * Get saved bookmarks
 */
router.post('/bookmarks', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const startTime = Date.now();
    const { scrapeBookmarks } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const bookmarks = /** @type {Record<string, unknown>} */ (await scrapeBookmarks((/** @type {string} */ (req.sessionCookie)), { limit: effectiveLimit, cursor }));

    return successResponse(res, {
      bookmarks: (/** @type {ScrapedBookmark[]} */ (/** @type {ScrapedBookmark[]} */ (bookmarks.items || []))).map(b => ({
        id: b.id,
        text: b.text,
        author: { username: b.author?.username || b.username, displayName: b.author?.name },
        createdAt: b.timestamp || b.createdAt,
        url: b.url,
        metrics: { likes: parseInt(String(b.likes), 10) || 0, retweets: parseInt(String(b.retweets), 10) || 0 },
      })),
      pagination: {
        count: (/** @type {ScrapedBookmark[]} */ (/** @type {ScrapedBookmark[]} */ (bookmarks.items || []))).length,
        limit: effectiveLimit,
        nextCursor: bookmarks.nextCursor || null,
        hasMore: !!bookmarks.nextCursor,
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Bookmarks scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/clear-bookmarks
 * Clear all bookmarks
 */
router.post('/clear-bookmarks', async (req, res) => {
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'clearBookmarks',
      config: { dryRun: !!dryRun, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'clear-bookmarks',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    }, { warning: dryRun ? 'Dry run - no bookmarks will be cleared' : '⚠️ All bookmarks will be deleted' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/posting/article
 * Publish a long-form article
 */
router.post('/article', async (req, res) => {
  const title = /** @type {string | undefined} */ (req.body.title);
  const body = /** @type {string | undefined} */ (req.body.body);
  const publish = /** @type {boolean | undefined} */ (req.body.publish) ?? false;
  const coverImageUrl = /** @type {string | undefined} */ (req.body.coverImageUrl);

  if (!title) return res.status(400).json({ error: 'INVALID_INPUT', message: 'title is required' });
  if (!body) return res.status(400).json({ error: 'INVALID_INPUT', message: 'body is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'publishArticle',
      config: { title, body, publish: !!publish, coverImageUrl: coverImageUrl || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'publish-article',
      config: { title, publish: !!publish, wordCount: body.split(/\s+/).length },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

export default router;
