// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Streams Endpoints
 *
 * Start, stop, pause, resume, and query real-time tweet streams.
 *
 * @module api/routes/ai/streams
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
    return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'Session cookie is required' });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/streams/start
 * Start a keyword/user stream
 */
router.post('/start', async (req, res) => {
  const type = /** @type {string | undefined} */ (req.body.type) ?? 'keyword';
  const username = /** @type {string | undefined} */ (req.body.username);
  const keyword = /** @type {string | undefined} */ (req.body.keyword);
  const hashtag = /** @type {string | undefined} */ (req.body.hashtag);
  const interval = /** @type {string | number | undefined} */ (req.body.interval) ?? 60;
  const maxItems = /** @type {string | number | undefined} */ (req.body.maxItems) ?? 1000;

  const validTypes = ['keyword', 'user', 'hashtag', 'mentions'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `type must be one of: ${validTypes.join(', ')}` });
  }

  if (type === 'keyword' && !keyword) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keyword is required for keyword streams' });
  if (type === 'user' && !username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required for user streams' });
  if (type === 'hashtag' && !hashtag) return res.status(400).json({ error: 'INVALID_INPUT', message: 'hashtag is required for hashtag streams' });

  const effectiveInterval = Math.max(parseInt(String(interval), 10) || 60, 30); // min 30s
  const effectiveMax = Math.min(parseInt(String(maxItems), 10) || 1000, 10000);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'streamStart',
      config: {
        streamType: type,
        username: username ? username.replace(/^@/, '').toLowerCase() : null,
        keyword: keyword || null,
        hashtag: hashtag ? hashtag.replace(/^#/, '') : null,
        intervalSeconds: effectiveInterval,
        maxItems: effectiveMax,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      streamId: operationId,
      status: 'started',
      type,
      config: { intervalSeconds: effectiveInterval, maxItems: effectiveMax },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: effectiveInterval * 1000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/stop
 * Stop a running stream
 */
router.post('/stop', async (req, res) => {
  const streamId = /** @type {string | undefined} */ (req.body.streamId);
  if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'streamId is required' });

  try {
    const { cancelJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await cancelJob(streamId);

    return successResponse(res, { streamId, status: 'stopped', stoppedAt: new Date().toISOString() });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/list
 * List active and recent streams
 */
router.post('/list', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;

  try {
    const { getRecentJobs } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const jobs = /** @type {Record<string, unknown>[]} */ (await getRecentJobs({ type: 'streamStart', limit: Math.min(parseInt(String(limit), 10) || 20, 100) }));

    return successResponse(res, {
      streams: jobs.map(j => ({
        streamId: j.id,
        type: j.config?.streamType,
        status: j.status,
        createdAt: j.createdAt,
        completedAt: j.completedAt || null,
      })),
      count: jobs.length,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/pause
 * Pause a stream
 */
router.post('/pause', async (req, res) => {
  const streamId = /** @type {string | undefined} */ (req.body.streamId);
  if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'streamId is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'streamPause',
      config: { streamId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, { streamId, status: 'paused', pausedAt: new Date().toISOString() });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/resume
 * Resume a paused stream
 */
router.post('/resume', async (req, res) => {
  const streamId = /** @type {string | undefined} */ (req.body.streamId);
  if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'streamId is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'streamResume',
      config: { streamId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, { streamId, status: 'resumed', resumedAt: new Date().toISOString() });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/status
 * Get stream status and recent results
 */
router.post('/status', async (req, res) => {
  const streamId = /** @type {string | undefined} */ (req.body.streamId);
  if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'streamId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const status = /** @type {Record<string, unknown>} */ (await getJobStatus(streamId));

    if (!status) return res.status(404).json({ error: 'NOT_FOUND', message: 'Stream not found' });

    return successResponse(res, {
      streamId,
      status: status.status,
      progress: status.progress || null,
      itemsCollected: status.result?.items?.length || 0,
      latestItems: (/** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>[]} */ (status.result?.items || []))).slice(-10),
      timing: { startedAt: status.startedAt, updatedAt: status.updatedAt },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/streams/history
 * Get historical items collected by a stream
 */
router.post('/history', async (req, res) => {
  const streamId = /** @type {string | undefined} */ (req.body.streamId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const eventType = /** @type {string | undefined} */ (req.body.eventType);
  if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'streamId is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 1000);

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const status = /** @type {Record<string, unknown>} */ (await getJobStatus(streamId));

    if (!status) return res.status(404).json({ error: 'NOT_FOUND', message: 'Stream not found' });

    let items = /** @type {Record<string, unknown>[]} */ (status.result?.items || []);
    if (eventType) items = items.filter(i => i.type === eventType);
    items = items.slice(-effectiveLimit);

    return successResponse(res, {
      streamId,
      items,
      count: items.length,
      filters: { eventType: eventType || null, limit: effectiveLimit },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

export default router;
