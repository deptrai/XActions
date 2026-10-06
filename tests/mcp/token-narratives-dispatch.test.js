// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 54.5 — `x_analytics` action `token_narratives` domain dispatch.
 *
 * Mirrors tests/mcp/token-mindshare-dispatch.test.js (Story 54.4):
 * - `x_analytics` schema advertises `token_narratives` action
 * - DOMAIN_DISPATCH_MAP routes token_narratives → x_token_narratives
 * - Happy path returns a ToolEnvelope carrying {scope, narratives, degraded, windowHours}
 * - Direct execution via executeTool('x_token_narratives', ...) succeeds
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  DOMAIN_TOOLS,
  DOMAIN_DISPATCH_MAP,
  executeTool,
  initializeBackend,
} from '../../src/mcp/server.js';

const DB_PATH = path.join(os.homedir(), '.xactions', 'analytics.db');

/**
 * Ensure token_mentions (+ content column) and narrative tables exist in the
 * real analytics.db used by the MCP analytics service.
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
    CREATE TABLE IF NOT EXISTS narrative_assignments (
      source_id    TEXT PRIMARY KEY,
      narrative_id TEXT NOT NULL,
      ts           INTEGER,
      via          TEXT
    );
    CREATE TABLE IF NOT EXISTS narrative_labels (
      narrative_id TEXT PRIMARY KEY,
      label        TEXT,
      keywords     TEXT,
      emergent     INTEGER DEFAULT 0,
      created_at   INTEGER
    );
  `);
}

describe('Story 54.5: x_analytics token_narratives dispatch', () => {
  beforeAll(async () => {
    process.env.XACTIONS_MODE = 'local';
    await initializeBackend();

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureSchema(db);
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO token_mentions
        (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'token:sym:BONK', 'x:test-narratives-dispatch-1', 'twitter', 'trader_bob', 1500,
      JSON.stringify({ likes: 10, retweets: 2, replies: 1 }),
      now - 3600_000, 0.5, 0, now - 3600_000, now - 3600_000,
      'pepe memecoin pumping',
    );
    db.close();
  });

  afterAll(() => {
    try {
      if (fs.existsSync(DB_PATH)) {
        const db = new Database(DB_PATH);
        db.prepare("DELETE FROM token_mentions WHERE source_id LIKE 'x:test-narratives-dispatch-%'").run();
        db.prepare("DELETE FROM narrative_assignments WHERE source_id LIKE 'x:test-narratives-dispatch-%'").run();
        db.close();
      }
    } catch {
      // Ignore cleanup error
    }
  });

  it('x_analytics schema advertises token_narratives in the action enum', () => {
    const xAnalytics = DOMAIN_TOOLS.find((t) => t.name === 'x_analytics');
    assert.ok(xAnalytics, 'x_analytics dispatcher must exist');
    const enumValues = /** @type {string[]} */ (xAnalytics.inputSchema?.properties?.action?.enum ?? []);
    assert.ok(
      enumValues.includes('token_narratives'),
      `x_analytics action enum must include token_narratives (got ${enumValues.join(', ')})`,
    );
    assert.ok(
      'hours' in (xAnalytics.inputSchema?.properties ?? {}),
      'x_analytics schema should expose hours for token_narratives window',
    );
  });

  it('DOMAIN_DISPATCH_MAP routes x_analytics token_narratives → x_token_narratives', () => {
    const entry = DOMAIN_DISPATCH_MAP.x_analytics?.token_narratives;
    assert.ok(entry, 'DOMAIN_DISPATCH_MAP.x_analytics.token_narratives missing');
    assert.equal(entry.targetTool, 'x_token_narratives');
    assert.deepEqual(entry.requiredArgs, []);
  });

  it('HAPPY_PATH: executeTool(x_analytics, token_narratives) returns ToolEnvelope with narratives', async () => {
    /** @type {any} */
    const res = await executeTool('x_analytics', { action: 'token_narratives' });
    assert.ok(res, 'response must exist');
    assert.equal(res.success, true, `expected success:true, got ${JSON.stringify(res).slice(0, 400)}`);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_analytics');

    const data = /** @type {any} */ (Array.isArray(res.data) ? res.data[0] : res.data);
    assert.ok(data, 'data payload must exist');
    assert.equal(data.scope, 'watchlist');
    assert.ok(Array.isArray(data.narratives), `expected data.narratives array, got ${JSON.stringify(data).slice(0, 300)}`);
    assert.equal(typeof data.degraded, 'boolean');
    assert.equal(typeof data.windowHours, 'number');
    assert.ok(data.generatedAt);

    if (data.narratives.length > 0) {
      const first = data.narratives[0];
      assert.equal(typeof first.id, 'string');
      assert.equal(typeof first.label, 'string');
      assert.equal(typeof first.mindsharePct, 'number');
    }
  });

  it('DIRECT_CALL: executeTool(x_token_narratives) returns valid payload', async () => {
    /** @type {any} */
    const res = await executeTool('x_token_narratives', { hours: 24 });
    assert.ok(res);
    assert.equal(res.scope, 'watchlist');
    assert.ok(Array.isArray(res.narratives));
    assert.equal(typeof res.degraded, 'boolean');
    assert.equal(typeof res.windowHours, 'number');
  });
});
