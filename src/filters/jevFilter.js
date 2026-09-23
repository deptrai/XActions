// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Jev Filter — Live Feed Prioritizer
 * 
 * Uses viral stats from Epic 45 to rank/prioritize posts in live feeds.
 * Posts matching high-viral-rate patterns get boosted in reply/engage queue.
 * 
 * @module src/filters/jevFilter
 */

import { getPlatformQuestions } from '../analytics/platformQuestions.js';

/**
 * @typedef {Object} Post
 * @property {string} id
 * @property {string} text
 * @property {string} platform
 * @property {Object} metrics - likes, shares, views, comments
 * @property {Object} [viralDNA] - Jev classification results
 */

/**
 * @typedef {Object} ViralStats
 * @property {Object} hookTypeDistribution - { [hookType]: { viralRate, avgEngagement } }
 * @property {Array} topPerformingPatterns - Top attribute combinations
 * @property {number} viralRateThreshold - Top 10% threshold
 */

/**
 * Calculate viral score for a post based on viral stats
 * @param {Post} post - Post to score
 * @param {ViralStats} viralStats - Viral stats for platform+niche
 * @returns {number} Viral score 0-100
 */
export function calculateViralScore(post, viralStats) {
  if (!viralStats || !post.viralDNA) {
    // Fallback: use engagement rate heuristic
    const engagement = (post.metrics?.likes || 0) + (post.metrics?.shares || 0) * 2 + (post.metrics?.comments || 0) * 3;
    return Math.min(100, engagement / 100);
  }
  
  const { viralDNA } = post;
  const { hookTypeDistribution, topPerformingPatterns } = viralStats;
  
  let score = 50; // Base score
  
  // Hook type bonus
  const hookType = typeof viralDNA.hookType === 'object' ? viralDNA.hookType?.choice : viralDNA.hookType;
  if (hookType && hookTypeDistribution && hookTypeDistribution[hookType]) {
    const viralRate = hookTypeDistribution[hookType].viralRate || 0;
    score += viralRate * 10; // Up to +30 for high viral rate
  }
  
  // Pattern match bonus
  if (topPerformingPatterns) {
    for (const pattern of topPerformingPatterns.slice(0, 3)) {
      const attrs = pattern.attributes || {};
      let matchCount = 0;
      for (const [key, value] of Object.entries(attrs)) {
        if (viralDNA[key] === value) matchCount++;
      }
      if (matchCount >= 2) {
        score += 15; // Pattern match bonus
        break;
      }
    }
  }
  
  // Emotional trigger bonus
  const emotionalTrigger = viralDNA.emotionalTrigger;
  if (emotionalTrigger && emotionalTrigger !== 'none') {
    score += 10;
  }
  
  // Numbers bonus
  if (viralDNA.hasNumbers) {
    score += 5;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Filter and rank posts by viral potential
 * @param {Post[]} posts - Posts to rank
 * @param {ViralStats} viralStats - Viral stats for platform+niche
 * @param {Object} options - { limit, threshold, boostPatterns }
 * @returns {Post[]} Ranked posts with viralScore
 */
export function filterByViralPotential(posts, viralStats, options = {}) {
  const { limit = 50, threshold = 60, boostPatterns = true } = options;
  
  return posts
    .map(post => ({
      ...post,
      viralScore: calculateViralScore(post, viralStats),
    }))
    .filter(post => post.viralScore >= threshold)
    .sort((a, b) => b.viralScore - a.viralScore)
    .slice(0, limit);
}

/**
 * Prioritize posts for engagement (reply, like, share)
 * @param {Post[]} posts - Posts to prioritize
 * @param {ViralStats} viralStats - Viral stats
 * @param {Object} options - { prioritizeHighViral, maxEngagements }
 * @returns {Post[]} Prioritized posts
 */
export function prioritizeForEngagement(posts, viralStats, options = {}) {
  const { prioritizeHighViral = true, maxEngagements = 20 } = options;
  
  const scored = posts.map(post => ({
    ...post,
    viralScore: calculateViralScore(post, viralStats),
    engagementPriority: prioritizeHighViral 
      ? calculateViralScore(post, viralStats) 
      : post.metrics?.likes || 0,
  }));
  
  return scored
    .sort((a, b) => b.engagementPriority - a.engagementPriority)
    .slice(0, maxEngagements);
}

export default {
  calculateViralScore,
  filterByViralPotential,
  prioritizeForEngagement,
};
