// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import express from 'express';
import { globalProxyBudgetGovernor } from '../../src/core/proxy-budget-governor.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/proxy/budget/status
 * Get current proxy budget status (remaining, daily budget, tier costs).
 */
router.get('/status', authenticateToken, async (_req, res) => {
  try {
    const remaining = await globalProxyBudgetGovernor.checkRemaining();
    res.json({
      success: true,
      remainingUsd: remaining.remaining,
      dailyBudgetUsd: remaining.dailyBudgetUsd,
      tierCosts: {
        free: 0,
        datacenter: 0.5,
        residential: 8.0,
        mobile_4g: 15.0,
      },
      estimatedCostPerRequestUsd: {
        datacenter: 0.42,
        residential: 0.42,
        mobile_4g: 0.79,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/proxy/budget/reset
 * Reset daily budget (admin only). Consumes all remaining budget.
 */
router.post('/reset', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const cur = await globalProxyBudgetGovernor.checkRemaining();
    if (cur.remaining > 0) {
      await globalProxyBudgetGovernor.consume('datacenter', (cur.remaining / 0.5) * 1e9);
    }
    const after = await globalProxyBudgetGovernor.checkRemaining();
    res.json({ success: true, remainingUsd: after.remaining });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;