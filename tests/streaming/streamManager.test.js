// by nichxbt
import { describe, it, expect } from 'vitest';
import { getStreamStats, STREAM_TYPES } from '../../src/streaming/streamManager.js';

/**
 * Pure-logic tests for streamManager.js
 *
 * Most of streamManager requires Redis + Bull + Puppeteer. We test only the
 * three pure / near-pure exported pieces:
 *   1. STREAM_TYPES constant — shape contract
 *   2. clampInterval        — extracted inline (not exported)
 *   3. sanitizeMeta         — extracted inline (not exported)
 *   4. getStreamStats       — synchronous, reads activeStreams in-memory map
 *
 * getStreamStats() is tested with an empty registry (no streams created),
 * which is the safe baseline that requires no Redis.
 */

// ---------------------------------------------------------------------------
// Inline copy of clampInterval (not exported)
// ---------------------------------------------------------------------------
const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 3_600_000;

function clampInterval(ms) {
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, ms));
}

// ---------------------------------------------------------------------------
// Inline copy of sanitizeMeta (not exported)
// ---------------------------------------------------------------------------
function sanitizeMeta(meta) {
  const { authToken, ...rest } = meta;
  return rest;
}

// ---------------------------------------------------------------------------
// STREAM_TYPES constant
// ---------------------------------------------------------------------------
describe('STREAM_TYPES', () => {
  it('is an array', () => {
    expect(Array.isArray(STREAM_TYPES)).toBe(true);
  });

  it('contains tweet, follower, and mention', () => {
    expect(STREAM_TYPES).toContain('tweet');
    expect(STREAM_TYPES).toContain('follower');
    expect(STREAM_TYPES).toContain('mention');
  });

  it('has exactly 3 entries', () => {
    expect(STREAM_TYPES).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// clampInterval
// ---------------------------------------------------------------------------
describe('clampInterval', () => {
  it('returns value unchanged when within bounds', () => {
    expect(clampInterval(60_000)).toBe(60_000);
    expect(clampInterval(300_000)).toBe(300_000);
  });

  it('clamps below MIN to MIN (15 000 ms)', () => {
    expect(clampInterval(0)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(1_000)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(14_999)).toBe(MIN_INTERVAL_MS);
  });

  it('clamps above MAX to MAX (1 hour)', () => {
    expect(clampInterval(10_000_000)).toBe(MAX_INTERVAL_MS);
    expect(clampInterval(MAX_INTERVAL_MS + 1)).toBe(MAX_INTERVAL_MS);
  });

  it('returns MIN when given exactly MIN', () => {
    expect(clampInterval(MIN_INTERVAL_MS)).toBe(MIN_INTERVAL_MS);
  });

  it('returns MAX when given exactly MAX', () => {
    expect(clampInterval(MAX_INTERVAL_MS)).toBe(MAX_INTERVAL_MS);
  });
});

// ---------------------------------------------------------------------------
// sanitizeMeta
// ---------------------------------------------------------------------------
describe('sanitizeMeta', () => {
  it('strips authToken from meta object', () => {
    const meta = {
      id: 'stream_tweet_alice_abc12345',
      type: 'tweet',
      username: 'alice',
      authToken: 'super-secret-token',
      status: 'running',
      pollCount: 5,
    };
    const result = sanitizeMeta(meta);
    expect(result).not.toHaveProperty('authToken');
  });

  it('preserves all other fields', () => {
    const meta = {
      id: 'stream_tweet_alice_abc12345',
      type: 'tweet',
      username: 'alice',
      authToken: 'secret',
      status: 'running',
      pollCount: 5,
      eventCount: 10,
    };
    const result = sanitizeMeta(meta);
    expect(result.id).toBe(meta.id);
    expect(result.type).toBe(meta.type);
    expect(result.username).toBe(meta.username);
    expect(result.status).toBe(meta.status);
    expect(result.pollCount).toBe(meta.pollCount);
    expect(result.eventCount).toBe(meta.eventCount);
  });

  it('does not mutate the original meta object', () => {
    const meta = { id: 'x', authToken: 'secret', status: 'running' };
    sanitizeMeta(meta);
    expect(meta).toHaveProperty('authToken', 'secret');
  });

  it('handles meta with no authToken gracefully', () => {
    const meta = { id: 'x', status: 'running' };
    const result = sanitizeMeta(meta);
    expect(result).not.toHaveProperty('authToken');
    expect(result.id).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// getStreamStats — empty registry baseline (no Redis needed)
// ---------------------------------------------------------------------------
describe('getStreamStats (empty registry)', () => {
  it('returns a stats object with expected shape', () => {
    const stats = getStreamStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('byStatus');
    expect(stats).toHaveProperty('totalPolls');
    expect(stats).toHaveProperty('totalEvents');
    expect(stats).toHaveProperty('totalErrors');
    expect(stats).toHaveProperty('pool');
  });

  it('reports zero streams when none have been created in this process', () => {
    const stats = getStreamStats();
    // In test isolation (no createStream called) the in-memory map is empty
    expect(stats.total).toBe(0);
    expect(stats.totalPolls).toBe(0);
    expect(stats.totalEvents).toBe(0);
    expect(stats.totalErrors).toBe(0);
  });

  it('byStatus has all expected status keys', () => {
    const stats = getStreamStats();
    expect(stats.byStatus).toHaveProperty('running');
    expect(stats.byStatus).toHaveProperty('paused');
    expect(stats.byStatus).toHaveProperty('backoff');
    expect(stats.byStatus).toHaveProperty('stopped');
    expect(stats.byStatus).toHaveProperty('error');
  });

  it('pool field has browsers and maxBrowsers', () => {
    const stats = getStreamStats();
    expect(stats.pool).toHaveProperty('browsers');
    expect(stats.pool).toHaveProperty('maxBrowsers');
  });
});
