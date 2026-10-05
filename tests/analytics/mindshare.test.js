// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for mindshare.js — Token Mindshare Engine (Story 54.4).
 *
 * Share-of-Voice % + Delta 24h/7d + Top Voices over `token_mentions`.
 *
 * No mock frameworks — deterministic injected seams (`db`, `healthFn`,
 * `now`, `watchlist`) per spec. In-memory better-sqlite3 db stands
 * in for analytics.db; `token_mentions` schema mirrors 54.2 pipeline.
 *
 * Covers the full I/O matrix: HAPPY_PATH, DELTA_RISE, DELTA_7D,
 * INSUFFICIENT_HISTORY, EMPTY_WATCHLIST, ZERO_MENTIONS, TOKEN_FILTER,
 * UNKNOWN_TOKEN, BOT_HEAVY, DEGRADED, NON_STRING_TOKENID, TOP_VOICES.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  createMindshareEngine,
  getDefaultMindshare,
  resetDefaultMindshare,
} from '../../src/analytics/mindshare.js';

// ============================================================================
// Fixtures & Helpers
// ============================================================================

const SOL_CONTRACT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP';
const BONK_ID = `token:solana:${SOL_CONTRACT}`;
const WIF_ID = 'token:sym:WIF';
const PEPE_ID = 'token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const WATCHLIST = {
  tokens: [
    { symbol: 'BONK', contract: SOL_CONTRACT, chain: 'solana' },
    { symbol: 'WIF', chain: 'solana' },
    { symbol: 'PEPE', contract: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum' },
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
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts_only ON token_mentions (ts);
  `);
  return db;
}

let _seq = 0;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   tokenId: string,
 *   author?: string|null,
 *   followers?: number,
 *   engagement?: Record<string, number>|string,
 *   ts?: number,
 *   isBot?: number
 * }} opts
 */
function seedMention(db, opts) {
  const {
    tokenId,
    author = 'trader_1',
    followers = 500,
    engagement = { likes: 0, retweets: 0, replies: 0 },
    ts = NOW - 2 * HOUR,
    isBot = 0,
  } = opts;

  const stmt = db.prepare(`
    INSERT INTO token_mentions (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
    VALUES (?, ?, 'twitter', ?, ?, ?, ?, 0.5, ?, ?, ?)
  `);
  const sid = `x:test:${_seq++}`;
  const engStr = typeof engagement === 'string' ? engagement : JSON.stringify(engagement);
  stmt.run(tokenId, sid, author, followers, engStr, ts, isBot, ts, ts);
}

// ============================================================================
// Tests
// ============================================================================

describe('Story 54.4: Token Mindshare Engine (Unit)', () => {
  it('HAPPY_PATH: 3 tokens with weighted volumes 50/30/20 yield mindsharePct ≈ 50/30/20 ±1pt', async () => {
    const db = makeDb();
    // 50 weighted volume for BONK: 50 mentions with followers=500 (weight=1)
    for (let i = 0; i < 50; i++) {
      seedMention(db, { tokenId: BONK_ID, followers: 500, author: `author_${i % 5}` });
    }
    // 30 weighted volume for WIF: 30 mentions with followers=500 (weight=1)
    for (let i = 0; i < 30; i++) {
      seedMention(db, { tokenId: WIF_ID, followers: 500, author: `author_wif_${i % 3}` });
    }
    // 20 weighted volume for PEPE: 20 mentions with followers=500 (weight=1)
    for (let i = 0; i < 20; i++) {
      seedMention(db, { tokenId: PEPE_ID, followers: 500, author: `author_pepe_${i % 2}` });
    }

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare();

    expect(res.scope).toBe('watchlist');
    expect(res.degraded).toBe(false);
    expect(res.tokens.length).toBe(3);

    const bonk = res.tokens.find(t => t.token === BONK_ID);
    const wif = res.tokens.find(t => t.token === WIF_ID);
    const pepe = res.tokens.find(t => t.token === PEPE_ID);

    assert(bonk);
    assert(wif);
    assert(pepe);

    expect(Math.abs(bonk.mindsharePct - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(wif.mindsharePct - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(pepe.mindsharePct - 20)).toBeLessThanOrEqual(1);

    // Check topVoices sorted desc by weightedVolume
    expect(bonk.topVoices.length).toBeGreaterThan(0);
    for (let i = 0; i < bonk.topVoices.length - 1; i++) {
      expect(bonk.topVoices[i].weightedVolume).toBeGreaterThanOrEqual(bonk.topVoices[i + 1].weightedVolume);
    }
  });

  it('DELTA_RISE: token A share 10% in trailing 24h, 40% in current 24h yields delta24h ≈ +30pt', async () => {
    const db = makeDb();

    // Trailing 24h: [NOW - 48h, NOW - 24h]
    // Token A (BONK): 10 mentions (weight 1 = 10)
    // Token B (WIF): 90 mentions (weight 1 = 90) -> Total = 100 -> BONK share = 10%
    const trailingTs = NOW - 36 * HOUR;
    for (let i = 0; i < 10; i++) {
      seedMention(db, { tokenId: BONK_ID, ts: trailingTs });
    }
    for (let i = 0; i < 90; i++) {
      seedMention(db, { tokenId: WIF_ID, ts: trailingTs });
    }

    // Current 24h: [NOW - 24h, NOW]
    // Token A (BONK): 40 mentions (weight 1 = 40)
    // Token B (WIF): 60 mentions (weight 1 = 60) -> Total = 100 -> BONK share = 40%
    const currentTs = NOW - 5 * HOUR;
    for (let i = 0; i < 40; i++) {
      seedMention(db, { tokenId: BONK_ID, ts: currentTs });
    }
    for (let i = 0; i < 60; i++) {
      seedMention(db, { tokenId: WIF_ID, ts: currentTs });
    }

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare(BONK_ID);

    expect(res.tokens.length).toBe(1);
    const bonk = res.tokens[0];
    assert(bonk);
    expect(bonk.token).toBe(BONK_ID);
    expect(bonk.mindsharePct).toBeCloseTo(40, 1);
    expect(bonk.delta24h).not.toBeNull();
    assert(bonk.delta24h !== null);
    expect(bonk.delta24h).toBeCloseTo(30, 1);
  });

  it('DELTA_7D: token A share 5% in trailing 7d, 20% in current 7d yields delta7d ≈ +15pt (with ≥3 baseline days)', async () => {
    const db = makeDb();

    // Trailing 7d: [NOW - 14d, NOW - 7d]
    // Seed across 4 distinct days (≥ minBaselineDays=3)
    // Total trailing: BONK = 5, WIF = 95 -> Total = 100 -> BONK share = 5%
    for (let d = 8; d <= 11; d++) {
      const ts = NOW - d * DAY;
      const bonkCount = d === 8 ? 2 : 1;
      const wifCount = d === 8 ? 23 : 24;
      for (let i = 0; i < bonkCount; i++) seedMention(db, { tokenId: BONK_ID, ts });
      for (let i = 0; i < wifCount; i++) seedMention(db, { tokenId: WIF_ID, ts });
    }

    // Current 7d: [NOW - 7d, NOW]
    // Total current: BONK = 20, WIF = 80 -> Total = 100 -> BONK share = 20%
    const currentTs = NOW - 2 * DAY;
    for (let i = 0; i < 20; i++) seedMention(db, { tokenId: BONK_ID, ts: currentTs });
    for (let i = 0; i < 80; i++) seedMention(db, { tokenId: WIF_ID, ts: currentTs });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW, minBaselineDays: 3 });
    const res = await engine.computeMindshare(BONK_ID);

    const bonk = res.tokens[0];
    assert(bonk);
    expect(bonk.token).toBe(BONK_ID);
    expect(bonk.delta7d).not.toBeNull();
    assert(bonk.delta7d !== null);
    expect(bonk.delta7d).toBeCloseTo(15, 1);
    expect(bonk.insufficientHistory).toBeFalsy();
  });

  it('INSUFFICIENT_HISTORY: token with only 1 day of data in 7d baseline yields delta7d:null and insufficientHistory:true', async () => {
    const db = makeDb();

    // Seed trailing 7d on ONLY 1 distinct day (day 9)
    const tsTrailing = NOW - 9 * DAY;
    seedMention(db, { tokenId: BONK_ID, ts: tsTrailing });
    seedMention(db, { tokenId: WIF_ID, ts: tsTrailing });

    // Seed trailing 24h
    const ts24hTrailing = NOW - 30 * HOUR;
    seedMention(db, { tokenId: BONK_ID, ts: ts24hTrailing });
    seedMention(db, { tokenId: WIF_ID, ts: ts24hTrailing });

    // Current 24h
    seedMention(db, { tokenId: BONK_ID, ts: NOW - 2 * HOUR });
    seedMention(db, { tokenId: WIF_ID, ts: NOW - 2 * HOUR });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW, minBaselineDays: 3 });
    const res = await engine.computeMindshare(BONK_ID);

    const bonk = res.tokens[0];
    assert(bonk);
    expect(bonk.token).toBe(BONK_ID);
    expect(bonk.delta7d).toBeNull();
    expect(bonk.insufficientHistory).toBe(true);
    expect(bonk.delta24h).not.toBeNull();
  });

  it('EMPTY_WATCHLIST: empty watchlist returns empty tokens with warning', async () => {
    const db = makeDb();
    const engine = createMindshareEngine({ db, watchlist: { tokens: [] }, now: () => NOW });
    const res = await engine.computeMindshare();

    expect(res.tokens).toEqual([]);
    expect(res.degraded).toBe(false);
    expect(res.warning).toBe('watchlist empty');
  });

  it('ZERO_MENTIONS: no mentions in current window returns mindsharePct 0', async () => {
    const db = makeDb();
    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare();

    expect(res.tokens.length).toBe(3);
    for (const tok of res.tokens) {
      expect(tok.mindsharePct).toBe(0);
      expect(tok.topVoices).toEqual([]);
      expect(tok.delta24h).toBeNull();
      expect(tok.delta7d).toBeNull();
      expect(tok.insufficientHistory).toBe(true);
    }
  });

  it('TOKEN_FILTER: filtering for specific tokenId returns single token computed against full universe', async () => {
    const db = makeDb();
    // 50 BONK, 50 WIF in active window
    for (let i = 0; i < 50; i++) seedMention(db, { tokenId: BONK_ID, followers: 100 });
    for (let i = 0; i < 50; i++) seedMention(db, { tokenId: WIF_ID, followers: 100 });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare(BONK_ID);

    expect(res.tokens.length).toBe(1);
    const bonk = res.tokens[0];
    assert(bonk);
    expect(bonk.token).toBe(BONK_ID);
    // Denominator is 100, not 50
    expect(bonk.mindsharePct).toBeCloseTo(50, 1);
  });

  it('UNKNOWN_TOKEN: unknown tokenId returns tokens:[] with warning', async () => {
    const db = makeDb();
    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare('token:unknown:0x123');

    expect(res.tokens).toEqual([]);
    expect(res.warning).toContain('not in watchlist and has no recorded mentions');
  });

  it('BOT_HEAVY: bot mentions (is_bot=1) are counted towards weighted volume', async () => {
    const db = makeDb();
    // 50 bot mentions for BONK, 50 human mentions for WIF
    for (let i = 0; i < 50; i++) seedMention(db, { tokenId: BONK_ID, isBot: 1, followers: 500 });
    for (let i = 0; i < 50; i++) seedMention(db, { tokenId: WIF_ID, isBot: 0, followers: 500 });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare();

    const bonk = res.tokens.find(t => t.token === BONK_ID);
    const wif = res.tokens.find(t => t.token === WIF_ID);

    assert(bonk);
    assert(wif);
    expect(bonk.mindsharePct).toBeCloseTo(50, 1);
    expect(wif.mindsharePct).toBeCloseTo(50, 1);
  });

  it('DEGRADED: healthFn degraded=true reflects in envelope and items; empty window returns tokens:[]', async () => {
    const db = makeDb();
    const healthFn = () => ({
      degraded: true,
      consecutiveEmptyBatches: 5,
      degradedSince: NOW - 600_000,
    });

    // 1) Window empty -> returns tokens: []
    const engineEmpty = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW, healthFn });
    const resEmpty = await engineEmpty.computeMindshare();
    expect(resEmpty.degraded).toBe(true);
    expect(resEmpty.tokens).toEqual([]);
    expect(resEmpty.consecutiveEmptyBatches).toBe(5);

    // 2) Window has data -> computes with degraded: true
    seedMention(db, { tokenId: BONK_ID, followers: 1000 });
    const engineWithData = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW, healthFn });
    const resWithData = await engineWithData.computeMindshare();
    expect(resWithData.degraded).toBe(true);
    expect(resWithData.tokens.length).toBeGreaterThan(0);
    const firstTok = resWithData.tokens[0];
    assert(firstTok);
    expect(firstTok.degraded).toBe(true);
  });

  it('TOP_VOICES: filters out empty/null authors and respects topN cap', async () => {
    const db = makeDb();
    // Insert 15 distinct authors with varying weights
    for (let i = 1; i <= 15; i++) {
      seedMention(db, {
        tokenId: BONK_ID,
        author: `vip_author_${i}`,
        followers: i * 1000,
        engagement: { likes: i * 10, retweets: 0, replies: 0 },
      });
    }
    // Insert null/empty author mentions
    seedMention(db, { tokenId: BONK_ID, author: null, followers: 50000 });
    seedMention(db, { tokenId: BONK_ID, author: '   ', followers: 50000 });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW, topN: 5 });
    const res = await engine.computeMindshare(BONK_ID);

    const bonk = res.tokens[0];
    assert(bonk);
    const voices = bonk.topVoices;
    expect(voices.length).toBe(5);
    expect(voices.some(v => !v.author || !v.author.trim())).toBe(false);
    assert(voices[0]);
    expect(voices[0].author).toBe('vip_author_15');
  });

  it('WEIGHTING: follower bands and engagement weights are applied accurately', async () => {
    const db = makeDb();
    seedMention(db, {
      tokenId: BONK_ID,
      author: 'author_a',
      followers: 500,
      engagement: { likes: 10, retweets: 0, replies: 0 },
    });
    seedMention(db, {
      tokenId: BONK_ID,
      author: 'author_b',
      followers: 50000,
      engagement: { likes: 0, retweets: 0, replies: 0 },
    });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare(BONK_ID);

    const bonk = res.tokens[0];
    assert(bonk);
    const voices = bonk.topVoices;
    assert(voices[0]);
    assert(voices[1]);
    expect(voices[0].author).toBe('author_a');
    expect(voices[0].weightedVolume).toBe(6);
    expect(voices[1].author).toBe('author_b');
    expect(voices[1].weightedVolume).toBe(2);
  });

  it('NON_STRING_TOKENID: non-string tokenId (array) is ignored, no crash', async () => {
    const db = makeDb();
    seedMention(db, { tokenId: BONK_ID, followers: 500 });
    seedMention(db, { tokenId: WIF_ID, followers: 500 });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    // @ts-expect-error - testing invalid runtime input
    const res = await engine.computeMindshare(['invalid', 'array']);
    expect(res.tokens.length).toBe(3);
    expect(res.tokens.map((t) => t.token)).toContain(BONK_ID);
    expect(res.tokens.map((t) => t.token)).toContain(WIF_ID);
  });

  it('SINGLETON: getDefaultMindshare() returns singleton, resetDefaultMindshare() clears it', () => {
    resetDefaultMindshare();
    const inst1 = getDefaultMindshare();
    const inst2 = getDefaultMindshare();
    expect(inst1).toBe(inst2);
    resetDefaultMindshare();
    const inst3 = getDefaultMindshare();
    expect(inst3).not.toBe(inst1);
    resetDefaultMindshare();
  });

  it('HOURS_FILTER: hours:1 only counts mentions in the last hour', async () => {
    const db = makeDb();
    seedMention(db, { tokenId: BONK_ID, followers: 500, ts: NOW - 30 * 60 * 1000 });
    seedMention(db, { tokenId: WIF_ID, followers: 500, ts: NOW - 90 * 60 * 1000 });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare(undefined, { hours: 1 });

    expect(res.windowHours).toBe(1);
    const bonk = res.tokens.find((t) => t.token === BONK_ID);
    const wif = res.tokens.find((t) => t.token === WIF_ID);
    assert(bonk);
    assert(wif);
    expect(bonk.mindsharePct).toBe(100);
    expect(wif.mindsharePct).toBe(0);
  });

  it('AUTHOR_AGGREGATION: multiple mentions by same author aggregate mentions count + accumulated weightedVolume in topVoices', async () => {
    const db = makeDb();
    // Author '@Trader_Joe' mentions BONK twice with different representations & engagements
    // mention 1: followers: 500 (weight 1), likes: 10 (score 5) -> w = 6
    seedMention(db, {
      tokenId: BONK_ID,
      author: '@Trader_Joe',
      followers: 500,
      engagement: { likes: 10, retweets: 0, replies: 0 },
      ts: NOW - 10 * 60 * 1000,
    });
    // mention 2: author 'trader_joe' (without @, lower case)
    // followers: 500 (weight 1), likes: 20 (score 10) -> w = 11
    seedMention(db, {
      tokenId: BONK_ID,
      author: 'trader_joe',
      followers: 500,
      engagement: { likes: 20, retweets: 0, replies: 0 },
      ts: NOW - 20 * 60 * 1000,
    });

    const engine = createMindshareEngine({ db, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare(BONK_ID);

    const bonk = res.tokens[0];
    assert(bonk);
    expect(bonk.topVoices.length).toBe(1);
    const voice = bonk.topVoices[0];
    assert(voice);
    expect(voice.author).toBe('trader_joe');
    expect(voice.mentions).toBe(2);
    expect(voice.weightedVolume).toBe(17);
  });

  it('CONFIG_AND_EDGE_CASES: getEngineConfig, followerBands:[], null options, and explicit 0 options', async () => {
    const customEngine = createMindshareEngine({
      topN: 0,
      minBaselineDays: 0,
      followerBands: [],
      weights: { likes: 1, retweets: 1, replies: 1 },
    });
    const cfg = customEngine.getEngineConfig();
    expect(cfg.topN).toBe(0);
    expect(cfg.minBaselineDays).toBe(0);
    expect(cfg.followerBands.length).toBeGreaterThan(0);
    expect(cfg.weights).toEqual({ likes: 1, retweets: 1, replies: 1 });

    // computeMindshare(tokenId, null) should not crash
    // @ts-expect-error - testing null options
    const resNullOpts = await customEngine.computeMindshare(undefined, null);
    expect(resNullOpts).toBeDefined();
    expect(Array.isArray(resNullOpts.tokens)).toBe(true);
  });

  it('UNINITIALIZED_TABLE: returns graceful warning when token_mentions does not exist', async () => {
    const emptyDb = new Database(':memory:');
    const engine = createMindshareEngine({ db: emptyDb, watchlist: WATCHLIST, now: () => NOW });
    const res = await engine.computeMindshare();
    expect(res.tokens).toEqual([]);
    expect(res.warning).toBe('token_mentions table not initialized');
    expect(res.scope).toBe('watchlist');
    expect(typeof res.generatedAt).toBe('string');
  });
});
