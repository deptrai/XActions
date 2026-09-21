// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Lead ICP Scorer (Story 42.7)
// High-throughput batch lead qualification via Jev typed decision.
// by nichxbt

import { JevBrain } from '../agents/jevBrain.js';

const DEFAULT_ICP =
  'B2B companies and founders who would benefit from AI-powered Twitter/X automation — content scheduling, smart engagement, lead generation';

/**
 * Score a single user profile for ICP fit via Jev typed decision.
 *
 * One `decide()` call with two questions:
 *   - `buyerIntent` — Choice: where the lead is in the buying journey.
 *   - `leadScore`   — Score 0-3: how well the profile matches the ICP.
 *
 * Returns `null` when the plane is degraded — caller treats as "no signal".
 *
 * @param {{username?: string, bio?: string, recentTweets?: string[]}} profile
 * @param {string} icp — ICP description.
 * @param {Object} [options]
 * @param {JevBrain} [options.brain] — pre-built JevBrain.
 * @returns {Promise<{username: string, buyerIntent: string, intentConfidence: number, leadScore: number, scoreConfidence: number} | null>}
 */
export async function scoreProfile(profile, icp = DEFAULT_ICP, { brain } = {}) {
  if (!profile || typeof profile !== 'object') return null;
  const username = profile.username || profile.handle || 'unknown';
  const bio = profile.bio || '';
  const tweets = (profile.recentTweets || []).slice(0, 5).join('\n---\n');

  const jev = brain || new JevBrain({});

  const decision = await jev.decide(
    { username, bio, recentTweets: tweets, icp },
    {
      buyerIntent: {
        type: 'choice',
        instructions: `Based on the user's bio and recent tweets, which buying intent stage best describes this lead for the ICP: "${icp}"?`,
        criteria: {
          not_a_lead: 'Not a potential customer — unrelated to the ICP',
          problem_aware: 'Experiencing the problem we solve but not actively seeking a solution',
          solution_seeking: 'Actively looking for a tool or service in this space',
          decision_maker: 'Has authority and intent to purchase — highest value lead',
        },
      },
      leadScore: {
        type: 'score',
        instructions: `Rate how well this profile matches the ICP: "${icp}"`,
        criteria: ['no_fit', 'weak_fit', 'good_fit', 'ideal_customer'],
      },
    },
  );

  if (decision.meta.degraded) return null;

  const intent = decision.answers.buyerIntent || {};
  const score = decision.answers.leadScore || {};

  return {
    username,
    buyerIntent: intent.choice ?? 'not_a_lead',
    intentConfidence: intent.confidence ?? 0,
    leadScore: score.score ?? 0,
    scoreConfidence: score.confidence ?? 0,
  };
}

/**
 * Batch-score a list of profiles against the ICP.
 * Sequential processing (Jev ~300ms/call) — rate-limit-friendly.
 *
 * @param {Array<{username?: string, bio?: string, recentTweets?: string[]}>} profiles
 * @param {string} [icp] — ICP description.
 * @param {Object} [options]
 * @param {JevBrain} [options.brain]
 * @param {number} [options.leadScoreThreshold] — minimum score to count as qualified (default 2 = good_fit).
 * @returns {Promise<{qualified: Array, all: Array, stats: {total: number, qualified: number, avgScore: number, degraded: boolean}}>}
 */
export async function scoreProfiles(profiles, icp = DEFAULT_ICP, { brain, leadScoreThreshold = 2 } = {}) {
  const all = [];
  const qualified = [];
  let degradedCount = 0;
  let totalScore = 0;
  let scoredCount = 0;

  for (const profile of profiles || []) {
    const result = await scoreProfile(profile, icp, { brain });
    if (result === null) {
      degradedCount++;
      continue;
    }
    all.push(result);
    if (result.leadScore >= leadScoreThreshold && result.buyerIntent !== 'not_a_lead') {
      qualified.push(result);
      const emoji = result.buyerIntent === 'decision_maker' ? '💎' : result.buyerIntent === 'solution_seeking' ? '🔍' : '💡';
      console.log(`   ${emoji} @${result.username} intent=${result.buyerIntent} score=${result.leadScore} conf=${result.intentConfidence.toFixed(2)}`);
    } else {
      console.log(`   ➖ @${result.username} intent=${result.buyerIntent} score=${result.leadScore}`);
    }
    totalScore += result.leadScore;
    scoredCount++;
  }

  const total = profiles?.length ?? 0;
  return {
    qualified,
    all,
    stats: {
      total,
      qualified: qualified.length,
      avgScore: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 100) / 100 : 0,
      degraded: degradedCount === total,
    },
  };
}

export { DEFAULT_ICP };
