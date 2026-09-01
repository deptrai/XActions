// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Admin routes for license management and payment monitoring
 * 
 * These routes require admin authentication
 */

import { Router } from 'express';
import crypto from 'crypto';
import {
  createLicense,
  validateLicenseKey,
  activateLicense,
  revokeLicense,
  listLicenses,
  getLicense,
  TIER_FEATURES,
} from '../services/licenseManager.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getStats as getPaymentStats } from '../services/payment-stats.js';
import {
  getWebhookStatus,
  testWebhooks,
  hasWebhooksConfigured
} from '../services/payment-webhooks.js';
import { defaultStreamMetricsCollector } from '../../src/utils/stream-metrics-collector.js';
import { defaultStreamAlertEngine } from '../../src/utils/stream-alerts.js';
import { globalProxyPool } from '../../src/proxy/proxy-pool.js';
import { globalAccountPool } from '../../src/core/account-pool.js';
import { globalStatusApi, globalAdaptiveRateGovernor } from '../../src/core/index.js';
import { refreshGovernorConsumerLag, globalStreamMetricsReader } from '../../src/utils/stream-metrics.js';

const router = Router();

// Timing-safe comparison that handles different-length strings without throwing
/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/admin/licenses
 * Create a new license key
 */
router.post('/licenses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      tier = 'starter',
      customerName,
      customerEmail,
      companyName,
      expiresInDays,
      maxInstances,
      notes,
      paymentId,
      amountPaid,
    } = /** @type {{
      tier?: string;
      customerName?: string;
      customerEmail?: string;
      companyName?: string;
      expiresInDays?: string;
      maxInstances?: number;
      notes?: string;
      paymentId?: string;
      amountPaid?: number;
    }} */ (req.body);

    // Calculate expiry date if specified
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }

    const license = /** @type {import('@prisma/client').License} */ (await createLicense({
      tier,
      customerName,
      customerEmail,
      companyName,
      expiresAt: expiresAt || undefined,
      maxInstances,
      notes,
      paymentId,
      amountPaid,
    }));

    res.status(201).json({
      success: true,
      license: {
        key: license.key,
        tier: license.tier,
        customerName: license.customerName,
        customerEmail: license.customerEmail,
        companyName: license.companyName,
        maxUsers: license.maxUsers,
        maxInstances: license.maxInstances,
        whiteLabel: license.whiteLabel,
        customDomain: license.customDomain,
        apiAccess: license.apiAccess,
        expiresAt: license.expiresAt,
        createdAt: license.createdAt,
      },
      message: `License key created: ${license.key}`,
    });
  } catch (error) {
    console.error('❌ Create license error:', error);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

/**
 * GET /api/admin/licenses
 * List all licenses
 */
router.get('/licenses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, tier, limit = '100', offset = '0' } = req.query;

    const result = await listLicenses({
      status,
      tier,
      limit: parseInt(limit || '0'),
      offset: parseInt(offset || '0'),
    });

    res.json(result);
  } catch (error) {
    console.error('❌ List licenses error:', error);
    res.status(500).json({ error: 'Failed to list licenses' });
  }
});

/**
 * GET /api/admin/licenses/:key
 * Get license details
 */
router.get('/licenses/:key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const license = /** @type {import('@prisma/client').License | null} */ (await getLicense(key));

    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }

    res.json({ license });
  } catch (error) {
    console.error('❌ Get license error:', error);
    res.status(500).json({ error: 'Failed to get license' });
  }
});

/**
 * POST /api/admin/licenses/:key/revoke
 * Revoke a license
 */
router.post('/licenses/:key/revoke', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { reason } = /** @type {{ reason?: string }} */ (req.body);

    const license = /** @type {import('@prisma/client').License} */ (await revokeLicense(key, String(reason || '')));

    res.json({
      success: true,
      message: 'License revoked',
      license: {
        key: license.key,
        status: license.status,
      },
    });
  } catch (error) {
    console.error('❌ Revoke license error:', error);
    res.status(500).json({ error: 'Failed to revoke license' });
  }
});

/**
 * GET /api/admin/licenses/tiers
 * Get available license tiers and features
 */
router.get('/tiers', authenticateToken, requireAdmin, async (req, res) => {
  res.json({ tiers: TIER_FEATURES });
});

/**
 * POST /api/admin/licenses/:key/validate
 * Validate a license key
 */
router.post('/licenses/:key/validate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const result = await validateLicenseKey(key);
    res.json(result);
  } catch (error) {
    console.error('❌ Validate license error:', error);
    res.status(500).json({ error: 'Failed to validate license' });
  }
});

/**
 * GET /api/admin/x402/stats
 * Get x402 payment statistics
 * Protected by admin API key
 */
router.get('/x402/stats', (req, res) => {
  // Timing-safe auth check via API key header
  const adminKey = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_API_KEY || '';
  if (!expected || !safeCompare(adminKey, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stats = getPaymentStats();
  res.json({
    success: true,
    stats,
    generatedAt: new Date().toISOString()
  });
});

/**
 * GET /api/admin/x402/webhooks
 * Get webhook configuration status and delivery statistics
 * Protected by admin API key
 */
router.get('/x402/webhooks', (req, res) => {
  // Timing-safe auth check via API key header
  const adminKey = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_API_KEY || '';
  if (!expected || !safeCompare(adminKey, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const status = getWebhookStatus();
  res.json({
    success: true,
    webhooks: status,
    generatedAt: new Date().toISOString()
  });
});

/**
 * POST /api/admin/x402/webhooks/test
 * Test webhook connectivity by sending a test event
 * Protected by admin API key
 */
router.post('/x402/webhooks/test', async (req, res) => {
  // Timing-safe auth check via API key header
  const adminKey = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_API_KEY || '';
  if (!expected || !safeCompare(adminKey, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!hasWebhooksConfigured()) {
    return res.status(400).json({
      success: false,
      error: 'No webhooks configured',
      message: 'Set X402_WEBHOOK_URL, DISCORD_WEBHOOK_URL, or SLACK_WEBHOOK_URL in environment variables'
    });
  }

  try {
    const results = await testWebhooks();
    res.json({
      success: true,
      message: 'Test webhooks sent',
      results,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Webhook test error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test webhooks',
      message: (error instanceof Error ? error.message : String(error))
    });
  }
});

/**
 * GET /api/admin/stream/metrics
 * Stream metrics for operator dashboard (Story 14.3)
 */
router.get('/stream/metrics', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const metrics = await defaultStreamMetricsCollector.getMetrics();
    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
  }
});

/**
 * GET /api/admin/stream/alerts
 * Stream alert status for operator dashboard (Story 14.3)
 */
router.get('/stream/alerts', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const status = defaultStreamAlertEngine.getAlertStatus();
    res.json({ success: true, alerts: status });
  } catch (err) {
    res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
  }
});

/**
 * GET /api/admin/governor/status
 * Get real-time governor & proxy health status (Story 19.2)
 */
router.get('/governor/status', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    await refreshGovernorConsumerLag(globalAdaptiveRateGovernor, globalStreamMetricsReader);
    const status = globalStatusApi.getGovernorStatus();
    res.json({
      success: true,
      status,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        type: 'internal_error',
        message: (err instanceof Error ? err.message : String(err)) || String(err),
      },
    });
  }
});

/**
 * GET /api/admin/proxies
 * List proxies with status and metrics (Story 19.2 & Story 19.7)
 */
router.get('/proxies', authenticateToken, requireAdmin, (_req, res) => {
  try {
    const proxies = globalProxyPool.listProxies();
    res.json({
      success: true,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
      isAllQuarantined: globalProxyPool.isAllQuarantined(),
      antiLeakFlags: globalProxyPool.antiLeakFlags,
      proxies,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
});

/**
 * POST /api/admin/proxies/quarantine
 * POST /api/admin/proxies/:key/quarantine
 * Manually quarantine a proxy (Story 19.2 & Story 19.7)
 */
const handleQuarantineProxy = (req, res) => {
  try {
    const rawKey = req.body?.proxy || req.body?.key || req.params?.key;
    if (!rawKey) {
      return res.status(400).json({ success: false, error: 'Proxy is required to quarantine' });
    }
    const durationMs = typeof req.body?.durationMs === 'number' ? req.body.durationMs : undefined;
    const decodedKey = decodeURIComponent(String(rawKey));

    globalProxyPool.quarantine(decodedKey, durationMs);
    res.json({
      success: true,
      quarantined: decodedKey,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
};
router.post('/proxies/quarantine', authenticateToken, requireAdmin, handleQuarantineProxy);
router.post('/proxies/:key/quarantine', authenticateToken, requireAdmin, handleQuarantineProxy);

/**
 * POST /api/admin/proxies/release
 * POST /api/admin/proxies/:key/release
 * Manually release a proxy from quarantine (Story 19.2 & Story 19.7)
 */
const handleReleaseProxy = (req, res) => {
  try {
    const rawKey = req.body?.proxy || req.body?.key || req.params?.key;
    if (!rawKey) {
      return res.status(400).json({ success: false, error: 'Proxy is required to release' });
    }
    const decodedKey = decodeURIComponent(String(rawKey));

    const released = globalProxyPool.release(decodedKey);
    res.json({
      success: true,
      released,
      proxy: decodedKey,
      healthyCount: globalProxyPool.healthyCount,
      totalCount: globalProxyPool.totalCount,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
};
router.post('/proxies/release', authenticateToken, requireAdmin, handleReleaseProxy);
router.post('/proxies/:key/release', authenticateToken, requireAdmin, handleReleaseProxy);

/**
 * GET /api/admin/accounts
 * List all accounts with status, hibernation, velocity, and assigned proxies (Story 19.2 & Story 19.8)
 */
router.get('/accounts', authenticateToken, requireAdmin, (req, res) => {
  try {
    const platform = typeof req.query?.platform === 'string' ? req.query.platform : undefined;
    const accounts = globalAccountPool.listAccountDetails(platform);
    res.json({
      success: true,
      total: accounts.length,
      accounts,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
});

/**
 * POST /api/admin/accounts/wake
 * POST /api/admin/accounts/:id/wake
 * Wake an account from hibernation (Story 19.2 & Story 19.8)
 */
const handleWakeAccount = (req, res) => {
  try {
    const rawId = req.body?.accountId || req.params?.id;
    if (!rawId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : undefined;
    const decodedId = decodeURIComponent(String(rawId));

    const account = globalAccountPool.getAccount(decodedId, platform);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: `Account "${decodedId}" not found`,
      });
    }

    const isHibernating = account.hibernatingUntil !== null && account.hibernatingUntil > Date.now();
    if (!isHibernating && !globalAdaptiveRateGovernor.isHibernating(decodedId)) {
      return res.status(409).json({
        success: false,
        error: `Account "${decodedId}" is not currently in hibernation`,
      });
    }

    globalAccountPool.markAvailable(decodedId, platform);
    res.json({
      success: true,
      accountId: decodedId,
      status: 'active',
      message: `Account "${decodedId}" is now active`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
};
router.post('/accounts/wake', authenticateToken, requireAdmin, handleWakeAccount);
router.post('/accounts/:id/wake', authenticateToken, requireAdmin, handleWakeAccount);

/**
 * POST /api/admin/accounts/rotate
 * POST /api/admin/accounts/:id/rotate
 * Rotate account in account pool (Story 19.2 & Story 19.8)
 */
const handleRotateAccount = (req, res) => {
  try {
    const rawId = req.body?.accountId || req.params?.id;
    if (!rawId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : undefined;
    const decodedId = decodeURIComponent(String(rawId));

    const account = globalAccountPool.getAccount(decodedId, platform);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: `Account "${decodedId}" not found`,
      });
    }

    const targetPlatform = platform || account.platform;
    const nextAccountId = globalAccountPool.getNextAvailable(targetPlatform);
    res.json({
      success: true,
      previousAccountId: decodedId,
      nextAccountId,
      platform: targetPlatform,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: (err instanceof Error ? err.message : String(err)),
    });
  }
};
router.post('/accounts/rotate', authenticateToken, requireAdmin, handleRotateAccount);
router.post('/accounts/:id/rotate', authenticateToken, requireAdmin, handleRotateAccount);

export default router;
