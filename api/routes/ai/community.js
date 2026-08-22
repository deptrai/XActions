// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Community Endpoints
 *
 * Join, leave, create, and manage X/Twitter Communities.
 *
 * @module api/routes/ai/community
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

/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!sessionCookie) {
    res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' });
    return null;
  }
  return sessionCookie || null;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try { const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js'))); await queueJob({ id: operationId, type, config, status: 'queued' }); } catch { /* queue unavailable */ }
  return res.json({ success: true, operationId, status: 'queued', statusUrl: `/api/ai/action/status/${operationId}` });
};

/** POST /api/ai/community/join */
router.post('/join', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const communityId = /** @type {string | undefined} */ (req.body.communityId);
  const keyword = /** @type {string | undefined} */ (req.body.keyword);
  if (!communityId && !keyword) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId or keyword required' });
  return queueOperation(res, generateOperationId(), 'communityJoin', { session, communityId, keyword });
});

/** POST /api/ai/community/leave */
router.post('/leave', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const communityId = /** @type {string | undefined} */ (req.body.communityId);
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  return queueOperation(res, generateOperationId(), 'communityLeave', { session, communityId });
});

/** POST /api/ai/community/leave-all */
router.post('/leave-all', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'communityLeaveAll', { session });
});

/** POST /api/ai/community/create */
router.post('/create', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const name = /** @type {string | undefined} */ (req.body.name);
  const description = /** @type {string | undefined} */ (req.body.description);
  const rules = /** @type {string[] | undefined} */ (req.body.rules);
  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name required' });
  return queueOperation(res, generateOperationId(), 'communityCreate', { session, name, description, rules });
});

/** POST /api/ai/community/manage */
router.post('/manage', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const communityId = /** @type {string | undefined} */ (req.body.communityId);
  const action = /** @type {string | undefined} */ (req.body.action);
  const targetUsername = /** @type {string | undefined} */ (req.body.targetUsername);
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  return queueOperation(res, generateOperationId(), 'communityManage', { session, communityId, action, targetUsername });
});

/** POST /api/ai/community/notes */
router.post('/notes', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'view';
  return queueOperation(res, generateOperationId(), 'communityNotes', { session, tweetId, action });
});

/** POST /api/ai/community/list */
router.post('/list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'communityList', { session });
});

/** POST /api/ai/community/members */
router.post('/members', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const communityId = /** @type {string | undefined} */ (req.body.communityId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  return queueOperation(res, generateOperationId(), 'communityMembers', { session, communityId, limit });
});

/** POST /api/ai/community/search */
router.post('/search', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const query = /** @type {string | undefined} */ (req.body.query);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  if (!query) return res.status(400).json({ error: 'INVALID_INPUT', message: 'query required' });
  return queueOperation(res, generateOperationId(), 'communitySearch', { session, query, limit });
});

export default router;
