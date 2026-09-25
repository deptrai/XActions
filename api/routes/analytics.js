// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Analytics API Routes
 * 
 * POST /api/analytics/sentiment — analyze text or tweet URL
 * POST /api/analytics/monitor — start monitoring a username/keyword
 * GET  /api/analytics/monitor — list active monitors
 * GET  /api/analytics/monitor/:id — get monitoring results
 * DELETE /api/analytics/monitor/:id — stop monitoring
 * GET  /api/analytics/reports/:username — get reputation report
 * GET  /api/analytics/alerts — get recent alerts
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import express from 'express';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import {
  analyzeSentiment,
  analyzeBatch,
  createMonitor,
  stopMonitor,
  getMonitor,
  getMonitorHistory,
  listMonitors,
  removeMonitor,
  getAlerts,
  generateReport,
  analyzeTweetPriceCorrelation,
} from '../../src/analytics/index.js';

const router = express.Router();

// Require authentication for all analytics routes
router.use(authenticate);

// ============================================================================
// Overview — real aggregated metrics for the Analytics dashboard panel
// ============================================================================

/**
 * GET /api/analytics/overview
 * Returns { metrics: [{label,value,change,positive}], weekly: [{label,value}] }
 * computed from real DB state (operations + follower snapshots). No mocks.
 */
router.get('/overview', async (req, res) => {
  try {
    const userId = /** @type {import('@prisma/client').User} */ (req.user).id;

    // Latest follower snapshot for the user (totalCount + prior snapshot for delta)
    const snapshots = await prisma.followerSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    const latestFollowers = snapshots[0]?.totalCount ?? 0;
    const prevFollowers = snapshots[1]?.totalCount ?? latestFollowers;
    const followerDelta = prevFollowers > 0
      ? ((latestFollowers - prevFollowers) / prevFollowers) * 100
      : 0;

    // Operation aggregates
    const totalOps = await prisma.operation.count({ where: { userId } });
    const completedOps = await prisma.operation.count({ where: { userId, status: 'completed' } });
    const creditsUsed = await prisma.operation.aggregate({
      where: { userId },
      _sum: { creditsUsed: true },
    });
    const unfollowed = await prisma.operation.aggregate({
      where: { userId },
      _sum: { unfollowedCount: true },
    });
    const followed = await prisma.operation.aggregate({
      where: { userId },
      _sum: { followedCount: true },
    });

    const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
    const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

    const metrics = [
      { label: 'Total Followers', value: fmt(latestFollowers), change: pct(followerDelta), positive: followerDelta >= 0 },
      { label: 'Operations Run', value: fmt(totalOps), change: `${completedOps} completed`, positive: true },
      { label: 'Credits Used', value: fmt(creditsUsed._sum.creditsUsed ?? 0), change: 'lifetime', positive: true },
      { label: 'Unfollowed', value: fmt(unfollowed._sum.unfollowedCount ?? 0), change: 'all-time', positive: true },
      { label: 'Followed', value: fmt(followed._sum.followedCount ?? 0), change: 'all-time', positive: true },
      { label: 'Profile Visits', value: fmt(latestFollowers), change: pct(followerDelta), positive: followerDelta >= 0 },
    ];

    // Weekly engagement proxy: operations completed per weekday over last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const recentOps = await prisma.operation.findMany({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true },
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyMap = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    for (const op of recentOps) {
      const d = dayNames[new Date(op.createdAt).getDay()];
      weeklyMap[d] = (weeklyMap[d] || 0) + 1;
    }
    const weekly = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({ label: d, value: weeklyMap[d] }));

    res.json({ success: true, metrics, weekly });
  } catch (err) {
    res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
  }
});

// ============================================================================
// Sentiment Analysis
// ============================================================================

/**
 * POST /api/analytics/sentiment
 * Analyze sentiment of text or tweet URL
 * 
 * Body: { text: string, mode?: 'rules'|'llm', texts?: string[] }
 */
router.post('/sentiment', async (req, res) => {
  try {
    const { text, texts, mode } = /** @type {{ text?: string; texts?: string[]; mode?: string }} */ (req.body);

    if (!text && (!texts || !Array.isArray(texts) || texts.length === 0)) {
      return res.status(400).json({
        error: 'Either "text" (string) or "texts" (array of strings) is required',
      });
    }

    const options = { mode: mode || 'rules' };

    // Batch mode
    if (texts && Array.isArray(texts)) {
      if (texts.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 texts per batch request' });
      }
      const results = /** @type {Record<string, unknown>[]} */ (await analyzeBatch(texts, options));
      return res.json({ results, count: results.length });
    }

    // Single text mode
    // If text looks like a tweet URL, we could scrape it — for now, analyze as-is
    const result = await analyzeSentiment(text, options);
    return res.json(result);
  } catch (error) {
    console.error('❌ Sentiment analysis error:', (error instanceof Error ? error.message : String(error)));
    return res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// ============================================================================
// Monitor Management
// ============================================================================

/**
 * POST /api/analytics/monitor
 * Start monitoring a username or keyword
 * 
 * Body: { target: string, type?: 'mentions'|'keyword'|'replies', interval?: number, sentimentMode?: string, alertConfig?: object }
 */
router.post('/monitor', async (req, res) => {
  try {
    const { target, type, interval, sentimentMode, alertConfig } = /** @type {{
      target: string;
      type?: string;
      interval?: number;
      sentimentMode?: string;
      alertConfig?: Record<string, unknown>;
    }} */ (req.body);

    if (!target) {
      return res.status(400).json({ error: '"target" (username or keyword) is required' });
    }

    // Get Socket.IO instance from app if available
    const io = /** @type {{ to: (room: string) => { emit: (event: string, data: Record<string, unknown>) => void } } | null | undefined} */ (req.app?.get('io'));

    const monitor = createMonitor({
      target,
      type: type || 'mentions',
      intervalMs: interval ? Math.max(60, Number(interval)) * 1000 : undefined, // min 60s
      sentimentMode: sentimentMode || 'rules',
      alertConfig: {
        ...(alertConfig || {}),
        socketRoom: `monitor_${target}`,
      },
    }, {
      onAlert: (/** @type {Record<string, unknown>} */ alert) => {
        // Emit alert via Socket.IO if available
        if (io) {
          io.to(`monitor_${target}`).emit('analytics:alert', alert);
        }
        console.log(`🚨 Alert: ${String(alert.message)}`);
      },
    });

    return res.status(201).json(monitor);
  } catch (error) {
    console.error('❌ Monitor creation error:', (error instanceof Error ? error.message : String(error)));
    return res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/monitor
 * List all active monitors
 */
router.get('/monitor', (req, res) => {
  const monitors = /** @type {Array<Record<string, unknown> & { id: string; target: string }>} */ (listMonitors());
  return res.json({ monitors, count: monitors.length });
});

/**
 * GET /api/analytics/monitor/:id
 * Get monitor details and recent history
 */
router.get('/monitor/:id', (req, res) => {
  const monitor = getMonitor(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const history = getMonitorHistory(req.params.id, {
    limit: parseInt(req.query.limit || '0') || 100,
    since: req.query.since,
  });

  return res.json({ ...monitor, history });
});

/**
 * DELETE /api/analytics/monitor/:id
 * Stop and remove a monitor
 */
router.delete('/monitor/:id', (req, res) => {
  const monitor = getMonitor(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  removeMonitor(req.params.id);
  return res.json({ success: true, message: `Monitor ${req.params.id} stopped and removed` });
});

// ============================================================================
// Reports
// ============================================================================

/**
 * GET /api/analytics/reports/:username
 * Generate a reputation report for a monitored username
 * 
 * Query: ?period=7d&format=json|markdown
 */
router.get('/reports/:username', (req, res) => {
  const username = req.params.username.replace(/^@/, '');
  const period = req.query.period || '7d';
  const format = req.query.format || 'json';

  // Find monitor for this username
  const monitors = /** @type {Array<Record<string, unknown> & { id: string; target: string }>} */ (listMonitors());
  const monitor = monitors.find(m =>
    m.target.replace(/^@/, '').toLowerCase() === username.toLowerCase()
  );

  if (!monitor) {
    return res.status(404).json({
      error: `No active monitor found for @${username}. Start one with POST /api/analytics/monitor`,
    });
  }

  const history = getMonitorHistory(monitor.id, { limit: 10000 });

  const { report, markdown } = /** @type {{ report: Record<string, unknown>; markdown: string }} */ (generateReport(monitor, history, { period, format }));

  if (format === 'markdown') {
    res.type('text/markdown').send(markdown);
  } else {
    res.json(report);
  }
});

// ============================================================================
// Alerts
// ============================================================================

/**
 * GET /api/analytics/alerts
 * Get recent alerts
 * 
 * Query: ?monitorId=xxx&severity=warning&limit=50
 */
router.get('/alerts', (req, res) => {
  const alerts = /** @type {Record<string, unknown>[]} */ (getAlerts({
    monitorId: req.query.monitorId,
    severity: req.query.severity,
    limit: parseInt(req.query.limit || '0') || 50,
  }));

  return res.json({ alerts, count: alerts.length });
});

// ============================================================================
// Tweet-Price Correlation (inspired by tweet-price-charts)
// ============================================================================

/**
 * POST /api/analytics/price-correlation
 * Analyze correlation between tweet activity and token price movements.
 *
 * Body: {
 *   tweets: [{ timestamp: number (ms), text: string, url?: string }, ...],
 *   tokenId?: string,            // CoinGecko coin ID (e.g. 'solana', 'bitcoin')
 *   network?: string,            // GeckoTerminal network (e.g. 'solana', 'eth')
 *   poolAddress?: string,        // GeckoTerminal pool address
 *   windows?: number[]           // impact windows in hours (default: [1, 24])
 * }
 *
 * Credit: Inspired by https://github.com/rohunvora/tweet-price-charts
 */
router.post('/price-correlation', async (req, res) => {
  try {
    const { tweets, tokenId, network, poolAddress, windows } = /** @type {{
      tweets: Array<Record<string, unknown>>;
      tokenId?: string;
      network?: string;
      poolAddress?: string;
      windows?: number[];
    }} */ (req.body);

    if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
      return res.status(400).json({
        error: '"tweets" (array of { timestamp, text }) is required. Timestamp should be ms since epoch.',
      });
    }

    if (!tokenId && !(network && poolAddress)) {
      return res.status(400).json({
        error: 'Either "tokenId" (CoinGecko ID) or "network" + "poolAddress" (GeckoTerminal) is required',
      });
    }

    if (tweets.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 tweets per request' });
    }

    const result = await analyzeTweetPriceCorrelation({
      tweets,
      tokenId,
      network,
      poolAddress,
      windows: windows || [1, 24],
    });

    return res.json(result);
  } catch (error) {
    console.error('❌ Price correlation error:', (error instanceof Error ? error.message : String(error)));
    return res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;
