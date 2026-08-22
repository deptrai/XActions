// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Moderation Endpoints
 *
 * Block bots, mass block/unblock/mute, remove followers,
 * shadowban check, manage muted words, verified-only replies.
 *
 * @module api/routes/ai/moderation
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

/** POST /api/ai/moderation/block-bots */
router.post('/block-bots', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const threshold = /** @type {string | number | undefined} */ (req.body.threshold) ?? 0.7;
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? false;
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  return queueOperation(res, generateOperationId(), 'blockBots', { session, threshold, dryRun, limit });
});

/** POST /api/ai/moderation/mass-block */
router.post('/mass-block', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'massBlock', { session, usernames, delayMs });
});

/** POST /api/ai/moderation/mass-unblock */
router.post('/mass-unblock', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'massUnblock', { session, usernames, delayMs });
});

/** POST /api/ai/moderation/mass-unmute */
router.post('/mass-unmute', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 2000;
  return queueOperation(res, generateOperationId(), 'massUnmute', { session, usernames, delayMs });
});

/** POST /api/ai/moderation/mute-keywords */
router.post('/mute-keywords', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
  if (!keywords?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keywords array required' });
  return queueOperation(res, generateOperationId(), 'muteKeywords', { session, keywords });
});

/** POST /api/ai/moderation/muted-words */
router.post('/muted-words', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'list';
  return queueOperation(res, generateOperationId(), 'mutedWords', { session, action });
});

/** POST /api/ai/moderation/remove-followers */
router.post('/remove-followers', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const delayMs = /** @type {string | number | undefined} */ (req.body.delayMs) ?? 3000;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'removeFollowers', { session, usernames, delayMs });
});

/** POST /api/ai/moderation/report-spam */
router.post('/report-spam', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'reportSpam', { session, usernames });
});

/** POST /api/ai/moderation/shadowban-check */
router.post('/shadowban-check', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username required' });
  return queueOperation(res, generateOperationId(), 'shadowbanCheck', { session, username });
});

/** POST /api/ai/moderation/verified-only */
router.post('/verified-only', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const enabled = /** @type {boolean | undefined} */ (req.body.enabled) ?? true;
  return queueOperation(res, generateOperationId(), 'verifiedOnly', { session, enabled });
});

/** POST /api/ai/moderation/blocked-list */
router.post('/blocked-list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'blockedList', { session });
});

/** POST /api/ai/moderation/muted-list */
router.post('/muted-list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'mutedList', { session });
});

export default router;
