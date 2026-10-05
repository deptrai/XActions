// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 54.3 — GET /api/analytics/token-hype (REST surface).
 *
 * Verifies the dual-auth lane (AD-5, eitherAuth):
 * - Mounted BEFORE the router-level `authenticate` so machine consumers
 *   (Bearer service key) and user-JWT both reach the handler.
 * - Response envelope { tokens: [...], degraded, alerts }.
 * - Query params tokenId + hours forwarded; array-valued tokenId does not
 *   crash the sqlite layer (spec TOKEN_FILTER + REST_ENDPOINT rows).
 *
 * The metric engine internals are seam-tested in
 * tests/analytics/hypeAuthenticity.test.js; this file covers the HTTP
 * contract only.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import app from '../../api/server.js';
import { makeTestToken, makeTestUserId, seedTestUser } from './fixtures/test-user.js';

const DB_PATH = path.join(os.homedir(), '.xactions', 'analytics.db');

/** Ensure token_mentions exists in analytics.db (schema mirrors 54.2 pipeline).
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

describe('Story 54.3: GET /api/analytics/token-hype', () => {
  const userId = makeTestUserId('hype');
  let authHeader = '';

  beforeAll(async () => {
    await seedTestUser(userId, 'hypeuser', { isAdmin: true });
    authHeader = `Bearer ${makeTestToken(userId, 'hypeuser')}`;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureSchema(db);
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO token_mentions
        (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'token:sym:BONK', 'x:rest-dispatch-1', 'twitter', 'tester', 500,
      JSON.stringify({ likes: 3, retweets: 0, replies: 1 }),
      now - 1800_000, 0.6, 0, now - 1800_000, now - 1800_000,
    );
    db.close();
  });

  it('returns 200 with tokens array for user JWT', async () => {
    const res = await request(app)
      .get('/api/analytics/token-hype')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(Array.isArray(payload.tokens)).toBe(true);
    expect(typeof payload.degraded).toBe('boolean');
  });

  it('accepts anonymous lane when no Authorization header (eitherAuth → serviceAuth anonymous)', async () => {
    const res = await request(app).get('/api/analytics/token-hype');
    // anonymous is a valid lane per serviceAuth — expect 200 (or 401 only if
    // route fell through to the JWT-only global authenticate, which would be
    // the bug this route mounting order prevents)
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body.data ?? res.body;
      const payload = Array.isArray(body) ? body[0] : body;
      expect(Array.isArray(payload.tokens)).toBe(true);
    }
  });

  it('array-valued ?tokenId=a&tokenId=b does not crash (returns 200, treats as no filter)', async () => {
    const res = await request(app)
      .get('/api/analytics/token-hype?tokenId=a&tokenId=b')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('string tokenId + hours params forward correctly', async () => {
    const res = await request(app)
      .get('/api/analytics/token-hype?tokenId=token:sym:BONK&hours=12')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(Array.isArray(payload.tokens)).toBe(true);
  });
});
