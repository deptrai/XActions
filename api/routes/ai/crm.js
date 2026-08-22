// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI CRM Endpoints
 *
 * Sync followers to CRM, tag/segment contacts, search CRM data.
 *
 * @module api/routes/ai/crm
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
 * POST /api/ai/crm/sync
 * Sync followers/following to CRM database
 */
router.post('/sync', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const type = /** @type {string | undefined} */ (req.body.type) ?? 'followers';
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 1000;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const validTypes = ['followers', 'following', 'both'];
  const effectiveType = validTypes.includes(type) ? type : 'followers';
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 1000, 100), 10000);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'crmSync',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        syncType: effectiveType,
        limit: effectiveLimit,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    const estimatedMinutes = Math.ceil(effectiveLimit / 200);
    return successResponse(res, {
      operationId, status: 'queued', type: 'crm-sync',
      config: { syncType: effectiveType, limit: effectiveLimit },
      estimatedDuration: `~${estimatedMinutes} minutes`,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 10000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/crm/tag
 * Tag a contact in the CRM
 */
router.post('/tag', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const tags = /** @type {string[] | undefined} */ (req.body.tags);
  const remove = /** @type {boolean | undefined} */ (req.body.remove) ?? false;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });
  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'tags array is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'crmTag',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        tags, remove: !!remove,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'crm-tag',
      config: { username, tags, remove: !!remove },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/crm/search
 * Search CRM contacts
 */
router.post('/search', async (req, res) => {
  const query = /** @type {string | undefined} */ (req.body.query);
  const tags = /** @type {string[] | undefined} */ (req.body.tags);
  const minFollowers = /** @type {string | number | undefined} */ (req.body.minFollowers);
  const maxFollowers = /** @type {string | number | undefined} */ (req.body.maxFollowers);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'crmSearch',
      config: {
        query: query || null,
        tags: Array.isArray(tags) ? tags : null,
        minFollowers: minFollowers || null,
        maxFollowers: maxFollowers || null,
        limit: effectiveLimit,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'crm-search',
      filters: { query, tags, minFollowers, maxFollowers, limit: effectiveLimit },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/crm/segment
 * Get or create a CRM segment
 */
router.post('/segment', async (req, res) => {
  const name = /** @type {string | undefined} */ (req.body.name);
  const criteria = /** @type {string | undefined} */ (req.body.criteria);
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'get';

  const validActions = ['get', 'create', 'list'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `action must be one of: ${validActions.join(', ')}` });
  }

  if (action !== 'list' && !name) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'crmSegment',
      config: { action, name: name || null, criteria: criteria || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'crm-segment',
      config: { action, name },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  }
});

export default router;
