// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Webhooks Endpoints
 *
 * @module api/routes/ai/webhooks
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
/** @param {import('express').Response} res @param {string} id @param {string} type @param {Record<string, unknown>} config */
const queueOp = async (res, id, type, config) => {
  try { const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js'))); await queueJob({ id, type, config, status: 'queued' }); } catch { /* */ }
  return res.json({ success: true, operationId: id, status: 'queued', statusUrl: `/api/ai/action/status/${id}` });
};

/** POST /api/ai/webhooks/create */
router.post('/create', async (req, res) => { const url = /** @type {string | undefined} */ (req.body.url);
      const events = /** @type {string | undefined} */ (req.body.events); if (!url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'url required' }); return queueOp(res, generateOperationId(), 'webhookCreate', { url, events }); });
/** POST /api/ai/webhooks/list */
router.post('/list', async (req, res) => { return res.json({ success: true, data: { webhooks: [] } }); });
/** POST /api/ai/webhooks/delete */
router.post('/delete', async (req, res) => { const webhookId = /** @type {string | undefined} */ (req.body.webhookId); if (!webhookId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'webhookId required' }); return queueOp(res, generateOperationId(), 'webhookDelete', { webhookId }); });
/** POST /api/ai/webhooks/test */
router.post('/test', async (req, res) => { const webhookId = /** @type {string | undefined} */ (req.body.webhookId); return queueOp(res, generateOperationId(), 'webhookTest', { webhookId }); });
/** POST /api/ai/webhooks/events */
router.post('/events', async (req, res) => { return res.json({ success: true, data: { events: ['new_follower', 'unfollower', 'mention', 'dm', 'like', 'retweet', 'quote', 'reply'] } }); });

export default router;
