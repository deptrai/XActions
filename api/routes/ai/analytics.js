// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Analytics Endpoints
 *
 * Account analytics, post performance, competitor analysis,
 * audience overlap, growth tracking, voice analysis, content generation.
 *
 * @module api/routes/ai/analytics
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
 * POST /api/ai/analytics/account
 * Full account analytics overview
 */
router.post('/account', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 10), 200);

  try {
    const startTime = Date.now();
    const { scrapeProfile, scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [profile, tweets] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
      scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername),
      scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: effectiveLimit }),
    ]));

    const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
    const followers = parseInt(String(profile.followers), 10) || 1;
    const totalLikes = items.reduce((s, t) => s + (parseInt(String(t.likes), 10) || 0), 0);
    const totalRetweets = items.reduce((s, t) => s + (parseInt(String(t.retweets), 10) || 0), 0);
    const totalReplies = items.reduce((s, t) => s + (parseInt(String(t.replies), 10) || 0), 0);
    const totalViews = items.reduce((s, t) => s + (parseInt(String(t.views), 10) || 0), 0);
    const avgEngagement = items.length > 0
      ? (((totalLikes + totalRetweets + totalReplies) / items.length) / followers * 100).toFixed(2)
      : '0';

    return successResponse(res, {
      username: cleanUsername,
      profile: {
        followers, following: parseInt(String(profile.following), 10) || 0,
        tweets: parseInt(String(profile.tweets), 10) || 0,
        verified: profile.verified || false,
        joinDate: profile.joinDate,
      },
      analytics: {
        tweetsAnalyzed: items.length,
        avgEngagementRate: `${avgEngagement}%`,
        avgLikes: items.length > 0 ? Math.round(totalLikes / items.length) : 0,
        avgRetweets: items.length > 0 ? Math.round(totalRetweets / items.length) : 0,
        avgReplies: items.length > 0 ? Math.round(totalReplies / items.length) : 0,
        avgViews: items.length > 0 ? Math.round(totalViews / items.length) : 0,
        totalEngagement: totalLikes + totalRetweets + totalReplies,
      },
      topTweet: items.length > 0
        ? items.reduce((best, t) => (parseInt(String(t.likes), 10) || 0) > (parseInt(String(best.likes), 10) || 0) ? t : best)
        : null,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/post
 * Analyze a single tweet's performance
 */
router.post('/post', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);

  if (!tweetUrl && !tweetId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });
  }

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  try {
    const startTime = Date.now();
    const { scrapeTweetDetails } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweet = /** @type {ScrapedTweet} */ (await scrapeTweetDetails((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));

    return successResponse(res, {
      tweetId: effectiveTweetId,
      text: tweet.text,
      author: tweet.author,
      createdAt: tweet.timestamp || tweet.createdAt,
      metrics: {
        likes: parseInt(String(tweet.likes), 10) || 0,
        retweets: parseInt(String(tweet.retweets), 10) || 0,
        replies: parseInt(String(tweet.replies), 10) || 0,
        views: parseInt(String(tweet.views), 10) || 0,
        quotes: parseInt(String(tweet.quotes), 10) || 0,
        bookmarks: parseInt(String(tweet.bookmarks), 10) || 0,
      },
      url: tweet.url || `https://x.com/i/status/${effectiveTweetId}`,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/creator
 * Creator monetization analytics
 */
router.post('/creator', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'getCreatorAnalytics',
      config: { username: username.replace(/^@/, '').toLowerCase(), sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'creator-analytics',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/brand-monitor
 * Monitor brand mentions and sentiment
 */
router.post('/brand-monitor', async (req, res) => {
  const brand = /** @type {string | undefined} */ (req.body.brand);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  if (!brand) return res.status(400).json({ error: 'INVALID_INPUT', message: 'brand is required' });

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 10), 500);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [topResults, latestResults] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
      searchTweets((/** @type {string} */ (req.sessionCookie)), brand, { limit: Math.floor(effectiveLimit / 2), filter: 'top' }),
      searchTweets((/** @type {string} */ (req.sessionCookie)), brand, { limit: Math.ceil(effectiveLimit / 2), filter: 'latest' }),
    ]));

    const all = [...(/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (topResults.items || []))), ...(/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (latestResults.items || [])))];
    const positive = all.filter(t => /great|love|amazing|best|thanks|awesome|excellent/i.test(t.text || '')).length;
    const negative = all.filter(t => /hate|worst|terrible|bad|awful|scam|awful|broken/i.test(t.text || '')).length;

    return successResponse(res, {
      brand,
      mentions: {
        total: all.length,
        positive, negative, neutral: all.length - positive - negative,
        sentimentScore: all.length > 0 ? ((positive - negative) / all.length).toFixed(3) : '0',
      },
      recentMentions: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (latestResults.items || []))).slice(0, 10).map(t => ({
        text: t.text,
        author: t.author?.username || t.username,
        likes: parseInt(String(t.likes), 10) || 0,
        url: t.url,
        createdAt: t.timestamp,
      })),
      topMentions: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (topResults.items || []))).slice(0, 5).map(t => ({
        text: t.text,
        author: t.author?.username || t.username,
        likes: parseInt(String(t.likes), 10) || 0,
        url: t.url,
      })),
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/competitor
 * Analyze competitor accounts
 */
router.post('/competitor', async (req, res) => {
  const handles = /** @type {string[] | undefined} */ (req.body.handles);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;

  if (!Array.isArray(handles) || handles.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'handles array is required' });
  }

  const targets = handles.slice(0, 5).map(h => h.replace(/^@/, '').toLowerCase());
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 10), 100);

  try {
    const startTime = Date.now();
    const { scrapeProfile, scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));

    const results = await Promise.allSettled(
      targets.map(async handle => {
        const [profile, tweets] = /** @type {[Record<string, unknown>, Record<string, unknown>]} */ (await Promise.all([
          scrapeProfile((/** @type {string} */ (req.sessionCookie)), handle),
          scrapeTweets((/** @type {string} */ (req.sessionCookie)), handle, { limit: effectiveLimit }),
        ]));
        const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
        const followers = parseInt(String(profile.followers), 10) || 1;
        const totalLikes = items.reduce((s, t) => s + (parseInt(String(t.likes), 10) || 0), 0);
        return {
          handle,
          followers,
          following: parseInt(String(profile.following), 10) || 0,
          verified: profile.verified || false,
          avgLikes: items.length > 0 ? Math.round(totalLikes / items.length) : 0,
          engagementRate: items.length > 0
            ? (totalLikes / items.length / followers * 100).toFixed(2)
            : '0',
          tweetsAnalyzed: items.length,
          topTweet: items.length > 0
            ? items.reduce((b, t) => (parseInt(String(t.likes), 10) || 0) > (parseInt(String(b.likes), 10) || 0) ? t : b)
            : null,
        };
      })
    );

    return successResponse(res, {
      competitors: results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { handle: targets[i], error: r.reason?.message }
      ),
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/audience-overlap
 * Find overlap between two accounts' audiences
 */
router.post('/audience-overlap', async (req, res) => {
  const username1 = /** @type {string | undefined} */ (req.body.username1);
  const username2 = /** @type {string | undefined} */ (req.body.username2);
  const sampleSize = /** @type {string | number | undefined} */ (req.body.sampleSize) ?? 200;

  if (!username1 || !username2) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'username1 and username2 are required' });
  }

  const u1 = username1.replace(/^@/, '').toLowerCase();
  const u2 = username2.replace(/^@/, '').toLowerCase();
  const effectiveSample = Math.min(Math.max(parseInt(String(sampleSize), 10) || 200, 50), 500);

  try {
    const startTime = Date.now();
    const { scrapeFollowers } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const [followers1, followers2] = /** @type {[UserListResult, UserListResult]} */ (await Promise.all([
      scrapeFollowers((/** @type {string} */ (req.sessionCookie)), u1, { limit: effectiveSample }),
      scrapeFollowers((/** @type {string} */ (req.sessionCookie)), u2, { limit: effectiveSample }),
    ]));

    const set1 = new Set((followers1.users || []).map(u => u.username?.toLowerCase()));
    const set2 = new Set((followers2.users || []).map(u => u.username?.toLowerCase()));
    const overlap = [...set1].filter(u => set2.has(u));
    const overlapPct = set1.size > 0 ? (overlap.length / set1.size * 100).toFixed(1) : '0';

    return successResponse(res, {
      username1: u1, username2: u2,
      overlap: {
        count: overlap.length,
        percentage: `${overlapPct}%`,
        sample: overlap.slice(0, 20),
      },
      audiences: {
        [u1]: { sampled: set1.size },
        [u2]: { sampled: set2.size },
      },
    }, { durationMs: Date.now() - startTime, sampleSize: effectiveSample });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/history
 * Get historical analytics snapshots
 */
router.post('/history', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 30;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'getAnalyticsHistory',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        limit: Math.min(parseInt(String(limit), 10) || 30, 90),
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'analytics-history',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/snapshot
 * Take a follower/engagement snapshot for comparison later
 */
router.post('/snapshot', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();

  try {
    const startTime = Date.now();
    const { scrapeProfile } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const profile = /** @type {ScrapedProfile} */ (await scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername));

    const snapshot = {
      username: cleanUsername,
      takenAt: new Date().toISOString(),
      followers: parseInt(String(profile.followers), 10) || 0,
      following: parseInt(String(profile.following), 10) || 0,
      tweets: parseInt(String(profile.tweets), 10) || 0,
      verified: profile.verified || false,
    };

    // Store snapshot via job queue for persistence
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    const operationId = generateOperationId();
    await queueJob({
      id: operationId,
      type: 'storeSnapshot',
      config: { snapshot, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, { snapshot, operationId }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/growth-rate
 * Compute follower growth rate between two snapshots
 */
router.post('/growth-rate', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const period = /** @type {string | undefined} */ (req.body.period) ?? '7d';
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'computeGrowthRate',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        period,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'growth-rate',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/compare-accounts
 * Compare metrics across multiple accounts
 */
router.post('/compare-accounts', async (req, res) => {
  const usernames = /** @type {string[] | undefined} */ (req.body.usernames);
  const metrics = /** @type {string[] | undefined} */ (req.body.metrics) ?? ['followers', 'engagement'];

  if (!Array.isArray(usernames) || usernames.length < 2) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array with at least 2 entries is required' });
  }

  const targets = usernames.slice(0, 5).map(u => u.replace(/^@/, '').toLowerCase());

  try {
    const startTime = Date.now();
    const { scrapeProfile } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));

    const results = /** @type {Array<PromiseFulfilledResult<ScrapedProfile> | PromiseRejectedResult>} */ (await Promise.allSettled(
      targets.map(u => scrapeProfile((/** @type {string} */ (req.sessionCookie)), u))
    ));

    return successResponse(res, {
      accounts: results.map((r, i) => ({
        username: targets[i],
        ...(r.status === 'fulfilled' ? {
          followers: parseInt(String(r.value.followers), 10) || 0,
          following: parseInt(String(r.value.following), 10) || 0,
          tweets: parseInt(String(r.value.tweets), 10) || 0,
          verified: r.value.verified || false,
        } : { error: r.reason?.message }),
      })),
      metrics,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/analyze-voice
 * Analyze writing voice from a user's tweets
 */
router.post('/analyze-voice', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 20), 100);

  try {
    const startTime = Date.now();
    const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweets = /** @type {TweetListResult} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: effectiveLimit }));

    const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
    const texts = items.filter(t => !t.isRetweet).map(t => t.text).filter((t) => typeof t === 'string');

    const wordCount = texts.reduce((s, t) => s + t.split(/\s+/).length, 0);
    const avgLength = texts.length > 0 ? Math.round(wordCount / texts.length) : 0;
    const emojiRegex = /\p{Emoji}/u;
    const emojiFreq = texts.filter(t => emojiRegex.test(t)).length / Math.max(texts.length, 1);
    const questionFreq = texts.filter(t => t.includes('?')).length / Math.max(texts.length, 1);
    const exclamationFreq = texts.filter(t => t.includes('!')).length / Math.max(texts.length, 1);

    const voiceProfile = {
      username: cleanUsername,
      analyzedTweets: texts.length,
      style: {
        avgTweetLength: avgLength,
        usesEmojis: emojiFreq > 0.3,
        emojiFrequency: Math.round(emojiFreq * 100),
        asksQuestions: questionFreq > 0.2,
        usesExclamations: exclamationFreq > 0.2,
        tone: emojiFreq > 0.5 ? 'casual' : questionFreq > 0.3 ? 'inquisitive' : 'informative',
      },
      sampleTweets: texts.slice(0, 5),
    };

    return successResponse(res, voiceProfile, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/generate-tweet
 * Generate a tweet in a user's voice
 */
router.post('/generate-tweet', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const topic = /** @type {string | undefined} */ (req.body.topic);
  const style = /** @type {string | undefined} */ (req.body.style);
  const count = /** @type {string | number | undefined} */ (req.body.count) ?? 3;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });
  if (!topic) return res.status(400).json({ error: 'INVALID_INPUT', message: 'topic is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'generateTweet',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        topic, style: style || null,
        count: Math.min(parseInt(String(count), 10) || 3, 10),
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'generate-tweet',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/rewrite-tweet
 * Rewrite/improve an existing tweet
 */
router.post('/rewrite-tweet', async (req, res) => {
  const text = /** @type {string | undefined} */ (req.body.text);
  const goal = /** @type {string | undefined} */ (req.body.goal) ?? 'improve';
  const style = /** @type {string | undefined} */ (req.body.style);
  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });

  const validGoals = ['improve', 'shorter', 'longer', 'more-engaging', 'professional', 'casual'];
  const effectiveGoal = validGoals.includes(goal) ? goal : 'improve';

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'rewriteTweet',
      config: { text, goal: effectiveGoal, style: style || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'rewrite-tweet',
      config: { goal: effectiveGoal },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/summarize-thread
 * Summarize a thread into key points
 */
router.post('/summarize-thread', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'bullets';
  if (!tweetUrl && !tweetId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  try {
    const startTime = Date.now();
    const { scrapeThread } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const thread = /** @type {ThreadResult} */ (await scrapeThread((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));

    const tweets = thread.tweets || [];
    const fullText = tweets.map(t => t.text).join('\n\n');

    // Basic extractive summary (real implementation would use LLM)
    const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const keyPoints = sentences.slice(0, 5).map(s => s.trim());

    return successResponse(res, {
      tweetId: effectiveTweetId,
      author: thread.author,
      tweetCount: tweets.length,
      summary: {
        format,
        keyPoints,
        fullText: format === 'full' ? fullText : undefined,
        bullets: format === 'bullets' ? keyPoints.map(p => `• ${p}`) : undefined,
      },
    }, { durationMs: Date.now() - startTime, note: 'Basic extractive summary — use writer/analyze-voice for LLM-enhanced version' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analytics/best-time
 * Find the best time to post based on audience engagement
 */
router.post('/best-time', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 20), 200);

  try {
    const startTime = Date.now();
    const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweets = /** @type {TweetListResult} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: effectiveLimit }));

    const items = /** @type {ScrapedTweet[]} */ (tweets.items || []);
    const hourlyEngagement = Array.from({ length: 24 }, (_, h) => ({ hour: h, totalEngagement: 0, count: 0 }));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dailyEngagement = Array.from({ length: 7 }, (_, d) => ({ day: d, name: dayNames[d], totalEngagement: 0, count: 0 }));

    for (const tweet of items) {
      const ts = tweet.timestamp || tweet.createdAt;
      if (!ts) continue;
      const date = new Date(ts);
      if (isNaN(date.getTime())) continue;
      const engagement = (parseInt(String(tweet.likes), 10) || 0) + (parseInt(String(tweet.retweets), 10) || 0) + (parseInt(String(tweet.replies), 10) || 0);
      const h = date.getUTCHours();
      const d = date.getUTCDay();
      hourlyEngagement[h].totalEngagement += engagement;
      hourlyEngagement[h].count++;
      dailyEngagement[d].totalEngagement += engagement;
      dailyEngagement[d].count++;
    }

    const hourlyAvg = hourlyEngagement.map(h => ({
      ...h,
      avgEngagement: h.count > 0 ? Math.round(h.totalEngagement / h.count) : 0,
    })).sort((a, b) => b.avgEngagement - a.avgEngagement);

    const dailyAvg = dailyEngagement.map(d => ({
      ...d,
      avgEngagement: d.count > 0 ? Math.round(d.totalEngagement / d.count) : 0,
    })).sort((a, b) => b.avgEngagement - a.avgEngagement);

    return successResponse(res, {
      username: cleanUsername,
      tweetsAnalyzed: items.length,
      bestTimes: {
        byHour: hourlyAvg.slice(0, 5).map(h => ({ hour: `${h.hour}:00 UTC`, avgEngagement: h.avgEngagement })),
        byDay: dailyAvg.slice(0, 3).map(d => ({ day: d.name, avgEngagement: d.avgEngagement })),
      },
      recommendation: hourlyAvg[0] ? `Post around ${hourlyAvg[0].hour}:00 UTC on ${dailyAvg[0]?.name}s for best engagement` : 'Insufficient data',
    }, { durationMs: Date.now() - startTime, timezone: 'UTC' });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

export default router;
