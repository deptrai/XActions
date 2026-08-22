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
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
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
    const graphJob = /** @type {QueueJob | null} */ (await getJobStatus(graphOperationId));

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
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
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
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
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
    const jobs = /** @type {QueueJob[]} */ (await getRecentJobs({ type: 'graphBuild', limit: Math.min(parseInt(String(limit), 10) || 10, 50) }));

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
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
