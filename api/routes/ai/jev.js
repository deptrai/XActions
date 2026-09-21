// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Agent API Routes — Jev Decision Plane (Epic 42)
 *
 * Exposes the JevBrain typed-decision engine for AI agent consumption.
 * Free endpoints — the decision plane meters its own cost via
 * DistributedTokenBucket (jev:daily:*) and JEV_DAILY_BUDGET_USD.
 *
 * by nichxbt
 */

import express from 'express';
import { JevBrain } from '../../../src/agents/jevBrain.js';

const router = express.Router();

/** Lazy singleton — constructed on first request with env/config. */
let _brain = null;
function getBrain() {
  if (!_brain) {
    _brain = new JevBrain({
      apiKey: process.env.TYPESAFE_API_KEY || '',
      endpoint: process.env.TYPESAFE_API_ENDPOINT,
      model: process.env.JEV_MODEL || undefined,
      timeoutMs: process.env.JEV_TIMEOUT_MS ? parseInt(process.env.JEV_TIMEOUT_MS, 10) : undefined,
      dailyBudgetUsd: process.env.JEV_DAILY_BUDGET_USD ? parseFloat(process.env.JEV_DAILY_BUDGET_USD) : undefined,
      confidenceThresholds: {
        like: process.env.JEV_THRESHOLD_LIKE ? parseFloat(process.env.JEV_THRESHOLD_LIKE) : undefined,
        reply: process.env.JEV_THRESHOLD_REPLY ? parseFloat(process.env.JEV_THRESHOLD_REPLY) : undefined,
        safeToSend: process.env.JEV_THRESHOLD_SAFE ? parseFloat(process.env.JEV_THRESHOLD_SAFE) : undefined,
        // Story 42.4 — pageStatus must be ABSENT (not undefined/NaN) when the
        // env is unset or non-numeric, so the JevBrain 0.80 default survives.
        ...(Number.isFinite(parseFloat(process.env.JEV_THRESHOLD_PAGESTATUS))
          ? { pageStatus: parseFloat(process.env.JEV_THRESHOLD_PAGESTATUS) }
          : {}),
      },
    });
  }
  return _brain;
}

/**
 * GET /api/ai/jev/status — configuration & health of the Jev decision plane.
 * Never leaks the API key; reports degraded state and budget.
 */
router.get('/status', (req, res) => {
  const brain = getBrain();
  res.json({
    service: 'XActions Jev Decision Plane',
    version: '1.0.0',
    endpoint: brain.endpoint,
    model: brain.model,
    configured: Boolean(brain.apiKey),
    timeoutMs: brain.timeoutMs,
    dailyBudgetUsd: brain.dailyBudgetUsd,
    confidenceThresholds: brain.confidenceThresholds,
    usageToday: brain.getUsageToday(),
    degraded: !brain.apiKey,
  });
});

/**
 * POST /api/ai/jev/decide — run typed decision questions against a state.
 *
 * Body:
 * {
 *   state: string | object | array,       // text-only state
 *   questions: { id: {type, instructions, criteria} },
 *   gate?: { hi?: number, mid?: number, action?: string }  // optional confidence gate
 * }
 *
 * Response: { answers, usage, meta } (+ gate verdict when gate options provided)
 */
router.post('/decide', async (req, res) => {
  const { state, questions, gate } = req.body || {};

  if (state === undefined || !questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_ARGS',
      message: 'Provide "state" (string/object/array) and "questions" (object of typed questions).',
    });
  }

  try {
    const brain = getBrain();
    const result = await brain.decide(state, questions);
    const response = { success: true, ...result };

    if (gate) {
      const answerId = gate.answer || Object.keys(result.answers)[0];
      response.gate = {
        answer: answerId,
        verdict: brain.gate(result.answers[answerId], gate),
      };
    }

    return res.json(response);
  } catch (err) {
    // JevBrain never throws by design — this is a last-resort envelope.
    return res.status(500).json({
      success: false,
      error: 'JEV_DECIDE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
