// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /api/actions — Public Actions Catalog (Story 50.5, Epic 50).
 *
 * Unauthenticated introspection route returning every registered
 * (platform, action, syncCapable, requiredArgs, category, description) triple
 * via the shared `executeActionListTool` — REST and MCP (`x_actions_list`)
 * consumers get the identical payload (UX-1).
 *
 * Query params (all optional):
 *   platform    — canonical key or alias (?platform=x → twitter)
 *   category    — category name or alias (?category=b2b → procurement)
 *   detailLevel — 'summary' | 'full'
 *   refresh     — 'true' bypasses the 60s cache (admin/debug only, still public)
 *
 * Caching: 60s in-memory TTL keyed by filter tuple. The executor instantiates
 * ~25 crawler classes — caching is required for the <100ms AC.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import express from 'express';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';

const router = express.Router();

const CACHE_TTL_MS = 60_000;
/** @type {Map<string, { payload: unknown, expiresAt: number }>} */
const _cache = new Map();

/**
 * GET /api/actions
 * Public manifest of all registered platforms + actions.
 */
router.get('/', async (req, res) => {
  try {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const detailLevel = req.query.detailLevel === 'summary' ? 'summary' : 'full';
    const refresh = req.query.refresh === 'true';

    const cacheKey = `${platform ?? ''}|${category ?? ''}|${detailLevel}`;
    const now = Date.now();

    if (!refresh) {
      const hit = _cache.get(cacheKey);
      if (hit && hit.expiresAt > now) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('X-Actions-Cache', 'hit');
        return res.json(hit.payload);
      }
    }

    const data = await executeActionListTool({ platform, category, detailLevel });

    const categories = [...new Set(
      data
        .map((a) => typeof a.category === 'string' ? a.category : 'unknown')
        .filter(Boolean)
    )].sort();

    const payload = {
      success: true,
      data,
      count: data.length,
      categories,
      generatedAt: new Date(now).toISOString(),
    };

    _cache.set(cacheKey, { payload, expiresAt: now + CACHE_TTL_MS });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Actions-Cache', 'miss');
    return res.json(payload);
  } catch (err) {
    console.error('❌ GET /api/actions error:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'XACT_5000',
        kind: 'internal',
        message: err instanceof Error ? err.message : 'Actions manifest failed',
        status: 500,
      },
    });
  }
});

/** Test seam — clear the manifest cache. @internal */
export function _resetActionsCache() {
  _cache.clear();
}

export default router;
