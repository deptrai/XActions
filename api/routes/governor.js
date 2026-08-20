// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Governor status & rate limiting observability routes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Router } from 'express';
import { globalStatusApi } from '../../src/core/index.js';

const router = Router();

/**
 * GET /governor/status
 * Returns live rate governor, proxy health, and hibernation metrics.
 */
router.get('/status', (req, res) => {
  try {
    const status = globalStatusApi.getGovernorStatus();
    res.json({
      success: true,
      status,
      data: status, // for compatibility
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        type: 'internal_error',
        message: err?.message || String(err),
        statusCode: 500,
        isRetryable: false,
        suggestedAction: 'retry_after_delay',
      },
    });
  }
});

export default router;
