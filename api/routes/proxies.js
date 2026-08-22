// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import express from 'express';
import { globalProxyPool } from '../../src/proxy/proxy-pool.js';
import { globalAccountPool } from '../../src/core/account-pool.js';

const router = express.Router();

// GET /api/proxies/status - Get current proxy pool status
router.get('/status', (req, res) => {
  res.json({
    healthyCount: globalProxyPool.healthyCount,
    totalCount: globalProxyPool.totalCount,
    antiLeakFlags: globalProxyPool.antiLeakFlags,
    isAllQuarantined: globalProxyPool.isAllQuarantined(),
  });
});

// POST /api/proxies/add - Add proxies to pool
router.post('/add', (req, res) => {
  const { proxies, proxy } = req.body || {};
  const list = proxies || (proxy ? [proxy] : []);
  if (!list.length) {
    return res.status(400).json({ error: 'No proxies provided in request body' });
  }

  try {
    for (const p of list) {
      globalProxyPool.add(p);
    }
    res.json({
      success: true,
      added: list.length,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
    });
  } catch (err) {
    res.status(400).json({ error: (err instanceof Error ? err.message : String(err)) });
  }
});

// GET /api/proxies/next - Get next round-robin proxy
router.get('/next', (req, res) => {
  const proxy = globalProxyPool.getNext();
  if (!proxy) {
    return res.status(503).json({ error: 'No healthy proxies available in pool', proxy: null });
  }
  res.json({ success: true, proxy });
});

// GET /api/proxies/sticky/:accountId - Get deterministic sticky proxy for account
router.get('/sticky/:accountId', (req, res) => {
  const { accountId } = req.params;
  const proxy = globalProxyPool.getStickyProxy(accountId);
  if (!proxy) {
    return res.status(503).json({ error: 'No healthy proxies available in pool', proxy: null });
  }
  res.json({ success: true, accountId, proxy });
});

// POST /api/proxies/quarantine - Quarantine a proxy
router.post('/quarantine', (req, res) => {
  const { proxy, durationMs } = req.body || {};
  if (!proxy) {
    return res.status(400).json({ error: 'Proxy is required to quarantine' });
  }
  globalProxyPool.quarantine(proxy, durationMs);
  res.json({
    success: true,
    quarantined: proxy,
    healthyCount: globalProxyPool.healthyCount,
    totalCount: globalProxyPool.totalCount,
  });
});

// Accounts endpoints
// POST /api/proxies/accounts/register
router.post('/accounts/register', (req, res) => {
  const { platform, accountIds, credentials } = req.body || {};
  if (!platform || !accountIds || !Array.isArray(accountIds)) {
    return res.status(400).json({ error: 'platform and accountIds array are required' });
  }
  globalAccountPool.registerAccounts(platform, accountIds, { credentials });
  res.json({
    success: true,
    platform,
    registered: accountIds.length,
    accounts: globalAccountPool.listAccounts(platform),
  });
});

// GET /api/proxies/accounts/next/:platform
router.get('/accounts/next/:platform', (req, res) => {
  const { platform } = req.params;
  const accountId = globalAccountPool.getNextAvailable(platform);
  if (!accountId) {
    return res.status(503).json({ error: `No available accounts for platform: ${platform}`, accountId: null });
  }
  res.json({ success: true, platform, accountId, account: globalAccountPool.getAccount(accountId) });
});

// POST /api/proxies/accounts/:id/unavailable
router.post('/accounts/:id/unavailable', (req, res) => {
  const { id } = req.params;
  const { reason, durationMs } = req.body || {};
  globalAccountPool.markUnavailable(id, reason, durationMs);
  res.json({ success: true, accountId: id, unavailable: true, reason, durationMs });
});

// POST /api/proxies/accounts/:id/available
router.post('/accounts/:id/available', (req, res) => {
  const { id } = req.params;
  globalAccountPool.markAvailable(id);
  res.json({ success: true, accountId: id, available: true });
});

export default router;
