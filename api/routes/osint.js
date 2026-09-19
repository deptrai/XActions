// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import express from 'express';
import { executeSocialFindProfiles } from '../../src/mcp/osint-find-profiles.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/osint/find-profiles
 * Execute OSINT find profiles fan-out query (Epic 36).
 * Body: { query, queryType?, platforms?, accountId?, locale?, timeoutMs? }
 */
router.post('/find-profiles', authenticateToken, async (req, res) => {
  try {
    const { query, queryType, platforms, accountId, locale, timeoutMs } = req.body || {};
    
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query is required (non-empty string)' });
    }

    const result = await executeSocialFindProfiles({
      query: query.trim(),
      queryType: queryType || 'auto',
      platforms: Array.isArray(platforms) ? platforms : undefined,
      accountId: accountId || undefined,
      locale: locale || 'en',
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * GET /api/osint/platforms
 * List supported platforms for OSINT queries.
 */
router.get('/platforms', authenticateToken, async (_req, res) => {
  try {
    const { PROFILE_ACTION_MAP } = await import('../../src/mcp/osint-find-profiles.js');
    res.json({ platforms: Object.keys(PROFILE_ACTION_MAP) });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
