// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for hypeAuthenticity.js — hype-vs-liquidity & unique-source
 * authenticity metrics (Story 54.3).
 *
 * No mock frameworks — deterministic injected seams (`db`, `healthFn`,
 * `alertFn`, `resolver`, `now`) per spec. In-memory better-sqlite3 db stands
 * in for analytics.db; `token_mentions` schema mirrors the 54.2 pipeline.
 *
 * Covers the full I/O matrix: HAPPY_PATH, NO_LIQUIDITY, ZERO_MENTIONS,
 * SINGLE_AUTHOR_RAID, MANUFACTURED_HYPE, DEGRADED_WINDOW, INSUFFICIENT_14D,
 * BOT_DOMINANT, TOKEN_FILTER, SYM_ONLY_TOKEN, RESOLVER_THROW.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHypeAuthenticity } from '../../src/analytics/hypeAuthenticity.js';
import { emitHypeAnomalyAlert, getAlerts, clearAlerts } from '../../src/analytics/alerts.js';

// ============================================================================
// Fixtures
// ============================================================================

const SOL_CONTRACT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP';
const BONK_ID = `token:solana:${SOL_CONTRACT}`;
const WIF_ID = 'token:sym:WIF';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const WATCHLIST = {
  tokens: [
    { symbol: 'BONK', contract: SOL_CONTRACT, chain: 'solana', aliases: ['bonk'] },
    { symbol: 'WIF', chain: 'solana', aliases: ['dogwifhat'] },
  ],
};

function makeDb() {
  const db = new Database(':memory:');
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
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts ON token_mentions (token_id, ts);
  `);
  return db;
}

/** @type {number} */
let _srcSeq = 0;
/**
 * Insert `n` mentions for `tokenId`, spread across `authors` authors,
 * timestamped at `ts` (default: inside the 24h window).
 * @param {import('better-sqlite3').Database} db
 * @param {string} tokenId
 * @param {number} n
 * @param {{authors?:number, ts?:number, isBot?:number, botEvery?:number}} [opts]
 */
function seedMentions(db, tokenId, n, { authors = n, ts = NOW - HOUR, isBot = 0, botEvery } = {}) {
  const stmt = db.prepare(`
    INSERT INTO token_mentions (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
    VALUES (?, ?, 'twitter', ?, 100, '{}', ?, 0.8, ?, ?, ?)
  `);
  for (let i = 0; i < n; i++) {
    const author = `author_${i % authors}`;
    const bot = botEvery ? (i % botEvery === 0 ? 1 : 0) : isBot;
    stmt.run(tokenId, `x:${tokenId}:${_srcSeq++}`, author, ts, bot, ts, ts);
  }
}

/** Seed mentions spread across `days` distinct past days (for 14d baseline).
 * @param {import('better-sqlite3').Database} db
 * @param {string} tokenId
 * @param {number} perDay
 * @param {number} days
 * @param {{authorsPerDay?:number}} [opts]
 */
function seedDailyMentions(db, tokenId, perDay, days, { authorsPerDay = perDay } = {}) {
  for (let d = 1; d <= days; d++) {
    seedMentions(db, tokenId, perDay, {
      authors: authorsPerDay,
      ts: NOW - d * DAY - HOUR, // noon each past day
    });
  }
}

function makeHype(overrides = {}) {
  return createHypeAuthenticity({
    watchlist: WATCHLIST,
    db: makeDb(),
    now: () => NOW,
    healthFn: () => ({ degraded: false }),
    resolver: async () => null,
    alertFn: () => {},
    ...overrides,
  });
}

// ============================================================================
// HAPPY_PATH — 50 mentions / 40 authors / liquidity 445449
// ============================================================================

describe('computeHypeMetrics — HAPPY_PATH', () => {
  it('computes hype_to_liquidity, unique_sources_pct, hype_score', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 5, 5); // 5d baseline, avg=25/14
    seedMentions(db, BONK_ID, 50, { authors: 40 });
    const hype = makeHype({
      db,
      resolver: async () => ({ liquidityUsd: 445449, volume24h: 1200000, symbol: 'BONK' }),
    });
    const res = await hype.computeHypeMetrics(BONK_ID);
    expect(res.tokens).toHaveLength(1);
    const t = res.tokens[0];
    expect(t.tokenId).toBe(BONK_ID);
    expect(t.symbol).toBe('BONK');
    expect(t.chain).toBe('solana');
    expect(t.mentions_24h).toBe(50);
    expect(t.unique_authors_24h).toBe(40);
    expect(t.hype_to_liquidity).toBeCloseTo(50 / 445449, 8); // ≈1.12e-4
    expect(t.unique_sources_pct).toBeCloseTo(0.8, 10);
    expect(t.liquidityUsd).toBe(445449);
    expect(t.volume24h).toBe(1200000);
    expect(t.liquidityKnown).toBe(true);
    expect(t.botDominant).toBe(false);
    expect(t.insufficientHistory).toBe(false);
    // avg_mentions_14d = total mentions over trailing 14d / 14 (today's
    // window mentions INCLUDED per spec — raw daily average, not anomaly
    // baseline). (25 baseline + 50 today) / 14 = 5.357/day.
    // score = (50 / (75/14)) * log10(40) = 9.333 * 1.602 ≈ 14.95
    expect(t.hype_score).toBeCloseTo((50 / (75 / 14)) * Math.log10(40), 5);
  });
});

// ============================================================================
// NO_LIQUIDITY — resolver miss / liquidityUsd=0
// ============================================================================

describe('computeHypeMetrics — NO_LIQUIDITY', () => {
  it('resolver null → hype_to_liquidity null + liquidityKnown false', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 5, 5);
    seedMentions(db, BONK_ID, 50, { authors: 40 });
    const hype = makeHype({ db, resolver: async () => null });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.hype_to_liquidity).toBeNull();
    expect(t.liquidityKnown).toBe(false);
    expect(t.liquidityUsd).toBeNull();
    expect(t.unique_sources_pct).toBeCloseTo(0.8, 10);
    expect(t.hype_score).not.toBeNull(); // history sufficient
  });

  it('liquidityUsd=0 → liquidityKnown false (no divide-by-zero)', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 5, 5);
    seedMentions(db, BONK_ID, 10, { authors: 8 });
    const hype = makeHype({ db, resolver: async () => ({ liquidityUsd: 0, volume24h: 0 }) });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.hype_to_liquidity).toBeNull();
    expect(t.liquidityKnown).toBe(false);
  });

  it('resolver throw → fail-open liquidityKnown false, no crash', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 5, 5);
    seedMentions(db, BONK_ID, 10, { authors: 8 });
    const hype = makeHype({
      db,
      resolver: async () => { throw new Error('dexscreener down'); },
    });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.hype_to_liquidity).toBeNull();
    expect(t.liquidityKnown).toBe(false);
    expect(t.mentions_24h).toBe(10);
  });
});

// ============================================================================
// ZERO_MENTIONS — token with no mentions in window
// ============================================================================

describe('computeHypeMetrics — ZERO_MENTIONS', () => {
  it('empty window → zeros/nulls + insufficientHistory', async () => {
    const db = makeDb();
    const hype = makeHype({ db });
    const res = await hype.computeHypeMetrics(BONK_ID);
    // BONK in watchlist but no mentions → still emitted (watchlist universe)
    expect(res.tokens).toHaveLength(1);
    const t = res.tokens[0];
    expect(t.mentions_24h).toBe(0);
    expect(t.unique_authors_24h).toBe(0);
    expect(t.unique_sources_pct).toBeNull();
    expect(t.hype_to_liquidity).toBeNull();
    expect(t.hype_score).toBeNull();
    expect(t.insufficientHistory).toBe(true);
    expect(t.botDominant).toBe(false);
  });
});

// ============================================================================
// SINGLE_AUTHOR_RAID — 100 mentions from 1 author
// ============================================================================

describe('computeHypeMetrics — SINGLE_AUTHOR_RAID', () => {
  it('unique_sources_pct=0.01, hype_score≈0 (log10(1)=0)', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 3, 4, { authorsPerDay: 3 });
    seedMentions(db, BONK_ID, 100, { authors: 1 });
    const hype = makeHype({ db });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.unique_sources_pct).toBeCloseTo(0.01, 10);
    expect(t.hype_score).toBeCloseTo(0, 10); // × log10(1)=0
  });
});

// ============================================================================
// INSUFFICIENT_14D — <3 days of data
// ============================================================================

describe('computeHypeMetrics — INSUFFICIENT_14D', () => {
  it('<3 days data → hype_score null + insufficientHistory true', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 4, 1); // only 1 past day (+today = 2 days with data < 3)
    seedMentions(db, BONK_ID, 20, { authors: 15 });
    const hype = makeHype({ db });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.insufficientHistory).toBe(true);
    expect(t.hype_score).toBeNull();
    expect(t.mentions_24h).toBe(20);
    expect(t.unique_sources_pct).toBeCloseTo(0.75, 10);
  });

  it('minBaselineDays configurable — 2 days passes when min=2', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 4, 2);
    seedMentions(db, BONK_ID, 20, { authors: 15 });
    const hype = makeHype({ db, minBaselineDays: 2 });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.insufficientHistory).toBe(false);
    expect(t.hype_score).not.toBeNull();
  });
});

// ============================================================================
// BOT_DOMINANT — >50% is_bot=1
// ============================================================================

describe('computeHypeMetrics — BOT_DOMINANT', () => {
  it('>50% bot mentions → botDominant true', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 10, { authors: 10, botEvery: 2 }); // 5/10 bots = 50% not >50
    seedMentions(db, BONK_ID, 1, { authors: 1, isBot: 1 }); // 6/11 > 50%
    const hype = makeHype({ db });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.botDominant).toBe(true);
  });

  it('bot share below threshold → botDominant false', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 10, { authors: 10, botEvery: 3 }); // ~27%
    const hype = makeHype({ db });
    const [t] = (await hype.computeHypeMetrics(BONK_ID)).tokens;
    expect(t.botDominant).toBe(false);
  });
});

// ============================================================================
// DEGRADED_WINDOW — healthFn degraded=true
// ============================================================================

describe('computeHypeMetrics — DEGRADED_WINDOW', () => {
  it('response degraded:true with last-good metrics', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 5, 5);
    seedMentions(db, BONK_ID, 20, { authors: 15 });
    const hype = makeHype({ db, healthFn: () => ({ degraded: true, consecutiveEmptyBatches: 4 }) });
    const res = await hype.computeHypeMetrics(BONK_ID);
    expect(res.degraded).toBe(true);
    expect(res.tokens[0].mentions_24h).toBe(20); // last-good still computed
  });

  it('degraded + empty window → degraded:true + insufficientHistory, no fake numbers', async () => {
    const db = makeDb();
    const hype = makeHype({ db, healthFn: () => ({ degraded: true }) });
    const res = await hype.computeHypeMetrics(BONK_ID);
    expect(res.degraded).toBe(true);
    expect(res.tokens[0].insufficientHistory).toBe(true);
    expect(res.tokens[0].hype_score).toBeNull();
  });
});

// ============================================================================
// TOKEN_FILTER — explicit tokenId
// ============================================================================

describe('computeHypeMetrics — TOKEN_FILTER', () => {
  it('filters to one token only', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 5, { authors: 5 });
    seedMentions(db, WIF_ID, 7, { authors: 7 });
    const hype = makeHype({ db });
    const res = await hype.computeHypeMetrics(WIF_ID);
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].tokenId).toBe(WIF_ID);
  });

  it('unknown tokenId → tokens:[] + warning', async () => {
    const db = makeDb();
    const hype = makeHype({ db });
    const res = await hype.computeHypeMetrics('token:solana:UNKNOWN');
    expect(res.tokens).toHaveLength(0);
    expect(res.warning).toMatch(/UNKNOWN/);
  });
});

// ============================================================================
// SYM_ONLY_TOKEN — token:sym:* never-merge, liquidityKnown false
// ============================================================================

describe('computeHypeMetrics — SYM_ONLY_TOKEN', () => {
  it('token:sym:WIF computes mentions but never resolves liquidity', async () => {
    const db = makeDb();
    seedDailyMentions(db, WIF_ID, 4, 4);
    seedMentions(db, WIF_ID, 30, { authors: 20 });
    let resolverCalls = 0;
    const hype = makeHype({
      db,
      resolver: async () => { resolverCalls++; return { liquidityUsd: 999 }; },
    });
    const [t] = (await hype.computeHypeMetrics(WIF_ID)).tokens;
    expect(resolverCalls).toBe(0); // no contract → resolver never invoked
    expect(t.liquidityKnown).toBe(false);
    expect(t.hype_to_liquidity).toBeNull();
    expect(t.mentions_24h).toBe(30);
    expect(t.hype_score).not.toBeNull(); // history sufficient
  });
});

// ============================================================================
// MANUFACTURED_HYPE — alert fire + dedup
// ============================================================================

describe('emitHypeAlerts — MANUFACTURED_HYPE', () => {
  it('fires one anomaly alert when hype_to_liquidity > baseline+3σ and unique_sources_pct<0.3', async () => {
    const db = makeDb();
    // Flat 14d baseline: 10 mentions/day → daily hype_to_liq = 10/1e6 = 1e-5
    seedDailyMentions(db, BONK_ID, 10, 10);
    // Raid today: 500 mentions from 50 authors (10% unique) → htl = 5e-4 >> 1e-5 + 3σ
    seedMentions(db, BONK_ID, 500, { authors: 50 });
    /** @type {Array<object>} */
    /** @type {Array<object>} */
    const alerts = [];
    const hype = makeHype({
      db,
      resolver: async () => ({ liquidityUsd: 1_000_000 }),
      alertFn: (/** @type {object} */ a) => { alerts.push(a); },
    });
    const res = await hype.computeWithAlerts(BONK_ID);
    expect(res.alerts).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    const a = res.alerts[0];
    expect(a.type).toBe('anomaly');
    expect(['warning', 'critical']).toContain(a.severity);
    expect(a.monitorId).toBe('token-hype');
    expect(a.data.tokenId).toBe(BONK_ID);
    expect(a.data.metric).toBe('hype_to_liquidity');
    expect(a.data.unique_sources_pct).toBeCloseTo(0.1, 5);
  });

  it('does NOT fire when unique_sources_pct >= floor (organic spike)', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 10, 10);
    seedMentions(db, BONK_ID, 500, { authors: 400 }); // 80% unique → organic
    /** @type {Array<object>} */
    const alerts = [];
    const hype = makeHype({ db, resolver: async () => ({ liquidityUsd: 1_000_000 }), alertFn: (/** @type {object} */ a) => alerts.push(a) });
    const res = await hype.computeWithAlerts(BONK_ID);
    expect(res.alerts).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  it('does NOT fire when spike within baseline+3σ', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 10, 10);
    // flat baseline → σ=0, threshold = mean = 1e-5; today's htl = 1e-5 (NOT >)
    seedMentions(db, BONK_ID, 10, { authors: 2 }); // usp=0.2 < floor but htl within baseline
    /** @type {Array<object>} */
    const alerts = [];
    const hype = makeHype({ db, resolver: async () => ({ liquidityUsd: 1_000_000 }), alertFn: (/** @type {object} */ a) => alerts.push(a) });
    const res = await hype.computeWithAlerts(BONK_ID);
    expect(res.alerts).toHaveLength(0);
  });

  it('does NOT fire without liquidity (htl null)', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 10, 10);
    seedMentions(db, BONK_ID, 500, { authors: 50 });
    /** @type {Array<object>} */
    const alerts = [];
    const hype = makeHype({ db, resolver: async () => null, alertFn: (/** @type {object} */ a) => alerts.push(a) });
    const res = await hype.computeWithAlerts(BONK_ID);
    expect(res.alerts).toHaveLength(0);
  });

  it('does NOT fire with <minBaselineDays baseline', async () => {
    const db = makeDb();
    seedDailyMentions(db, BONK_ID, 10, 2); // 2 days < 3
    seedMentions(db, BONK_ID, 500, { authors: 50 });
    /** @type {Array<object>} */
    const alerts = [];
    const hype = makeHype({ db, resolver: async () => ({ liquidityUsd: 1_000_000 }), alertFn: (/** @type {object} */ a) => alerts.push(a) });
    const res = await hype.computeWithAlerts(BONK_ID);
    expect(res.alerts).toHaveLength(0);
  });

  it('emitHypeAnomalyAlert lands in getAlerts({type:anomaly}) via default seam', async () => {
    clearAlerts();
    const before = getAlerts({ monitorId: 'token-hype' }).length;
    emitHypeAnomalyAlert({
      severity: 'warning',
      message: 'test hype anomaly',
      monitorId: 'token-hype',
      target: BONK_ID,
      data: { tokenId: BONK_ID },
    });
    const alerts = getAlerts({ monitorId: 'token-hype' });
    expect(alerts.length).toBe(before + 1);
    expect(alerts[alerts.length - 1].type).toBe('anomaly');
    expect(alerts[alerts.length - 1].monitorId).toBe('token-hype');
  });
});

// ============================================================================
// Multi-token universe + getTokenMetrics
// ============================================================================

describe('computeHypeMetrics — universe + hours window', () => {
  it('no tokenId → all watchlist tokens + db tokens', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 3, { authors: 3 });
    const hype = makeHype({ db });
    const res = await hype.computeHypeMetrics();
    const ids = res.tokens.map(t => t.tokenId).sort();
    expect(ids).toEqual([BONK_ID, WIF_ID].sort());
  });

  it('hours=48 widens the window', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 10, { authors: 10, ts: NOW - 30 * HOUR }); // outside 24h
    const hype = makeHype({ db });
    const narrow = await hype.computeHypeMetrics(BONK_ID, { hours: 24 });
    expect(narrow.tokens[0].mentions_24h).toBe(0);
    const wide = await hype.computeHypeMetrics(BONK_ID, { hours: 48 });
    expect(wide.tokens[0].mentions_24h).toBe(10);
  });

  it('getTokenMetrics returns single-token shape', async () => {
    const db = makeDb();
    seedMentions(db, BONK_ID, 5, { authors: 5 });
    const hype = makeHype({ db });
    const res = await hype.getTokenMetrics(BONK_ID);
    expect(res.token.tokenId).toBe(BONK_ID);
    expect(res.tokens).toHaveLength(1);
  });
});
