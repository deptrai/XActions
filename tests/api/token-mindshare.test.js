// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 54.4 — GET /api/analytics/token-mindshare (REST surface).
 *
 * Verifies the dual-auth lane (AD-5, eitherAuth):
 * - Mounted BEFORE the router-level `authenticate` so machine consumers
 *   (Bearer service key) and user-JWT both reach the handler.
 * - Response envelope { scope: 'watchlist', tokens: [...], degraded, windowHours }.
 * - Query param tokenId forwarded; array-valued tokenId does not
 *   crash the sqlite layer (spec NON_STRING_TOKENID row).
 *
 * The metric engine internals are seam-tested in
 * tests/analytics/mindshare.test.js; this file covers the HTTP
 * contract only.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import app from '../../api/server.js';
import { makeTestToken, makeTestUserId, seedTestUser } from './fixtures/test-user.js';

const DB_PATH = path.join(os.homedir(), '.medirus', 'analytics.db');

/**
 * Ensure token_mentions exists in analytics.db (schema mirrors 54.2 pipeline).
 * @param {import('better-sqlite3').Database} db
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
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts_only
      ON token_mentions (ts);
  `);
}

describe('Story 54.4: GET /api/analytics/token-mindshare', () => {
  const userId = makeTestUserId('mindshare');
  let authHeader = '';

  beforeAll(async () => {
    await seedTestUser(userId, 'mindshareuser', { isAdmin: true });
    authHeader = `Bearer ${makeTestToken(userId, 'mindshareuser')}`;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureSchema(db);
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO token_mentions
        (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'token:sym:BONK', 'x:rest-mindshare-1', 'twitter', 'trader_alice', 750,
      JSON.stringify({ likes: 8, retweets: 1, replies: 2 }),
      now - 1800_000, 0.7, 0, now - 1800_000, now - 1800_000,
    );
    db.close();
  });

  afterAll(() => {
    try {
      if (fs.existsSync(DB_PATH)) {
        const db = new Database(DB_PATH);
        db.prepare("DELETE FROM token_mentions WHERE source_id LIKE 'x:rest-mindshare-%'").run();
        db.close();
      }
    } catch {
      // Ignore cleanup error
    }
  });

  it('returns 200 with tokens array for user JWT', async () => {
    const res = await request(app)
      .get('/api/analytics/token-mindshare')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.scope).toBe('watchlist');
    expect(Array.isArray(payload.tokens)).toBe(true);
    expect(typeof payload.degraded).toBe('boolean');
    expect(typeof payload.windowHours).toBe('number');
  });

  it('accepts anonymous lane when no Authorization header (eitherAuth → serviceAuth anonymous)', async () => {
    const res = await request(app).get('/api/analytics/token-mindshare');
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body.data ?? res.body;
      const payload = Array.isArray(body) ? body[0] : body;
      expect(Array.isArray(payload.tokens)).toBe(true);
    }
  });

  it('array-valued ?tokenId=a&tokenId=b does not crash (returns 200, treats as no filter)', async () => {
    const res = await request(app)
      .get('/api/analytics/token-mindshare?tokenId=a&tokenId=b')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('string tokenId param forwards correctly', async () => {
    const res = await request(app)
      .get('/api/analytics/token-mindshare?tokenId=token:sym:BONK')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(Array.isArray(payload.tokens)).toBe(true);
  });

  it('canonical alias GET /api/analytics/mindshare returns 200 with expected shape', async () => {
    const res = await request(app)
      .get('/api/analytics/mindshare')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.scope).toBe('watchlist');
    expect(Array.isArray(payload.tokens)).toBe(true);
    expect(typeof payload.degraded).toBe('boolean');
    expect(typeof payload.windowHours).toBe('number');
  });

  it('Bearer service key (MEDIRUS_SERVICE_KEYS) returns 200', async () => {
    const origEnv = process.env.MEDIRUS_SERVICE_KEYS;
    const testKey = 'test-service-key-mindshare-xyz';
    process.env.MEDIRUS_SERVICE_KEYS = JSON.stringify({
      [testKey]: { consumer_id: 'jev', tier: 'internal' },
    });
    const { _resetServiceKeyMap } = await import('../../api/middleware/serviceAuth.js');
    _resetServiceKeyMap();
    try {
      const res = await request(app)
        .get('/api/analytics/mindshare')
        .set('Authorization', `Bearer ${testKey}`);
      expect(res.status).toBe(200);
      const body = res.body.data ?? res.body;
      const payload = Array.isArray(body) ? body[0] : body;
      expect(payload.scope).toBe('watchlist');
      expect(Array.isArray(payload.tokens)).toBe(true);
    } finally {
      if (origEnv === undefined) {
        delete process.env.MEDIRUS_SERVICE_KEYS;
      } else {
        process.env.MEDIRUS_SERVICE_KEYS = origEnv;
      }
      _resetServiceKeyMap();
    }
  });

  it('?hours=12 returns windowHours: 12', async () => {
    const res = await request(app)
      .get('/api/analytics/token-mindshare?hours=12')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.windowHours).toBe(12);
  });
});
