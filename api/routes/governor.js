// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Governor status & rate limiting observability routes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Router } from 'express';
import { globalStatusApi, globalAdaptiveRateGovernor } from '../../src/core/index.js';
import { refreshGovernorConsumerLag, globalStreamMetricsReader } from '../../src/utils/stream-metrics.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * GET /governor/status
 * Returns live rate governor, proxy health, and hibernation metrics.
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
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
        statusCode: 500,
        isRetryable: false,
        suggestedAction: 'retry_after_delay',
      },
    });
  }
});

/**
 * POST /governor/panic-stop (Story 32.1)
 * Emergency halt: hibernates accounts and enforces critical throttle.
 */
router.post('/panic-stop', authenticateToken, requireAdmin, (req, res) => {
  try {
    const platform = req.body?.platform || 'all';
    const durationMs = req.body?.durationMs;
    const result = globalAdaptiveRateGovernor.panicStop(platform, { durationMs });
    res.json({
      success: true,
      message: `Emergency Panic Stop activated for ${result.platform}`,
      result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        type: 'internal_error',
        message: (err instanceof Error ? err.message : String(err)) || String(err),
        statusCode: 500,
        isRetryable: false,
        suggestedAction: 'retry_after_delay',
      },
    });
  }
});

/**
 * POST /governor/panic-resume (Story 32.1)
 * Resume operations after panic stop.
 */
router.post('/panic-resume', authenticateToken, requireAdmin, (req, res) => {
  try {
    const platform = req.body?.platform || 'all';
    const result = globalAdaptiveRateGovernor.resumePanic(platform);
    res.json({
      success: true,
      message: `Panic Stop resumed for ${result.platform}`,
      result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        type: 'internal_error',
        message: (err instanceof Error ? err.message : String(err)) || String(err),
        statusCode: 500,
        isRetryable: false,
        suggestedAction: 'retry_after_delay',
      },
    });
  }
});

/**
 * POST /governor/priorities (Story 32.1)
 * Reorder consumer priorities.
 */
router.post('/priorities', authenticateToken, requireAdmin, (req, res) => {
  try {
    const priorities = Array.isArray(req.body?.priorities) ? req.body.priorities : [];
    const updated = [];
    for (const item of priorities) {
      if (item?.consumerId && item?.priority != null) {
        const ok = globalAdaptiveRateGovernor.setConsumerPriority(item.consumerId, item.priority);
        if (ok) updated.push(item.consumerId);
      }
    }
    res.json({
      success: true,
      updated,
      consumerQuotas: globalStatusApi.getGovernorStatus()?.consumerQuotas || {},
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        type: 'internal_error',
        message: (err instanceof Error ? err.message : String(err)) || String(err),
        statusCode: 500,
        isRetryable: false,
        suggestedAction: 'retry_after_delay',
      },
    });
  }
});

export default router;
