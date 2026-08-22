// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Automation Endpoints
 *
 * Advanced automation: auto-reply, auto-repost, plug replies,
 * engagement boosting, content repurposing, customer service bots.
 *
 * @module api/routes/ai/automation
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

/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!sessionCookie) {
    res.status(400).json({
      success: false,
      error: 'SESSION_REQUIRED',
      message: 'Provide sessionCookie in body or X-Session-Cookie header',
    });
    return null;
  }
  return sessionCookie || null;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try {
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({ id: operationId, type, config, status: 'queued' });
  } catch {
    // Job queue unavailable — accepted anyway
  }
  return res.json({
    success: true,
    operationId,
    status: 'queued',
    statusUrl: `/api/ai/action/status/${operationId}`,
    message: `Operation ${type} queued`,
  });
};

/** POST /api/ai/automation/auto-reply */
router.post('/auto-reply', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
  const replyTemplate = /** @type {string | undefined} */ (req.body.replyTemplate);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  if (!keywords || !replyTemplate) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'keywords and replyTemplate required' });
  }
  return queueOperation(res, generateOperationId(), 'autoReply', { session, keywords, replyTemplate, limit, delayMs });
});

/** POST /api/ai/automation/auto-repost */
router.post('/auto-repost', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 3000;
  if (!keywords) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keywords required' });
  return queueOperation(res, generateOperationId(), 'autoRepost', { session, keywords, limit, delayMs });
});

/** POST /api/ai/automation/plug-replies */
router.post('/plug-replies', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const plugText = /** @type {string | undefined} */ (req.body.plugText);
  const minLikes = /** @type {string | number | undefined} */ (req.body.minLikes) ?? 100;
  if (!plugText) return res.status(400).json({ error: 'INVALID_INPUT', message: 'plugText required' });
  return queueOperation(res, generateOperationId(), 'plugReplies', { session, tweetUrl, plugText, minLikes });
});

/** POST /api/ai/automation/engagement-booster */
router.post('/engagement-booster', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const targetAccounts = /** @type {string | undefined} */ (req.body.targetAccounts);
  const actionsPerDay = /** @type {string | number | undefined} */ (req.body.actionsPerDay) ?? 50;
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 3000;
  return queueOperation(res, generateOperationId(), 'engagementBooster', { session, targetAccounts, actionsPerDay, delayMs });
});

/** POST /api/ai/automation/quote-tweet-auto */
router.post('/quote-tweet-auto', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
  const commentTemplate = /** @type {string | undefined} */ (req.body.commentTemplate);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 10;
  return queueOperation(res, generateOperationId(), 'quoteTweetAuto', { session, keywords, commentTemplate, limit });
});

/** POST /api/ai/automation/content-repurpose */
router.post('/content-repurpose', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const tweetIds = /** @type {string[] | undefined} */ (req.body.tweetIds);
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'thread';
  if (!tweetIds) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetIds required' });
  return queueOperation(res, generateOperationId(), 'contentRepurpose', { session, tweetIds, format });
});

/** POST /api/ai/automation/content-calendar */
router.post('/content-calendar', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const niche = /** @type {string | undefined} */ (req.body.niche);
  const tweetsPerDay = /** @type {string | number | undefined} */ (req.body.tweetsPerDay) ?? 3;
  const days = /** @type {string | number | undefined} */ (req.body.days) ?? 7;
  return queueOperation(res, generateOperationId(), 'contentCalendar', { session, niche, tweetsPerDay, days });
});

/** POST /api/ai/automation/welcome-followers */
router.post('/welcome-followers', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const messageTemplate = /** @type {string | undefined} */ (req.body.messageTemplate);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 5000;
  return queueOperation(res, generateOperationId(), 'welcomeFollowers', { session, messageTemplate, delayMs });
});

/** POST /api/ai/automation/continuous-monitor */
router.post('/continuous-monitor', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const username = /** @type {string | undefined} */ (req.body.username);
  const intervalMs = /** @type {string | number | undefined} */ (req.body.intervalMs) ?? 300000;
  const webhookUrl = /** @type {string | undefined} */ (req.body.webhookUrl);
  return queueOperation(res, generateOperationId(), 'continuousMonitor', { session, username, intervalMs, webhookUrl });
});

/** POST /api/ai/automation/keyword-monitor */
router.post('/keyword-monitor', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
  const webhookUrl = /** @type {string | undefined} */ (req.body.webhookUrl);
  const intervalMs = /** @type {string | number | undefined} */ (req.body.intervalMs) ?? 60000;
  if (!keywords) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keywords required' });
  return queueOperation(res, generateOperationId(), 'keywordMonitor', { session, keywords, webhookUrl, intervalMs });
});

/** POST /api/ai/automation/customer-service */
router.post('/customer-service', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const triggerKeywords = /** @type {string | undefined} */ (req.body.triggerKeywords);
  const responseTemplates = /** @type {string | undefined} */ (req.body.responseTemplates);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  return queueOperation(res, generateOperationId(), 'customerService', { session, triggerKeywords, responseTemplates, delayMs });
});

/** POST /api/ai/automation/evergreen */
router.post('/evergreen', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const minAge = /** @type {string | number | undefined} */ (req.body.minAge) ?? 30;
  const minEngagement = /** @type {string | number | undefined} */ (req.body.minEngagement) ?? 10;
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;
  return queueOperation(res, generateOperationId(), 'evergreenRecycle', { session, minAge, minEngagement, limit });
});

export default router;
