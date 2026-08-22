// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Grok Endpoints
 *
 * Query Grok AI, summarize topics, analyze images via Grok.
 *
 * @module api/routes/ai/grok
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
      message: 'X/Twitter session cookie is required for Grok operations',
      hint: 'Grok requires an X Premium subscription on the authenticated account',
    });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/grok/query
 * Query Grok with a question or prompt
 */
router.post('/query', async (req, res) => {
  const query = /** @type {string | undefined} */ (req.body.query);
  const mode = /** @type {string | undefined} */ (req.body.mode) ?? 'fun';

  if (!query) return res.status(400).json({ error: 'INVALID_INPUT', message: 'query is required' });
  if (query.length > 4000) return res.status(400).json({ error: 'INVALID_INPUT', message: 'query exceeds 4,000 characters' });

  const validModes = ['fun', 'regular'];
  const effectiveMode = validModes.includes(mode) ? mode : 'fun';

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'grokQuery',
      config: { query, mode: effectiveMode, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'grok-query',
      config: { queryLength: query.length, mode: effectiveMode },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    }, { note: 'Requires X Premium on the authenticated account' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/grok/summarize
 * Summarize a topic using Grok
 */
router.post('/summarize', async (req, res) => {
  const topic = /** @type {string | undefined} */ (req.body.topic);
  const context = /** @type {Record<string, unknown> | undefined} */ (req.body.context);

  if (!topic) return res.status(400).json({ error: 'INVALID_INPUT', message: 'topic is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'grokSummarize',
      config: { topic, context: context || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'grok-summarize',
      config: { topic },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/grok/analyze-image
 * Analyze an image using Grok's vision
 */
router.post('/analyze-image', async (req, res) => {
  const imageUrl = /** @type {string | undefined} */ (req.body.imageUrl);
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const question = /** @type {string | undefined} */ (req.body.question) ?? 'What is in this image?';

  if (!imageUrl && !tweetUrl) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'imageUrl or tweetUrl is required',
      schema: {
        imageUrl: { type: 'string', description: 'Direct URL to an image' },
        tweetUrl: { type: 'string', description: 'URL of a tweet containing an image' },
        question: { type: 'string', description: 'Question to ask about the image', default: 'What is in this image?' },
      },
    });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'grokAnalyzeImage',
      config: {
        imageUrl: imageUrl || null,
        tweetUrl: tweetUrl || null,
        question,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'grok-analyze-image',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

export default router;
