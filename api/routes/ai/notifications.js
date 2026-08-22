// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Push Notification Endpoints
 *
 * Send and test webhook/push notifications.
 *
 * @module api/routes/ai/notifications
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
 * @property {string} [username]
 * @property {string} [authorName]
 * @property {Record<string, unknown>} [metrics]
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
 * @property {string} [thumbnail]
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
 * @property {string} [username]
 * @property {string} [authorName]
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

// No session required for notification endpoints — webhook URL is the auth
router.use((req, res, next) => next());

/**
 * POST /api/ai/notify/send
 * Send a push notification / webhook
 */
router.post('/send', async (req, res) => {
  const webhookUrl = /** @type {string | undefined} */ (req.body.webhookUrl);
  const event = /** @type {string | undefined} */ (req.body.event);
  const data = /** @type {string | undefined} */ (req.body.data);
  const channel = /** @type {string | undefined} */ (req.body.channel) ?? 'webhook';

  if (!webhookUrl && channel === 'webhook') {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'webhookUrl is required for webhook notifications',
      schema: {
        webhookUrl: { type: 'string', description: 'HTTPS webhook endpoint' },
        event: { type: 'string', description: 'Event name (e.g., new_follower, mention)' },
        data: { type: 'object', description: 'Payload to send' },
        channel: { type: 'string', enum: ['webhook', 'email', 'slack'], default: 'webhook' },
      },
    });
  }

  const operationId = generateOperationId();

  try {
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'sendNotification',
      config: {
        webhookUrl: webhookUrl || null,
        event: event || 'xactions.notification',
        data: data || {},
        channel,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'send-notification',
      config: { channel, event },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/notify/test
 * Send a test notification to verify webhook
 */
router.post('/test', async (req, res) => {
  const webhookUrl = /** @type {string | undefined} */ (req.body.webhookUrl);

  if (!webhookUrl) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'webhookUrl is required' });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XActions-Event': 'test', 'User-Agent': 'XActions/1.0' },
      body: JSON.stringify({
        event: 'xactions.test',
        message: 'XActions webhook test — if you see this, the connection works! ✅',
        timestamp: new Date().toISOString(),
        source: 'xactions-ai-api',
      }),
      signal: AbortSignal.timeout(10000),
    });

    return successResponse(res, {
      webhookUrl,
      status: response.ok ? 'success' : 'failed',
      responseStatus: response.status,
      responseStatusText: response.statusText,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 400, 'WEBHOOK_UNREACHABLE',
      `Could not reach webhook: ${_errMessage}`, { retryable: false });
  
  
  }
});

export default router;
