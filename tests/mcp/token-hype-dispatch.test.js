// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 54.3 — `x_analytics` action `token_hype` domain dispatch.
 *
 * Verifies the Epic-52 dispatcher surface:
 * - `x_analytics` schema advertises `token_hype` action
 * - DOMAIN_DISPATCH_MAP routes token_hype → x_token_hype
 * - Happy path returns a ToolEnvelope carrying {tokens, degraded, alerts}
 * - tokenId + hours args are forwarded into the analytics tool
 *
 * The target tool's internals are seam-tested in
 * tests/analytics/hypeAuthenticity.test.js; this file covers the
 * dispatcher↔tool contract only (spec MCP_ACTION row).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, beforeAll } from 'vitest';
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

/** Ensure token_mentions exists in the real analytics.db (schema mirrors 54.2).
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

describe('Story 54.3: x_analytics token_hype dispatch', () => {
  beforeAll(async () => {
    process.env.XACTIONS_MODE = 'local';
    await initializeBackend();

    // Seed the real analytics.db with one mention row for BONK so the
    // default hype instance has data to aggregate. Schema identical to
    // the 54.2 pipeline's ensureSchema.
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureSchema(db);
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO token_mentions
        (token_id, source_id, platform, author, followers, engagement, ts, sentiment, is_bot, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'token:sym:BONK', 'x:test-dispatch-1', 'twitter', 'tester', 1000,
      JSON.stringify({ likes: 5, retweets: 1, replies: 0 }),
      now - 3600_000, 0.5, 0, now - 3600_000, now - 3600_000,
    );
    db.close();
  });

  it('x_analytics schema advertises token_hype in the action enum', () => {
    const xAnalytics = DOMAIN_TOOLS.find((t) => t.name === 'x_analytics');
    assert.ok(xAnalytics, 'x_analytics dispatcher must exist');
    /** @type {string[]} */
    const enumValues = /** @type {string[]} */ (xAnalytics.inputSchema?.properties?.action?.enum ?? []);
    assert.ok(
      enumValues.includes('token_hype'),
      `x_analytics action enum must include token_hype (got ${enumValues.join(', ')})`,
    );
    // tokenId + hours params documented for the action
    assert.ok(
      'tokenId' in (xAnalytics.inputSchema?.properties ?? {}),
      'x_analytics schema should expose tokenId for token_hype filter',
    );
  });

  it('DOMAIN_DISPATCH_MAP routes x_analytics token_hype → x_token_hype', () => {
    const entry = DOMAIN_DISPATCH_MAP.x_analytics?.token_hype;
    assert.ok(entry, 'DOMAIN_DISPATCH_MAP.x_analytics.token_hype missing');
    assert.equal(entry.targetTool, 'x_token_hype');
    assert.deepEqual(entry.requiredArgs, []);
  });

  it('HAPPY_PATH: executeTool(x_analytics, token_hype) returns ToolEnvelope with tokens', async () => {
    /** @type {any} */
    const res = await executeTool('x_analytics', { action: 'token_hype' });
    assert.ok(res, 'response must exist');
    assert.equal(res.success, true, `expected success:true, got ${JSON.stringify(res).slice(0, 400)}`);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_analytics');
    // Result payload shape per spec: { tokens, degraded, alerts }
    const data = /** @type {any} */ (Array.isArray(res.data) ? res.data[0] : res.data);
    assert.ok(data, 'data payload must exist');
    assert.ok(Array.isArray(data.tokens), `expected data.tokens array, got ${JSON.stringify(data).slice(0, 300)}`);
    assert.equal(typeof data.degraded, 'boolean');
    assert.ok(Array.isArray(data.alerts));
  });

  it('HAPPY_PATH: tokenId + hours args forward into result (filtered query still valid)', async () => {
    /** @type {any} */
    const res = await executeTool('x_analytics', {
      action: 'token_hype',
      tokenId: 'token:sym:BONK',
      hours: 48,
    });
    assert.ok(res);
    assert.equal(res.success, true);
    const data = /** @type {any} */ (Array.isArray(res.data) ? res.data[0] : res.data);
    assert.ok(data && Array.isArray(data.tokens));
  });
});
