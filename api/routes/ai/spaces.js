// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Spaces Endpoints
 *
 * Discover, scrape, join, and manage X Spaces.
 *
 * @module api/routes/ai/spaces
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

/* ScrapedUser, ScrapedTweet, ScrapedMedia, and ScrapedBookmark types are provided globally by src/types/ai-routes.d.ts */

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
    return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'Session cookie is required' });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/spaces/list
 * Discover live and scheduled Spaces
 */
router.post('/list', async (req, res) => {
  const query = /** @type {string | undefined} */ (req.body.query);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  const type = /** @type {string | undefined} */ (req.body.type) ?? 'live';
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const searchQuery = query ? `${query} filter:spaces` : 'filter:spaces';
    const results = /** @type {TweetListResult} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), searchQuery, {
      limit: effectiveLimit,
      filter: 'top',
    }));

    return successResponse(res, {
      spaces: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        title: t.text?.match(/🎙|Spaces/i) ? t.text : `Space by @${t.author?.username}`,
        hostUsername: t.author?.username || t.username,
        url: t.url,
        tweet: { id: t.id, text: t.text, createdAt: t.timestamp },
      })),
      count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length,
      type,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/spaces/scrape
 * Scrape metadata from a Space URL
 */
router.post('/scrape', async (req, res) => {
  const spaceUrl = /** @type {string | undefined} */ (req.body.spaceUrl);
  const spaceId = /** @type {string | undefined} */ (req.body.spaceId);

  if (!spaceUrl && !spaceId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'spaceUrl or spaceId is required',
    });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'scrapeSpace',
      config: {
        spaceUrl: spaceUrl || null,
        spaceId: spaceId || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'scrape-space',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/spaces/join
 * Join a Space as a listener (with optional AI co-host)
 */
router.post('/join', async (req, res) => {
  const spaceUrl = /** @type {string | undefined} */ (req.body.spaceUrl);
  const spaceId = /** @type {string | undefined} */ (req.body.spaceId);
  const provider = /** @type {string | undefined} */ (req.body.provider) ?? 'openai';
  const systemPrompt = /** @type {string | undefined} */ (req.body.systemPrompt);
  const model = /** @type {string | undefined} */ (req.body.model);

  if (!spaceUrl && !spaceId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'spaceUrl or spaceId is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'spaceJoin',
      config: {
        spaceUrl: spaceUrl || null,
        spaceId: spaceId || null,
        provider,
        systemPrompt: systemPrompt || null,
        model: model || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'space-join',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/spaces/leave
 * Leave an active Space session
 */
router.post('/leave', async (req, res) => {
  const spaceOperationId = /** @type {string | undefined} */ (req.body.operationId);

  try {
    const { cancelJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    if (spaceOperationId) {
      await cancelJob(spaceOperationId);
    }

    return successResponse(res, { status: 'left', spaceOperationId: spaceOperationId || null });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/spaces/status
 * Get status of a Space session
 */
router.post('/status', async (req, res) => {
  const spaceOperationId = /** @type {string | undefined} */ (req.body.operationId);

  if (!spaceOperationId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'operationId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const status = /** @type {QueueJob | null} */ (await getJobStatus(spaceOperationId));

    if (!status) return res.status(404).json({ error: 'NOT_FOUND', message: 'Space session not found' });

    return successResponse(res, {
      operationId: spaceOperationId,
      status: status.status,
      result: status.result || null,
      timing: { startedAt: status.startedAt, completedAt: status.completedAt },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'STATUS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/spaces/transcript
 * Get transcript from a completed Space session
 */
router.post('/transcript', async (req, res) => {
  const spaceOperationId = /** @type {string | undefined} */ (req.body.operationId);
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'text';

  if (!spaceOperationId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'operationId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const status = /** @type {QueueJob | null} */ (await getJobStatus(spaceOperationId));

    if (!status) return res.status(404).json({ error: 'NOT_FOUND', message: 'Space session not found' });

    const transcript = /** @type {SpaceTranscriptEntry[] | null} */ (status.result?.transcript || null);

    return successResponse(res, {
      operationId: spaceOperationId,
      transcript: format === 'json' ? transcript : transcript?.map(e => `[${e.speaker}]: ${e.text}`).join('\n') || null,
      format,
      available: !!transcript,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
