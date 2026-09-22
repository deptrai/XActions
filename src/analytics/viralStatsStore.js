// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Viral Stats Store — Aggregation & Persistence
 * 
 * Story 45.2: Aggregate PostViralProfile[] into ViralStats,
 * persist to data/viral-stats/{category}-{platform}-{niche}.json
 * 
 * @module src/analytics/viralStatsStore
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { normalizeNiche } from './jevViralMiner.js';
import { getPlatformCategory } from './platformQuestions.js';

/**
 * Zod schema for ViralStats validation
 */
export const ViralStatsSchema = z.object({
  platform: z.string(),
  category: z.enum(['social', 'recruitment', 'realestate', 'ecom']),
  niche: z.string(),
  sampleSize: z.number(),
  generatedAt: z.string().datetime(),
  viralRateThreshold: z.number(),
  hookTypeDistribution: z.record(z.string(), z.object({
    count: z.number(),
    avgEngagement: z.number(),
    viralRate: z.number(),
  })),
  topPerformingPatterns: z.array(z.object({
    attributes: z.record(z.string(), z.any()),
    avgEngagement: z.number(),
    count: z.number(),
  })),
  attributeCorrelations: z.record(z.string(), z.number()),
  platformSpecificMetrics: z.record(z.string(), z.object({
    distribution: z.record(z.string(), z.number()),
    avgEngagement: z.number(),
  })).optional(),
  categoryInsights: z.object({
    comparedPlatforms: z.array(z.string()),
    bestPerforming: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
});

/**
 * @typedef {Object} ViralStats
 * @property {string} platform
 * @property {string} category
 * @property {string} niche
 * @property {number} sampleSize
 * @property {string} generatedAt
 * @property {number} viralRateThreshold
 * @property {Object} hookTypeDistribution
 * @property {Array} topPerformingPatterns
 * @property {Object} attributeCorrelations
 * @property {Object} [platformSpecificMetrics]
 * @property {Object} [categoryInsights]
 */

/**
 * Calculate engagement score from metrics
 * @param {Object} metrics - { likes, shares, views, comments, applies, saves }
 * @returns {number}
 */
function calculateEngagement(metrics) {
  const { likes = 0, shares = 0, views = 0, comments = 0, applies = 0, saves = 0 } = metrics || {};
  // Weighted engagement: shares > comments > likes > views
  return (shares * 3) + (comments * 2) + likes + (views * 0.1) + (applies * 2) + (saves * 1.5);
}

/**
 * Determine viral threshold (top 10% engagement)
 * @param {PostViralProfile[]} profiles
 * @returns {number}
 */
function calculateViralThreshold(profiles) {
  const engagements = profiles
    .map(p => calculateEngagement(p.metrics))
    .sort((a, b) => b - a);
  
  const top10Index = Math.floor(engagements.length * 0.1);
  return engagements[top10Index] || 0;
}

/**
 * Aggregate profiles into ViralStats
 * @param {PostViralProfile[]} profiles
 * @param {string} platform
 * @param {string} niche
 * @returns {ViralStats}
 */
export function aggregateStats(profiles, platform, niche) {
  const category = getPlatformCategory(platform);
  const viralThreshold = calculateViralThreshold(profiles);
  
  // Group by hookType
  const hookGroups = {};
  for (const profile of profiles) {
    const hookType = profile.viralDNA?.hookType || 'unknown';
    if (!hookGroups[hookType]) {
      hookGroups[hookType] = [];
    }
    hookGroups[hookType].push(profile);
  }
  
  // Calculate hook type distribution
  const hookTypeDistribution = {};
  for (const [hookType, group] of Object.entries(hookGroups)) {
    const engagements = group.map(p => calculateEngagement(p.metrics));
    const avgEngagement = engagements.reduce((a, b) => a + b, 0) / engagements.length;
    const viralCount = engagements.filter(e => e >= viralThreshold).length;
    const viralRate = viralCount / group.length;
    
    hookTypeDistribution[hookType] = {
      count: group.length,
      avgEngagement,
      viralRate: Math.round(viralRate * 10000) / 100, // Percentage with 2 decimals
    };
  }
  
  // Find top performing patterns (attribute combinations)
  const patternMap = new Map();
  for (const profile of profiles) {
    const dna = profile.viralDNA || {};
    const key = JSON.stringify({
      hookType: dna.hookType,
      hasNumbers: dna.hasNumbers,
      emotionalTrigger: dna.emotionalTrigger,
    });
    
    if (!patternMap.has(key)) {
      patternMap.set(key, { attributes: dna, engagements: [], count: 0 });
    }
    patternMap.get(key).engagements.push(calculateEngagement(profile.metrics));
    patternMap.get(key).count++;
  }
  
  const topPerformingPatterns = Array.from(patternMap.values())
    .map(p => ({
      attributes: p.attributes,
      avgEngagement: p.engagements.reduce((a, b) => a + b, 0) / p.engagements.length,
      count: p.count,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 10);
  
  // Calculate attribute correlations with engagement
  const attributeCorrelations = {};
  const attributes = ['hookType', 'hasNumbers', 'emotionalTrigger', 'curiosityGap'];
  
  for (const attr of attributes) {
    const values = profiles.map(p => p.viralDNA?.[attr]);
    const engagements = profiles.map(p => calculateEngagement(p.metrics));
    
    // Simple correlation: variance of engagement by attribute value
    const groups = {};
    values.forEach((v, i) => {
      const key = String(v);
      if (!groups[key]) groups[key] = [];
      groups[key].push(engagements[i]);
    });
    
    const groupMeans = Object.values(groups).map(g => g.reduce((a, b) => a + b, 0) / g.length);
    const variance = groupMeans.reduce((sum, mean) => {
      const overallMean = engagements.reduce((a, b) => a + b, 0) / engagements.length;
      return sum + Math.pow(mean - overallMean, 2);
    }, 0) / groupMeans.length;
    
    attributeCorrelations[attr] = Math.round(variance * 100) / 100;
  }
  
  return {
    platform,
    category,
    niche,
    sampleSize: profiles.length,
    generatedAt: new Date().toISOString(),
    viralRateThreshold: viralThreshold,
    hookTypeDistribution,
    topPerformingPatterns,
    attributeCorrelations,
  };
}

/**
 * Save viral stats to file
 * @param {ViralStats} stats
 * @param {string} platform
 * @param {string} niche
 * @returns {Promise<string>} Output file path
 */
export async function saveStats(stats, platform, niche) {
  // Validate schema
  const validated = ViralStatsSchema.parse(stats);
  
  const category = getPlatformCategory(platform);
  const normalizedNiche = normalizeNiche(niche);
  const date = new Date().toISOString().split('T')[0];
  
  const dir = 'data/viral-stats';
  await fs.mkdir(dir, { recursive: true });
  
  // Save dated file
  const filename = `${category}-${platform}-${normalizedNiche}-${date}.json`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, JSON.stringify(validated, null, 2));
  
  // Update latest symlink
  const latestPath = path.join(dir, `latest-${platform}-${normalizedNiche}.json`);
  try {
    await fs.unlink(latestPath);
  } catch { /* ignore */ }
  await fs.symlink(filename, latestPath);
  
  return filepath;
}

/**
 * Load latest viral stats
 * @param {string} platform
 * @param {string} niche
 * @returns {Promise<ViralStats|null>}
 */
export async function loadLatestStats(platform, niche) {
  const normalizedNiche = normalizeNiche(niche);
  const latestPath = path.join('data/viral-stats', `latest-${platform}-${normalizedNiche}.json`);
  
  try {
    const content = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * List all available stats
 * @returns {Promise<Array<{platform, niche, filename, generatedAt}>>}
 */
export async function listStats() {
  const dir = 'data/viral-stats';
  
  try {
    const files = await fs.readdir(dir);
    const stats = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('latest-')) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const data = JSON.parse(content);
        stats.push({
          platform: data.platform,
          niche: data.niche,
          filename: file,
          generatedAt: data.generatedAt,
          sampleSize: data.sampleSize,
        });
      }
    }
    
    return stats.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  } catch {
    return [];
  }
}

export default {
  aggregateStats,
  saveStats,
  loadLatestStats,
  listStats,
  ViralStatsSchema,
};
