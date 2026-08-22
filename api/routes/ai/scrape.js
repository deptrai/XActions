// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Scraping Endpoints
 * 
 * Structured data extraction from X/Twitter.
 * All responses follow consistent JSON schema.
 * 
 * @module api/routes/ai/scrape
 */

import express from 'express';

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


// Require session cookie for all scraping
router.use(async (req, res, next) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  
  if (!sessionCookie) {
    return res.status(400).json({
      error: 'SESSION_REQUIRED',
      code: 'E_SESSION_MISSING',
      message: 'X/Twitter session cookie is required for scraping',
      hint: 'Include sessionCookie in request body or X-Session-Cookie header',
      docs: 'https://xactions.app/docs/ai-api#authentication',
      example: {
        body: { sessionCookie: 'your_auth_token_here', username: 'elonmusk' },
        header: { 'X-Session-Cookie': 'your_auth_token_here' },
      },
    });
  }
  
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * Helper: Create consistent error response
 */
/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} error
 * @param {string} message
 * @param {Record<string, unknown> & { retryable?: boolean; retryAfterMs?: number }} [extras]
 */
const errorResponse = (res, statusCode, error, message, extras = {}) => {
  return res.status(statusCode).json({
    success: false,
    error,
    message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });
};

/**
 * Helper: Create consistent success response
 */
/**
 * @param {import('express').Response} res
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [meta]
 */
const successResponse = (res, data, meta = {}) => {
  return res.json({
    success: true,
    data,
    meta: {
      scrapedAt: new Date().toISOString(),
      source: 'x.com',
      ...meta,
    },
  });
};

/**
 * POST /api/ai/scrape/profile
 * Get profile information for a username
 */
router.post('/profile', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true, example: 'elonmusk' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  
  try {
    const startTime = Date.now();
    
    // Dynamic import to handle potential module issues
    const { scrapeProfile } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const profile = /** @type {Record<string, unknown>} */ (await scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername));
    
    return successResponse(res, {
      username: profile.username,
      displayName: profile.name,
      bio: profile.bio,
      location: profile.location,
      website: profile.website,
      joinDate: profile.joinDate,
      followersCount: parseInt(String(profile.followers), 10) || 0,
      followingCount: parseInt(String(profile.following), 10) || 0,
      tweetsCount: parseInt(String(profile.tweets), 10) || 0,
      verified: profile.verified || false,
      protected: profile.protected || false,
      profileImageUrl: profile.profileImage,
      bannerImageUrl: profile.bannerImage,
    }, {
      durationMs: Date.now() - startTime,
      requestedUsername: cleanUsername,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Profile scrape error:', error);
    
    if (_errMessage?.includes('not found') || _errMessage?.includes('404')) {
      return errorResponse(res, 404, 'USER_NOT_FOUND', `User @${cleanUsername} not found`, {
        retryable: false,
      });
    }
    
    if (_errMessage?.includes('suspended')) {
      return errorResponse(res, 410, 'USER_SUSPENDED', `User @${cleanUsername} is suspended`, {
        retryable: false,
      });
    }
    
    if (_errMessage?.includes('rate limit')) {
      return errorResponse(res, 429, 'RATE_LIMITED', 'Rate limited by X/Twitter', {
        retryAfterMs: 60000,
      });
    }
    
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/followers
 * Get follower list for a username
 */
router.post('/followers', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true, example: 'elonmusk' },
        limit: { type: 'number', default: 100, min: 1, max: 1000 },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 1000);
  
  try {
    const startTime = Date.now();
    
    const { scrapeFollowers } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const followers = /** @type {Record<string, unknown>} */ (await scrapeFollowers((/** @type {string} */ (req.sessionCookie)), cleanUsername, { 
      limit: effectiveLimit,
      cursor,
    }));
    
    return successResponse(res, {
      username: cleanUsername,
      followers: (followers.users || []).map(u => ({
        username: u.username,
        displayName: u.name || u.displayName,
        bio: u.bio || null,
        followsYou: u.followsYou || false,
        verified: u.verified || false,
        followersCount: parseInt(String(u.followers), 10) || null,
        profileImageUrl: u.profileImage || null,
      })),
      pagination: {
        count: (followers.users || []).length,
        limit: effectiveLimit,
        nextCursor: followers.nextCursor || null,
        hasMore: !!followers.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Followers scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/following
 * Get following list for a username
 */
router.post('/following', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true },
        limit: { type: 'number', default: 100, max: 1000 },
        cursor: { type: 'string' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 1000);
  
  try {
    const startTime = Date.now();
    
    const { scrapeFollowing } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const following = /** @type {Record<string, unknown>} */ (await scrapeFollowing((/** @type {string} */ (req.sessionCookie)), cleanUsername, {
      limit: effectiveLimit,
      cursor,
    }));
    
    return successResponse(res, {
      username: cleanUsername,
      following: (following.users || []).map(u => ({
        username: u.username,
        displayName: u.name || u.displayName,
        bio: u.bio || null,
        followsBack: u.followsBack || false,
        verified: u.verified || false,
        followersCount: parseInt(String(u.followers), 10) || null,
        profileImageUrl: u.profileImage || null,
      })),
      pagination: {
        count: (following.users || []).length,
        limit: effectiveLimit,
        nextCursor: following.nextCursor || null,
        hasMore: !!following.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Following scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/tweets
 * Get tweets from a user's profile
 */
router.post('/tweets', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const includeReplies = /** @type {boolean | undefined} */ (req.body.includeReplies) ?? false;
  const includeRetweets = /** @type {boolean | undefined} */ (req.body.includeRetweets) ?? true;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true },
        limit: { type: 'number', default: 50, max: 200 },
        includeReplies: { type: 'boolean', default: false },
        includeRetweets: { type: 'boolean', default: true },
        cursor: { type: 'string' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  
  try {
    const startTime = Date.now();
    
    const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweets = /** @type {Record<string, unknown>} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, {
      limit: effectiveLimit,
      includeReplies,
      includeRetweets,
      cursor,
    }));
    
    return successResponse(res, {
      username: cleanUsername,
      tweets: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (tweets.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        createdAt: t.timestamp || t.createdAt,
        url: t.url || `https://x.com/${cleanUsername}/status/${t.id}`,
        metrics: {
          likes: parseInt(String(t.likes), 10) || 0,
          retweets: parseInt(String(t.retweets), 10) || 0,
          replies: parseInt(String(t.replies), 10) || 0,
          views: parseInt(String(t.views), 10) || 0,
          quotes: parseInt(String(t.quotes), 10) || 0,
          bookmarks: parseInt(String(t.bookmarks), 10) || 0,
        },
        media: (t.media || []).map(m => ({
          type: m.type,
          url: m.url,
          thumbnailUrl: m.thumbnail,
        })),
        isReply: t.isReply || false,
        isRetweet: t.isRetweet || false,
        isQuote: t.isQuote || false,
        replyToUser: t.replyToUser || null,
        quotedTweetId: t.quotedTweetId || null,
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (tweets.items || []))).length,
        limit: effectiveLimit,
        nextCursor: tweets.nextCursor || null,
        hasMore: !!tweets.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
      filters: { includeReplies, includeRetweets },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Tweets scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/search
 * Search tweets by query
 */
router.post('/search', async (req, res) => {
  const query = /** @type {string | undefined} */ (req.body.query);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const filter = /** @type {string | undefined} */ (req.body.filter) ?? 'latest';
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!query) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_QUERY',
      message: 'query is required',
      schema: {
        query: { type: 'string', required: true, example: 'bitcoin', maxLength: 500 },
        limit: { type: 'number', default: 50, max: 200 },
        filter: { type: 'string', enum: ['latest', 'top', 'people', 'media', 'lists'], default: 'latest' },
        cursor: { type: 'string' },
      },
      examples: {
        simple: { query: 'bitcoin' },
        fromUser: { query: 'from:elonmusk crypto' },
        hashtag: { query: '#ai #machinelearning' },
        advanced: { query: 'from:naval min_faves:100 -filter:replies' },
      },
    });
  }
  
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  const validFilters = ['latest', 'top', 'people', 'media', 'lists'];
  const effectiveFilter = validFilters.includes(filter) ? filter : 'latest';
  
  try {
    const startTime = Date.now();
    
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), query, {
      limit: effectiveLimit,
      filter: effectiveFilter,
      cursor,
    }));
    
    return successResponse(res, {
      query,
      filter: effectiveFilter,
      results: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        author: {
          username: t.author?.username || t.username,
          displayName: t.author?.name || t.authorName,
          verified: t.author?.verified || false,
          profileImageUrl: t.author?.profileImage || null,
        },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: {
          likes: parseInt(String(t.likes), 10) || 0,
          retweets: parseInt(String(t.retweets), 10) || 0,
          replies: parseInt(String(t.replies), 10) || 0,
          views: parseInt(String(t.views), 10) || 0,
        },
        media: t.media || [],
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length,
        limit: effectiveLimit,
        nextCursor: results.nextCursor || null,
        hasMore: !!results.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Search scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/thread
 * Get full thread/conversation
 */
router.post('/thread', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
      schema: {
        tweetUrl: { type: 'string', example: 'https://x.com/naval/status/1234567890' },
        tweetId: { type: 'string', example: '1234567890' },
      },
    });
  }
  
  // Extract tweet ID from URL if provided
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) {
      effectiveTweetId = match[1];
    }
  }
  
  if (!effectiveTweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_INVALID_TWEET_URL',
      message: 'Could not extract tweet ID from provided URL',
    });
  }
  
  try {
    const startTime = Date.now();
    
    const { scrapeThread } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const thread = /** @type {Record<string, unknown>} */ (await scrapeThread((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));
    
    return successResponse(res, {
      originalTweetId: effectiveTweetId,
      author: {
        username: thread.author?.username,
        displayName: thread.author?.name,
        verified: thread.author?.verified || false,
        profileImageUrl: thread.author?.profileImage,
      },
      tweets: (thread.tweets || []).map((t, i) => ({
        position: i + 1,
        id: t.id,
        text: t.text,
        createdAt: t.timestamp || t.createdAt,
        metrics: {
          likes: parseInt(String(t.likes), 10) || 0,
          retweets: parseInt(String(t.retweets), 10) || 0,
          replies: parseInt(String(t.replies), 10) || 0,
        },
        media: t.media || [],
      })),
      totalTweets: (thread.tweets || []).length,
      threadText: (thread.tweets || []).map(t => t.text).join('\n\n---\n\n'),
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Thread scrape error:', error);
    
    if (_errMessage?.includes('not found')) {
      return errorResponse(res, 404, 'TWEET_NOT_FOUND', 'Tweet not found', { retryable: false });
    }
    
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/hashtag
 * Get tweets for a hashtag
 */
router.post('/hashtag', async (req, res) => {
  const hashtag = /** @type {string | undefined} */ (req.body.hashtag);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const filter = /** @type {string | undefined} */ (req.body.filter) ?? 'latest';
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!hashtag) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_HASHTAG',
      message: 'hashtag is required (with or without #)',
      schema: {
        hashtag: { type: 'string', required: true, example: 'bitcoin' },
        limit: { type: 'number', default: 50, max: 200 },
        filter: { type: 'string', enum: ['latest', 'top'], default: 'latest' },
        cursor: { type: 'string' },
      },
    });
  }
  
  // Normalize hashtag (remove # if present)
  const cleanHashtag = hashtag.replace(/^#/, '');
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  
  try {
    const startTime = Date.now();
    
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), `#${cleanHashtag}`, {
      limit: effectiveLimit,
      filter: filter === 'top' ? 'top' : 'latest',
      cursor,
    }));
    
    return successResponse(res, {
      hashtag: cleanHashtag,
      filter,
      tweets: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        author: {
          username: t.author?.username || t.username,
          displayName: t.author?.name || t.authorName,
          verified: t.author?.verified || false,
        },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: {
          likes: parseInt(String(t.likes), 10) || 0,
          retweets: parseInt(String(t.retweets), 10) || 0,
          replies: parseInt(String(t.replies), 10) || 0,
        },
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length,
        limit: effectiveLimit,
        nextCursor: results.nextCursor || null,
        hasMore: !!results.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Hashtag scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/media
 * Get media (images/videos) from a profile
 */
router.post('/media', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const type = /** @type {string | undefined} */ (req.body.type) ?? 'all';
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true },
        limit: { type: 'number', default: 50, max: 100 },
        type: { type: 'string', enum: ['all', 'images', 'videos'], default: 'all' },
        cursor: { type: 'string' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
  
  try {
    const startTime = Date.now();
    
    const { scrapeMedia } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const media = /** @type {Record<string, unknown>} */ (await scrapeMedia((/** @type {string} */ (req.sessionCookie)), cleanUsername, {
      limit: effectiveLimit,
      type,
      cursor,
    }));
    
    return successResponse(res, {
      username: cleanUsername,
      media: (/** @type {ScrapedMedia[]} */ (/** @type {ScrapedMedia[]} */ (media.items || []))).map(m => ({
        type: m.type, // 'image' or 'video'
        url: m.url,
        thumbnailUrl: m.thumbnail,
        tweetId: m.tweetId,
        tweetUrl: m.tweetUrl || `https://x.com/${cleanUsername}/status/${m.tweetId}`,
        createdAt: m.timestamp,
        dimensions: m.dimensions || null,
        duration: m.type === 'video' ? m.duration : null,
      })),
      pagination: {
        count: (/** @type {ScrapedMedia[]} */ (/** @type {ScrapedMedia[]} */ (media.items || []))).length,
        limit: effectiveLimit,
        nextCursor: media.nextCursor || null,
        hasMore: !!media.nextCursor,
      },
      summary: {
        images: (/** @type {ScrapedMedia[]} */ (/** @type {ScrapedMedia[]} */ (media.items || []))).filter(m => m.type === 'image').length,
        videos: (/** @type {ScrapedMedia[]} */ (/** @type {ScrapedMedia[]} */ (media.items || []))).filter(m => m.type === 'video').length,
      },
    }, {
      durationMs: Date.now() - startTime,
      filterType: type,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Media scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/likes
 * Get users who liked a tweet
 */
router.post('/likes', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
    });
  }
  
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }
  
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 500);
  
  try {
    const startTime = Date.now();
    
    const { scrapeTweetLikes } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const likers = /** @type {Record<string, unknown>} */ (await scrapeTweetLikes((/** @type {string} */ (req.sessionCookie)), effectiveTweetId, {
      limit: effectiveLimit,
      cursor,
    }));
    
    return successResponse(res, {
      tweetId: effectiveTweetId,
      likers: (likers.users || []).map(u => ({
        username: u.username,
        displayName: u.name || u.displayName,
        bio: u.bio || null,
        verified: u.verified || false,
        followersCount: parseInt(String(u.followers), 10) || null,
      })),
      pagination: {
        count: (likers.users || []).length,
        limit: effectiveLimit,
        nextCursor: likers.nextCursor || null,
        hasMore: !!likers.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Likes scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/retweets
 * Get users who retweeted a tweet
 */
router.post('/retweets', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
    });
  }
  
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }
  
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 500);
  
  try {
    const startTime = Date.now();
    
    const { scrapeTweetRetweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const retweeters = /** @type {Record<string, unknown>} */ (await scrapeTweetRetweets((/** @type {string} */ (req.sessionCookie)), effectiveTweetId, {
      limit: effectiveLimit,
      cursor,
    }));
    
    return successResponse(res, {
      tweetId: effectiveTweetId,
      retweeters: (retweeters.users || []).map(u => ({
        username: u.username,
        displayName: u.name || u.displayName,
        bio: u.bio || null,
        verified: u.verified || false,
        followersCount: parseInt(String(u.followers), 10) || null,
      })),
      pagination: {
        count: (retweeters.users || []).length,
        limit: effectiveLimit,
        nextCursor: retweeters.nextCursor || null,
        hasMore: !!retweeters.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Retweets scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/replies
 * Get replies to a tweet (search-based)
 */
router.post('/replies', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);

  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
    });
  }

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const startTime = Date.now();
    const { scrapeThread } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const thread = /** @type {Record<string, unknown>} */ (await scrapeThread((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));

    const replies = (thread.tweets || [])
      .filter(t => t.id !== effectiveTweetId)
      .slice(0, effectiveLimit)
      .map(t => ({
        id: t.id,
        text: t.text,
        author: { username: t.author?.username || t.username, displayName: t.author?.name },
        createdAt: t.timestamp || t.createdAt,
        metrics: {
          likes: parseInt(String(t.likes), 10) || 0,
          retweets: parseInt(String(t.retweets), 10) || 0,
          replies: parseInt(String(t.replies), 10) || 0,
        },
      }));

    return successResponse(res, {
      tweetId: effectiveTweetId,
      replies,
      pagination: { count: replies.length, limit: effectiveLimit },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Replies scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/quote-tweets
 * Get quote tweets for a tweet
 */
router.post('/quote-tweets', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);

  if (!tweetUrl && !tweetId) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetUrl or tweetId is required' });
  }

  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }

  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), `quoted_tweet_id:${effectiveTweetId}`, {
      limit: effectiveLimit,
      filter: 'latest',
      cursor,
    }));

    return successResponse(res, {
      tweetId: effectiveTweetId,
      quoteTweets: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        author: {
          username: t.author?.username || t.username,
          displayName: t.author?.name,
          verified: t.author?.verified || false,
        },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: { likes: parseInt(String(t.likes), 10) || 0, retweets: parseInt(String(t.retweets), 10) || 0 },
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length,
        limit: effectiveLimit,
        nextCursor: results.nextCursor || null,
        hasMore: !!results.nextCursor,
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Quote tweets scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/user-likes
 * Get tweets a user has liked
 */
router.post('/user-likes', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const cursor = /** @type {string | undefined} */ (req.body.cursor);

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const startTime = Date.now();
    const { scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    // Likes tab scraped via profile likes tab
    const tweets = /** @type {Record<string, unknown>} */ (await scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, {
      limit: effectiveLimit,
      tab: 'likes',
      cursor,
    }));

    return successResponse(res, {
      username: cleanUsername,
      likedTweets: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (tweets.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        author: { username: t.author?.username || t.username, displayName: t.author?.name },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: { likes: parseInt(String(t.likes), 10) || 0, retweets: parseInt(String(t.retweets), 10) || 0 },
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (tweets.items || []))).length,
        limit: effectiveLimit,
        nextCursor: tweets.nextCursor || null,
        hasMore: !!tweets.nextCursor,
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ User likes scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/mentions
 * Get mentions of a user
 */
router.post('/mentions', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 50;
  const filter = /** @type {string | undefined} */ (req.body.filter) ?? 'latest';
  const cursor = /** @type {string | undefined} */ (req.body.cursor);

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

  try {
    const startTime = Date.now();
    const { searchTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const results = /** @type {Record<string, unknown>} */ (await searchTweets((/** @type {string} */ (req.sessionCookie)), `@${cleanUsername}`, {
      limit: effectiveLimit,
      filter: filter === 'top' ? 'top' : 'latest',
      cursor,
    }));

    return successResponse(res, {
      username: cleanUsername,
      mentions: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).map(t => ({
        id: t.id,
        text: t.text,
        author: {
          username: t.author?.username || t.username,
          displayName: t.author?.name,
          verified: t.author?.verified || false,
          followersCount: parseInt(String(t.author?.followers), 10) || null,
        },
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        metrics: { likes: parseInt(String(t.likes), 10) || 0, retweets: parseInt(String(t.retweets), 10) || 0, replies: parseInt(String(t.replies), 10) || 0 },
      })),
      pagination: {
        count: (/** @type {ScrapedTweet[]} */ (/** @type {ScrapedTweet[]} */ (results.items || []))).length,
        limit: effectiveLimit,
        nextCursor: results.nextCursor || null,
        hasMore: !!results.nextCursor,
      },
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Mentions scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

/**
 * POST /api/ai/scrape/recommendations
 * Get recommended users to follow based on profile
 */
router.post('/recommendations', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 20;

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 50);

  try {
    const startTime = Date.now();
    const { scrapeProfile, scrapeFollowers } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const profile = /** @type {Record<string, unknown>} */ (await scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername));

    // Get followers of followers as recommendations (2nd-degree connections)
    const followers = /** @type {Record<string, unknown>} */ (await scrapeFollowers((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: 10 }));
    const seen = new Set([cleanUsername]);
    const recommendations = [];

    for (const follower of (followers.users || []).slice(0, 5)) {
      if (seen.has(follower.username)) continue;
      seen.add(follower.username);
      recommendations.push({
        username: follower.username,
        displayName: follower.name || follower.displayName,
        bio: follower.bio || null,
        verified: follower.verified || false,
        followersCount: parseInt(String(follower.followers), 10) || null,
        reason: `Followed by @${cleanUsername}'s followers`,
      });
    }

    return successResponse(res, {
      username: cleanUsername,
      recommendations: recommendations.slice(0, effectiveLimit),
      count: Math.min(recommendations.length, effectiveLimit),
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Recommendations scrape error:', error);
    return errorResponse(res, 500, 'SCRAPE_FAILED', _errMessage);
  
  }
});

export default router;
