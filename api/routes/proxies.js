// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import express from 'express';
import { globalProxyPool } from '../../src/proxy/proxy-pool.js';
import { globalAccountPool } from '../../src/core/account-pool.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

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
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const proxies = /** @type {unknown[]} */ (body.proxies);
  const proxy = /** @type {string | undefined} */ (body.proxy);
  const list = (Array.isArray(proxies) ? proxies : (proxy ? [proxy] : []));
  if (!list.length) {
    return res.status(400).json({ error: 'No proxies provided in request body' });
  }

  try {
    for (const raw of list) {
      globalProxyPool.add(/** @type {import('../../src/proxy/proxy-pool.js').ProxyInput} */ (raw));
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
router.post('/quarantine', authenticateToken, requireAdmin, (req, res, next) => {
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const proxy = /** @type {import('../../src/proxy/proxy-pool.js').ProxyInput} */ (body.proxy);
  const durationMs = typeof body.durationMs === 'number' ? body.durationMs : undefined;
  if (!proxy) {
    return res.status(400).json({ error: 'Proxy is required to quarantine' });
  }
  try {
    globalProxyPool.quarantine(proxy, durationMs);
    res.json({
      success: true,
      quarantined: proxy,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/proxies/release - Release a quarantined proxy
router.post('/release', authenticateToken, requireAdmin, (req, res, next) => {
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const proxy = /** @type {import('../../src/proxy/proxy-pool.js').ProxyInput} */ (body.proxy);
  if (!proxy) {
    return res.status(400).json({ error: 'Proxy is required to release' });
  }
  try {
    const released = globalProxyPool.release(proxy);
    res.json({
      success: true,
      released,
      proxy,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/proxies/list - List all proxies in pool
router.get('/list', authenticateToken, requireAdmin, (req, res) => {
  res.json({
    success: true,
    proxies: globalProxyPool.listAll(),
    healthyCount: globalProxyPool.healthyCount,
    totalCount: globalProxyPool.totalCount,
  });
});

// Accounts endpoints
// POST /api/proxies/accounts/register
router.post('/accounts/register', (req, res) => {
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const platform = /** @type {string} */ (body.platform);
  const accountIds = /** @type {unknown[]} */ (body.accountIds);
  const credentials = /** @type {Record<string, Record<string, unknown>> | undefined} */ (body.credentials);
  if (!platform || !accountIds || !Array.isArray(accountIds)) {
    return res.status(400).json({ error: 'platform and accountIds array are required' });
  }
  const options = credentials ? { credentials } : {};
  globalAccountPool.registerAccounts(platform, /** @type {string[]} */ (accountIds), options);
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
router.post('/accounts/:id/unavailable', authenticateToken, requireAdmin, (req, res, next) => {
  const { id } = req.params;
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const reason = /** @type {string | undefined} */ (body.reason);
  const durationMs = typeof body.durationMs === 'number' ? body.durationMs : undefined;
  try {
    globalAccountPool.markUnavailable(id, reason, durationMs);
    res.json({ success: true, accountId: id, unavailable: true, reason, durationMs });
  } catch (err) {
    next(err);
  }
});

// POST /api/proxies/accounts/:id/available
router.post('/accounts/:id/available', authenticateToken, requireAdmin, (req, res, next) => {
  const { id } = req.params;
  try {
    globalAccountPool.markAvailable(id);
    res.json({ success: true, accountId: id, available: true });
  } catch (err) {
    next(err);
  }
});

export default router;
