// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Tweet Writer API Routes
 * 
 * Voice analysis + AI-powered tweet generation.
 * The moat: scrape → analyze voice → generate in user's style.
 * 
 * POST /api/ai/writer/analyze-voice — analyze a user's writing voice
 * POST /api/ai/writer/generate — generate tweets in a voice
 * POST /api/ai/writer/rewrite — improve an existing tweet
 * POST /api/ai/writer/calendar — generate weekly content calendar
 * POST /api/ai/writer/reply — generate a reply to a tweet
 * GET  /api/ai/writer/voice-profiles — list saved voice profiles
 * 
 * Rate limit: 10 generations/minute for free tier.
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import express from 'express';
import rateLimit from 'express-rate-limit';

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


// ============================================================================
// Rate Limiting — 10 generations/minute
// ============================================================================

const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Maximum 10 AI generations per minute. Please wait.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================================
// In-memory voice profile store (replace with DB in production)
// ============================================================================

/** @type {Map<string, { profile: Record<string, unknown>; savedAt: string }>} */
/** @type {Map<string, { profile: Record<string, unknown>; savedAt: string }>} */
const voiceProfiles = new Map();

// ============================================================================
// Routes
// ============================================================================

/**
 * Analyze a user's writing voice
 * POST /api/ai/writer/analyze-voice
 * 
 * Body: { username, authToken, tweetLimit? }
 * Returns: VoiceProfile object
 */
router.post('/analyze-voice', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const authToken = /** @type {string | undefined} */ (req.body.authToken);
    const tweetLimit = /** @type {string | number | undefined} */ (req.body.tweetLimit) ?? 200;

    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    if (!authToken) {
      return res.status(400).json({
        error: 'authToken is required',
        hint: 'Provide your X/Twitter auth_token cookie value to scrape tweets',
      });
    }

    // Step 1: Scrape tweets
    const { scrapeTweets } = await import('../../../src/scrapers/index.js');
    const tweets = await scrapeTweets(username, authToken, { limit: tweetLimit });

    if (!tweets || tweets.length === 0) {
      return res.status(404).json({
        error: 'No tweets found',
        message: `Could not scrape tweets for @${username}. The account may be private or have no tweets.`,
      });
    }

    // Step 2: Analyze voice
    const { analyzeVoice, summarizeVoiceProfile } = await import('../../../src/ai/voiceAnalyzer.js');
    const profile = analyzeVoice(username, tweets);
    const summary = summarizeVoiceProfile(profile);

    // Step 3: Save profile
    voiceProfiles.set(username.toLowerCase().replace(/^@/, ''), {
      profile,
      savedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      data: {
        profile,
        summary,
      },
      operation: 'ai:analyze-voice',
      tweetsScraped: tweets.length,
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Voice analysis failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Generate tweets in a user's voice
 * POST /api/ai/writer/generate
 * 
 * Body: { username, topic, style?, count?, type?, threadLength?, model?, apiKey? }
 * type: 'tweet' | 'thread'
 */
router.post('/generate', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const topic = /** @type {string | undefined} */ (req.body.topic);
    const style = /** @type {string | undefined} */ (req.body.style);
    const tone = /** @type {string | undefined} */ (req.body.tone);
    const count = /** @type {string | number | undefined} */ (req.body.count) ?? 3;
    const type = /** @type {string | undefined} */ (req.body.type) ?? 'tweet';
    const threadLength = /** @type {string | number | undefined} */ (req.body.threadLength) ?? 5;
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const provider = /** @type {string | undefined} */ (req.body.provider);
    const openaiApiKey = /** @type {string | undefined} */ (req.body.openaiApiKey);
    const grokApiKey = /** @type {string | undefined} */ (req.body.grokApiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    if (!topic) {
      return res.status(400).json({ error: 'topic is required' });
    }

    // Resolve voice profile
    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) {
        voiceProfile = saved.profile;
      }
    }

    if (!voiceProfile) {
      return res.status(400).json({
        error: 'Voice profile required',
        message: 'Either pass voiceProfile directly or analyze a username first via POST /api/ai/writer/analyze-voice',
        hint: `No saved profile found${username ? ` for @${username}` : ''}`,
      });
    }

    const { generateTweet, generateThread } = await import('../../../src/ai/tweetGenerator.js');

    let result;
    if (type === 'thread') {
      result = await generateThread(voiceProfile, { topic, length: threadLength, model, apiKey, provider, openaiApiKey, grokApiKey });
      res.json({
        success: true,
        data: result,
        operation: 'ai:generate-thread',
      });
    } else {
      result = await generateTweet(voiceProfile, { topic, style, tone, count, model, apiKey, provider, openaiApiKey, grokApiKey });
      res.json({
        success: true,
        data: result,
        operation: 'ai:generate-tweet',
      });
    }
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Generation failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Generate a thread from long-form text (auto-split)
 * POST /api/ai/writer/thread-from-text
 *
 * Body: { username, text, maxLength?, hooks?, tone?, model?, apiKey?, provider?, voiceProfile? }
 */
router.post('/thread-from-text', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const text = /** @type {string | undefined} */ (req.body.text);
    const maxLength = /** @type {string | number | undefined} */ (req.body.maxLength) ?? 10;
    const hooks = /** @type {boolean | undefined} */ (req.body.hooks) ?? true;
    const tone = /** @type {string | undefined} */ (req.body.tone);
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const provider = /** @type {string | undefined} */ (req.body.provider);
    const openaiApiKey = /** @type {string | undefined} */ (req.body.openaiApiKey);
    const grokApiKey = /** @type {string | undefined} */ (req.body.grokApiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    if (!text) {
      return res.status(400).json({ error: 'text is required — the long-form text to split into a thread' });
    }

    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) voiceProfile = saved.profile;
    }

    if (!voiceProfile) {
      return res.status(400).json({
        error: 'Voice profile required',
        message: 'Either pass voiceProfile directly or analyze a username first via POST /api/ai/writer/analyze-voice',
      });
    }

    const { generateThreadFromText } = await import('../../../src/ai/tweetGenerator.js');
    const result = await generateThreadFromText(voiceProfile, {
      text, maxLength, hooks, tone, model, apiKey, provider, openaiApiKey, grokApiKey,
    });

    res.json({
      success: true,
      data: result,
      operation: 'ai:thread-from-text',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Thread generation failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Generate bio options
 * POST /api/ai/writer/bio
 *
 * Body: { username?, topic?, keywords?, tone?, count?, maxLength?, model?, apiKey?, provider?, voiceProfile? }
 */
router.post('/bio', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const topic = /** @type {string | undefined} */ (req.body.topic);
    const keywords = /** @type {string[] | undefined} */ (req.body.keywords);
    const tone = /** @type {string | undefined} */ (req.body.tone);
    const count = /** @type {string | number | undefined} */ (req.body.count) ?? 5;
    const maxLength = /** @type {string | number | undefined} */ (req.body.maxLength) ?? 160;
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const provider = /** @type {string | undefined} */ (req.body.provider);
    const openaiApiKey = /** @type {string | undefined} */ (req.body.openaiApiKey);
    const grokApiKey = /** @type {string | undefined} */ (req.body.grokApiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) voiceProfile = saved.profile;
    }

    if (!voiceProfile && !topic) {
      return res.status(400).json({
        error: 'topic or voiceProfile required',
        message: 'Provide a topic, or analyze a username first and pass username/voiceProfile.',
      });
    }

    const { generateBio } = await import('../../../src/ai/tweetGenerator.js');
    const result = await generateBio(voiceProfile, {
      topic, keywords, tone, count, maxLength, model, apiKey, provider, openaiApiKey, grokApiKey,
    });

    res.json({
      success: true,
      data: result,
      operation: 'ai:generate-bio',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Bio generation failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Rewrite/improve an existing tweet
 * POST /api/ai/writer/rewrite
 * 
 * Body: { username, text, goal?, count?, model?, apiKey? }
 */
router.post('/rewrite', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const text = /** @type {string | undefined} */ (req.body.text);
    const goal = /** @type {string | undefined} */ (req.body.goal) ?? 'more_engaging';
    const count = /** @type {string | number | undefined} */ (req.body.count) ?? 3;
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    if (!text) {
      return res.status(400).json({ error: 'text is required — the tweet to rewrite' });
    }

    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) voiceProfile = saved.profile;
    }

    if (!voiceProfile) {
      return res.status(400).json({
        error: 'Voice profile required',
        message: 'Analyze a username first via POST /api/ai/writer/analyze-voice',
      });
    }

    const { rewriteTweet } = await import('../../../src/ai/tweetGenerator.js');
    const result = await rewriteTweet(voiceProfile, text, { goal, count, model, apiKey });

    res.json({
      success: true,
      data: result,
      operation: 'ai:rewrite-tweet',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Rewrite failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Generate weekly content calendar
 * POST /api/ai/writer/calendar
 * 
 * Body: { username, topics?, postsPerDay?, days?, model?, apiKey? }
 */
router.post('/calendar', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const topics = /** @type {string[] | undefined} */ (req.body.topics);
    const postsPerDay = /** @type {string | number | undefined} */ (req.body.postsPerDay) ?? 2;
    const days = /** @type {string | number | undefined} */ (req.body.days) ?? 7;
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) voiceProfile = saved.profile;
    }

    if (!voiceProfile) {
      return res.status(400).json({
        error: 'Voice profile required',
        message: 'Analyze a username first via POST /api/ai/writer/analyze-voice',
      });
    }

    const { generateWeek } = await import('../../../src/ai/tweetGenerator.js');
    const result = await generateWeek(voiceProfile, { topics, postsPerDay, days, model, apiKey });

    res.json({
      success: true,
      data: result,
      operation: 'ai:generate-calendar',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Calendar generation failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * Generate reply to a tweet
 * POST /api/ai/writer/reply
 * 
 * Body: { username, originalTweet, tone?, count?, model?, apiKey? }
 */
router.post('/reply', generationLimiter, async (req, res) => {
  try {
    const username = /** @type {string | undefined} */ (req.body.username);
    const originalTweet = /** @type {string | undefined} */ (req.body.originalTweet);
    const tone = /** @type {string | undefined} */ (req.body.tone);
    const count = /** @type {string | number | undefined} */ (req.body.count) ?? 3;
    const model = /** @type {string | undefined} */ (req.body.model);
    const apiKey = /** @type {string | undefined} */ (req.body.apiKey);
    const directProfile = /** @type {Record<string, unknown> | undefined} */ (req.body.voiceProfile);

    if (!originalTweet) {
      return res.status(400).json({ error: 'originalTweet is required — the tweet to reply to' });
    }

    let voiceProfile = directProfile;
    if (!voiceProfile && username) {
      const saved = voiceProfiles.get(username.toLowerCase().replace(/^@/, ''));
      if (saved) voiceProfile = saved.profile;
    }

    if (!voiceProfile) {
      return res.status(400).json({
        error: 'Voice profile required',
        message: 'Analyze a username first via POST /api/ai/writer/analyze-voice',
      });
    }

    const { generateReply } = await import('../../../src/ai/tweetGenerator.js');
    const result = await generateReply(voiceProfile, originalTweet, { tone, count, model, apiKey });

    res.json({
      success: true,
      data: result,
      operation: 'ai:generate-reply',
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);res.status(500).json({
      error: 'Reply generation failed',
      message: _errMessage,
    });
  
  
  }
});

/**
 * List saved voice profiles
 * GET /api/ai/writer/voice-profiles
 */
router.get('/voice-profiles', (req, res) => {
  const profiles = [];
  for (const [username, data] of voiceProfiles) {
    profiles.push({
      username,
      tweetCount: data.profile.tweetCount,
      contentPillars: data.profile.contentPillars.map(p => p.topic),
      savedAt: data.savedAt,
    });
  }

  res.json({
    success: true,
    data: profiles,
    count: profiles.length,
    operation: 'ai:list-voice-profiles',
  });
});

/**
 * Get a specific voice profile
 * GET /api/ai/writer/voice-profiles/:username
 */
router.get('/voice-profiles/:username', (req, res) => {
  const username = req.params.username.toLowerCase().replace(/^@/, '');
  const saved = voiceProfiles.get(username);

  if (!saved) {
    return res.status(404).json({
      error: 'Profile not found',
      message: `No voice profile saved for @${username}. Analyze first via POST /api/ai/writer/analyze-voice`,
    });
  }

  res.json({
    success: true,
    data: saved.profile,
    savedAt: saved.savedAt,
    operation: 'ai:get-voice-profile',
  });
});

export default router;
