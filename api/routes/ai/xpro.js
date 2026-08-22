// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI X Pro / TweetDeck Endpoints
 *
 * @module api/routes/ai/xpro
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


const generateOperationId = () => `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const s = req.body.sessionCookie || req.headers['x-session-cookie'];
  if (!s) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return s;
};
/** @param {import('express').Response} res @param {string} id @param {string} type @param {Record<string, unknown>} config */
const queueOp = async (res, id, type, config) => {
  try { const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js'))); await queueJob({ id, type, config, status: 'queued' }); } catch { /* */ }
  return res.json({ success: true, operationId: id, status: 'queued', statusUrl: `/api/ai/action/status/${id}` });
};

/** POST /api/ai/xpro/dashboard */
router.post('/dashboard', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'xproDashboard', { session: s }); });
/** POST /api/ai/xpro/columns */
router.post('/columns', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'xproColumns', { session: s, ...req.body }); });
/** POST /api/ai/xpro/manage */
router.post('/manage', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'xproManage', { session: s, ...req.body }); });

export default router;
