// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Sentiment & Reputation Endpoints
 *
 * Sentiment analysis, reputation monitoring, reputation reports.
 *
 * @module api/routes/ai/sentiment
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

// Session middleware
router.use((req, res, next) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!sessionCookie) {
    return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'Session cookie is required' });
  }
  req.sessionCookie = sessionCookie;
  next();
});

// Simple rule-based sentiment scorer
function scoreSentiment(text) {
  const t = text.toLowerCase();
  const positive = ['great', 'love', 'amazing', 'excellent', 'best', 'awesome', 'good', 'thanks', 'happy', 'win', '🔥', '❤️', '✅', '💯', '🎉', '🙌'];
  const negative = ['hate', 'worst', 'terrible', 'awful', 'bad', 'broken', 'scam', 'fail', 'wrong', 'stupid', 'dumb', '💀', '🤬', '😡', '❌'];
  let score = 0;
  for (const w of positive) if (t.includes(w)) score += 0.1;
  for (const w of negative) if (t.includes(w)) score -= 0.1;
  return Math.max(-1, Math.min(1, score));
}

function labelScore(score) {
  if (score > 0.1) return 'positive';
  if (score < -0.1) return 'negative';
  return 'neutral';
}

/**
 * POST /api/ai/sentiment/analyze
 * Analyze sentiment of text(s) or tweets from a search
 */
router.post('/analyze', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const texts = /** @type {string | undefined} */ (req.body.texts);
  const query = /** @type {string | undefined} */ (req.body.query);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const mode = /** @type {string | undefined} */ (req.body.mode) ?? 'rule';

  // Mode 1: analyze provided text(s)
  if (text || texts) {
    const items = texts || [text];
    const startTime = Date.now();
    const analyzed = items.map(t => {
      const score = scoreSentiment(t);
      return { text: t, score: parseFloat(score.toFixed(3)), label: labelScore(score) };
    });

    const avgScore = analyzed.reduce((s, a) => s + a.score, 0) / analyzed.length;

    return successResponse(res, {
      mode: 'text',
      analyzed,
      summary: {
        avgScore: parseFloat(avgScore.toFixed(3)),
        label: labelScore(avgScore),
        positive: analyzed.filter(a => a.label === 'positive').length,
        neutral: analyzed.filter(a => a.label === 'neutral').length,
        negative: analyzed.filter(a => a.label === 'negative').length,
      },
    }, { durationMs: Date.now() - startTime });
  }

  // Mode 2: search Twitter and analyze results
  if (query) {
    const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 10), 200);
    try {
      const startTime = Date.now();
      const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
      const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), query, { limit: effectiveLimit, filter: 'latest' }));

      const analyzed = (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        text: t.text,
        author: t.author?.username || t.username,
        score: parseFloat(scoreSentiment(t.text).toFixed(3)),
        label: labelScore(scoreSentiment(t.text)),
        likes: parseInt(String(t.likes), 10) || 0,
      }));

      const avgScore = analyzed.length > 0
        ? analyzed.reduce((s, a) => s + a.score, 0) / analyzed.length
        : 0;

      return successResponse(res, {
        mode: 'query', query,
        summary: {
          avgScore: parseFloat(avgScore.toFixed(3)),
          label: labelScore(avgScore),
          positive: analyzed.filter(a => a.label === 'positive').length,
          neutral: analyzed.filter(a => a.label === 'neutral').length,
          negative: analyzed.filter(a => a.label === 'negative').length,
          total: analyzed.length,
        },
        tweets: analyzed,
      }, { durationMs: Date.now() - startTime });
    } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
    
  
  }
  }

  return res.status(400).json({
    error: 'INVALID_INPUT',
    message: 'Provide text, texts array, or query to analyze',
    schema: {
      text: { type: 'string', description: 'Single text to analyze' },
      texts: { type: 'array', items: 'string', description: 'Multiple texts to analyze' },
      query: { type: 'string', description: 'Search query — will fetch and analyze tweets' },
      limit: { type: 'number', default: 50, description: 'Max tweets to fetch (query mode)' },
    },
  });
});

/**
 * POST /api/ai/sentiment/monitor
 * Start/stop/list reputation monitoring
 */
router.post('/monitor', async (req, res) => {
  const action = /** @type {string | undefined} */ (req.body.action) ?? 'start';
  const username = /** @type {string | undefined} */ (req.body.username);
  const monitorId = /** @type {string | undefined} */ (req.body.monitorId);
  const interval = /** @type {string | undefined} */ (req.body.interval) ?? '1h';

  const validActions = ['start', 'stop', 'list', 'status'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `action must be one of: ${validActions.join(', ')}` });
  }

  try {
    const { queueJob, cancelJob, getRecentJobs, getJobStatus } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));

    if (action === 'list') {
      const jobs = /** @type {Record<string, unknown>[]} */ (await getRecentJobs({ type: 'reputationMonitor', limit: 20 }));
      return successResponse(res, {
        monitors: jobs.map(j => ({ monitorId: j.id, username: j.config?.username, status: j.status, createdAt: j.createdAt })),
      });
    }

    if (action === 'status' && monitorId) {
      const status = /** @type {Record<string, unknown>} */ (await getJobStatus(monitorId));
      return successResponse(res, { monitorId, status: status?.status || 'not_found', result: status?.result });
    }

    if (action === 'stop' && monitorId) {
      await cancelJob(monitorId);
      return successResponse(res, { monitorId, status: 'cancelled' });
    }

    // action === 'start'
    if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required to start monitoring' });

    const operationId = generateOperationId();
    await queueJob({
      id: operationId,
      type: 'reputationMonitor',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        interval,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      monitorId: operationId,
      status: 'started',
      username: username.replace(/^@/, '').toLowerCase(),
      interval,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 60000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/sentiment/report
 * Generate a full reputation report for a username
 */
router.post('/report', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 20), 300);

  try {
    const startTime = Date.now();
    const { scrapeProfile, searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [profile, mentions] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
      scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername),
      searchTweets((/** @type {string} */ (req.sessionCookie)), `@${cleanUsername}`, { limit: effectiveLimit, filter: 'latest' }),
    ]));

    const items = /** @type {ScrapedTweet[]} */ (mentions.items || []);
    const scored = items.map(t => ({
      text: t.text,
      author: t.author?.username || t.username,
      score: scoreSentiment(t.text),
      likes: parseInt(String(t.likes), 10) || 0,
      url: t.url,
    }));

    const avgScore = scored.length > 0
      ? scored.reduce((s, t) => s + t.score, 0) / scored.length
      : 0;

    const positive = scored.filter(t => t.score > 0.1);
    const negative = scored.filter(t => t.score < -0.1);

    return successResponse(res, {
      username: cleanUsername,
      profile: {
        followers: parseInt(String(profile.followers), 10) || 0,
        verified: profile.verified || false,
        bio: profile.bio,
      },
      reputation: {
        overallScore: parseFloat(avgScore.toFixed(3)),
        label: labelScore(avgScore),
        mentionsAnalyzed: scored.length,
        positive: positive.length,
        negative: negative.length,
        neutral: scored.length - positive.length - negative.length,
      },
      highlights: {
        mostPositive: positive.sort((a, b) => b.likes - a.likes).slice(0, 3),
        mostNegative: negative.sort((a, b) => b.likes - a.likes).slice(0, 3),
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

export default router;
