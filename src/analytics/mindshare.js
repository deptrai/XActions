// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Token Mindshare Engine — Share-of-Voice % + Delta 24h/7d (Story 54.4).
 *
 * Read-path metric engine over `token_mentions` (watchlist-scope share per AD-7):
 * - `mindsharePct`: weighted-mention volume per token ÷ total weighted volume across watchlist universe
 * - `delta24h`: current 24h share - trailing 24h share [now-48h, now-24h)
 * - `delta7d`: current 7d share - trailing 7d share [now-14d, now-7d)
 * - `topVoices`: top N authors by weighted mentions in the active window
 * - `insufficientHistory`: flag when baseline has < minBaselineDays (<3 days)
 * - `degraded`: passthrough flag from pipeline healthFn (AD-3)
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabase } from './historyStore.js';

// ============================================================================
// Constants & Defaults
// ============================================================================

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_BASELINE_DAYS = 3;

/** Default engagement weights reused from tokenMentionPipeline.js. */
const DEFAULT_WEIGHTS = Object.freeze({ likes: 0.5, retweets: 0.3, replies: 0.2 });

/**
 * Default follower bands for weighting (Design Note 3):
 * <1k -> 1, 1k–10k -> 1.5, 10k–100k -> 2, >100k -> 3.
 */
const DEFAULT_FOLLOWER_BANDS = Object.freeze([
  { max: 1000, weight: 1 },
  { max: 10000, weight: 1.5 },
  { max: 100000, weight: 2 },
  { max: Infinity, weight: 3 },
]);

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_24H_MS = 24 * HOUR_MS;
const WINDOW_7D_MS = 7 * DAY_MS;

// ============================================================================
// Watchlist Helpers
// ============================================================================

function loadDefaultWatchlist() {
  try {
    const p = fileURLToPath(new URL('../../config/token-watchlist.json', import.meta.url));
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Canonical tokenId for a watchlist entry (AD-1 grammar):
 * `token:{chain}:{contract}` when contract present, else `token:sym:{SYMBOL}`.
 * EVM contracts are lowercased to avoid splitting rows.
 * @param {{ symbol?: string, contract?: string, chain?: string } | null | undefined} token
 * @returns {string|null}
 */
function canonicalIdFor(token) {
  if (!token || typeof token !== 'object' || !token.symbol) return null;
  if (token.contract && token.chain) {
    const contract = /^0x/i.test(String(token.contract))
      ? String(token.contract).toLowerCase()
      : String(token.contract);
    return `token:${token.chain}:${contract}`;
  }
  return `token:sym:${String(token.symbol).toUpperCase()}`;
}

// ============================================================================
// Mention Weight Calculations
// ============================================================================

/**
 * @param {number|string|null|undefined} followers
 * @param {ReadonlyArray<{ max: number, weight: number }>} bands
 * @returns {number}
 */
function followerWeight(followers, bands) {
  const f = Number(followers);
  if (!Number.isFinite(f) || f < 0) return bands[0].weight;
  for (const band of bands) {
    if (f < band.max) return band.weight;
  }
  return bands[bands.length - 1].weight;
}

/**
 * @param {any} engagementRaw
 * @param {{ likes?: number, retweets?: number, replies?: number }} weights
 * @returns {number}
 */
function engagementScore(engagementRaw, weights) {
  if (!engagementRaw) return 0;
  let eng = engagementRaw;
  if (typeof eng === 'string') {
    try {
      eng = JSON.parse(engagementRaw);
    } catch {
      return 0;
    }
  }
  if (!eng || typeof eng !== 'object') return 0;

  const likes = Math.max(0, Number(eng.likes || eng.like_count) || 0);
  const retweets = Math.max(0, Number(eng.retweets || eng.retweet_count) || 0);
  const replies = Math.max(0, Number(eng.replies || eng.reply_count) || 0);

  const wLikes = weights.likes ?? 0.5;
  const wRetweets = weights.retweets ?? 0.3;
  const wReplies = weights.replies ?? 0.2;

  return likes * wLikes + retweets * wRetweets + replies * wReplies;
}

/**
 * Compute the weighted volume for a single token_mentions row:
 * weighted_volume = follower_weight + engagement_score
 * @param {any} row
 * @param {ReadonlyArray<{ max: number, weight: number }>} followerBands
 * @param {{ likes?: number, retweets?: number, replies?: number }} weights
 * @returns {number}
 */
function computeRowWeight(row, followerBands, weights) {
  const fw = followerWeight(row.followers, followerBands);
  const es = engagementScore(row.engagement, weights);
  return fw + es;
}

// ============================================================================
// Engine Factory
// ============================================================================

/**
 * Create a MindshareEngine instance with injectable seams (Design Note 4).
 *
 * @param {object} [options]
 * @param {import('better-sqlite3').Database} [options.db] - SQLite connection (default: getDatabase())
 * @param {() => { degraded: boolean, consecutiveEmptyBatches?: number, degradedSince?: number }} [options.healthFn] - health source (default: pipeline status)
 * @param {() => number} [options.now] - timestamp generator (default: Date.now)
 * @param {object} [options.watchlist] - parsed token-watchlist.json (default: loaded from disk)
 * @param {number} [options.topN=10] - max top voices to return per token
 * @param {number} [options.minBaselineDays=3] - minimum distinct days required in 7d baseline
 * @param {ReadonlyArray<{ max: number, weight: number }>} [options.followerBands]
 * @param {{ likes?: number, retweets?: number, replies?: number }} [options.weights]
 */
export function createMindshareEngine(options = {}) {
  const getDb = () => options.db || getDatabase();
  const healthFn = options.healthFn || (() => ({ degraded: false }));
  const now = options.now || (() => Date.now());
  const watchlist = options.watchlist !== undefined ? options.watchlist : loadDefaultWatchlist();
  const topN = typeof options.topN === 'number' ? options.topN : DEFAULT_TOP_N;
  const minBaselineDays = typeof options.minBaselineDays === 'number' ? options.minBaselineDays : DEFAULT_MIN_BASELINE_DAYS;
  const followerBands = Array.isArray(options.followerBands) && options.followerBands.length > 0
    ? options.followerBands
    : DEFAULT_FOLLOWER_BANDS;
  const weights = options.weights || DEFAULT_WEIGHTS;

  function getEngineConfig() {
    return {
      topN,
      minBaselineDays,
      weights,
      followerBands,
    };
  }

  /** @type {any} */
  let _stmts = null;
  function stmts() {
    if (_stmts) return _stmts;
    const db = /** @type {import('better-sqlite3').Database} */ (getDb());
    _stmts = {
      windowRows: db.prepare(`
        SELECT token_id, author, followers, engagement, ts, is_bot
        FROM token_mentions
        WHERE ts >= ? AND ts < ?
      `),
      distinctTokens: db.prepare(`
        SELECT DISTINCT token_id FROM token_mentions
      `),
      distinctDays7d: db.prepare(`
        SELECT token_id, CAST(ts / 86400000 AS INTEGER) AS d
        FROM token_mentions
        WHERE ts >= ? AND ts < ?
        GROUP BY token_id, d
      `),
    };
    return _stmts;
  }

  /**
   * Aggregate mentions in [fromTs, toTs) into weighted volume per token.
   * Optionally collects author stats for Top Voices ranking.
   *
   * @param {number} fromTs
   * @param {number} toTs
   * @param {boolean} [collectVoices=false]
   * @returns {{
   *   tokenVolumes: Map<string, number>,
   *   totalVolume: number,
   *   rowCount: number,
   *   authorStats: Map<string, Map<string, { weightedVolume: number, mentions: number }>>
   * }}
   */
  function aggregateWindow(fromTs, toTs, collectVoices = false) {
    const tokenVolumes = new Map();
    const authorStats = new Map();
    let totalVolume = 0;
    let rowCount = 0;

    for (const row of stmts().windowRows.iterate(fromTs, toTs)) {
      rowCount += 1;
      const w = computeRowWeight(row, followerBands, weights);
      const tid = row.token_id;
      tokenVolumes.set(tid, (tokenVolumes.get(tid) || 0) + w);
      totalVolume += w;

      if (collectVoices && row.author && typeof row.author === 'string' && row.author.trim()) {
        const cleanAuthor = row.author.trim().replace(/^@/, '').toLowerCase();
        if (cleanAuthor) {
          let tokAuthors = authorStats.get(tid);
          if (!tokAuthors) {
            tokAuthors = new Map();
            authorStats.set(tid, tokAuthors);
          }
          const prev = tokAuthors.get(cleanAuthor) || { weightedVolume: 0, mentions: 0 };
          prev.weightedVolume += w;
          prev.mentions += 1;
          tokAuthors.set(cleanAuthor, prev);
        }
      }
    }

    return { tokenVolumes, totalVolume, rowCount, authorStats };
  }

/**
 * @typedef {Object} MindshareTopVoice
 * @property {string} author
 * @property {number} weightedVolume
 * @property {number} mentions
 */

/**
 * @typedef {Object} MindshareTokenItem
 * @property {string} token
 * @property {number} mindsharePct
 * @property {number|null} delta24h
 * @property {number|null} delta7d
 * @property {MindshareTopVoice[]} topVoices
 * @property {boolean} degraded
 * @property {boolean} [insufficientHistory]
 */

/**
 * @typedef {Object} MindshareComputeResult
 * @property {string} scope
 * @property {number} windowHours
 * @property {MindshareTokenItem[]} tokens
 * @property {boolean} degraded
 * @property {number} [consecutiveEmptyBatches]
 * @property {number} [degradedSince]
 * @property {string} [warning]
 * @property {string} generatedAt
 */

/**
 * Main calculation function.
 *
 * @param {string} [tokenId] - canonical token id filter (undefined for all)
 * @param {object} [options]
 * @param {number} [options.hours=24] - active window in hours
 * @returns {Promise<MindshareComputeResult>}
 */
  async function computeMindshare(tokenId, options = {}) {
    const opts = options || {};
    const hoursRaw = Number(opts.hours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : DEFAULT_WINDOW_HOURS;
    const activeWindowMs = hours * HOUR_MS;
    const t = now();

    // --- 1. Health check (AD-3 degraded contract) ---
    /** @type {{ degraded: boolean, consecutiveEmptyBatches?: number, degradedSince?: number }} */
    let health = { degraded: false };
    try {
      health = healthFn() || { degraded: false };
    } catch {
      health = { degraded: false };
    }
    const isDegraded = health.degraded === true;

    try {
      // --- 2. Token Universe Construction (AD-7 / Design Note 4) ---
      // Universe = watchlist (canonical ids) ∪ distinct token_ids in db
      const wlTokens = Array.isArray(watchlist?.tokens) ? watchlist.tokens : [];
      const wlById = new Map();
      for (const tok of wlTokens) {
        const cid = canonicalIdFor(tok);
        if (cid) wlById.set(cid, tok);
      }

      const statements = stmts();

      const dbTokens = new Set();
      for (const row of statements.distinctTokens.all()) {
        if (row.token_id) dbTokens.add(row.token_id);
      }

      const universeSet = new Set([...wlById.keys(), ...dbTokens]);

      // Handle completely empty watchlist & empty db
      if (universeSet.size === 0) {
        return {
          tokens: [],
          degraded: isDegraded,
          scope: 'watchlist',
          windowHours: hours,
          warning: 'watchlist empty',
          ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
          ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
          generatedAt: new Date(t).toISOString(),
        };
      }

      // --- 3. Filter check if tokenId is provided ---
      let targetTokens = [...universeSet];
      const filterId = typeof tokenId === 'string' && tokenId.trim() ? tokenId.trim() : undefined;
      if (filterId) {
        if (!universeSet.has(filterId)) {
          return {
            tokens: [],
            degraded: isDegraded,
            scope: 'watchlist',
            windowHours: hours,
            warning: `tokenId "${filterId}" not in watchlist and has no recorded mentions`,
            ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
            ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
            generatedAt: new Date(t).toISOString(),
          };
        }
        targetTokens = [filterId];
      }

      // --- 4. Query current active window ---
      const currWindow = aggregateWindow(t - activeWindowMs, t, true);

      // If degraded and window is empty: DO NOT compute on empty window (AD-3)
      if (isDegraded && currWindow.rowCount === 0) {
        return {
          tokens: [],
          degraded: true,
          scope: 'watchlist',
          windowHours: hours,
          ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
          ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
          generatedAt: new Date(t).toISOString(),
        };
      }

      // --- 5. Query 24h & 7d windows for Deltas ---
      // 24h windows
      let curr24h;
      if (activeWindowMs === WINDOW_24H_MS) {
        curr24h = currWindow;
      } else {
        curr24h = aggregateWindow(t - WINDOW_24H_MS, t, false);
      }
      const prev24h = aggregateWindow(t - 2 * WINDOW_24H_MS, t - WINDOW_24H_MS, false);

      // 7d windows
      let curr7d;
      if (activeWindowMs === WINDOW_7D_MS) {
        curr7d = currWindow;
      } else {
        curr7d = aggregateWindow(t - WINDOW_7D_MS, t, false);
      }
      const prev7d = aggregateWindow(t - 2 * WINDOW_7D_MS, t - WINDOW_7D_MS, false);

      // Distinct days in 7d baseline window [now - 14d, now - 7d]
      const distinctDaysMap = new Map();
      try {
        const dayRows = statements.distinctDays7d.all(t - 2 * WINDOW_7D_MS, t - WINDOW_7D_MS);
        for (const row of dayRows) {
          if (row.d != null) {
            distinctDaysMap.set(row.token_id, (distinctDaysMap.get(row.token_id) || 0) + 1);
          }
        }
      } catch {
        // Ignore
      }

      // --- 6. Compute per-token metrics ---
      const totalCurrVol = currWindow.totalVolume;
      const totalCurr24hVol = curr24h.totalVolume;
      const totalPrev24hVol = prev24h.totalVolume;
      const totalCurr7dVol = curr7d.totalVolume;
      const totalPrev7dVol = prev7d.totalVolume;

      const tokenResults = [];

      for (const id of targetTokens) {
        // 1) Current window Mindshare %
        const tokVol = currWindow.tokenVolumes.get(id) || 0;
        let mindsharePct = 0;
        if (totalCurrVol > 0) {
          mindsharePct = (tokVol / totalCurrVol) * 100;
        }

        // 2) Delta 24h
        let delta24h = null;
        if (totalPrev24hVol > 0 && totalCurr24hVol > 0) {
          const tokCurr24h = curr24h.tokenVolumes.get(id) || 0;
          const tokPrev24h = prev24h.tokenVolumes.get(id) || 0;
          const curr24hShare = (tokCurr24h / totalCurr24hVol) * 100;
          const prev24hShare = (tokPrev24h / totalPrev24hVol) * 100;
          delta24h = curr24hShare - prev24hShare;
        }

        // 3) Delta 7d & Insufficient History check
        let delta7d = null;
        let insufficientHistory = false;
        const daysCount = distinctDaysMap.get(id) || 0;

        if (daysCount < minBaselineDays || totalPrev7dVol === 0) {
          insufficientHistory = true;
          delta7d = null;
        } else {
          const tokCurr7d = curr7d.tokenVolumes.get(id) || 0;
          const tokPrev7d = prev7d.tokenVolumes.get(id) || 0;
          const curr7dShare = totalCurr7dVol > 0 ? (tokCurr7d / totalCurr7dVol) * 100 : 0;
          const prev7dShare = (tokPrev7d / totalPrev7dVol) * 100;
          delta7d = curr7dShare - prev7dShare;
        }

        // 4) Top Voices
        const voicesMap = currWindow.authorStats.get(id);
        /** @type {MindshareTopVoice[]} */
        let topVoices = [];
        if (voicesMap && voicesMap.size > 0) {
          const authorList = [];
          for (const [authorName, stats] of voicesMap.entries()) {
            authorList.push({
              author: authorName,
              weightedVolume: stats.weightedVolume,
              mentions: stats.mentions,
            });
          }
          authorList.sort((a, b) => b.weightedVolume - a.weightedVolume || b.mentions - a.mentions);
          topVoices = authorList.slice(0, topN);
        }

        tokenResults.push({
          token: id,
          mindsharePct,
          delta24h,
          delta7d,
          topVoices,
          degraded: isDegraded,
          ...(insufficientHistory ? { insufficientHistory: true } : {}),
        });
      }

      return {
        tokens: tokenResults,
        degraded: isDegraded,
        scope: 'watchlist',
        windowHours: hours,
        ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
        ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
        generatedAt: new Date(t).toISOString(),
      };
    } catch (err) {
      if (err && String(err.message).includes('no such table')) {
        return {
          tokens: [],
          degraded: isDegraded,
          scope: 'watchlist',
          windowHours: hours,
          warning: 'token_mentions table not initialized',
          ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
          ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
          generatedAt: new Date(t).toISOString(),
        };
      }
      throw err;
    }
  }

  return {
    computeMindshare,
    getEngineConfig,
  };
}

// ============================================================================
// Singleton Default Instance
// ============================================================================

/** @type {ReturnType<typeof createMindshareEngine> | null} */
let defaultInstance = null;

/**
 * Returns the default singleton MindshareEngine using process-level DB & config.
 * Re-created when resetDefaultMindshare is called (for test isolation).
 * @returns {ReturnType<typeof createMindshareEngine>}
 */
export function getDefaultMindshare() {
  if (!defaultInstance) {
    defaultInstance = createMindshareEngine();
  }
  return defaultInstance;
}

/**
 * Reset default instance — for tests that mutate test databases or clocks.
 */
export function resetDefaultMindshare() {
  defaultInstance = null;
}
