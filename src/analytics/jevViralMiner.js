// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Jev Viral Miner — Universal Corpus Scraping & Batch Classification
 * 
 * Story 45.1: Scrape posts from any platform, classify viral DNA via Jev batch,
 * output PostViralProfile[] for stats aggregation.
 * 
 * @module src/analytics/jevViralMiner
 */

import { JevBrain } from '../agents/jevBrain.js';
import { getPlatformQuestions, getPlatformCategory, listPlatforms } from './platformQuestions.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * @typedef {Object} PostViralProfile
 * @property {string} id - Post identifier
 * @property {string} platform - Platform source
 * @property {string} category - Platform category
 * @property {string} niche - Search niche/keyword
 * @property {string} text - Post content
 * @property {Object} metrics - Engagement metrics
 * @property {Object} viralDNA - Jev classification results
 * @property {boolean} jevDegraded - Whether Jev was degraded
 * @property {string} scrapedAt - ISO timestamp
 */

/**
 * @typedef {Object} MiningResult
 * @property {string} jobId
 * @property {string} platform
 * @property {string} niche
 * @property {number} requested
 * @property {number} scraped
 * @property {number} classified
 * @property {PostViralProfile[]} profiles
 * @property {Object} cost - { estimated, actual, currency }
 * @property {string} outputPath
 * @property {number} durationMs
 * @property {string} status - 'completed' | 'partial' | 'failed'
 */

// Platform to scraper mapping
const SCRAPER_MAP = {
  // Social
  twitter: { module: '../scrapers/social/twitter/crawler.js', class: 'TwitterCrawler', method: 'search' },
  threads: { module: '../scrapers/social/threads/crawler.js', class: 'ThreadsCrawler', method: 'search' },
  facebook: { module: '../scrapers/social/facebook/crawler.js', class: 'FacebookCrawler', method: 'search' },
  tiktok: { module: '../scrapers/social/tiktok/crawler.js', class: 'TikTokCrawler', method: 'search' },
  youtube: { module: '../scrapers/social/youtube/crawler.js', class: 'YouTubeVNCrawler', method: 'search' },
  reddit: { module: '../scrapers/social/reddit/crawler.js', class: 'RedditCrawler', method: 'search' },
  instagram: { module: '../scrapers/social/instagram/crawler.js', class: 'InstagramCrawler', method: 'search' },
  bluesky: { module: '../scrapers/social/bluesky/crawler.js', class: 'BlueskyCrawler', method: 'search' },
  mastodon: { module: '../scrapers/social/mastodon/crawler.js', class: 'MastodonCrawler', method: 'search' },
  medium: { module: '../scrapers/social/medium/crawler.js', class: 'MediumCrawler', method: 'search' },
  zalo: { module: '../scrapers/social/zalo/crawler.js', class: 'ZaloCrawler', method: 'search' },
  // Recruitment
  linkedin: { module: '../scrapers/recruitment/linkedin/crawler.js', class: 'LinkedInCrawler', method: 'searchJobs' },
  topcv: { module: '../scrapers/recruitment/topcv/crawler.js', class: 'TopCvCrawler', method: 'searchJobs' },
  vietnamworks: { module: '../scrapers/recruitment/vietnamworks/crawler.js', class: 'VietnamWorksCrawler', method: 'searchJobs' },
  // Real Estate
  chotot: { module: '../scrapers/realestate/chotot/crawler.js', class: 'ChototCrawler', method: 'searchListings' },
  batdongsan: { module: '../scrapers/realestate/batdongsan/crawler.js', class: 'BatdongsanCrawler', method: 'searchListings' },
  // E-Commerce
  shopee: { module: '../scrapers/ecom/shopee/crawler.js', class: 'ShopeeCrawler', method: 'searchProducts' },
  'tiktok-shop': { module: '../scrapers/ecom/tiktok-shop/crawler.js', class: 'TikTokShopCrawler', method: 'searchProducts' },
};

/**
 * Normalize niche for file naming
 * @param {string} niche - Raw niche input
 * @returns {string} Normalized niche (lowercase, alphanumeric + hyphens)
 */
export function normalizeNiche(niche) {
  return niche
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Estimate mining cost
 * @param {number} postCount - Number of posts to process
 * @param {number} questionsPerPost - Questions per post (default 14)
 * @returns {Object} Cost breakdown
 */
export function estimateCost(postCount, questionsPerPost = 14) {
  const COST_PER_QUESTION = 0.00000048; // $0.48 per 1M questions
  const totalQuestions = postCount * questionsPerPost;
  const estimated = totalQuestions * COST_PER_QUESTION;
  
  return {
    posts: postCount,
    questionsPerPost,
    totalQuestions,
    estimated,
    currency: 'USD',
    formatted: `$${estimated.toFixed(4)}`,
  };
}

/**
 * Get scraper instance for platform
 * @param {string} platform - Platform identifier
 * @returns {Promise<Object>} Scraper instance
 */
async function getScraper(platform) {
  const config = SCRAPER_MAP[platform];
  if (!config) {
    throw new Error(`Platform '${platform}' not supported. Available: ${listPlatforms().join(', ')}`);
  }
  
  try {
    const module = await import(config.module);
    const ScraperClass = module[config.class];
    if (!ScraperClass) {
      throw new Error(`Class ${config.class} not found in ${config.module}`);
    }
    const scraperOptions = platform === 'threads' 
      ? { client: 'curl', requiresProxy: true, requiresResidential: true } 
      : {};
    return new ScraperClass(scraperOptions);
  } catch (err) {
    throw new Error(`Failed to load scraper for ${platform}: ${err.message}`);
  }
}

/**
 * Scrape posts from platform
 * @param {string} platform - Platform identifier
 * @param {string} niche - Search query
 * @param {number} count - Max posts to scrape
 * @param {Object} options - { scraperConcurrency, scraperDelay, session }
 * @returns {Promise<Array>} Raw posts
 */
async function scrapePosts(platform, niche, count, options = {}) {
  const { scraperConcurrency = 3, scraperDelay = 2000, session } = options;
  
  const scraper = await getScraper(platform);
  const config = SCRAPER_MAP[platform];
  
  // Initialize if needed
  if (typeof scraper.init === 'function') {
    await scraper.init(session);
  }
  
  try {
    // Platform-specific dispatch with smart fallback
    if (platform === 'threads') {
      const cleanTarget = niche.replace(/^@/, '').trim();
      // If niche looks like a username or search docId is missing/fails, fetch user feed with resilient retries
      if (niche.startsWith('@')) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const feed = await scraper.getUserFeed({ username: cleanTarget, count });
            if (feed?.posts?.length) return feed.posts;
          } catch (err) {
            if (attempt === 3) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
        return [];
      }
      try {
        const results = await scraper.search({ query: niche, limit: count });
        const posts = Array.isArray(results) ? results : results?.items || results?.posts || [];
        if (posts.length > 0) return posts;
      } catch (err) {
        console.warn(`[Threads] search fallback triggered: ${err.message}`);
      }
      // Niche creator fallback map for public guest scraping
      const NICHE_CREATORS = {
        ai: ['zuck', 'yannlecun', 'mosseri'],
        'artificial-intelligence': ['zuck', 'yannlecun', 'mosseri'],
        'ai-tech': ['zuck', 'yannlecun', 'mosseri'],
        tech: ['zuck', 'mosseri'],
        technology: ['zuck', 'mosseri'],
        fashion: ['chaubui_'],
        lifestyle: ['chaubui_'],
      };
      const creators = NICHE_CREATORS[cleanTarget.toLowerCase()] || ['mosseri'];
      const collected = [];
      for (const creator of creators) {
        try {
          const feed = await scraper.getUserFeed({ username: creator, count: Math.max(10, count) });
          if (feed?.posts?.length) collected.push(...feed.posts);
        } catch {}
      }
      // If niche is AI, prioritize posts discussing AI/models/agents/intelligence
      const isAiNiche = /\b(ai|artificial intelligence|machine learning|llm|model|agent)\b/i.test(cleanTarget);
      if (isAiNiche && collected.length > 0) {
        const aiKeywords = /\b(ai|meta ai|llama|agent|agents|model|models|intelligence|compute|algorithm|robot|learning|tech|app)\b/i;
        collected.sort((a, b) => {
          const aMatch = aiKeywords.test(a.content || a.text || '') ? 1 : 0;
          const bMatch = aiKeywords.test(b.content || b.text || '') ? 1 : 0;
          return bMatch - aMatch;
        });
      }
      return collected.slice(0, count);
    }

    // Call platform-specific search method
    const results = await scraper[config.method]({
      query: niche,
      limit: count,
      concurrency: scraperConcurrency,
      delay: scraperDelay,
    });
    
    return Array.isArray(results) ? results : results?.items || results?.posts || [];
  } finally {
    if (typeof scraper.cleanup === 'function') {
      await scraper.cleanup();
    }
  }
}

/**
 * Classify posts with Jev batch
 * @param {Array} posts - Raw posts
 * @param {string} platform - Platform identifier
 * @param {Object} options - { concurrency, onProgress }
 * @returns {Promise<PostViralProfile[]>}
 */
async function classifyPosts(posts, platform, options = {}) {
  const { concurrency = 10, onProgress } = options;
  const questions = getPlatformQuestions(platform);
  const category = getPlatformCategory(platform);
  
  const brain = new JevBrain();
  
  // Prepare batch requests
  const requests = posts.map((post, index) => ({
    state: {
      text: post.content || post.text || post.title || post.description || '',
      platform,
      category,
      metrics: post.metrics || {},
    },
    questions,
  }));
  
  // Batch decide with progress tracking
  const results = await brain.batchDecide(requests, {
    concurrency,
    onProgress: (progress) => {
      if (onProgress && progress.completed % 100 === 0) {
        onProgress({
          phase: 'classify',
          completed: progress.completed,
          total: posts.length,
          percentage: Math.round((progress.completed / posts.length) * 100),
        });
      }
    },
  });
  
  // Join results with posts
  return posts.map((post, index) => ({
    id: post.id || `post-${index}`,
    platform,
    category,
    niche: post.niche || '',
    text: post.content || post.text || post.title || post.description || '',
    metrics: post.metrics || {},
    viralDNA: results[index]?.answers || {},
    jevDegraded: results[index]?.meta?.degraded || false,
    scrapedAt: new Date().toISOString(),
  }));
}

/**
 * Save corpus to file
 * @param {PostViralProfile[]} profiles - Classified profiles
 * @param {string} platform - Platform
 * @param {string} niche - Niche
 * @returns {Promise<string>} Output file path
 */
async function saveCorpus(profiles, platform, niche) {
  const category = getPlatformCategory(platform);
  const normalizedNiche = normalizeNiche(niche);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  const dir = `data/viral-corpus`;
  await fs.mkdir(dir, { recursive: true });
  
  const filename = `${category}-${platform}-${normalizedNiche}-${timestamp}.json`;
  const filepath = path.join(dir, filename);
  
  await fs.writeFile(filepath, JSON.stringify(profiles, null, 2));
  
  return filepath;
}

/**
 * Main mining function
 * @param {Object} params - { platform, niche, count }
 * @param {Object} options - { session, scraperConcurrency, scraperDelay, jevConcurrency, onProgress }
 * @returns {Promise<MiningResult>}
 */
export async function viralMine(params, options = {}) {
  const {
    platform,
    niche,
    count = 1000,
  } = params;
  
  const {
    session,
    scraperConcurrency = 3,
    scraperDelay = 2000,
    jevConcurrency = 10,
    onProgress,
  } = options;
  
  const jobId = `viral-${Date.now()}`;
  const startTime = Date.now();
  
  // Validate platform
  if (!listPlatforms().includes(platform)) {
    throw new Error(`Platform '${platform}' not supported. Available: ${listPlatforms().join(', ')}`);
  }
  
  // Report progress: scraping
  if (onProgress) {
    onProgress({ phase: 'scrape', status: 'started', platform, niche, count });
  }
  
  // Scrape posts
  const posts = await scrapePosts(platform, niche, count, {
    scraperConcurrency,
    scraperDelay,
    session,
  });
  
  if (onProgress) {
    onProgress({ phase: 'scrape', status: 'completed', scraped: posts.length });
  }
  
  // Report progress: classifying
  if (onProgress) {
    onProgress({ phase: 'classify', status: 'started', total: posts.length });
  }
  
  // Classify with Jev
  const profiles = await classifyPosts(posts, platform, {
    concurrency: jevConcurrency,
    onProgress,
  });
  
  if (onProgress) {
    onProgress({ phase: 'classify', status: 'completed', classified: profiles.length });
  }
  
  // Save corpus
  const outputPath = await saveCorpus(profiles, platform, niche);

  // Aggregate and save stats
  let stats = null;
  let statsPath = null;
  try {
    const { aggregateStats, saveStats } = await import('./viralStatsStore.js');
    stats = aggregateStats(profiles, platform, niche);
    statsPath = await saveStats(stats, platform, niche);
  } catch (err) {
    console.warn(`[viralMine] Stats aggregation failed: ${err.message}`);
  }
  
  const durationMs = Date.now() - startTime;
  const cost = estimateCost(posts.length);
  
  return {
    jobId,
    platform,
    niche,
    requested: count,
    scraped: posts.length,
    classified: profiles.length,
    profiles,
    stats,
    statsPath,
    cost,
    outputPath,
    durationMs,
    status: posts.length === 0 ? 'failed' : posts.length < count ? 'partial' : 'completed',
  };
}

export default {
  viralMine,
  normalizeNiche,
  estimateCost,
  getScraper,
};
