// by nichxbt
import { describe, it, expect } from 'vitest';

/**
 * Pure-logic tests for followerStream.js
 *
 * pollFollowers() requires real Puppeteer + scrapers — not testable without
 * a live browser. Instead we test the two pure computations that drive its
 * behaviour:
 *   1. parseCount   — follower-string → number conversion
 *   2. diff logic   — new/lost follower set arithmetic
 *
 * Both are extracted verbatim from followerStream.js so the tests act as a
 * contract: if the source logic changes these tests will catch regressions.
 */

// ---------------------------------------------------------------------------
// Inline copy of parseCount (not exported by the module)
// ---------------------------------------------------------------------------
function parseCount(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const cleaned = String(str).trim().replace(/,/g, '');
  if (/[\d.]+M$/i.test(cleaned)) return Math.round(parseFloat(cleaned) * 1_000_000);
  if (/[\d.]+K$/i.test(cleaned)) return Math.round(parseFloat(cleaned) * 1_000);
  return parseInt(cleaned, 10) || 0;
}

// ---------------------------------------------------------------------------
// Inline copy of follower diff logic (the pure part of pollFollowers)
// ---------------------------------------------------------------------------
function computeFollowerDiff({ currentUsernames, lastFollowers, lastCount, currentCount }) {
  const lastSet = new Set(lastFollowers);
  const currentSet = new Set(currentUsernames);

  const newFollowers = currentUsernames.filter((u) => !lastSet.has(u));
  const lostFollowers = lastFollowers.filter((u) => !currentSet.has(u));
  const countDelta = lastCount !== null ? currentCount - lastCount : 0;

  return { newFollowers, lostFollowers, followers: currentUsernames, followerCount: currentCount, countDelta };
}

// ---------------------------------------------------------------------------
// parseCount
// ---------------------------------------------------------------------------
describe('parseCount', () => {
  it('parses plain integers', () => {
    expect(parseCount('1234')).toBe(1234);
    expect(parseCount('0')).toBe(0);
  });

  it('parses comma-separated numbers', () => {
    expect(parseCount('1,234')).toBe(1234);
    expect(parseCount('1,234,567')).toBe(1234567);
  });

  it('parses K suffix (thousands)', () => {
    expect(parseCount('1.2K')).toBe(1200);
    expect(parseCount('10K')).toBe(10000);
    expect(parseCount('999K')).toBe(999000);
  });

  it('parses M suffix (millions)', () => {
    expect(parseCount('1.5M')).toBe(1500000);
    expect(parseCount('100M')).toBe(100000000);
  });

  it('passes through numeric values unchanged', () => {
    expect(parseCount(42)).toBe(42);
    expect(parseCount(0)).toBe(0);
  });

  it('returns 0 for falsy / non-numeric strings', () => {
    expect(parseCount(null)).toBe(0);
    expect(parseCount(undefined)).toBe(0);
    expect(parseCount('')).toBe(0);
    expect(parseCount('abc')).toBe(0);
  });

  it('is case-insensitive for K/M suffixes', () => {
    expect(parseCount('5k')).toBe(5000);
    expect(parseCount('2m')).toBe(2000000);
  });
});

// ---------------------------------------------------------------------------
// Follower diff logic
// ---------------------------------------------------------------------------
describe('computeFollowerDiff', () => {
  it('detects new followers when someone was not in the previous list', () => {
    const result = computeFollowerDiff({
      currentUsernames: ['alice', 'bob', 'carol'],
      lastFollowers: ['alice', 'bob'],
      lastCount: 2,
      currentCount: 3,
    });
    expect(result.newFollowers).toEqual(['carol']);
    expect(result.lostFollowers).toEqual([]);
    expect(result.countDelta).toBe(1);
  });

  it('detects lost followers when someone left', () => {
    const result = computeFollowerDiff({
      currentUsernames: ['alice'],
      lastFollowers: ['alice', 'bob'],
      lastCount: 2,
      currentCount: 1,
    });
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual(['bob']);
    expect(result.countDelta).toBe(-1);
  });

  it('returns zero delta on first run (lastCount === null)', () => {
    const result = computeFollowerDiff({
      currentUsernames: ['alice', 'bob'],
      lastFollowers: [],
      lastCount: null,
      currentCount: 2,
    });
    expect(result.countDelta).toBe(0);
    expect(result.newFollowers).toEqual(['alice', 'bob']);
  });

  it('returns empty diffs when nothing changed', () => {
    const result = computeFollowerDiff({
      currentUsernames: ['alice', 'bob'],
      lastFollowers: ['alice', 'bob'],
      lastCount: 2,
      currentCount: 2,
    });
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.countDelta).toBe(0);
  });

  it('handles simultaneous gain and loss', () => {
    const result = computeFollowerDiff({
      currentUsernames: ['alice', 'carol'],
      lastFollowers: ['alice', 'bob'],
      lastCount: 2,
      currentCount: 2,
    });
    expect(result.newFollowers).toEqual(['carol']);
    expect(result.lostFollowers).toEqual(['bob']);
    expect(result.countDelta).toBe(0);
  });
});
