// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Trend Analyzer (Story 42.6)
// Semantic classification + brand safety + opportunity scoring for trending topics.
// by nichxbt

import { JevBrain } from '../agents/jevBrain.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** @type {Map<string, {result: Object, expiresAt: number}>} */
const _trendCache = new Map();

/**
 * Clear the in-memory trend analysis cache (tests + forced refresh).
 */
export function clearTrendCache() {
  _trendCache.clear();
}

/**
 * Semantic trend analysis via Jev typed decision.
 *
 * One `decide()` call per trend with three questions:
 *   - `vertical`    — Choice: which content vertical the trend belongs to.
 *   - `brandSafe`   — Noul: probability the trend is related to tragic events,
 *                     scams, or ongoing controversy (high = unsafe).
 *   - `opportunity` — Score 0-3: whether this is a thought-leader comment
 *                     opportunity (0=avoid, 1=neutral, 2=good_hook, 3=must_post).
 *
 * Returns `null` when the plane is degraded (no key / budget exhausted / HTTP
 * error) — callers MUST treat `null` as "no opinion" and keep the trend,
 * never over-filter.
 *
 * Results are cached for {@link DEFAULT_TTL_MS} to avoid duplicate calls
 * within a session.
 *
 * @param {string} topic — trending topic text.
 * @param {Object} [options]
 * @param {JevBrain} [options.brain] — pre-built JevBrain (optional; lazy singleton used otherwise).
 * @param {number} [options.ttlMs] — cache TTL override.
 * @returns {Promise<{vertical: string, verticalConfidence: number, brandSafeNoul: number, opportunityScore: number, opportunityConfidence: number, raw: Object} | null>}
 */
export async function analyzeTrend(topic, { brain, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!topic || typeof topic !== 'string') return null;

  const key = topic.toLowerCase().trim();
  const cached = _trendCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const jev = brain || new JevBrain({});

  const decision = await jev.decide(
    { topic },
    {
      vertical: {
        type: 'choice',
        instructions: 'Which content vertical does this trending topic belong to?',
        criteria: {
          tech_ai: 'Technology, AI, software, devtools, startups',
          crypto_web3: 'Crypto, blockchain, DeFi, NFTs, Web3',
          politics: 'Politics, elections, government, policy',
          sports: 'Sports, games, athletes, leagues',
          entertainment: 'Movies, music, celebrities, TV, awards',
          business: 'Markets, finance, stocks, economy, companies',
          gaming: 'Video games, consoles, esports, streaming',
          science: 'Space, climate, health, research, discoveries',
          culture_meme: 'Memes, viral moments, internet culture',
          other: 'Does not fit any of the above',
        },
      },
      brandSafe: {
        type: 'noul',
        instructions: 'This trend is related to tragic events, scams, ongoing controversy, or topics brands should not associate with',
      },
      opportunity: {
        type: 'score',
        instructions: 'Rate this trend as a thought-leader comment opportunity for an account in the AI/tech space',
        criteria: ['avoid', 'neutral', 'good_hook', 'must_post'],
      },
    },
  );

  if (decision.meta.degraded) return null;

  const vertical = decision.answers.vertical || {};
  const brandSafe = decision.answers.brandSafe || {};
  const opportunity = decision.answers.opportunity || {};

  const result = {
    vertical: vertical.choice ?? 'other',
    verticalConfidence: vertical.confidence ?? 0,
    brandSafeNoul: brandSafe.noul ?? 0,
    opportunityScore: opportunity.score ?? 0,
    opportunityConfidence: opportunity.confidence ?? 0,
    raw: decision.answers,
  };

  _trendCache.set(key, { result, expiresAt: Date.now() + ttlMs });
  return result;
}

/**
 * Batch trend analysis — classify each topic and filter by brand safety +
 * opportunity thresholds. Used by `_createContent` to decide which trends
 * are worth riding in generated content.
 *
 * @param {string[]} topics — trending topic strings.
 * @param {Object} [options]
 * @param {JevBrain} [options.brain]
 * @param {number} [options.brandSafeThreshold] — brandSafe.noul >= this → unsafe (default 0.5).
 * @param {number} [options.opportunityThreshold] — opportunity.score >= this → keep (default 2 = good_hook).
 * @returns {Promise<{ filtered: string[], analyses: Map<string, Object|null>, degraded: boolean }>}
 *   - `filtered`  — topics that passed both gates.
 *   - `analyses`  — per-topic result map (null = degraded / un-analyzed).
 *   - `degraded`  — true when EVERY analysis returned null (no Jev signal at all).
 */
export async function analyzeTrends(topics, { brain, brandSafeThreshold = 0.5, opportunityThreshold = 2 } = {}) {
  const analyses = new Map();
  const filtered = [];
  let degradedCount = 0;

  for (const topic of topics || []) {
    const result = await analyzeTrend(topic, { brain });
    analyses.set(topic, result);
    if (result === null) {
      degradedCount++;
      continue;
    }
    const unsafe = result.brandSafeNoul >= brandSafeThreshold;
    const goodHook = result.opportunityScore >= opportunityThreshold;
    const verdict = unsafe ? '🚫 unsafe' : goodHook ? '✅ hook' : '➖ skip';
    console.log(`   ${verdict} "${topic}" [${result.vertical}] safety=${result.brandSafeNoul.toFixed(2)} opp=${result.opportunityScore}`);
    if (!unsafe && goodHook) filtered.push(topic);
  }

  return { filtered, analyses, degraded: degradedCount === (topics?.length ?? 0) };
}

export { JevBrain };
