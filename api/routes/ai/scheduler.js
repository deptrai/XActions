// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Scheduler / RSS Endpoints
 *
 * Schedule posts, manage RSS feeds, find evergreen content.
 *
 * @module api/routes/ai/scheduler
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
 * POST /api/ai/schedule/add
 * Add a scheduled post (cron or datetime)
 */
router.post('/add', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const scheduledAt = /** @type {string | undefined} */ (req.body.scheduledAt);
  const cron = /** @type {string | undefined} */ (req.body.cron);
  const timezone = /** @type {string | undefined} */ (req.body.timezone) ?? 'UTC';
  const repeat = /** @type {boolean | undefined} */ (req.body.repeat) ?? false;

  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });
  if (!scheduledAt && !cron) return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt or cron is required' });

  if (scheduledAt) {
    const date = new Date(scheduledAt);
    if (isNaN(date.getTime()) || date <= new Date()) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt must be a valid future datetime' });
    }
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'scheduleAdd',
      config: {
        text,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        cron: cron || null,
        timezone, repeat: !!repeat,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'schedule-add',
      config: { scheduledAt, cron, repeat: !!repeat },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/list
 * List scheduled posts
 */
router.post('/list', async (req, res) => {
  const status = /** @type {string | undefined} */ (req.body.status) ?? 'pending';
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;

  try {
    const { getRecentJobs } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const jobs = /** @type {QueueJob[]} */ (await getRecentJobs({ type: 'scheduleAdd', limit: Math.min(parseInt(String(limit), 10) || 50, 200) }));

    const filtered = status === 'all' ? jobs : jobs.filter(j => j.status === status);

    return successResponse(res, {
      scheduled: filtered.map(j => ({
        scheduleId: j.id,
        text: (/** @type {string | undefined} */ (j.config?.text))?.slice(0, 100),
        scheduledAt: j.config?.scheduledAt,
        cron: j.config?.cron,
        status: j.status,
        createdAt: j.createdAt,
      })),
      count: filtered.length,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/remove
 * Remove a scheduled post
 */
router.post('/remove', async (req, res) => {
  const scheduleId = /** @type {string | undefined} */ (req.body.scheduleId);
  if (!scheduleId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduleId is required' });

  try {
    const { cancelJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await cancelJob(scheduleId);

    return successResponse(res, { scheduleId, status: 'removed', removedAt: new Date().toISOString() });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/rss-add
 * Add an RSS feed for auto-posting
 */
router.post('/rss-add', async (req, res) => {
  const url = /** @type {string | undefined} */ (req.body.url);
  const postTemplate = /** @type {string | undefined} */ (req.body.postTemplate);
  const interval = /** @type {string | undefined} */ (req.body.interval) ?? '1h';
  const maxPerDay = /** @type {string | number | undefined} */ (req.body.maxPerDay) ?? 5;

  if (!url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'url is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'rssAdd',
      config: {
        url, postTemplate: postTemplate || '{{title}} {{url}}',
        interval, maxPerDay: Math.min(parseInt(String(maxPerDay), 10) || 5, 20),
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'rss-add',
      config: { url, interval, maxPerDay },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/rss-check
 * Manually check RSS feed for new items
 */
router.post('/rss-check', async (req, res) => {
  const feedId = /** @type {string | undefined} */ (req.body.feedId);
  const url = /** @type {string | undefined} */ (req.body.url);

  if (!feedId && !url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'feedId or url is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'rssCheck',
      config: { feedId: feedId || null, url: url || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'rss-check',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/rss-drafts
 * Get draft posts from RSS feed items
 */
router.post('/rss-drafts', async (req, res) => {
  const feedId = /** @type {string | undefined} */ (req.body.feedId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 10;
  if (!feedId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'feedId is required' });

  try {
    const { getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const feedStatus = /** @type {QueueJob | null} */ (await getJobStatus(feedId));

    const drafts = Array.isArray(feedStatus?.result?.drafts) ? /** @type {unknown[]} */ (feedStatus.result.drafts) : [];
    return successResponse(res, {
      feedId,
      drafts: drafts.slice(0, Math.min(parseInt(String(limit), 10) || 10, 50)),
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/schedule/evergreen
 * Find evergreen (timeless) tweets to re-share
 */
router.post('/evergreen', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const minLikes = /** @type {string | number | undefined} */ (req.body.minLikes) ?? 50;
  const minAgeDays = /** @type {string | number | undefined} */ (req.body.minAgeDays) ?? 30;
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 10;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 10, 1), 30);

  try {
    const startTime = Date.now();
    const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweets = /** @type {TweetListResult} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: 200 }));

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (parseInt(String(minAgeDays), 10) || 30));

    const evergreen = (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (tweets.items || [])))
      .filter(t => {
        const ts = t.timestamp || t.createdAt;
        if (!ts) return false;
        const tweetDate = new Date(ts);
        return tweetDate < cutoffDate && (parseInt(String(t.likes), 10) || 0) >= (parseInt(String(minLikes), 10) || 50);
      })
      .sort((a, b) => (parseInt(String(b.likes), 10) || 0) - (parseInt(String(a.likes), 10) || 0))
      .slice(0, effectiveLimit)
      .map(t => ({
        id: t.id,
        text: t.text,
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        likes: parseInt(String(t.likes), 10) || 0,
        retweets: parseInt(String(t.retweets), 10) || 0,
      }));

    return successResponse(res, {
      username: cleanUsername, minLikes, minAgeDays,
      evergreenTweets: evergreen,
      count: evergreen.length,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

export default router;
