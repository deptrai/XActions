// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Personas Endpoints
 *
 * Create, manage, and run AI-powered posting personas.
 *
 * @module api/routes/ai/personas
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
 * POST /api/ai/personas/presets
 * List available persona presets/strategies
 */
router.post('/presets', async (req, res) => {
  return successResponse(res, {
    presets: [
      {
        id: 'thought-leader',
        name: 'Thought Leader',
        description: 'Build authority by sharing insights and engaging with industry conversations',
        activityPattern: { tweetsPerDay: '2-3', replyRatio: 0.4, retweetRatio: 0.2 },
        niche: 'any',
      },
      {
        id: 'growth-hacker',
        name: 'Growth Hacker',
        description: 'Maximize follower growth via high engagement and follow-back tactics',
        activityPattern: { tweetsPerDay: '5-8', replyRatio: 0.6, followsPerDay: '50-100' },
        niche: 'any',
      },
      {
        id: 'crypto-influencer',
        name: 'Crypto Influencer',
        description: 'Niche persona for crypto/web3 community engagement',
        activityPattern: { tweetsPerDay: '4-6', replyRatio: 0.5, topics: ['bitcoin', 'ethereum', 'defi', 'nft'] },
        niche: 'crypto',
      },
      {
        id: 'content-creator',
        name: 'Content Creator',
        description: 'Consistent content machine — threads, hot takes, and viral loops',
        activityPattern: { tweetsPerDay: '3-5', threadFrequency: 'daily', replyRatio: 0.3 },
        niche: 'any',
      },
      {
        id: 'b2b-lead-gen',
        name: 'B2B Lead Gen',
        description: 'Targeted engagement with decision-makers and company accounts',
        activityPattern: { tweetsPerDay: '2-3', dmSequence: true, targetRoles: ['founder', 'cto', 'cmo'] },
        niche: 'b2b',
      },
    ],
  });
});

/**
 * POST /api/ai/personas/create
 * Create a new persona
 */
router.post('/create', async (req, res) => {
  const name = /** @type {string | undefined} */ (req.body.name);
  const niche = /** @type {string | undefined} */ (req.body.niche);
  const strategy = /** @type {string | undefined} */ (req.body.strategy) ?? 'thought-leader';
  const model = /** @type {string | undefined} */ (req.body.model) ?? 'gpt-4o-mini';
  const systemPrompt = /** @type {string | undefined} */ (req.body.systemPrompt);
  const activityPattern = /** @type {string | undefined} */ (req.body.activityPattern);
  const targetAudience = /** @type {string | undefined} */ (req.body.targetAudience);

  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
  if (!niche) return res.status(400).json({ error: 'INVALID_INPUT', message: 'niche is required (e.g. "AI", "crypto", "fitness")' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'personaCreate',
      config: {
        name, niche, strategy, model,
        systemPrompt: systemPrompt || null,
        activityPattern: activityPattern || null,
        targetAudience: targetAudience || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-create',
      config: { name, niche, strategy, model },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/personas/list
 * List all personas
 */
router.post('/list', async (req, res) => {
  try {
    const { getRecentJobs } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const jobs = /** @type {QueueJob[]} */ (await getRecentJobs({ type: 'personaCreate', limit: 50 }));

    return successResponse(res, {
      personas: jobs
        .filter(j => j.status === 'completed')
        .map(j => ({
          personaId: j.id,
          name: j.config?.name,
          niche: j.config?.niche,
          strategy: j.config?.strategy,
          createdAt: j.createdAt,
          result: j.result || null,
        })),
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/personas/status
 * Get persona status
 */
router.post('/status', async (req, res) => {
  const personaId = /** @type {string | undefined} */ (req.body.personaId);
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const status = /** @type {QueueJob | null} */ (await getJobStatus(personaId));

    if (!status) return res.status(404).json({ error: 'NOT_FOUND', message: 'Persona not found' });

    return successResponse(res, {
      personaId,
      status: status.status,
      name: status.config?.name,
      niche: status.config?.niche,
      result: status.result || null,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/personas/edit
 * Edit a persona's settings
 */
router.post('/edit', async (req, res) => {
  const personaId = /** @type {string | undefined} */ (req.body.personaId);
  const updates = /** @type {string | undefined} */ (req.body.updates);
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'updates object is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'personaEdit',
      config: { personaId, updates, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-edit',
      personaId, fields: Object.keys(updates),
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/personas/delete
 * Delete a persona
 */
router.post('/delete', async (req, res) => {
  const personaId = /** @type {string | undefined} */ (req.body.personaId);
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'personaDelete',
      config: { personaId, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', personaId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/personas/run
 * Start running a persona (continuous automation)
 */
router.post('/run', async (req, res) => {
  const personaId = /** @type {string | undefined} */ (req.body.personaId);
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;
  const sessions = /** @type {string | number | undefined} */ (req.body.sessions) ?? 1;
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  const effectiveSessions = Math.min(Math.max(parseInt(String(sessions), 10) || 1, 1), 5);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'personaRun',
      config: {
        personaId, dryRun: !!dryRun, sessions: effectiveSessions,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-run',
      personaId,
      config: { dryRun: !!dryRun, sessions: effectiveSessions },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 30000 },
    }, { note: dryRun ? 'Dry run — actions will be logged but not executed' : 'Persona is now running' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
