// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Ads & Business Endpoints
 *
 * Ad campaigns, dashboard, media studio, boosts, ads analytics.
 *
 * @module api/routes/ai/ads
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
  if (!sessionCookie) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return sessionCookie || null;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try { const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js'))); await queueJob({ id: operationId, type, config, status: 'queued' }); } catch { /* queue unavailable */ }
  return res.json({ success: true, operationId, status: 'queued', statusUrl: `/api/ai/action/status/${operationId}` });
};

/** POST /api/ai/ads/campaigns */
router.post('/campaigns', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'list';
  return queueOperation(res, generateOperationId(), 'adsCampaigns', { session, action });
});

/** POST /api/ai/ads/dashboard */
router.post('/dashboard', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'adsDashboard', { session });
});

/** POST /api/ai/ads/media-studio */
router.post('/media-studio', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'list';
  return queueOperation(res, generateOperationId(), 'adsMediaStudio', { session, action });
});

/** POST /api/ai/ads/boost */
router.post('/boost', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const budget = /** @type {string | number | undefined} */ (req.body.budget);
  if (!tweetId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetId required' });
  return queueOperation(res, generateOperationId(), 'adsBoost', { session, tweetId, budget });
});

/** POST /api/ai/ads/analytics */
router.post('/analytics', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const campaignId = /** @type {string | undefined} */ (req.body.campaignId);
  const dateRange = /** @type {Record<string, unknown> | undefined} */ (req.body.dateRange);
  return queueOperation(res, generateOperationId(), 'adsAnalytics', { session, campaignId, dateRange });
});

export default router;
