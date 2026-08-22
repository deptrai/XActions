// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Timeline Viewing Endpoints
 *
 * @module api/routes/ai/timeline
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


const generateOperationId = () => `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const s = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!s) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return s || null;
};
/** @param {import('express').Response} res @param {string} id @param {string} type @param {Record<string, unknown>} config */
const queueOp = async (res, id, type, config) => {
  try { const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js'))); await queueJob({ id, type, config, status: 'queued' }); } catch { /* */ }
  return res.json({ success: true, operationId: id, status: 'queued', statusUrl: `/api/ai/action/status/${id}` });
};

/** POST /api/ai/timeline/view */
router.post('/view', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'timelineView', { session: s, ...req.body }); });
/** POST /api/ai/timeline/scroll */
router.post('/scroll', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'timelineScroll', { session: s, ...req.body }); });
/** POST /api/ai/timeline/collect */
router.post('/collect', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'timelineCollect', { session: s, ...req.body }); });
/** POST /api/ai/timeline/export */
router.post('/export', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'timelineExport', { session: s, ...req.body }); });
/** POST /api/ai/timeline/switch-feed */
router.post('/switch-feed', async (req, res) => { const s = requireSession(req, res); if (!s) return; const feed = /** @type {string | undefined} */ (req.body.feed) ?? 'following'; return queueOp(res, generateOperationId(), 'timelineSwitchFeed', { session: s, feed }); });

export default router;
