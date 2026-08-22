// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Account Endpoints
 *
 * Account backup, data download, follower audits, delegate access,
 * identity verification, contact uploads, multi-account support.
 *
 * @module api/routes/ai/account
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

/** POST /api/ai/account/backup */
router.post('/backup', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const include = /** @type {string[] | undefined} */ (req.body.include) ?? ['tweets', 'likes', 'bookmarks', 'followers'];
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'json';
  return queueOperation(res, generateOperationId(), 'accountBackup', { session, include, format });
});

/** POST /api/ai/account/download-data */
router.post('/download-data', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'downloadData', { session });
});

/** POST /api/ai/account/audit-followers */
router.post('/audit-followers', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 200;
  const checkBots = /** @type {boolean | undefined} */ (req.body.checkBots) ?? true;
  return queueOperation(res, generateOperationId(), 'auditFollowers', { session, username, limit, checkBots });
});

/** POST /api/ai/account/delegate-access */
router.post('/delegate-access', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'list';
  const targetUsername = /** @type {string | undefined} */ (req.body.targetUsername);
  const permissions = /** @type {string[] | undefined} */ (req.body.permissions);
  return queueOperation(res, generateOperationId(), 'delegateAccess', { session, action, targetUsername, permissions });
});

/** POST /api/ai/account/verify-identity */
router.post('/verify-identity', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'verifyIdentity', { session });
});

/** POST /api/ai/account/upload-contacts */
router.post('/upload-contacts', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const contacts = /** @type {string | undefined} */ (req.body.contacts);
  return queueOperation(res, generateOperationId(), 'uploadContacts', { session, contacts });
});

/** POST /api/ai/account/multi-account */
router.post('/multi-account', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'list';
  return queueOperation(res, generateOperationId(), 'multiAccount', { session, action });
});

/** POST /api/ai/account/join-date */
router.post('/join-date', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username required' });
  return queueOperation(res, generateOperationId(), 'joinDate', { session, username });
});

/** POST /api/ai/account/login-history */
router.post('/login-history', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'loginHistory', { session });
});

/** POST /api/ai/account/connected-accounts */
router.post('/connected-accounts', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'connectedAccounts', { session });
});

/** POST /api/ai/account/appeal-suspension */
router.post('/appeal-suspension', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const reason = /** @type {string | undefined} */ (req.body.reason);
  return queueOperation(res, generateOperationId(), 'appealSuspension', { session, reason });
});

/** POST /api/ai/account/qr-code */
router.post('/qr-code', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const username = /** @type {string | undefined} */ (req.body.username);
  return queueOperation(res, generateOperationId(), 'qrCode', { session, username });
});

export default router;
