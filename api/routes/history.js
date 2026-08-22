// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions History & Analytics API Routes
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getDashboard,
  getRatioSeries,
  getEngagementSeries,
  getTopTweets,
  getStats,
  getFullDashboard,
} from '../services/analyticsDashboard.js';

const router = Router();

// Require authentication for all history routes
router.use(authenticate);

// GET /api/analytics/history/:username — get account history
router.get('/history/:username', async (req, res) => {
  try {
    const { getAccountHistory } = await import('../../src/analytics/historyStore.js');
    const days = parseInt(req.query.days) || 30;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const data = getAccountHistory(req.params.username, { from, interval: req.query.interval || 'day' });
    res.json({ snapshots: data, username: req.params.username, days });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/analytics/growth/:username — get growth rate
router.get('/growth/:username', async (req, res) => {
  try {
    const { getGrowthRate } = await import('../../src/analytics/historyStore.js');
    const days = parseInt(req.query.days) || 7;
    const data = getGrowthRate(req.params.username, days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/analytics/compare — compare accounts
router.post('/compare', async (req, res) => {
  try {
    const { compareAccounts } = await import('../../src/analytics/historyStore.js');
    const body = /** @type {Record<string, unknown>} */ (req.body);
    const usernames = Array.isArray(body.usernames) ? body.usernames.map(String) : /** @type {string[]} */ ([]);
    const metric = String(body.metric || '');
    const data = compareAccounts(usernames, metric, { from: new Date(Date.now() - (Number(body.days) || 30) * 86400000).toISOString() });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/analytics/export/:username — export history
router.get('/export/:username', async (req, res) => {
  try {
    const { exportHistory } = await import('../../src/analytics/historyStore.js');
    const format = req.query.format || 'json';
    const data = exportHistory(req.params.username, format);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${req.params.username}-history.csv`);
    }
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/analytics/overlap — audience overlap
router.get('/overlap', async (req, res) => {
  try {
    const { analyzeOverlap } = await import('../../src/analytics/audienceOverlap.js');
    const { username1, username2 } = req.query;
    if (!username1 || !username2) return res.status(400).json({ error: 'username1 and username2 required' });
    const data = await analyzeOverlap(username1, username2);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// ============================================================================
// EPS-3 Analytics Dashboard — Prisma-backed endpoints
// ============================================================================

/**
 * GET /api/analytics/dashboard/:username — composite dashboard payload.
 * Query: ?days=30&limit=10
 */
router.get('/dashboard/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const data = await getFullDashboard(username, {
      days: parseInt(req.query.days, 10) || 30,
      limit: parseInt(req.query.limit, 10) || 10,
    });
    res.json(data);
  } catch (error) {
    console.error('❌ Dashboard error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/follower-growth/:username — follower growth time-series.
 * Query: ?days=30
 */
router.get('/follower-growth/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const data = await getDashboard(username, { days: parseInt(req.query.days, 10) || 30 });
    res.json(data);
  } catch (error) {
    console.error('❌ Follower growth error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/ratio/:username — following/followers ratio over time.
 * Query: ?days=30
 */
router.get('/ratio/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const data = await getRatioSeries(username, { days: parseInt(req.query.days, 10) || 30 });
    res.json(data);
  } catch (error) {
    console.error('❌ Ratio series error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/engagement/:username — engagement rate over time.
 * Query: ?days=30
 */
router.get('/engagement/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const data = await getEngagementSeries(username, { days: parseInt(req.query.days, 10) || 30 });
    res.json(data);
  } catch (error) {
    console.error('❌ Engagement series error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/top-tweets/:username — best performing tweets.
 * Query: ?limit=10&days=90
 */
router.get('/top-tweets/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const data = await getTopTweets(username, {
      limit: parseInt(req.query.limit, 10) || 10,
      days: parseInt(req.query.days, 10) || 90,
    });
    res.json(data);
  } catch (error) {
    console.error('❌ Top tweets error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/analytics/stats/:username — daily/weekly/monthly aggregation.
 * Query: ?interval=day|week|month&days=30
 */
router.get('/stats/:username', async (req, res) => {
  try {
    const username = req.params.username.replace(/^@/, '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const requestedInterval = req.query.interval;
    if (requestedInterval && !['day', 'week', 'month'].includes(requestedInterval)) {
      return res.status(400).json({ error: 'interval must be one of: day, week, month' });
    }
    const interval = /** @type {"day" | "week" | "month" | undefined} */ (requestedInterval);
    const data = await getStats(username, {
      days: parseInt(req.query.days, 10) || 30,
      interval: interval || 'day',
    });
    res.json(data);
  } catch (error) {
    console.error('❌ Stats aggregation error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;

// by nichxbt
