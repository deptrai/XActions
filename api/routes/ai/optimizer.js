// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Optimizer Endpoints
 *
 * Optimize tweets, suggest hashtags, predict performance, generate variations.
 *
 * @module api/routes/ai/optimizer
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

/**
 * POST /api/ai/optimizer/optimize
 * Optimize a tweet for engagement
 */
router.post('/optimize', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const goals = /** @type {string[] | undefined} */ (req.body.goals) ?? ['engagement'];
  const constraints = /** @type {Record<string, unknown> | undefined} */ (req.body.constraints) ?? {};
  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });

  const validGoals = ['engagement', 'clicks', 'replies', 'retweets', 'followers'];
  const effectiveGoals = Array.isArray(goals) ? goals.filter(g => validGoals.includes(g)) : ['engagement'];

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'optimizeTweet',
      config: { text, goals: effectiveGoals, constraints, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'optimize-tweet',
      config: { goals: effectiveGoals, textLength: text.length },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/optimizer/hashtags
 * Suggest relevant hashtags for content
 */
router.post('/hashtags', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const niche = /** @type {string | undefined} */ (req.body.niche);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 5;
  if (!text && !niche) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text or niche is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 5, 1), 20);
  const query = text || niche;

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), query, { limit: 50, filter: 'top' }));

    // Extract hashtags from top tweets
    const hashtagCounts = {};
    for (const tweet of /** @type {ScrapedTweet[]} */ (results.items || [])) {
      const tags = tweet.text?.match(/#\w+/g) || [];
      for (const tag of tags) {
        const t = tag.toLowerCase();
        hashtagCounts[t] = (hashtagCounts[t] || 0) + 1;
      }
    }

    const hashtags = Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, effectiveLimit)
      .map(([tag, count]) => ({ hashtag: tag, frequency: count, relevanceScore: count / (results.items?.length || 1) }));

    return successResponse(res, {
      query,
      hashtags,
      count: hashtags.length,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/optimizer/predict
 * Predict performance of a tweet before posting
 */
router.post('/predict', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });

  try {
    const startTime = Date.now();

    // Heuristic scoring (real implementation would use ML model)
    const score = {
      length: 0,
      hasQuestion: text.includes('?') ? 0.1 : 0,
      hasHashtags: /#\w+/.test(text) ? 0.05 : 0,
      hasEmoji: /\p{Emoji}/u.test(text) ? 0.05 : 0,
      hasMention: /@\w+/.test(text) ? 0.05 : 0,
      hasMedia: 0, // can't know without posting
      hasCTA: /click|follow|share|retweet|rt|dm|check|link in bio/i.test(text) ? 0.1 : 0,
    };

    const charLen = text.length;
    if (charLen >= 100 && charLen <= 200) score.length = 0.15;
    else if (charLen >= 50 && charLen < 100) score.length = 0.1;
    else if (charLen > 200 && charLen <= 280) score.length = 0.08;
    else score.length = 0.05;

    const totalScore = Math.min(Object.values(score).reduce((s, v) => s + v, 0), 1);
    const label = totalScore >= 0.3 ? 'high' : totalScore >= 0.15 ? 'medium' : 'low';

    let baselineAccount = null;
    if (username) {
      try {
        const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
        const tweets = /** @type {Record<string, unknown>} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), username.replace(/^@/, ''), { limit: 50 }));
        const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
        const avgLikes = items.length > 0
          ? Math.round(items.reduce((s, t) => s + (parseInt(String(t.likes), 10) || 0), 0) / items.length)
          : null;
        baselineAccount = { username, avgLikesPerTweet: avgLikes };
      } catch (_) {
    const _errMessage = _ instanceof Error ? _.message : String(_);/* optional */ 
  
  }
    }

    return successResponse(res, {
      text: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
      prediction: {
        engagementScore: parseFloat(totalScore.toFixed(3)),
        engagementLabel: label,
        factors: score,
      },
      baselineAccount,
      suggestions: [
        !text.includes('?') && 'Add a question to invite replies',
        !/#\w+/.test(text) && 'Add 1-2 relevant hashtags',
        charLen < 100 && 'Expand the tweet — sweet spot is 100-200 characters',
        charLen > 240 && 'Shorten the tweet for better performance',
      ].filter(Boolean),
    }, { durationMs: Date.now() - startTime, note: 'Heuristic prediction — actual performance may vary' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/optimizer/variations
 * Generate multiple tweet variations from a draft
 */
router.post('/variations', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const count = /** @type {string | number | undefined} */ (req.body.count) ?? 5;
  const styles = /** @type {string[] | undefined} */ (req.body.styles) ?? ['casual', 'professional', 'viral', 'concise', 'detailed'];
  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });

  const effectiveCount = Math.min(Math.max(parseInt(String(count), 10) || 5, 1), 10);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'generateVariations',
      config: {
        text, count: effectiveCount,
        styles: styles.slice(0, effectiveCount),
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'generate-variations',
      config: { count: effectiveCount, styles },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

export default router;
