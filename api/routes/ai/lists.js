// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Lists Endpoints
 *
 * Get user lists, list members.
 *
 * @module api/routes/ai/lists
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
 * POST /api/ai/lists/all
 * Get all lists for authenticated user or specified username
 */
router.post('/all', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'getLists',
      config: {
        username: username ? username.replace(/^@/, '').toLowerCase() : null,
        limit: effectiveLimit,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'get-lists',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/lists/members
 * Get members of a specific list
 */
router.post('/members', async (req, res) => {
  const listUrl = /** @type {string | undefined} */ (req.body.listUrl);
  const listId = /** @type {string | undefined} */ (req.body.listId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);

  if (!listUrl && !listId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'listUrl or listId is required',
      schema: {
        listUrl: { type: 'string', example: 'https://x.com/i/lists/1234567890' },
        listId: { type: 'string', example: '1234567890' },
        limit: { type: 'number', default: 100, max: 500 },
        cursor: { type: 'string' },
      },
    });
  }

  let effectiveListId = listId;
  if (listUrl) {
    const match = listUrl.match(/lists\/(\d+)/);
    if (match) effectiveListId = match[1];
  }

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 500);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'getListMembers',
      config: {
        listId: effectiveListId,
        limit: effectiveLimit,
        cursor: cursor || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'get-list-members',
      listId: effectiveListId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
