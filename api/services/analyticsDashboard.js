// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.

import prisma from '../lib/prisma.js';
/**
 * XActions Analytics Dashboard Service (EPS-3)
 *
 * Prisma-based analytics aggregation for the dashboard:
 * - Follower growth over time (AccountSnapshot)
 * - Following/Followers ratio over time (AccountSnapshot)
 * - Engagement rate over time (EngagementDaily)
 * - Best performing tweets (TweetSnapshot)
 * - Daily/weekly/monthly stats aggregation (AccountSnapshot + EngagementDaily)
 *
 * Pure aggregation helpers are exported separately from the DB queries so they
 * can be unit-tested without a database (no mocks/stubs/fakes — real logic on
 * fixture arrays, matching the project testing policy).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */
// ============================================================================
// Pure helpers — no DB, no side effects. Unit-tested directly.
// ============================================================================

/**
 * Parse an AccountSnapshot row into a normalized time-series point.
 *
 * AccountSnapshot.data is a JSON string written by api/services/monitoring.js
 * with shape: { profile: { followers, following, tweets, ... }, followerCount, followingCount }.
 * This helper tolerates missing/partial JSON and returns 0 for absent counts.
 *
 * @param {{ createdAt: Date|string, data: string|null }} row
 * @returns {{ date: string, followers: number, following: number, tweets: number }}
 */
export function parseSnapshotData(row) {
  const date = new Date(row.createdAt).toISOString();
  let parsed = null;
  if (row.data) {
    try {
      parsed = JSON.parse(row.data);
    } catch {
      parsed = null;
    }
  }
  const profile = parsed && typeof parsed === 'object' ? parsed.profile || {} : {};
  const followers = Number(profile.followers ?? parsed?.followerCount ?? 0) || 0;
  const following = Number(profile.following ?? parsed?.followingCount ?? 0) || 0;
  const tweets = Number(profile.tweets ?? 0) || 0;
  return { date, followers, following, tweets };
}

/**
 * Compute following/followers ratio, rounded to 4 decimals.
 * Returns 0 when followers is 0 (no NaN/Infinity).
 *
 * @param {number} following
 * @param {number} followers
 * @returns {number}
 */
export function computeRatio(following, followers) {
  if (!followers || !Number.isFinite(followers)) return 0;
  const f = Number(following) || 0;
  if (!Number.isFinite(f)) return 0;
  return Math.round((f / followers) * 10000) / 10000;
}

/**
 * Compute engagement rate = engagements / impressions, rounded to 4 decimals.
 * Returns 0 when impressions is 0 (no NaN/Infinity).
 *
 * @param {number} totalEngagements
 * @param {number} totalImpressions
 * @returns {number}
 */
export function computeEngagementRate(totalEngagements, totalImpressions) {
  if (!totalImpressions || !Number.isFinite(totalImpressions)) return 0;
  const e = Number(totalEngagements) || 0;
  if (!Number.isFinite(e)) return 0;
  return Math.round((e / totalImpressions) * 10000) / 10000;
}

/**
 * Total engagement score for a tweet: likes + retweets + replies + quotes.
 * @param {{ likes?: number, retweets?: number, replies?: number, quotes?: number }} t
 * @returns {number}
 */
export function tweetEngagementScore(t) {
  return (Number(t.likes) || 0) + (Number(t.retweets) || 0) + (Number(t.replies) || 0) + (Number(t.quotes) || 0);
}

/**
 * Rank tweets by total engagement (likes+retweets+replies+quotes) descending.
 * Ties broken by views descending, then tweetId ascending for determinism.
 * Returns at most `limit` items with an added `engagementScore` field.
 *
 * @param {Array<{ tweetId: string, likes?: number, retweets?: number, replies?: number, quotes?: number, views?: number, text?: string, tweetedAt?: Date|string|null, snapshotAt?: Date|string }>} tweets
 * @param {number} [limit=10]
 * @returns {Array<object>}
 */
export function rankTopTweets(tweets, limit = 10) {
  const list = Array.isArray(tweets) ? tweets : [];
  const ranked = list
    .map((t) => ({
      ...t,
      engagementScore: tweetEngagementScore(t),
      views: Number(t.views) || 0,
    }))
    .sort((a, b) => {
      const scoreDiff = b.engagementScore - a.engagementScore;
      if (scoreDiff !== 0) return scoreDiff;
      const viewsDiff = b.views - a.views;
      if (viewsDiff !== 0) return viewsDiff;
      return String(a.tweetId).localeCompare(String(b.tweetId));
    });
  const safeLimit = Math.max(0, Math.min(Number(limit) || 0, ranked.length));
  return ranked.slice(0, safeLimit);
}

/**
 * Interval bucket key for an ISO date, matching historyStore.getIntervalKey semantics.
 * - day:  YYYY-MM-DD
 * - week: ISO week Monday date (YYYY-MM-DD)
 * - month: YYYY-MM
 *
 * @param {string|Date} isoDate
 * @param {'day'|'week'|'month'} interval
 * @returns {string}
 */
export function intervalKey(isoDate, interval) {
  const d = new Date(isoDate);
  switch (interval) {
    case 'week': {
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      return monday.toISOString().split('T')[0];
    }
    case 'month':
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'day':
    default:
      return d.toISOString().split('T')[0];
  }
}

/**
 * Aggregate time-series rows by interval, returning the latest snapshot per bucket
 * with the follower delta vs the previous bucket.
 *
 * Each row must expose `createdAt` (Date|ISO) and the parsed counts from
 * `parseSnapshotData`. The output preserves bucket order ascending.
 *
 * @param {Array<{ date: string, followers: number, following: number, tweets: number }>} rows
 * @param {'day'|'week'|'month'} interval
 * @returns {Array<{ bucket: string, followers: number, following: number, tweets: number, followerDelta: number }>}
 */
export function aggregateByInterval(rows, interval) {
  const list = Array.isArray(rows) ? rows : [];
  const buckets = new Map();
  for (const row of list) {
    const key = intervalKey(row.date, interval);
    const existing = buckets.get(key);
    // Keep the latest snapshot per bucket (rows are assumed ascending by date,
    // but compare explicitly to be robust to unordered input).
    if (!existing || new Date(row.date) > new Date(existing.date)) {
      buckets.set(key, row);
    }
  }
  const sortedKeys = [...buckets.keys()].sort();
  const out = [];
  let prevFollowers = null;
  for (const key of sortedKeys) {
    const row = buckets.get(key);
    const followerDelta = prevFollowers === null ? 0 : row.followers - prevFollowers;
    out.push({
      bucket: key,
      followers: row.followers,
      following: row.following,
      tweets: row.tweets,
      followerDelta,
    });
    prevFollowers = row.followers;
  }
  return out;
}

// ============================================================================
// DB queries — Prisma. Thin wrappers around the pure helpers.
// ============================================================================

/** Clamp an integer query param to a safe range. */
function clampInt(value, fallback, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Build a `from` Date for `days` ago. */
function fromDate(days) {
  return new Date(Date.now() - days * 86400000);
}

/**
 * Fetch AccountSnapshot rows for a username within `days`, ordered ascending.
 * @param {string} username
 * @param {number} days
 * @returns {Promise<object[]>}
 */
async function fetchSnapshots(username, days) {
  return prisma.accountSnapshot.findMany({
    where: {
      username,
      createdAt: { gte: fromDate(days) },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * GET dashboard payload — follower growth series parsed from AccountSnapshot.
 * @param {string} username
 * @param {{ days?: number }} opts
 * @returns {Promise<{ username: string, days: number, followerGrowth: object[] }>}
 */
export async function getDashboard(username, opts = {}) {
  const days = clampInt(opts.days, 30, 1, 365);
  const snapshots = await fetchSnapshots(username, days);
  const followerGrowth = snapshots.map(parseSnapshotData);
  return { username, days, followerGrowth };
}

/**
 * GET following/followers ratio series.
 * @param {string} username
 * @param {{ days?: number }} opts
 * @returns {Promise<{ username: string, days: number, series: object[] }>}
 */
export async function getRatioSeries(username, opts = {}) {
  const days = clampInt(opts.days, 30, 1, 365);
  const snapshots = await fetchSnapshots(username, days);
  const series = snapshots.map((s) => {
    const point = parseSnapshotData(s);
    return {
      date: point.date,
      following: point.following,
      followers: point.followers,
      ratio: computeRatio(point.following, point.followers),
    };
  });
  return { username, days, series };
}

/**
 * GET engagement rate series from EngagementDaily.
 * @param {string} username
 * @param {{ days?: number }} opts
 * @returns {Promise<{ username: string, days: number, series: object[] }>}
 */
export async function getEngagementSeries(username, opts = {}) {
  const days = clampInt(opts.days, 30, 1, 365);
  const fromStr = fromDate(days).toISOString().split('T')[0];
  const rows = await prisma.engagementDaily.findMany({
    where: {
      username,
      date: { gte: fromStr },
    },
    orderBy: { date: 'asc' },
  });
  const series = rows.map((r) => ({
    date: r.date,
    engagementRate: computeEngagementRate(r.totalEngagements, r.totalImpressions),
    avgEngagementRate: r.avgEngagementRate,
    totalEngagements: r.totalEngagements,
    totalImpressions: r.totalImpressions,
    topTweetId: r.topTweetId,
  }));
  return { username, days, series };
}

/**
 * GET best performing tweets from TweetSnapshot (latest snapshot per tweet).
 * @param {string} username
 * @param {{ limit?: number, days?: number }} opts
 * @returns {Promise<{ username: string, tweets: object[] }>}
 */
export async function getTopTweets(username, opts = {}) {
  const limit = clampInt(opts.limit, 10, 1, 100);
  const days = clampInt(opts.days, 90, 1, 365);
  const rows = await prisma.tweetSnapshot.findMany({
    where: {
      username,
      snapshotAt: { gte: fromDate(days) },
    },
    orderBy: { snapshotAt: 'desc' },
  });
  // Keep only the latest snapshot per tweetId (rows are desc by snapshotAt).
  const latestPerTweet = new Map();
  for (const r of rows) {
    if (!latestPerTweet.has(r.tweetId)) {
      latestPerTweet.set(r.tweetId, r);
    }
  }
  const ranked = rankTopTweets([...latestPerTweet.values()], limit);
  return { username, tweets: ranked };
}

/**
 * GET aggregated stats (daily/weekly/monthly) — follower deltas + engagement totals.
 * @param {string} username
 * @param {{ days?: number, interval?: 'day'|'week'|'month' }} opts
 * @returns {Promise<{ username: string, days: number, interval: string, followerStats: object[], engagementStats: object[] }>}
 */
export async function getStats(username, opts = {}) {
  const days = clampInt(opts.days, 30, 1, 365);
  const interval = ['day', 'week', 'month'].includes(opts.interval) ? opts.interval : 'day';

  const snapshots = await fetchSnapshots(username, days);
  const parsed = snapshots.map(parseSnapshotData);
  const followerStats = aggregateByInterval(parsed, interval);

  const fromStr = fromDate(days).toISOString().split('T')[0];
  const engagementRows = await prisma.engagementDaily.findMany({
    where: { username, date: { gte: fromStr } },
    orderBy: { date: 'asc' },
  });

  // Aggregate engagement rows into the same interval buckets.
  const engByBucket = new Map();
  for (const r of engagementRows) {
    const key = intervalKey(r.date, interval);
    const acc = engByBucket.get(key) || { totalEngagements: 0, totalImpressions: 0, days: 0 };
    acc.totalEngagements += r.totalEngagements;
    acc.totalImpressions += r.totalImpressions;
    acc.days += 1;
    engByBucket.set(key, acc);
  }
  const engagementStats = [...engByBucket.keys()].sort().map((bucket) => {
    const acc = engByBucket.get(bucket);
    return {
      bucket,
      totalEngagements: acc.totalEngagements,
      totalImpressions: acc.totalImpressions,
      engagementRate: computeEngagementRate(acc.totalEngagements, acc.totalImpressions),
      sampleDays: acc.days,
    };
  });

  return { username, days, interval, followerStats, engagementStats };
}

/**
 * Composite dashboard payload — all chart data in one call (used by the UI).
 * @param {string} username
 * @param {{ days?: number, limit?: number }} opts
 * @returns {Promise<object>}
 */
export async function getFullDashboard(username, opts = {}) {
  const days = clampInt(opts.days, 30, 1, 365);
  const limit = clampInt(opts.limit, 10, 1, 100);
  const [dashboard, ratio, engagement, topTweets] = await Promise.all([
    getDashboard(username, { days }),
    getRatioSeries(username, { days }),
    getEngagementSeries(username, { days }),
    getTopTweets(username, { limit, days }),
  ]);

  // Overview cards: latest snapshot + period deltas.
  const growth = dashboard.followerGrowth;
  const latest = growth[growth.length - 1] || { followers: 0, following: 0, tweets: 0 };
  const earliest = growth[0] || { followers: 0, following: 0, tweets: 0 };
  const followerChange = latest.followers - earliest.followers;
  const followerPct = earliest.followers > 0
    ? Math.round((followerChange / earliest.followers) * 10000) / 100
    : 0;

  const engSeries = engagement.series;
  const engLatest = engSeries[engSeries.length - 1] || { engagementRate: 0, totalEngagements: 0, totalImpressions: 0 };
  const engEarliest = engSeries[0] || { totalEngagements: 0, totalImpressions: 0 };
  const engChange = engLatest.totalEngagements - engEarliest.totalEngagements;

  return {
    username,
    days,
    overview: {
      followers: latest.followers,
      following: latest.following,
      tweets: latest.tweets,
      followerChange,
      followerPct,
      followingRatio: computeRatio(latest.following, latest.followers),
      engagementRate: engLatest.engagementRate,
      totalEngagements: engLatest.totalEngagements,
      totalImpressions: engLatest.totalImpressions,
      engagementChange: engChange,
    },
    followerGrowth: growth,
    ratioSeries: ratio.series,
    engagementSeries: engSeries,
    topTweets: topTweets.tweets,
  };
}

// by nichxbt
