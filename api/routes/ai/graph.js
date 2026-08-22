// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Social Graph Endpoints
 *
 * Build, analyze, and query the social graph of an account.
 *
 * @module api/routes/ai/graph
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
 * POST /api/ai/graph/build
 * Build a social graph for an account (crawl followers/following network)
 */
router.post('/build', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const depth = /** @type {string | number | undefined} */ (req.body.depth) ?? 1;
  const maxNodes = /** @type {string | number | undefined} */ (req.body.maxNodes) ?? 500;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveDepth = Math.min(Math.max(parseInt(String(depth), 10) || 1, 1), 2);
  const effectiveMax = Math.min(Math.max(parseInt(String(maxNodes), 10) || 500, 50), 2000);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'graphBuild',
      config: {
        username: cleanUsername,
        depth: effectiveDepth,
        maxNodes: effectiveMax,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    const estimatedMinutes = Math.ceil(effectiveMax * effectiveDepth / 100);
    return successResponse(res, {
      operationId, status: 'queued', type: 'graph-build',
      config: { username: cleanUsername, depth: effectiveDepth, maxNodes: effectiveMax },
      estimatedDuration: `~${estimatedMinutes} minutes`,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 15000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/graph/analyze
 * Analyze a built graph for communities, influencers, clusters
 */
router.post('/analyze', async (req, res) => {
  const graphOperationId = /** @type {string | undefined} */ (req.body.graphOperationId);
  const metrics = /** @type {string[] | undefined} */ (req.body.metrics) ?? ['communities', 'influencers', 'bridges'];
  if (!graphOperationId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'graphOperationId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const graphJob = /** @type {Record<string, unknown>} */ (await getJobStatus(graphOperationId));

    if (!graphJob) return res.status(404).json({ error: 'NOT_FOUND', message: 'Graph build job not found' });
    if (graphJob.status !== 'completed') {
      return successResponse(res, {
        status: 'graph_not_ready',
        graphStatus: graphJob.status,
        message: 'Graph is still building. Check back when it completes.',
        polling: { endpoint: `/api/ai/action/status/${graphOperationId}`, recommendedIntervalMs: 10000 },
      });
    }

    // Queue analysis on the completed graph
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'graphAnalyze',
      config: { graphOperationId, metrics, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'graph-analyze',
      graphOperationId, metrics,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 10000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/graph/recommendations
 * Get recommended accounts to follow based on graph
 */
router.post('/recommendations', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  const based_on = /** @type {string | undefined} */ (req.body.based_on) ?? 'mutual_followers';
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 5), 50);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'graphRecommendations',
      config: {
        username: cleanUsername,
        limit: effectiveLimit,
        basedOn: based_on,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'graph-recommendations',
      config: { username: cleanUsername, limit: effectiveLimit, based_on },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 10000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/graph/list
 * List built graphs
 */
router.post('/list', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 10;

  try {
    const { getRecentJobs } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const jobs = /** @type {Record<string, unknown>[]} */ (await getRecentJobs({ type: 'graphBuild', limit: Math.min(parseInt(String(limit), 10) || 10, 50) }));

    return successResponse(res, {
      graphs: jobs.map(j => ({
        graphId: j.id,
        username: j.config?.username,
        depth: j.config?.depth,
        maxNodes: j.config?.maxNodes,
        status: j.status,
        nodeCount: j.result?.nodeCount || null,
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

export default router;
