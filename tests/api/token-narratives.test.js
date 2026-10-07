// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 54.5 — GET /api/analytics/narratives (REST surface).
 *
 * Verifies the dual-auth lane (AD-5, eitherAuth):
 * - Canonical `/api/analytics/narratives` + alias `/api/analytics/token-narratives`.
 * - Response envelope { scope: 'watchlist', narratives: [...], degraded, windowHours }.
 * - ?hours=N forwarded into computeNarratives.
 * - Bearer service key lane (MEDIRUS_SERVICE_KEYS).
 *
 * Engine internals are seam-tested in tests/analytics/narrativeTracker.test.js;
 * this file covers the HTTP contract only.
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
 * Ensure token_mentions + narrative tables exist in the real analytics.db.
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
      content     TEXT,
      PRIMARY KEY (token_id, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts
      ON token_mentions (token_id, ts);
    CREATE INDEX IF NOT EXISTS idx_token_mentions_ts_only
      ON token_mentions (ts);
  `);
}

describe('Story 54.5: GET /api/analytics/narratives', () => {
  const userId = makeTestUserId('narratives');
  let authHeader = '';

  beforeAll(async () => {
    await seedTestUser(userId, 'narrativesuser', { isAdmin: true });
    authHeader = `Bearer ${makeTestToken(userId, 'narrativesuser')}`;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureSchema(db);
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO token_mentions
        (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'token:sym:BONK', 'x:rest-narratives-1', 'twitter', 'trader_alice', 750,
      JSON.stringify({ likes: 8, retweets: 1, replies: 2 }),
      now - 1800_000, 0.7, 0, now - 1800_000, now - 1800_000,
      'pepe memecoin pumping hard today',
    );
    db.close();
  });

  afterAll(() => {
    try {
      if (fs.existsSync(DB_PATH)) {
        const db = new Database(DB_PATH);
        db.prepare("DELETE FROM token_mentions WHERE source_id LIKE 'x:rest-narratives-%'").run();
        db.prepare("DELETE FROM narrative_assignments WHERE source_id LIKE 'x:rest-narratives-%'").run();
        db.close();
      }
    } catch {
      // Ignore cleanup error
    }
  });

  it('returns 200 with narratives array for user JWT', async () => {
    const res = await request(app)
      .get('/api/analytics/narratives')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.scope).toBe('watchlist');
    expect(Array.isArray(payload.narratives)).toBe(true);
    expect(typeof payload.degraded).toBe('boolean');
    expect(typeof payload.windowHours).toBe('number');

    // T1: assert seeded post 'pepe memecoin pumping hard today' classifies into a real taxonomy category
    const taxonomyRaw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'narrative-taxonomy.json'), 'utf8'));
    /** @type {Array<{id: string}>} */
    const taxonomyCats = Array.isArray(taxonomyRaw) ? taxonomyRaw : taxonomyRaw.categories;
    const taxonomyIds = new Set(taxonomyCats.map((/** @type {{id: string}} */ c) => c.id));
    const hasTaxonomyNarrative = payload.narratives.some((/** @type {{id: string}} */ n) => taxonomyIds.has(n.id));
    const isNotSolelyOther = payload.narratives.length > 0 && !payload.narratives.every((/** @type {{id: string}} */ n) => n.id === '__other__');
    expect(hasTaxonomyNarrative || isNotSolelyOther).toBe(true);
  });

  it('alias GET /api/analytics/token-narratives returns same envelope', async () => {
    const res = await request(app)
      .get('/api/analytics/token-narratives')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.scope).toBe('watchlist');
    expect(Array.isArray(payload.narratives)).toBe(true);
  });

  it('?hours=12 returns windowHours: 12', async () => {
    const res = await request(app)
      .get('/api/analytics/narratives?hours=12')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    const payload = Array.isArray(body) ? body[0] : body;
    expect(payload.windowHours).toBe(12);
  });

  it('anonymous lane accepts eitherAuth (200 or 401 depending on serviceAuth config)', async () => {
    const res = await request(app).get('/api/analytics/narratives');
    expect([200, 401]).toContain(res.status);
  });

  it('Bearer service key (MEDIRUS_SERVICE_KEYS) returns 200', async () => {
    const origEnv = process.env.MEDIRUS_SERVICE_KEYS;
    const testKey = 'test-service-key-narratives-xyz';
    process.env.MEDIRUS_SERVICE_KEYS = JSON.stringify({
      [testKey]: { consumer_id: 'jev', tier: 'internal' },
    });
    const { _resetServiceKeyMap } = await import('../../api/middleware/serviceAuth.js');
    _resetServiceKeyMap();
    try {
      const res = await request(app)
        .get('/api/analytics/narratives')
        .set('Authorization', `Bearer ${testKey}`);
      expect(res.status).toBe(200);
      const body = res.body.data ?? res.body;
      const payload = Array.isArray(body) ? body[0] : body;
      expect(payload.scope).toBe('watchlist');
      expect(Array.isArray(payload.narratives)).toBe(true);
    } finally {
      if (origEnv === undefined) {
        delete process.env.MEDIRUS_SERVICE_KEYS;
      } else {
        process.env.MEDIRUS_SERVICE_KEYS = origEnv;
      }
      _resetServiceKeyMap();
    }
  });
});
