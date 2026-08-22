// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Governor status & rate limiting observability routes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Router } from 'express';
import { globalStatusApi, globalAdaptiveRateGovernor } from '../../src/core/index.js';
import { refreshGovernorConsumerLag, globalStreamMetricsReader } from '../../src/utils/stream-metrics.js';

const router = Router();

/**
 * GET /governor/status
 * Returns live rate governor, proxy health, and hibernation metrics.
 */
router.get('/status', async (req, res) => {
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

export default router;
