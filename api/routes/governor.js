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
      data: status,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
      },
    });
  }
});

export default router;
