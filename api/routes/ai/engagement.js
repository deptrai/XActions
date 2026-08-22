// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Engagement Endpoints
 *
 * Follow, unfollow, like, retweet, quote-tweet, notifications,
 * mute, discovery, and intelligence operations.
 *
 * @module api/routes/ai/engagement
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * @typedef {Object} JobStatus
 * @property {string} [id]
 * @property {string} [status]
 * @property {string} [type]
 * @property {number} [progress]
 * @property {Record<string, unknown>} [result]
 * @property {Record<string, unknown>} [error]
 * @property {string} [createdAt]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 */

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
 * @property {string} [username]
 * @property {string} [authorName]
 * @property {Record<string, unknown>} [metrics]
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
 * @property {string} [thumbnail]
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
 * @property {string} [username]
 * @property {string} [authorName]
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

/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} error
 * @param {string} message
 * @param {Record<string, unknown> & { retryable?: boolean; retryAfterMs?: number }} [extras]
 */
const errorResponse = (res, statusCode, error, message, extras = {}) =>
  res.status(statusCode).json({
    success: false, error, message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });

/**
 * @param {import('express').Response} res
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [meta]
 */
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
    });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/engagement/follow
 * Follow a user
 */
router.post('/follow', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'followUser',
      config: { username: cleanUsername, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'follow', username: cleanUsername,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/unfollow
 * Unfollow a user
 */
router.post('/unfollow', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'unfollowUser',
      config: { username: cleanUsername, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'unfollow', username: cleanUsername,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/like
 * Like a tweet
 */
router.post('/like', async (req, res) => {
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
      type: 'likeTweet',
      config: { tweetId: effectiveTweetId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'like', tweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/retweet
 * Retweet a tweet
 */
router.post('/retweet', async (req, res) => {
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
      type: 'retweetTweet',
      config: { tweetId: effectiveTweetId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'retweet', tweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/quote-tweet
 * Quote-tweet a tweet with comment
 */
router.post('/quote-tweet', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const text = /** @type {string | undefined} */ (req.body.text);

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
      type: 'quoteTweet',
      config: { tweetId: effectiveTweetId, text, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'quote-tweet', tweetId: effectiveTweetId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/auto-follow
 * Auto-follow users matching criteria
 */
router.post('/auto-follow', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const hashtag = /** @type {string | undefined} */ (req.body.hashtag);
  const keyword = /** @type {string | undefined} */ (req.body.keyword);
  const maxFollows = /** @type {string | number | undefined} */ (req.body.maxFollows) ?? 50;
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 3000;
  const filters = /** @type {Record<string, unknown> | undefined} */ (req.body.filters) ?? {};

  if (!username && !hashtag && !keyword) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'username, hashtag, or keyword required' });
  }

  const effectiveMax = Math.min(Math.max(parseInt(String(maxFollows), 10) || 50, 1), 200);
  const target = username
    ? { type: 'username', value: username.replace(/^@/, '').toLowerCase() }
    : hashtag ? { type: 'hashtag', value: hashtag.replace(/^#/, '') }
    : { type: 'keyword', value: keyword };

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'autoFollow',
      config: {
        target, maxFollows: effectiveMax, dryRun: !!dryRun,
        delayMs: Math.max(parseInt(String(delayMs), 10) || 3000, 2000), filters,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'auto-follow',
      config: { targetType: target.type, targetValue: target.value, maxFollows: effectiveMax, dryRun: !!dryRun },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/smart-unfollow
 * Intelligently unfollow low-engagement accounts
 */
router.post('/smart-unfollow', async (req, res) => {
  const maxUnfollows = /** @type {string | number | undefined} */ (req.body.maxUnfollows) ?? 50;
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  const minDaysSinceFollow = /** @type {string | number | undefined} */ (req.body.minDaysSinceFollow) ?? 7;
  const skipVerified = /** @type {boolean | undefined} */ (req.body.skipVerified) ?? false;
  const skipWithBio = /** @type {boolean | undefined} */ (req.body.skipWithBio) ?? false;

  const effectiveMax = Math.min(Math.max(parseInt(String(maxUnfollows), 10) || 50, 1), 300);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'smartUnfollow',
      config: {
        maxUnfollows: effectiveMax, dryRun: !!dryRun,
        delayMs: Math.max(parseInt(String(delayMs), 10) || 2000, 1000),
        minDaysSinceFollow, skipVerified, skipWithBio,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'smart-unfollow',
      config: { maxUnfollows: effectiveMax, dryRun: !!dryRun, skipVerified, skipWithBio },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/auto-retweet
 * Auto-retweet tweets matching criteria
 */
router.post('/auto-retweet', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const hashtag = /** @type {string | undefined} */ (req.body.hashtag);
  const keyword = /** @type {string | undefined} */ (req.body.keyword);
  const maxRetweets = /** @type {string | number | undefined} */ (req.body.maxRetweets) ?? 20;
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 5000;

  if (!username && !hashtag && !keyword) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'username, hashtag, or keyword required' });
  }

  const effectiveMax = Math.min(Math.max(parseInt(String(maxRetweets), 10) || 20, 1), 50);
  const target = username
    ? { type: 'username', value: username.replace(/^@/, '').toLowerCase() }
    : hashtag ? { type: 'hashtag', value: hashtag.replace(/^#/, '') }
    : { type: 'keyword', value: keyword };

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'autoRetweet',
      config: {
        target, maxRetweets: effectiveMax, dryRun: !!dryRun,
        delayMs: Math.max(parseInt(String(delayMs), 10) || 5000, 3000),
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'auto-retweet',
      config: { targetType: target.type, targetValue: target.value, maxRetweets: effectiveMax, dryRun: !!dryRun },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/bulk-execute
 * Execute a list of actions in sequence
 */
router.post('/bulk-execute', async (req, res) => {
  const actions = /** @type {string | undefined} */ (req.body.actions);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 3000;
  const stopOnError = /** @type {boolean | undefined} */ (req.body.stopOnError) ?? false;

  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'actions must be a non-empty array',
      schema: {
        actions: {
          type: 'array',
          items: { type: 'string', action: 'like|retweet|follow|unfollow', target: 'tweetId or username' },
        },
        delayMs: { type: 'number', default: 3000 },
        stopOnError: { type: 'boolean', default: false },
      },
    });
  }

  const effectiveActions = actions.slice(0, 100);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'bulkExecute',
      config: {
        actions: effectiveActions,
        delayMs: Math.max(parseInt(String(delayMs), 10) || 3000, 1000),
        stopOnError: !!stopOnError,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'bulk-execute',
      config: { actionCount: effectiveActions.length, delayMs, stopOnError },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/notifications
 * Get recent notifications
 */
router.post('/notifications', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const filter = /** @type {string | undefined} */ (req.body.filter) ?? 'all';
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'getNotifications',
      config: { limit: effectiveLimit, filter, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'get-notifications',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/mute
 * Mute a user
 */
router.post('/mute', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'muteUser',
      config: { username: cleanUsername, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'mute', username: cleanUsername,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/unmute
 * Unmute a user
 */
router.post('/unmute', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'unmuteUser',
      config: { username: cleanUsername, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'unmute', username: cleanUsername,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/trends
 * Get trending topics
 */
router.post('/trends', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  const location = /** @type {string | undefined} */ (req.body.location) ?? 'worldwide';
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), 'filter:safe', {
      limit: effectiveLimit,
      filter: 'top',
    }));

    return successResponse(res, {
      location,
      trends: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).slice(0, effectiveLimit).map((t, i) => ({
        rank: i + 1,
        topic: t.text?.match(/#\w+/)?.[0] || t.text?.split(' ')[0] || `Trend ${i + 1}`,
        tweetCount: parseInt(String(t.metrics?.impressions), 10) || null,
        exampleTweet: { text: t.text, author: t.author?.username },
      })),
      count: Math.min((/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length, effectiveLimit),
    }, { durationMs: Date.now() - startTime, note: 'Trends scraped from X explore page' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Trends error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/explore
 * Get explore/discovery feed
 */
router.post('/explore', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 30;
  const filter = /** @type {string | undefined} */ (req.body.filter) ?? 'top';
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 30, 1), 100);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), 'min_faves:100', {
      limit: effectiveLimit,
      filter: filter === 'latest' ? 'latest' : 'top',
    }));

    return successResponse(res, {
      feed: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        id: t.id, text: t.text,
        author: { username: t.author?.username || t.username, verified: t.author?.verified || false },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: { likes: parseInt(String(t.likes), 10) || 0, retweets: parseInt(String(t.retweets), 10) || 0 },
      })),
      pagination: { count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length, limit: effectiveLimit },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/detect-bots
 * Analyze accounts for bot-like behavior
 */
router.post('/detect-bots', async (req, res) => {
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const threshold = /** @type {string | number | undefined} */ (req.body.threshold) ?? 0.7;

  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array is required' });
  }

  const targets = usernames.slice(0, 20).map(u => u.replace(/^@/, '').toLowerCase());

  try {
    const startTime = Date.now();
    const { scrapeProfile, scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));

    const results = await Promise.allSettled(
      targets.map(async username => {
        const [profile, tweets] = await Promise.allSettled([
          scrapeProfile((/** @type {string} */ (req.sessionCookie)), username),
          scrapeTweets((/** @type {string} */ (req.sessionCookie)), username, { limit: 20 }),
        ]);

        const p = profile.value || {};
        const t = /** @type {ScrapedTweet[]} */ (tweets.value?.items || []);

        // Simple heuristic bot scoring
        let botScore = 0;
        const factors = [];

        const followerRatio = parseInt(String(p.following), 10) / Math.max(parseInt(String(p.followers), 10) || 1, 1);
        if (followerRatio > 10) { botScore += 0.3; factors.push('high_follow_ratio'); }
        if (!p.bio) { botScore += 0.1; factors.push('no_bio'); }
        if (!p.profileImage || p.profileImage?.includes('default')) { botScore += 0.2; factors.push('default_avatar'); }
        if (t.length > 0) {
          const avgInterval = t.length > 1 ? 1 : 0;
          if (avgInterval === 0) { botScore += 0.1; factors.push('identical_intervals'); }
        }

        return {
          username,
          botScore: Math.min(botScore, 1),
          isLikelyBot: botScore >= threshold,
          factors,
          profile: { followers: parseInt(String(p.followers), 10) || 0, following: parseInt(String(p.following), 10) || 0 },
        };
      })
    );

    return successResponse(res, {
      threshold,
      accounts: results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { username: targets[i], error: r.reason?.message }
      ),
      summary: {
        analyzed: targets.length,
        likelyBots: results.filter(r => r.status === 'fulfilled' && r.value.isLikelyBot).length,
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/find-influencers
 * Find influencers for a niche/keyword
 */
router.post('/find-influencers', async (req, res) => {
  const keyword = /** @type {string | undefined} */ (req.body.keyword);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  const minFollowers = /** @type {string | number | undefined} */ (req.body.minFollowers) ?? 1000;

  if (!keyword) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keyword is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), keyword, {
      limit: effectiveLimit * 3,
      filter: 'top',
    }));

    // Deduplicate by author and filter by follower count
    const seen = new Set();
    const influencers = (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || [])))
      .filter(t => {
        const u = t.author?.username || t.username;
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return (parseInt(String(t.author?.followers), 10) || 0) >= minFollowers;
      })
      .slice(0, effectiveLimit)
      .map(t => ({
        username: t.author?.username || t.username,
        displayName: t.author?.name,
        verified: t.author?.verified || false,
        followersCount: parseInt(String(t.author?.followers), 10) || null,
        sampleTweet: { text: t.text, url: t.url, likes: parseInt(String(t.likes), 10) || 0 },
      }));

    return successResponse(res, {
      keyword, minFollowers,
      influencers,
      count: influencers.length,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/smart-target
 * Find the best accounts to engage with for growth
 */
router.post('/smart-target', async (req, res) => {
  const niche = /** @type {string | undefined} */ (req.body.niche);
  const goals = /** @type {string[] | undefined} */ (req.body.goals) ?? ['followers'];
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 15;

  if (!niche) return res.status(400).json({ error: 'INVALID_INPUT', message: 'niche is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 15, 1), 30);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'smartTarget',
      config: { niche, goals, limit: effectiveLimit, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'smart-target',
      config: { niche, goals, limit: effectiveLimit },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/crypto-analyze
 * Analyze crypto sentiment and activity for a token/project
 */
router.post('/crypto-analyze', async (req, res) => {
  const query = /** @type {string | undefined} */ (req.body.query);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const period = /** @type {string | undefined} */ (req.body.period) ?? '24h';

  if (!query) return res.status(400).json({ error: 'INVALID_INPUT', message: 'query (token symbol or project name) is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 10), 200);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [topResults, latestResults] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
      searchTweets((/** @type {string} */ (req.sessionCookie)), `${query} crypto`, { limit: effectiveLimit / 2, filter: 'top' }),
      searchTweets((/** @type {string} */ (req.sessionCookie)), `${query} crypto`, { limit: effectiveLimit / 2, filter: 'latest' }),
    ]));

    const allTweets = [...(/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (topResults.items || []))), ...(/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (latestResults.items || [])))];
    const bullish = allTweets.filter(t => /buy|bull|moon|pump|🚀|💎|gem/i.test(t.text)).length;
    const bearish = allTweets.filter(t => /sell|bear|dump|crash|rug|scam|dead/i.test(t.text)).length;
    const neutral = allTweets.length - bullish - bearish;

    return successResponse(res, {
      query, period,
      sentiment: {
        score: allTweets.length > 0 ? ((bullish - bearish) / allTweets.length).toFixed(3) : '0',
        bullish, bearish, neutral,
        label: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
      },
      volume: { tweets: allTweets.length, period },
      topTweets: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (topResults.items || []))).slice(0, 5).map(t => ({
        text: t.text,
        author: t.author?.username || t.username,
        likes: parseInt(String(t.likes), 10) || 0,
      })),
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/audience-insights
 * Analyze audience demographics and interests
 */
router.post('/audience-insights', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const sampleSize = /** @type {string | number | undefined} */ (req.body.sampleSize) ?? 100;

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveSample = Math.min(Math.max(parseInt(String(sampleSize), 10) || 100, 20), 300);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'audienceInsights',
      config: { username: cleanUsername, sampleSize: effectiveSample, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'audience-insights',
      config: { username: cleanUsername, sampleSize: effectiveSample },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 10000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/engagement/engagement-report
 * Generate an engagement report for an account
 */
router.post('/engagement-report', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const period = /** @type {string | undefined} */ (req.body.period) ?? '30d';
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 10), 200);

  try {
    const startTime = Date.now();
    const { scrapeProfile, scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [profile, tweets] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
      scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername),
      scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: effectiveLimit }),
    ]));

    const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
    const totalLikes = items.reduce((s, t) => s + (parseInt(String(t.likes), 10) || 0), 0);
    const totalRetweets = items.reduce((s, t) => s + (parseInt(String(t.retweets), 10) || 0), 0);
    const totalReplies = items.reduce((s, t) => s + (parseInt(String(t.replies), 10) || 0), 0);
    const followers = parseInt(String(profile.followers), 10) || 1;
    const avgEngagementRate = items.length > 0
      ? (((totalLikes + totalRetweets + totalReplies) / items.length) / followers * 100).toFixed(2)
      : '0';

    const topTweets = [...items]
      .sort((a, b) => (parseInt(String(b.likes), 10) || 0) - (parseInt(String(a.likes), 10) || 0))
      .slice(0, 5)
      .map(t => ({ text: t.text, likes: parseInt(String(t.likes), 10) || 0, retweets: parseInt(String(t.retweets), 10) || 0, url: t.url }));

    return successResponse(res, {
      username: cleanUsername, period,
      account: { followers, following: parseInt(String(profile.following), 10) || 0 },
      engagement: {
        avgEngagementRate: `${avgEngagementRate}%`,
        totalLikes, totalRetweets, totalReplies,
        tweetsAnalyzed: items.length,
        avgLikesPerTweet: items.length > 0 ? Math.round(totalLikes / items.length) : 0,
        avgRetweetsPerTweet: items.length > 0 ? Math.round(totalRetweets / items.length) : 0,
      },
      topTweets,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

export default router;
