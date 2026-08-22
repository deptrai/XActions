// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Utility Endpoints
 * 
 * Utility operations: video download, bookmark export, thread unroll, etc.
 * 
 * @module api/routes/ai/utility
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


const generateOperationId = () => {
  return `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
};

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
      processedAt: new Date().toISOString(),
      ...meta,
    },
  });
};

// Require session cookie for most utilities
router.use(async (req, res, next) => {
  // Some endpoints might work without session
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/download/video
 * Download video from a tweet
 */
router.post('/video', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const quality = /** @type {string | undefined} */ (req.body.quality) ?? 'highest';
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
      schema: {
        tweetUrl: { type: 'string', example: 'https://x.com/elonmusk/status/1234567890' },
        tweetId: { type: 'string', example: '1234567890' },
        quality: { type: 'string', enum: ['highest', 'lowest', 'all'], default: 'highest' },
      },
    });
  }
  
  // Extract tweet ID
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
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
    
    const { extractVideoUrls } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const videos = /** @type {VideoVariant[]} */ (await extractVideoUrls((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));
    
    if (!videos || videos.length === 0) {
      return res.status(404).json({
        error: 'NO_VIDEO_FOUND',
        code: 'E_NO_VIDEO',
        message: 'No video found in this tweet',
        hint: 'Make sure the tweet contains a video (not just images or a GIF)',
        retryable: false,
      });
    }
    
    // Sort by quality (resolution)
    const sortedVideos = videos.sort((a, b) => {
      /** @param {VideoVariant} v */
      const getResolution = (v) => {
        const match = v.quality?.match(/(\d+)x(\d+)/);
        return match ? parseInt(String(match[1]), 10) * parseInt(String(match[2]), 10) : 0;
      };
      return getResolution(b) - getResolution(a);
    });
    
    let selectedVideos;
    if (quality === 'highest') {
      selectedVideos = [sortedVideos[0]];
    } else if (quality === 'lowest') {
      selectedVideos = [sortedVideos[sortedVideos.length - 1]];
    } else {
      selectedVideos = sortedVideos;
    }
    
    return successResponse(res, {
      tweetId: effectiveTweetId,
      tweetUrl: `https://x.com/i/status/${effectiveTweetId}`,
      videos: selectedVideos.map(v => ({
        url: v.url,
        quality: v.quality,
        contentType: v.contentType || 'video/mp4',
        bitrate: v.bitrate || null,
      })),
      selectedQuality: quality,
      totalQualities: videos.length,
    }, {
      durationMs: Date.now() - startTime,
      note: 'Video URLs are temporary and may expire. Download promptly.',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Video download error:', error);
    return errorResponse(res, 500, 'DOWNLOAD_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/export/bookmarks
 * Export user's bookmarks
 */
router.post('/bookmarks', async (req, res) => {
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 100;
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'json';
  const cursor = /** @type {string | undefined} */ (req.body.cursor);
  
  if (!(/** @type {string} */ (req.sessionCookie))) {
    return res.status(400).json({
      error: 'SESSION_REQUIRED',
      code: 'E_SESSION_MISSING',
      message: 'Session cookie is required to access bookmarks',
    });
  }
  
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 500);
  
  try {
    const startTime = Date.now();
    
    const { scrapeBookmarks } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const bookmarks = /** @type {BookmarkListResult} */ (await scrapeBookmarks((/** @type {string} */ (req.sessionCookie)), {
      limit: effectiveLimit,
      cursor,
    }));
    
    const formattedBookmarks = (/** @type {ScrapedBookmark[]} */ (/** @type {ScrapedBookmark[]} */ (bookmarks.items || []))).map(b => ({
      id: b.id,
      text: b.text,
      author: {
        username: b.author?.username || b.username,
        displayName: b.author?.name || b.authorName,
      },
      createdAt: b.timestamp || b.createdAt,
      url: b.url || `https://x.com/i/status/${b.id}`,
      metrics: {
        likes: parseInt(String(b.likes), 10) || 0,
        retweets: parseInt(String(b.retweets), 10) || 0,
        replies: parseInt(String(b.replies), 10) || 0,
      },
      bookmarkedAt: b.bookmarkedAt || null,
    }));
    
    // Handle different export formats
    let output;
    if (format === 'csv') {
      const headers = ['id', 'author', 'text', 'url', 'likes', 'retweets', 'createdAt'];
      const rows = formattedBookmarks.map(b => [
        b.id,
        `@${b.author.username}`,
        `"${(b.text || '').replace(/"/g, '""')}"`,
        b.url,
        b.metrics.likes,
        b.metrics.retweets,
        b.createdAt,
      ]);
      output = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    } else if (format === 'markdown') {
      output = formattedBookmarks.map(b => 
        `## [@${b.author.username}](https://x.com/${b.author.username})\n\n${b.text}\n\n[View tweet](${b.url}) | ❤️ ${b.metrics.likes} | 🔁 ${b.metrics.retweets}\n\n---\n`
      ).join('\n');
    } else {
      output = formattedBookmarks;
    }
    
    return successResponse(res, {
      bookmarks: format === 'json' ? output : formattedBookmarks,
      formattedOutput: format !== 'json' ? output : null,
      format,
      pagination: {
        count: formattedBookmarks.length,
        limit: effectiveLimit,
        nextCursor: bookmarks.nextCursor || null,
        hasMore: !!bookmarks.nextCursor,
      },
    }, {
      durationMs: Date.now() - startTime,
      exportFormat: format,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Bookmark export error:', error);
    return errorResponse(res, 500, 'EXPORT_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/unroll/thread
 * Unroll a thread into readable text
 */
router.post('/thread', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  const format = /** @type {string | undefined} */ (req.body.format) ?? 'text';
  const includeMetrics = /** @type {boolean | undefined} */ (req.body.includeMetrics) ?? false;
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
      schema: {
        tweetUrl: { type: 'string', example: 'https://x.com/naval/status/1002103360646823936' },
        tweetId: { type: 'string' },
        format: { type: 'string', enum: ['text', 'markdown', 'json'], default: 'text' },
        includeMetrics: { type: 'boolean', default: false },
      },
    });
  }
  
  // Extract tweet ID
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }
  
  try {
    const startTime = Date.now();
    
    const { scrapeThread } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const thread = /** @type {ThreadResult} */ (await scrapeThread((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));
    
    if (!thread || !thread.tweets || thread.tweets.length === 0) {
      return res.status(404).json({
        error: 'THREAD_NOT_FOUND',
        code: 'E_NO_THREAD',
        message: 'Could not find thread or tweet is not part of a thread',
        retryable: false,
      });
    }
    
    const author = thread.author?.username || 'unknown';
    const tweets = thread.tweets;
    
    // Format output based on requested format
    let unrolled = /** @type {string | Record<string, unknown>} */ ('');
    if (format === 'markdown') {
      unrolled = `# Thread by @${author}\n\n`;
      unrolled += `> ${tweets.length} tweets\n\n`;
      unrolled += `---\n\n`;
      
      tweets.forEach((t, i) => {
        unrolled += `**${i + 1}/${tweets.length}**\n\n`;
        unrolled += `${t.text}\n\n`;
        
        if (includeMetrics) {
          unrolled += `_❤️ ${t.likes || 0} | 🔁 ${t.retweets || 0} | 💬 ${t.replies || 0}_\n\n`;
        }
        
        unrolled += `---\n\n`;
      });
      
      unrolled += `\n[Original Thread](https://x.com/${author}/status/${effectiveTweetId})\n`;
      
    } else if (format === 'json') {
      unrolled = {
        author,
        totalTweets: tweets.length,
        tweets: tweets.map((t, i) => ({
          position: i + 1,
          text: t.text,
          ...(includeMetrics && {
            metrics: {
              likes: parseInt(String(t.likes), 10) || 0,
              retweets: parseInt(String(t.retweets), 10) || 0,
              replies: parseInt(String(t.replies), 10) || 0,
            },
          }),
        })),
        url: `https://x.com/${author}/status/${effectiveTweetId}`,
      };
      
    } else {
      // Plain text
      unrolled = `Thread by @${author} (${tweets.length} tweets)\n`;
      unrolled += `${'='.repeat(50)}\n\n`;
      
      tweets.forEach((t, i) => {
        unrolled += `[${i + 1}/${tweets.length}]\n`;
        unrolled += `${t.text}\n`;
        
        if (includeMetrics) {
          unrolled += `(❤️ ${t.likes || 0} | 🔁 ${t.retweets || 0})\n`;
        }
        
        unrolled += '\n';
      });
      
      unrolled += `${'='.repeat(50)}\n`;
      unrolled += `Original: https://x.com/${author}/status/${effectiveTweetId}\n`;
    }
    
    return successResponse(res, {
      author,
      originalTweetId: effectiveTweetId,
      totalTweets: tweets.length,
      format,
      unrolled,
      // Include structured data for programmatic access regardless of format
      tweets: tweets.map((t, i) => ({
        position: i + 1,
        text: t.text,
        id: t.id,
      })),
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Thread unroll error:', error);
    return errorResponse(res, 500, 'UNROLL_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analyze/profile
 * Analyze a profile's engagement patterns
 */
router.post('/profile', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const tweetCount = /** @type {string | number | undefined} */ (req.body.tweetCount) ?? 50;
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true },
        tweetCount: { type: 'number', default: 50, max: 200, description: 'Number of recent tweets to analyze' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveCount = Math.min(Math.max(parseInt(String(tweetCount), 10) || 50, 10), 200);
  
  try {
    const startTime = Date.now();
    
    // Fetch profile and recent tweets
    const { scrapeProfile, scrapeTweets } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    
    const [profile, tweets] = /** @type {[ScrapedProfile, TweetListResult]} */ (await Promise.all([
      scrapeProfile((/** @type {string} */ (req.sessionCookie)), cleanUsername),
      scrapeTweets((/** @type {string} */ (req.sessionCookie)), cleanUsername, { limit: effectiveCount }),
    ]));
    
    const tweetItems = /** @type {ScrapedTweet[]} */ (tweets.items || []);
    
    // Calculate engagement metrics
    const totalLikes = tweetItems.reduce((sum, t) => sum + (parseInt(String(t.likes), 10) || 0), 0);
    const totalRetweets = tweetItems.reduce((sum, t) => sum + (parseInt(String(t.retweets), 10) || 0), 0);
    const totalReplies = tweetItems.reduce((sum, t) => sum + (parseInt(String(t.replies), 10) || 0), 0);
    const totalViews = tweetItems.reduce((sum, t) => sum + (parseInt(String(t.views), 10) || 0), 0);
    
    const avgLikes = tweetItems.length > 0 ? Math.round(totalLikes / tweetItems.length) : 0;
    const avgRetweets = tweetItems.length > 0 ? Math.round(totalRetweets / tweetItems.length) : 0;
    const avgReplies = tweetItems.length > 0 ? Math.round(totalReplies / tweetItems.length) : 0;
    const avgViews = tweetItems.length > 0 ? Math.round(totalViews / tweetItems.length) : 0;
    
    // Calculate engagement rate (likes + retweets + replies) / followers
    const followers = parseInt(String(profile.followers), 10) || 1;
    const avgEngagement = avgLikes + avgRetweets + avgReplies;
    const engagementRate = ((avgEngagement / followers) * 100).toFixed(4);
    
    // Find top performing tweets
    const topTweets = [...tweetItems]
      .sort((a, b) => (parseInt(String(b.likes), 10) || 0) - (parseInt(String(a.likes), 10) || 0))
      .slice(0, 5)
      .map(t => ({
        id: t.id,
        text: t.text?.slice(0, 100) + (t.text?.length > 100 ? '...' : ''),
        likes: parseInt(String(t.likes), 10) || 0,
        retweets: parseInt(String(t.retweets), 10) || 0,
        url: t.url || `https://x.com/${cleanUsername}/status/${t.id}`,
      }));
    
    // Analyze posting patterns
    const tweetsByHour = new Array(24).fill(0);
    const tweetsByDay = new Array(7).fill(0);
    
    tweetItems.forEach(t => {
      if (t.timestamp) {
        const date = new Date(t.timestamp);
        tweetsByHour[date.getUTCHours()]++;
        tweetsByDay[date.getUTCDay()]++;
      }
    });
    
    const bestHour = tweetsByHour.indexOf(Math.max(...tweetsByHour));
    const bestDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      tweetsByDay.indexOf(Math.max(...tweetsByDay))
    ];
    
    return successResponse(res, {
      profile: {
        username: cleanUsername,
        displayName: profile.name,
        bio: profile.bio,
        followers: followers,
        following: parseInt(String(profile.following), 10) || 0,
        totalTweets: parseInt(String(profile.tweets), 10) || 0,
        verified: profile.verified || false,
        joinDate: profile.joinDate,
      },
      analysis: {
        tweetsAnalyzed: tweetItems.length,
        engagement: {
          avgLikesPerTweet: avgLikes,
          avgRetweetsPerTweet: avgRetweets,
          avgRepliesPerTweet: avgReplies,
          avgViewsPerTweet: avgViews,
          engagementRate: `${engagementRate}%`,
          totalEngagement: totalLikes + totalRetweets + totalReplies,
        },
        topPerformingTweets: topTweets,
        postingPatterns: {
          bestHourUTC: bestHour,
          bestDay: bestDay,
          hourlyDistribution: tweetsByHour,
          dailyDistribution: tweetsByDay,
        },
        ratios: {
          followersToFollowing: (followers / (parseInt(String(profile.following), 10) || 1)).toFixed(2),
          tweetsPerFollower: (parseInt(String(profile.tweets), 10) / followers).toFixed(4),
        },
      },
    }, {
      durationMs: Date.now() - startTime,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Profile analysis error:', error);
    return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/analyze/tweet
 * Analyze engagement on a specific tweet
 */
router.post('/tweet', async (req, res) => {
  const tweetUrl = /** @type {string | undefined} */ (req.body.tweetUrl);
  const tweetId = /** @type {string | undefined} */ (req.body.tweetId);
  
  if (!tweetUrl && !tweetId) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_TWEET_REF',
      message: 'tweetUrl or tweetId is required',
    });
  }
  
  // Extract tweet ID
  let effectiveTweetId = tweetId;
  if (tweetUrl) {
    const match = tweetUrl.match(/status\/(\d+)/);
    if (match) effectiveTweetId = match[1];
  }
  
  try {
    const startTime = Date.now();
    
    const { scrapeTweetDetails } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/browserAutomation.js')));
    const tweet = /** @type {ScrapedTweet | null} */ (await scrapeTweetDetails((/** @type {string} */ (req.sessionCookie)), effectiveTweetId));
    
    if (!tweet) {
      return res.status(404).json({
        error: 'TWEET_NOT_FOUND',
        code: 'E_NO_TWEET',
        message: 'Tweet not found',
        retryable: false,
      });
    }
    
    const likes = parseInt(String(tweet.likes), 10) || 0;
    const retweets = parseInt(String(tweet.retweets), 10) || 0;
    const replies = parseInt(String(tweet.replies), 10) || 0;
    const views = parseInt(String(tweet.views), 10) || 0;
    const quotes = parseInt(String(tweet.quotes), 10) || 0;
    const bookmarks = parseInt(String(tweet.bookmarks), 10) || 0;
    
    const totalEngagement = likes + retweets + replies + quotes;
    const engagementRate = views > 0 ? ((totalEngagement / views) * 100).toFixed(4) : '0';
    
    return successResponse(res, {
      tweet: {
        id: effectiveTweetId,
        text: tweet.text,
        author: {
          username: tweet.author?.username,
          displayName: tweet.author?.name,
          verified: tweet.author?.verified || false,
        },
        createdAt: tweet.timestamp || tweet.createdAt,
        url: `https://x.com/${tweet.author?.username}/status/${effectiveTweetId}`,
      },
      metrics: {
        likes,
        retweets,
        replies,
        quotes,
        bookmarks,
        views,
        totalEngagement,
      },
      analysis: {
        engagementRate: `${engagementRate}%`,
        likeToRetweetRatio: retweets > 0 ? (likes / retweets).toFixed(2) : 'N/A',
        replyToLikeRatio: likes > 0 ? (replies / likes).toFixed(4) : 'N/A',
        performance: views > 0 
          ? (parseFloat(engagementRate) > 1 ? 'High' : parseFloat(engagementRate) > 0.5 ? 'Medium' : 'Low')
          : 'Unknown',
      },
      media: tweet.media || [],
    }, {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);console.error('❌ Tweet analysis error:', error);
    return errorResponse(res, 500, 'ANALYSIS_FAILED', _errMessage);
  
  
  }
});

export default router;
