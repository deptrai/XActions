// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * HypeAuthenticity — hype-vs-liquidity & unique-source authenticity metrics
 * (Story 54.3).
 *
 * Answers the question provider-grade tools (TheTie `hype_to_activity_ratio`,
 * Santiment `log10(unique_users)`) answer: is this token's social hype
 * ORGANIC or manufactured / raid-farmed?
 *
 * Metrics per token (computed per `token_id` in the watchlist):
 *   - `hype_to_liquidity`  = mentions_24h / liquidity_usd   (raw mentions ÷ USD)
 *   - `unique_sources_pct` = unique_authors_24h / mentions_24h   (0..1)
 *   - `hype_score`         = (mentions_24h / avg_mentions_14d) × log10(unique_authors_24h)
 *
 * 14-day baseline is read DIRECTLY from `token_mentions` (same `getDb()`
 * connection as the pipeline) via `GROUP BY day` — NOT via `getRollups`,
 * which is hardcoded rolling-24h (spec Design Note 1).
 *
 * Liquidity enrichment goes through `createDexscreenerTokenResolver`
 * (Story 54.1 seam — cached, never throws). `token:sym:*` ids have no
 * contract → resolver skipped, `liquidityKnown: false`.
 *
 * Alert path: when `hype_to_liquidity > baseline_mean + alertSigma·σ`
 * (baseline = replayed daily `mentions/liquidity` on the same liquidity
 * snapshot) AND `unique_sources_pct < uniqueSourcesFloor` → one anomaly
 * alert per token per invocation via the injectable `alertFn` seam
 * (default: `emitHypeAnomalyAlert` in alerts.js).
 *
 * Degraded contract (AD-3): `healthFn().degraded === true` → metrics are
 * still computed from whatever data exists (last-good) and the response
 * carries `degraded: true`; empty windows report `insufficientHistory`
 * instead of invented numbers.
 *
 * Seams (all injectable, no-mock DI per spec):
 *   - `db`          -> default `getDatabase()` (analytics.db)
 *   - `healthFn`    -> default `() => ({degraded:false})`
 *   - `alertFn`     -> default `emitHypeAnomalyAlert` (alerts.js)
 *   - `resolver`    -> default `createDexscreenerTokenResolver({scrape})`
 *   - `now`         -> injectable clock (ms) for tests
 *   - `watchlist`   -> default `config/token-watchlist.json`
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import fs from 'fs';
import { getDatabase } from './historyStore.js';
import { createDexscreenerTokenResolver } from './tokenEntityExtractor.js';
import { emitHypeAnomalyAlert } from './alerts.js';

// ============================================================================
// Constants
// ============================================================================

/** Metric window default: 24h. */
const DEFAULT_WINDOW_HOURS = 24;
/** 14-day trailing baseline window. */
const BASELINE_DAYS = 14;
const BASELINE_WINDOW_MS = BASELINE_DAYS * 24 * 60 * 60 * 1000;

/** Spec defaults — configurable via opts, never hardcoded at call sites. */
const DEFAULT_MIN_BASELINE_DAYS = 3;
const DEFAULT_BOT_DOMINANT_THRESHOLD = 0.5;
const DEFAULT_ALERT_SIGMA = 3;
const DEFAULT_UNIQUE_SOURCES_FLOOR = 0.3;

/** Sentinel monitorId so hype alerts don't collide with reputation monitors. */
export const HYPE_ALERT_MONITOR_ID = 'token-hype';

// ============================================================================
// Watchlist helpers (mirrors tokenMentionPipeline.js)
// ============================================================================

function loadDefaultWatchlist() {
  try {
    const p = new URL('../../config/token-watchlist.json', import.meta.url).pathname;
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Canonical tokenId for a watchlist entry (AD-1 grammar):
 * `token:{chain}:{contract}` when contract present, else `token:sym:{SYMBOL}`.
 * @param {object} token
 * @returns {string|null}
 */
function canonicalIdFor(token) {
  if (!token || typeof token !== 'object' || !token.symbol) return null;
  if (token.contract && token.chain) {
    // EVM ids are stored lowercase by TokenEntityExtractor (54.1) — keep the
    // same normalization so watchlist checksummed addresses don't split the
    // token universe in two rows.
    const contract = /^0x/i.test(String(token.contract))
      ? String(token.contract).toLowerCase()
      : String(token.contract);
    return `token:${token.chain}:${contract}`;
  }
  return `token:sym:${String(token.symbol).toUpperCase()}`;
}

/**
 * Map a canonical tokenId back to resolver args.
 * `token:{chain}:{contract}` → `{chainId, tokenAddress}`; `token:sym:*` → null.
 * @param {string} tokenId
 * @returns {{chainId:string, tokenAddress:string}|null}
 */
function resolverArgsFor(tokenId) {
  if (typeof tokenId !== 'string' || !tokenId.startsWith('token:')) return null;
  if (tokenId.startsWith('token:sym:')) return null;
  const parts = tokenId.split(':');
  if (parts.length < 3) return null;
  return { chainId: parts[1], tokenAddress: parts.slice(2).join(':') };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a HypeAuthenticity instance.
 *
 * @param {object} [opts]
 * @param {object}   [opts.db] - better-sqlite3-compatible db (default `getDatabase()`)
 * @param {Function} [opts.healthFn] - pipeline `getHealth()` passthrough (default `() => ({degraded:false})`)
 * @param {Function} [opts.alertFn] - anomaly alert sink (default `emitHypeAnomalyAlert`)
 * @param {Function} [opts.resolver] - `resolveToken({chainId, tokenAddress})` (default Dexscreener resolver)
 * @param {Function} [opts.now] - injectable clock (ms)
 * @param {object}   [opts.watchlist] - `{tokens:[{symbol,contract?,chain?}]}`
 * @param {number}   [opts.minBaselineDays=3]
 * @param {number}   [opts.botDominantThreshold=0.5]
 * @param {number}   [opts.alertSigma=3]
 * @param {number}   [opts.uniqueSourcesFloor=0.3]
 * @param {Function} [opts.scrape] - used ONLY to build the default resolver
 * @param {Map}      [opts.resolverCache] - shared Map for resolver hit cache (default per-instance Map)
 * @returns {{computeHypeMetrics:Function, getTokenMetrics:Function, emitHypeAlerts:Function, computeWithAlerts:Function}}
 */
export function createHypeAuthenticity(opts = {}) {
  const db = opts.db || getDatabase();
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const healthFn = typeof opts.healthFn === 'function' ? opts.healthFn : () => ({ degraded: false });
  const alertFn = typeof opts.alertFn === 'function' ? opts.alertFn : emitHypeAnomalyAlert;
  const watchlist = opts.watchlist ?? loadDefaultWatchlist();

  const minBaselineDays = Number.isFinite(opts.minBaselineDays) ? Math.floor(Number(opts.minBaselineDays)) : DEFAULT_MIN_BASELINE_DAYS;
  const botDominantThreshold = Number.isFinite(opts.botDominantThreshold) ? Number(opts.botDominantThreshold) : DEFAULT_BOT_DOMINANT_THRESHOLD;
  const alertSigma = Number.isFinite(opts.alertSigma) ? Number(opts.alertSigma) : DEFAULT_ALERT_SIGMA;
  const uniqueSourcesFloor = Number.isFinite(opts.uniqueSourcesFloor) ? Number(opts.uniqueSourcesFloor) : DEFAULT_UNIQUE_SOURCES_FLOOR;

  let _resolver = typeof opts.resolver === 'function' ? opts.resolver : null;
  async function getResolver() {
    if (_resolver) return _resolver;
    const cache = opts.resolverCache ?? new Map(); // default in-memory hit cache
    if (typeof opts.scrape === 'function') {
      _resolver = createDexscreenerTokenResolver({ scrape: opts.scrape, cache });
      return _resolver;
    }
    try {
      const mod = await import('../scrapers/index.js');
      _resolver = createDexscreenerTokenResolver({ scrape: mod.scrape, cache });
      return _resolver;
    } catch {
      _resolver = async () => null; // resolver unavailable → every token liquidityUnknown
      return _resolver;
    }
  }

  // --- statements (lazy so :memory: dbs without schema still construct) ------
  let _stmts = null;
  function stmts() {
    if (_stmts) return _stmts;
    _stmts = {
      windowRows: db.prepare(
        `SELECT author, is_bot FROM token_mentions WHERE token_id = ? AND ts > ?`
      ),
      baselineRows: db.prepare(
        `SELECT date(ts/1000, 'unixepoch') AS d, COUNT(*) AS c
           FROM token_mentions
          WHERE token_id = ? AND ts > ?
          GROUP BY d`
      ),
      distinctTokens: db.prepare(`SELECT DISTINCT token_id FROM token_mentions`),
    };
    return _stmts;
  }

  /**
   * Pull mention counts + unique authors + bot share for one token over
   * `windowMs`. Returns raw aggregates (null-safe callers decide semantics).
   * @param {string} tokenId
   * @param {number} cutoffTs
   */
  function windowAggregates(tokenId, cutoffTs) {
    const rows = stmts().windowRows.all(tokenId, cutoffTs);
    let mentions = 0;
    let botMentions = 0;
    let botKnown = 0; // rows where is_bot is a real flag (0 or 1 non-null)
    const authors = new Set();
    for (const row of rows) {
      mentions++;
      if (row.author) authors.add(row.author);
      if (row.is_bot !== null && row.is_bot !== undefined) {
        botKnown++;
        if (Number(row.is_bot) === 1) botMentions++;
      }
    }
    return { mentions, uniqueAuthors: authors.size, botMentions, botKnown };
  }

  /**
   * 14-day baseline: per-day mention counts (for avg_mentions_14d) —
   * `SELECT date(ts/1000,'unixepoch') d, COUNT(*) ... GROUP BY d`.
   * @param {string} tokenId
   * @param {number} cutoffTs
   * @returns {{daily: Map<string,number>, daysWithData:number, avgPerDay:number}}
   */
  function baselineAggregates(tokenId, cutoffTs) {
    const rows = stmts().baselineRows.all(tokenId, cutoffTs);
    const daily = new Map();
    let total = 0;
    for (const row of rows) {
      if (row.d == null) continue; // NULL-ts rows must not count as a baseline day
      daily.set(row.d, Number(row.c));
      total += Number(row.c);
    }
    return {
      daily,
      daysWithData: daily.size,
      avgPerDay: total / BASELINE_DAYS, // chia 14 cố định — spec
    };
  }

  /**
   * Compute metrics for a single tokenId. Async because of the resolver seam.
   * @param {string} tokenId
   * @param {{symbol?:string, chain?:string, contract?:string}|undefined} wlMeta
   * @param {number} windowMs
   */
  async function metricsForToken(tokenId, wlMeta, windowMs) {
    const t = now();
    const win = windowAggregates(tokenId, t - windowMs);
    const base = baselineAggregates(tokenId, t - BASELINE_WINDOW_MS);

    // --- liquidity (resolver seam; miss/throw → liquidityKnown:false) -------
    let liquidityUsd = null;
    let volume24h = null;
    let liquidityKnown = false;
    const rArgs = resolverArgsFor(tokenId);
    if (rArgs) {
      try {
        const resolver = await getResolver();
        const hit = await resolver(rArgs);
        if (hit && Number.isFinite(hit.liquidityUsd) && hit.liquidityUsd > 0) {
          liquidityUsd = hit.liquidityUsd;
          volume24h = Number.isFinite(hit.volume24h) ? hit.volume24h : null;
          liquidityKnown = true;
        }
      } catch {
        // fail-open metric — resolver throw never crashes the endpoint
      }
    }

    // --- derived metrics ------------------------------------------------------
    const insufficientHistory = win.mentions === 0 || base.daysWithData < minBaselineDays;

    const hype_to_liquidity =
      liquidityKnown && win.mentions > 0 ? win.mentions / liquidityUsd : null;

    const unique_sources_pct =
      win.mentions > 0 ? win.uniqueAuthors / win.mentions : null;

    // botDominant: absence-is-signal — when is_bot is entirely absent (null
    // column or all-null rows), the flag stays false (not null per response
    // schema; documented: field absent from source data → không tính bot).
    const botDominant =
      win.mentions > 0 && botKnownShare(win) > botDominantThreshold;

    let hype_score = null;
    if (!insufficientHistory && win.mentions > 0 && win.uniqueAuthors > 0 && base.avgPerDay > 0) {
      hype_score = (win.mentions / base.avgPerDay) * Math.log10(win.uniqueAuthors);
      if (!Number.isFinite(hype_score)) hype_score = null;
    }

    return {
      tokenId,
      symbol: wlMeta?.symbol ?? null,
      chain: wlMeta?.chain ?? null,
      contract: wlMeta?.contract ?? null,
      mentions_24h: win.mentions,
      unique_authors_24h: win.uniqueAuthors,
      hype_to_liquidity,
      unique_sources_pct,
      hype_score,
      liquidityUsd,
      volume24h,
      liquidityKnown,
      botDominant,
      insufficientHistory,
      _baseline: base, // internal — stripped before return
    };
  }

  function botKnownShare(win) {
    // share of is_bot=1 over the whole window (spec: "is_bot=1 mention chiếm
    // >50% window"); rows where is_bot is absent don't count as bots but DO
    // count in the denominator (they're real mentions).
    if (win.mentions === 0) return 0;
    return win.botMentions / win.mentions;
  }

  /**
   * Shared compute pass — returns public rows AND baseline-attached rows
   * (for `emitHypeAlerts` without a second db hit). Single token universe
   * resolver for both computeHypeMetrics and computeWithAlerts.
   * @param {string} [tokenId]
   * @param {object} [opts2]
   * @param {number} [opts2.hours=24]
   */
  async function _compute(tokenId, opts2 = {}) {
    const hoursRaw = Number(opts2.hours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : DEFAULT_WINDOW_HOURS;
    const windowMs = hours * 60 * 60 * 1000;

    let degraded = false;
    try {
      degraded = healthFn()?.degraded === true;
    } catch {
      degraded = false;
    }

    // Token universe: explicit filter → just that id; else the watchlist
    // (canonical ids) ∪ any token_ids present in the db (mentions can exist
    // for tokens dropped from the watchlist).
    const wlById = new Map();
    for (const tok of watchlist?.tokens || []) {
      const id = canonicalIdFor(tok);
      if (id) wlById.set(id, tok);
    }

    let ids;
    let warning;
    if (tokenId) {
      const exists = stmts().windowRows.all(tokenId, 0).length > 0;
      if (!wlById.has(tokenId) && !exists) {
        ids = [];
        warning = `tokenId "${tokenId}" not in watchlist and has no recorded mentions`;
      } else {
        ids = [tokenId];
      }
    } else {
      const set = new Set(wlById.keys());
      for (const row of stmts().distinctTokens.all()) set.add(row.token_id);
      ids = [...set];
    }

    const withBaseline = [];
    const tokens = [];
    for (const id of ids) {
      const m = await metricsForToken(id, wlById.get(id), windowMs);
      const { _baseline, ...pub } = m;
      withBaseline.push(m);
      tokens.push({ ...pub, degraded }); // spec: per-token row carries degraded passthrough
    }
    return { tokens, withBaseline, degraded, ...(warning ? { warning } : {}) };
  }

  /**
   * Compute hype metrics for one tokenId or the whole watchlist.
   *
   * @param {string} [tokenId] - canonical tokenId filter; unknown → `tokens:[]` + warning
   * @param {object} [opts2]
   * @param {number} [opts2.hours=24] - metric window in hours
   * @returns {Promise<{tokens:Array<object>, degraded:boolean, warning?:string}>}
   */
  async function computeHypeMetrics(tokenId, opts2 = {}) {
    const { tokens, degraded, warning } = await _compute(tokenId, opts2);
    return { tokens, degraded, ...(warning ? { warning } : {}) };
  }

  /**
   * Convenience: metrics for exactly one token (or null when unknown).
   * @param {string} tokenId
   * @param {object} [opts2]
   */
  async function getTokenMetrics(tokenId, opts2 = {}) {
    const res = await computeHypeMetrics(tokenId, opts2);
    return { ...res, token: res.tokens[0] ?? null };
  }

  /**
   * Alert check — replay the daily `hype_to_liquidity` baseline series over
   * 14d against the CURRENT liquidity snapshot (liquidity has no history —
   * documented spec limitation, Design Note 6), compute mean/σ, and fire ONE
   * anomaly alert per token when `hype_to_liquidity > mean + alertSigma·σ`
   * AND `unique_sources_pct < uniqueSourcesFloor`.
   *
   * @param {Array<object>} metrics - token metric rows from `computeHypeMetrics`
   *   (with `_baseline` still attached when called internally) OR plain rows
   *   (baselines recomputed).
   * @returns {Promise<Array<object>>} fired alerts
   */
  async function emitHypeAlerts(metrics) {
    const fired = [];
    const t = now();
    for (const m of Array.isArray(metrics) ? metrics : []) {
      if (!m || m.hype_to_liquidity == null || m.liquidityUsd == null || m.liquidityUsd <= 0) continue;
      if (m.unique_sources_pct == null || m.unique_sources_pct >= uniqueSourcesFloor) continue;

      const base = m._baseline ?? baselineAggregates(m.tokenId, t - BASELINE_WINDOW_MS);
      // Baseline = TRAILING days only — today's partial day carries the spike
      // itself and would inflate mean/σ, suppressing real anomalies.
      const todayKey = new Date(t).toISOString().slice(0, 10);
      const trailing = [...base.daily.entries()].filter(([d]) => d !== todayKey);
      if (trailing.length < minBaselineDays) continue;

      // Replay daily hype_to_liquidity on the same liquidity snapshot
      // (liquidity has no history — documented spec limitation, DN 6).
      const series = trailing.map(([, c]) => c / m.liquidityUsd);
      if (series.length < minBaselineDays) continue;
      const mean = series.reduce((s, v) => s + v, 0) / series.length;
      const std = Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length);
      const threshold = mean + alertSigma * std;

      if (m.hype_to_liquidity > threshold) {
        // flat baseline (σ=0): any fire is a jump off a constant → critical
        const severity = std === 0
          ? 'critical'
          : (m.hype_to_liquidity > mean + alertSigma * 2 * std ? 'critical' : 'warning');
        const alert = {
          type: 'anomaly',
          severity,
          monitorId: HYPE_ALERT_MONITOR_ID,
          target: m.tokenId,
          message: `Manufactured-hype signature for ${m.symbol ?? m.tokenId}: hype_to_liquidity ${m.hype_to_liquidity.toExponential(2)} > baseline ${mean.toExponential(2)} + ${alertSigma}σ (σ=${std.toExponential(2)}), unique_sources_pct ${(m.unique_sources_pct * 100).toFixed(1)}% < ${(uniqueSourcesFloor * 100).toFixed(0)}%.`,
          data: {
            tokenId: m.tokenId,
            symbol: m.symbol,
            metric: 'hype_to_liquidity',
            value: m.hype_to_liquidity,
            baselineMean: mean,
            baselineStd: std,
            threshold,
            sigma: alertSigma,
            unique_sources_pct: m.unique_sources_pct,
            mentions_24h: m.mentions_24h,
            liquidityUsd: m.liquidityUsd,
          },
        };
        try {
          await Promise.resolve(alertFn(alert));
        } catch (err) {
          console.error(`❌ hype alertFn failed for ${m.tokenId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        fired.push(alert);
      }
    }
    return fired;
  }

  /**
   * Full pass: compute metrics (with baselines) then run the alert check.
   * Used by MCP/REST default paths — a single invocation, at most one alert
   * per token.
   */
  async function computeWithAlerts(tokenId, opts2 = {}) {
    const res = await _compute(tokenId, opts2);
    const alerts = await emitHypeAlerts(res.withBaseline);
    return { tokens: res.tokens, degraded: res.degraded, alerts, ...(res.warning ? { warning: res.warning } : {}) };
  }

  return { computeHypeMetrics, getTokenMetrics, emitHypeAlerts, computeWithAlerts };
}

// ============================================================================
// Shared default instance — REST/MCP consumers reuse ONE instance so the
// Dexscreener resolver cache and prepared statements stay warm across
// requests (per-request construction defeated the 54.1 cache and burned
// the dexscreener rate-limit budget).
// ============================================================================

let _defaultInstance = null;

/**
 * Lazily-built shared default instance (analytics.db + scrapers scrape +
 * alerts.js sink + default watchlist). For long-lived consumers
 * (REST route, MCP dispatcher). Tests should inject their own instance.
 * @returns {ReturnType<typeof createHypeAuthenticity>}
 */
export function getDefaultHypeAuthenticity() {
  if (!_defaultInstance) _defaultInstance = createHypeAuthenticity();
  return _defaultInstance;
}

export default { createHypeAuthenticity, getDefaultHypeAuthenticity };
