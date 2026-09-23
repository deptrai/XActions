// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Jev Backtest — Validate Predictions vs Actual Performance
 * 
 * Story 45.4: Compare predicted-viral vs actual performance on own posts,
 * calculate precision/recall metrics per platform.
 * 
 * @module src/analytics/jevBacktest
 */

import { promises as fs } from 'fs';
import path from 'path';
import { normalizeNiche } from './jevViralMiner.js';
import { getPlatformCategory } from './platformQuestions.js';
import { loadLatestStats } from './viralStatsStore.js';
import { calculateViralScore } from '../filters/jevFilter.js';

/**
 * @typedef {Object} BacktestResult
 * @property {string} reportId
 * @property {string} platform
 * @property {string} niche
 * @property {number} days
 * @property {number} sampleSize
 * @property {Object} metrics - precision, recall, accuracyByHookType
 * @property {Object} platformBreakdown
 * @property {string} summary
 * @property {string} generatedAt
 */

/**
 * Fetch own posts from platform for backtest period
 * @param {string} platform
 * @param {number} days
 * @param {Object} options - { session }
 * @returns {Promise<Array>}
 */
async function fetchOwnPosts(platform, days, options = {}) {
  const { session, mockPosts, testMode } = options;
  
  // Test mode: return mock posts directly
  if (testMode && mockPosts) {
    return mockPosts;
  }
  
  // Check for local corpus files first to backtest offline
  try {
    const dir = 'data/viral-corpus';
    const files = await fs.readdir(dir).catch(() => []);
    const matches = files.filter(f => f.includes(`-${platform}-`)).sort().reverse();
    for (const match of matches) {
      try {
        const content = await fs.readFile(path.join(dir, match), 'utf8');
        const posts = JSON.parse(content);
        if (Array.isArray(posts) && posts.length >= 10) {
          return posts;
        }
      } catch {}
    }
  } catch {}

  // Platform-specific fetch logic
  const scraperMap = {
    twitter: { module: '../scrapers/social/twitter/crawler.js', class: 'TwitterCrawler', method: 'profile' },
    threads: { module: '../scrapers/social/threads/crawler.js', class: 'ThreadsCrawler', method: 'getUserFeed' },
    linkedin: { module: '../scrapers/recruitment/linkedin/crawler.js', class: 'LinkedInCrawler', method: 'leadProfile' },
  };
  
  const config = scraperMap[platform];
  if (!config) {
    throw new Error(`Backtest not supported for platform: ${platform}`);
  }
  
  try {
    const module = await import(config.module);
    const ScraperClass = module[config.class];
    const scraper = new ScraperClass(platform === 'threads' ? { client: 'curl', requiresProxy: true, requiresResidential: true } : {});
    
    if (typeof scraper.init === 'function') {
      await scraper.init(session);
    }
    
    const args = platform === 'threads'
      ? { username: options.username || 'mosseri', count: 20 }
      : { days };
    const posts = await scraper[config.method](args);
    
    if (typeof scraper.cleanup === 'function') {
      await scraper.cleanup();
    }
    
    return posts;
  } catch (err) {
    throw new Error(`Failed to fetch own posts: ${err.message}`);
  }
}

/**
 * Calculate precision and recall
 * @param {Array} predictions - Posts predicted viral
 * @param {Array} actuals - Posts actually viral
 * @returns {Object} { precision, recall }
 */
function calculateMetrics(predictions, actuals) {
  const predIds = new Set(predictions.map(p => p.id));
  const actualIds = new Set(actuals.map(p => p.id));
  
  const truePositives = predictions.filter(p => actualIds.has(p.id)).length;
  
  const precision = predictions.length > 0 ? truePositives / predictions.length : 0;
  const recall = actuals.length > 0 ? truePositives / actuals.length : 0;
  
  return {
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    truePositives,
    falsePositives: predictions.length - truePositives,
    falseNegatives: actuals.length - truePositives,
  };
}

/**
 * Group posts by hook type for accuracy breakdown
 * @param {Array} posts
 * @returns {Object}
 */
function groupByHookType(posts) {
  const groups = {};
  for (const post of posts) {
    const rawHook = post.viralDNA?.hookType;
    const hookType = typeof rawHook === 'object' && rawHook?.choice ? rawHook.choice : (rawHook || 'unknown');
    if (!groups[hookType]) {
      groups[hookType] = { predicted: 0, actual: 0, posts: [] };
    }
    groups[hookType].posts.push(post);
  }
  return groups;
}

/**
 * Run backtest
 * @param {Object} params - { platform, niche, days }
 * @param {Object} options - { session, viralThreshold }
 * @returns {Promise<BacktestResult>}
 */
export async function runBacktest(params, options = {}) {
  const { platform, niche, days = 7 } = params;
  const { session, viralThreshold = 0.7 } = options;
  
  const reportId = `backtest-${Date.now()}`;
  
  // Load viral stats
  const stats = await loadLatestStats(platform, niche);
  if (!stats) {
    throw new Error(`No viral stats found for ${platform}/${niche}. Run mining first.`);
  }
  
  // Fetch own posts
  const ownPosts = await fetchOwnPosts(platform, days, options);
  
  if (ownPosts.length < 10) {
    return {
      reportId,
      platform,
      niche,
      days,
      sampleSize: ownPosts.length,
      metrics: { precision: 0, recall: 0 },
      summary: `Insufficient data: only ${ownPosts.length} posts in last ${days} days. Need at least 10.`,
      generatedAt: new Date().toISOString(),
      status: 'insufficient_data',
    };
  }
  
  // Classify own posts (reuse viral DNA from stats if available, else re-classify)
  // For now, use viralDNA from posts if present, else mark as unknown
  const classifiedPosts = ownPosts.map(post => ({
    ...post,
    viralScore: calculateViralScore(post, stats),
    predictedViral: calculateViralScore(post, stats) >= 70, // Score >= 70 = predicted viral
    actualViral: (post.metrics?.likes || 0) >= stats.viralRateThreshold,
  }));
  
  // Split into predicted/actual
  const predictedViral = classifiedPosts.filter(p => p.predictedViral);
  const actualViral = classifiedPosts.filter(p => p.actualViral);
  
  // Calculate metrics
  const { precision, recall, truePositives, falsePositives, falseNegatives } = calculateMetrics(
    predictedViral,
    actualViral
  );
  
  // Accuracy by hook type
  const hookGroups = groupByHookType(classifiedPosts);
  const accuracyByHookType = {};
  
  for (const [hookType, group] of Object.entries(hookGroups)) {
    const pred = group.posts.filter(p => p.predictedViral).length;
    const act = group.posts.filter(p => p.actualViral).length;
    const correct = group.posts.filter(p => p.predictedViral && p.actualViral).length;
    
    accuracyByHookType[hookType] = {
      predicted: pred,
      actual: act,
      accuracy: pred > 0 ? Math.round((correct / pred) * 100) / 100 : 0,
    };
  }
  
  // Generate summary
  const topHook = Object.entries(accuracyByHookType)
    .sort((a, b) => b[1].accuracy - a[1].accuracy)[0];
  
  const summary = `Backtest complete: ${Math.round(precision * 100)}% precision, ${Math.round(recall * 100)}% recall. ` +
    `${topHook ? `${topHook[0]} hooks: ${Math.round(topHook[1].accuracy * 100)}% accurate.` : ''}`;
  
  const result = {
    reportId,
    platform,
    niche,
    days,
    sampleSize: ownPosts.length,
    metrics: {
      precision,
      recall,
      truePositives,
      falsePositives,
      falseNegatives,
      viralThreshold,
    },
    accuracyByHookType,
    platformBreakdown: {
      [platform]: { precision, recall, sampleSize: ownPosts.length },
    },
    summary,
    generatedAt: new Date().toISOString(),
    status: 'completed',
  };
  
  // Save report
  const category = getPlatformCategory(platform);
  const normalizedNiche = normalizeNiche(niche);
  const date = new Date().toISOString().split('T')[0];
  
  const dir = 'data/backtest-reports';
  await fs.mkdir(dir, { recursive: true });
  
  const filename = `${category}-${platform}-${normalizedNiche}-${date}.json`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, JSON.stringify(result, null, 2));
  
  result.outputPath = filepath;
  
  return result;
}

/**
 * Get backtest report by ID
 * @param {string} reportId
 * @returns {Promise<BacktestResult|null>}
 */
export async function getBacktestReport(reportId) {
  // Search in data/backtest-reports/
  const dir = 'data/backtest-reports';
  
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.includes(reportId)) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        return JSON.parse(content);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default {
  runBacktest,
  getBacktestReport,
};
