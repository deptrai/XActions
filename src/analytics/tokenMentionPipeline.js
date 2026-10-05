// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TokenMentionPipeline — normalized per-token mention stream (Story 54.2).
 *
 * Ingests a batch of `PostItem[]` (from `scrape('twitter','search')`), runs
 * `extractTokenEntities` (Story 54.1) on each post's content, normalizes into
 * `TokenMention[]`, dedups on `(token_id, source_id)` (AD-4 namespace
 * `x:<tweetId>`), persists append-only into `token_mentions` inside
 * `analytics.db`, and serves rolling-24h rollups
 * (`mentions_24h` / `unique_authors_24h` / `weighted_engagement_24h`).
 *
 * Degraded contract (AD-3): counts `consecutiveEmptyBatches`; `degraded`
 * flips on at `>= degradedThreshold` (default 3) and off on the next
 * non-empty batch. Scrape throws count as empty batches (fail-safe).
 *
 * Seams (all injectable, no-mock DI per spec):
 *   - `extractFn(text, {aliasMap})`  -> default `extractTokenEntities`
 *   - `sentimentFn(text)`            -> default `analyzeSentiment` (rules)
 *   - `db`                           -> default `getDatabase()` (analytics.db)
 *   - `scrape`                       -> default scrapers `scrape()`; only
 *                                     used by `startPipeline`, never by
 *                                     `processBatch` (deterministic tests).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { extractTokenEntities } from './tokenEntityExtractor.js';
import { analyzeSentiment } from './sentiment.js';
import { getDatabase } from './historyStore.js';
import { globalAdaptiveRateGovernor } from '../core/adaptive-governor.js';

// ============================================================================
// Constants
// ============================================================================

/** Default degraded threshold — consecutive empty batches before flag. */
const DEFAULT_DEGRADED_THRESHOLD = 3;
/** Default poll interval (60s) — watchlist-scale, under 10 req/min ceiling. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;
/** Default search result page size per query. */
const DEFAULT_POLL_LIMIT = 20;
/** Rolling rollup window: 24 hours in ms. */
const ROLLUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Spike 54.0 measured safe ceiling for twitter search. */
const TWITTER_SAFE_RPM = 10;

/** Default engagement weights for `weighted_engagement_24h`. */
const DEFAULT_WEIGHTS = { likes: 0.5, retweets: 0.3, replies: 0.2 };

// ============================================================================
// Watchlist helpers
// ============================================================================

/**
 * Load the default watchlist from `config/token-watchlist.json` when it
 * exists. Returns null when absent — caller decides fail-fast vs no-op.
 * @returns {object|null}
 */
function loadDefaultWatchlist() {
  try {
    const p = path.join(process.cwd(), 'config', 'token-watchlist.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build the extractor aliasMap from a watchlist.
 * Keys: every `aliases[]` entry + the lowercase symbol; values carry
 * `{symbol, chain, contract}` so contract-bearing tokens resolve to their
 * canonical `token:{chain}:{contract}` id, others degrade to
 * `token:sym:{SYMBOL}` inside the extractor.
 * Contract-keyed entries are added too so contract-as-key lookup works.
 * @param {object} watchlist
 * @returns {Record<string, {symbol?:string, chain?:string, contract?:string}>}
 */
function buildAliasMap(watchlist) {
  /** @type {Record<string, {symbol?:string, chain?:string, contract?:string}>} */
  const map = {};
  for (const token of watchlist?.tokens || []) {
    if (!token || !token.symbol) continue;
    const value = { symbol: token.symbol };
    if (token.chain) value.chain = token.chain;
    if (token.contract) value.contract = token.contract;
    map[String(token.symbol).toLowerCase()] = value;
    for (const alias of token.aliases || []) {
      if (alias && String(alias).trim()) map[String(alias).toLowerCase()] = value;
    }
    if (token.contract) map[String(token.contract)] = value;
  }
  return map;
}

// ============================================================================
// Schema (additive, shared analytics.db — NOT username-keyed historyStore tables)
// ============================================================================

/**
 * Create pipeline tables on an injectable better-sqlite3-compatible db.
 * @param {object} db
 */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_mentions (
      token_id    TEXT NOT NULL,
      source_id   TEXT NOT NULL,
      platform    TEXT,
      author      TEXT,
      followers   INTEGER,
      engagement  TEXT,
      ts          INTEGER,
      sentiment   REAL,
      is_bot      INTEGER DEFAULT 0,
      first_seen  INTEGER,
      last_seen   INTEGER,
      PRIMARY KEY (token_id, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts
      ON token_mentions (token_id, ts);
  `);
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a scrape search response into a PostItem array.
 * Tolerates both envelopes (`res.data.posts`, `res.posts`).
 * @param {object} res
 * @returns {Array<object>}
 */
function postsFromResponse(res) {
  if (!res || typeof res !== 'object') return [];
  const posts = res.data?.posts ?? res.posts;
  return Array.isArray(posts) ? posts : [];
}

/**
 * Pull engagement counters out of a PostItem (flat fields first, metadata
 * fallback — normalizer writes both shapes).
 * @param {object} post
 * @returns {{likes:number, retweets:number, replies:number, quotes:number}}
 */
function engagementOf(post) {
  const meta = post.metadata || {};
  return {
    likes: Number(post.likesCount ?? meta.likeCount ?? 0) || 0,
    retweets: Number(post.repostsCount ?? meta.retweetCount ?? 0) || 0,
    replies: Number(post.repliesCount ?? meta.replyCount ?? 0) || 0,
    quotes: Number(meta.quoteCount ?? 0) || 0,
  };
}

/**
 * Deterministic bot heuristic (spec Design Note 4): new account OR low
 * follower quality. Absent fields -> false (absence is signal, not error).
 * @param {object|undefined} author
 * @param {number} threshold
 * @returns {boolean}
 */
function isProbableBot(author, threshold) {
  if (!author || typeof author !== 'object') return false;
  if (author.is_new_account === true) return true;
  const fq = Number(author.follower_quality);
  if (Number.isFinite(fq) && fq < threshold) return true;
  return false;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a TokenMentionPipeline instance.
 *
 * Fail-fast (NO_WATCHLIST row): throws when no watchlist is resolvable, or
 * when `watchlist.tokens` is missing/not a non-empty array.
 *
 * @param {object} [opts]
 * @param {object} [opts.watchlist] - `{tokens:[{symbol,contract?,chain?,aliases[]}], queries:[...]}`;
 *   defaults to `config/token-watchlist.json` when that file exists.
 * @param {number} [opts.pollIntervalMs]
 * @param {number} [opts.pollLimit]
 * @param {number} [opts.degradedThreshold]
 * @param {number} [opts.botFollowerQualityThreshold]
 * @param {object} [opts.engagementWeights] - `{likes, retweets, replies}`
 * @param {Function} [opts.extractFn]
 * @param {Function} [opts.sentimentFn]
 * @param {object}   [opts.db]
 * @param {Function} [opts.scrape]
 * @param {Function} [opts.now] - injectable clock (ms) for tests
 * @returns {{processBatch:Function, startPipeline:Function, stopPipeline:Function,
 *   getHealth:Function, getRollups:Function}}
 */
export function createTokenMentionPipeline(opts = {}) {
  const watchlist = opts.watchlist ?? loadDefaultWatchlist();
  if (!watchlist || !Array.isArray(watchlist.tokens) || watchlist.tokens.length === 0) {
    throw new Error('❌ watchlist.tokens required — supply {tokens:[{symbol,...}]} or create config/token-watchlist.json');
  }

  const extractFn = opts.extractFn || extractTokenEntities;
  const sentimentFn = opts.sentimentFn || analyzeSentiment;
  const scrapeFn = opts.scrape || null; // resolved lazily to avoid import cost in tests
  const db = opts.db || getDatabase();
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  const degradedThreshold = /** @type {number} */ (Number.isFinite(opts.degradedThreshold) ? opts.degradedThreshold : DEFAULT_DEGRADED_THRESHOLD);
  const botFqThreshold = /** @type {number} */ (Number.isFinite(opts.botFollowerQualityThreshold) ? opts.botFollowerQualityThreshold : 0.1);
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) ? opts.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;
  const pollLimit = Number.isFinite(opts.pollLimit) ? opts.pollLimit : DEFAULT_POLL_LIMIT;
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.engagementWeights || {}) };

  ensureSchema(db);

  const aliasMap = buildAliasMap(watchlist);
  const queries = Array.isArray(watchlist.queries) && watchlist.queries.length
    ? watchlist.queries
    : watchlist.tokens.map((/** @type {{symbol:string}} */ t) => `$${t.symbol}`);

  const upsertStmt = db.prepare(`
    INSERT INTO token_mentions
      (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
    VALUES
      (@token_id, @source_id, @platform, @author, @followers, @engagement, @ts, @sentiment, @is_bot, @first_seen, @last_seen)
    ON CONFLICT(token_id, source_id) DO UPDATE SET
      engagement = excluded.engagement,
      sentiment  = excluded.sentiment,
      is_bot     = excluded.is_bot,
      followers  = excluded.followers,
      last_seen  = excluded.last_seen
  `);

  // ---- health state (single-writer) -----------------------------------------
  /** @type {{degraded:boolean, degradedSince:(string|null), consecutiveEmptyBatches:number, lastError:(string|null), lastPollAt:(string|null), totalBatches:number, totalMentions:number}} */
  const health = {
    degraded: false,
    degradedSince: null,
    consecutiveEmptyBatches: 0,
    lastError: null,
    lastPollAt: null,
    totalBatches: 0,
    totalMentions: 0,
  };

  let _timer = null;
  let _scrape = scrapeFn;

  /**
   * Record a processed batch's emptiness for the degraded contract (AD-3).
   * This is the single point where empty-batch semantics live.
   * @param {boolean} empty
   * @param {Error|null} [err]
   */
  function recordBatchEmptiness(empty, err = null) {
    health.totalBatches++;
    if (err) health.lastError = String(err.message || err);
    if (empty) {
      health.consecutiveEmptyBatches++;
      if (!health.degraded && health.consecutiveEmptyBatches >= degradedThreshold) {
        health.degraded = true;
        health.degradedSince = new Date(now()).toISOString();
        console.warn(`⚠️ TokenMentionPipeline degraded — ${health.consecutiveEmptyBatches} consecutive empty batches`);
      }
    } else {
      health.consecutiveEmptyBatches = 0;
      health.degraded = false;
      health.degradedSince = null;
    }
  }

  /**
   * Process one batch of PostItems into TokenMentions. Pure seam — never
   * calls scrape; deterministic with fixtures.
   * @param {Array<object>} posts
   * @returns {Promise<{mentions: Array<object>, skipped: number}>}
   */
  async function processBatch(posts) {
    const list = Array.isArray(posts) ? posts : [];
    if (list.length === 0) {
      recordBatchEmptiness(true);
      return { mentions: [], skipped: 0 };
    }

    const mentions = [];
    let skipped = 0;
    const seenAt = now();

    for (const post of list) {
      const content = typeof post?.content === 'string' ? post.content : '';
      const entities = extractFn(content, { aliasMap });
      if (!entities || entities.length === 0) { skipped++; continue; }

      const tweetId = post.externalId || post.metadata?.tweetId || post.id;
      const sourceId = `x:${tweetId}`;
      const ts = post.publishedAt ? new Date(post.publishedAt).getTime() : seenAt;
      const engagement = engagementOf(post);
      const sent = await sentimentFn(content).catch(() => ({ score: 0 }));
      const sentimentScore = Math.min(1, Math.max(0, Number(sent?.score) || 0));
      const authorName = post.authorName || post.author?.username || null;
      const followers = Number.isFinite(post.author?.followers_count)
        ? post.author.followers_count
        : (Number.isFinite(post.author?.followers) ? post.author.followers : null);
      const bot = isProbableBot(post.author, botFqThreshold);

      for (const entity of entities) {
        const mention = {
          tokenId: entity.canonicalId,
          sourceId,
          platform: 'twitter',
          author: authorName,
          followers,
          engagement,
          ts,
          sentimentScore,
          isProbableBot: bot,
        };
        upsertStmt.run({
          token_id: mention.tokenId,
          source_id: mention.sourceId,
          platform: mention.platform,
          author: mention.author,
          followers: mention.followers,
          engagement: JSON.stringify(mention.engagement),
          ts: mention.ts,
          sentiment: mention.sentimentScore,
          is_bot: mention.isProbableBot ? 1 : 0,
          first_seen: seenAt,
          last_seen: seenAt,
        });
        mentions.push(mention);
      }
    }

    health.totalMentions += mentions.length;
    recordBatchEmptiness(false);
    return { mentions, skipped };
  }

  /**
   * One poll cycle: scrape each watchlist query, merge PostItems, process.
   * Scrape throws count as an empty batch (fail-safe, SCRAPE_THROW row).
   */
  async function pollOnce() {
    health.lastPollAt = new Date(now()).toISOString();
    if (!_scrape) {
      const mod = await import('../scrapers/index.js');
      _scrape = mod.scrape;
    }
    const all = [];
    try {
      for (const query of queries) {
        const res = await _scrape('twitter', 'search', { query, limit: pollLimit });
        all.push(...postsFromResponse(res));
      }
    } catch (err) {
      console.error(`❌ TokenMentionPipeline poll error:`, err.message);
      recordBatchEmptiness(true, err);
      return;
    }
    await processBatch(all);
  }

  /**
   * Start polling (reputation.js `_startPolling` precedent): first poll
   * immediate, then setInterval. Sets the twitter safe ceiling once.
   * Idempotent — calling twice keeps the existing timer.
   */
  function startPipeline() {
    if (_timer) return { running: true, intervalMs: pollIntervalMs };
    globalAdaptiveRateGovernor.setPlatformLimit('twitter', { safeRequestsPerMinute: TWITTER_SAFE_RPM });
    console.log(`🚀 TokenMentionPipeline started — ${queries.length} queries every ${pollIntervalMs}ms`);
    pollOnce().catch((err) => console.error('❌ poll error:', err.message));
    _timer = setInterval(() => {
      pollOnce().catch((err) => console.error('❌ poll error:', err.message));
    }, pollIntervalMs);
    if (typeof _timer.unref === 'function') _timer.unref();
    return { running: true, intervalMs: pollIntervalMs };
  }

  /**
   * Stop polling. Idempotent — safe to call when not running.
   */
  function stopPipeline() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
      console.log('🛑 TokenMentionPipeline stopped');
    }
    return { running: false };
  }

  /**
   * Health snapshot for downstream 54.3/54.4 degraded gating.
   */
  function getHealth() {
    return { ...health };
  }

  /**
   * Rolling-24h rollup per token (or all tokens when tokenId omitted).
   * @param {string} [tokenId]
   * @returns {Array<{tokenId:string, mentions_24h:number, unique_authors_24h:number, weighted_engagement_24h:number}>}
   */
  function getRollups(tokenId) {
    const cutoff = now() - ROLLUP_WINDOW_MS;
    const rows = tokenId
      ? db.prepare(`SELECT token_id, author, engagement, ts FROM token_mentions WHERE token_id = ? AND ts > ?`).all(tokenId, cutoff)
      : db.prepare(`SELECT token_id, author, engagement, ts FROM token_mentions WHERE ts > ?`).all(cutoff);

    const byToken = new Map();
    for (const row of rows) {
      let agg = byToken.get(row.token_id);
      if (!agg) {
        agg = { tokenId: row.token_id, mentions_24h: 0, authors: new Set(), weighted_engagement_24h: 0 };
        byToken.set(row.token_id, agg);
      }
      agg.mentions_24h++;
      if (row.author) agg.authors.add(row.author);
      let eng = {};
      try { eng = JSON.parse(row.engagement || '{}'); } catch { eng = {}; }
      agg.weighted_engagement_24h +=
        (Number(eng.likes) || 0) * weights.likes +
        (Number(eng.retweets) || 0) * weights.retweets +
        (Number(eng.replies) || 0) * weights.replies;
    }

    return [...byToken.values()].map((a) => ({
      tokenId: a.tokenId,
      mentions_24h: a.mentions_24h,
      unique_authors_24h: a.authors.size,
      weighted_engagement_24h: Math.round(a.weighted_engagement_24h * 1000) / 1000,
    }));
  }

  return { processBatch, startPipeline, stopPipeline, getHealth, getRollups };
}

export default { createTokenMentionPipeline };
