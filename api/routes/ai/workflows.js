// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Workflows Endpoints
 *
 * Create, run, list, and inspect multi-step automation workflows.
 *
 * @module api/routes/ai/workflows
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
 * POST /api/ai/workflows/actions
 * List available workflow action types
 */
router.post('/actions', async (req, res) => {
  return successResponse(res, {
    actions: [
      { type: 'scrape_profile', description: 'Get profile data', params: ['username'] },
      { type: 'scrape_tweets', description: 'Get tweets', params: ['username', 'limit'] },
      { type: 'search', description: 'Search tweets', params: ['query', 'filter', 'limit'] },
      { type: 'follow', description: 'Follow a user', params: ['username'] },
      { type: 'unfollow', description: 'Unfollow a user', params: ['username'] },
      { type: 'like', description: 'Like a tweet', params: ['tweetId'] },
      { type: 'retweet', description: 'Retweet a tweet', params: ['tweetId'] },
      { type: 'post_tweet', description: 'Post a tweet', params: ['text'] },
      { type: 'reply', description: 'Reply to a tweet', params: ['tweetId', 'text'] },
      { type: 'send_dm', description: 'Send a DM', params: ['username', 'message'] },
      { type: 'auto_like', description: 'Auto-like tweets', params: ['username|hashtag|keyword', 'maxLikes'] },
      { type: 'auto_follow', description: 'Auto-follow users', params: ['username|hashtag|keyword', 'maxFollows'] },
      { type: 'delay', description: 'Wait N seconds', params: ['seconds'] },
      { type: 'condition', description: 'Branch on condition', params: ['field', 'operator', 'value'] },
    ],
  });
});

/**
 * POST /api/ai/workflows/create
 * Create a named workflow
 */
router.post('/create', async (req, res) => {
  const name = /** @type {string | undefined} */ (req.body.name);
  const description = /** @type {string | undefined} */ (req.body.description);
  const steps = /** @type {string | undefined} */ (req.body.steps);
  const schedule = /** @type {Record<string, unknown> | undefined} */ (req.body.schedule);

  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'steps must be a non-empty array',
      example: {
        name: 'Morning engagement',
        steps: [
          { type: 'search', params: { query: 'ai technology', limit: 20 } },
          { type: 'auto_like', params: { keyword: 'ai technology', maxLikes: 10 } },
          { type: 'delay', params: { seconds: 5 } },
        ],
      },
    });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'workflowCreate',
      config: {
        name, description: description || null,
        steps: steps.slice(0, 50),
        schedule: schedule || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'workflow-create',
      config: { name, stepCount: steps.length, scheduled: !!schedule },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/workflows/run
 * Execute a workflow (inline or by ID)
 */
router.post('/run', async (req, res) => {
  const workflowId = /** @type {string | undefined} */ (req.body.workflowId);
  const workflow = /** @type {Record<string, unknown> | undefined} */ (req.body.workflow);
  const context = /** @type {Record<string, unknown> | undefined} */ (req.body.context) ?? {};
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;

  if (!workflowId && !workflow) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'workflowId or workflow definition is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'workflowRun',
      config: {
        workflowId: workflowId || null,
        workflow: workflow || null,
        context,
        dryRun: !!dryRun,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'workflow-run',
      config: { dryRun: !!dryRun, workflowId: workflowId || null },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/workflows/list
 * List saved workflows
 */
router.post('/list', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;

  try {
    const { getRecentJobs } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const jobs = /** @type {QueueJob[]} */ (await getRecentJobs({ type: 'workflowCreate', limit: Math.min(parseInt(String(limit), 10) || 20, 100) }));

    return successResponse(res, {
      workflows: jobs.map(j => ({
        workflowId: j.id,
        name: j.config?.name,
        stepCount: (/** @type {Array<unknown> | undefined} */ (j.config?.steps))?.length || 0,
        status: j.status,
        createdAt: j.createdAt,
      })),
      count: jobs.length,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
