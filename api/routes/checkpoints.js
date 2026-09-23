// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CrawlCheckpoint Operational HTTP Endpoints.
 * Story 10.4 — Express router for listing, showing, resuming, pausing, and retrying checkpoints.
 * Story 46.2 — canonical envelopes: list returns `data:T[]` + `page:{cursor,limit,total}`;
 * auth emits flow through `next(ApiError)`; domain `PlatformError`s are serialized
 * by the global error middleware (details = toEnvelope() verbatim).
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { resolveUserId } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/envelope.js';
import { validate } from '../middleware/validate.js';
import {
  validateApiKey,
  validateToken,
  checkPermission,
} from '../../src/a2a/auth.js';
import {
  listCheckpoints,
  getCheckpoint,
  resumeCheckpoint,
  pauseCheckpoint,
  retryCheckpoint,
} from '../../src/store/checkpoint-manager.js';
import { CheckpointListQuery, CheckpointIdParams } from '../schemas/checkpoints.js';

const router = Router();

// ── Opaque offset cursor (v2 pagination contract) ────────────────────────────

/** @param {number} offset */
export function encodeOffsetCursor(offset) {
  return Buffer.from(`off:${offset}`, 'utf8').toString('base64url');
}

/**
 * @param {string} cursor
 * @returns {number}
 */
function decodeOffsetCursor(cursor) {
  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const match = /^off:(\d+)$/.exec(decoded);
    if (match) {
      const n = Number(match[1]);
      if (Number.isSafeInteger(n) && n <= 2147483647) return n;
    }
  } catch { /* fall through to error */ }
  throw new ApiError('VALIDATION_FAILED', 400, 'Invalid pagination cursor');
}

/**
 * Dual-Channel Authentication & Authorization Middleware for Checkpoint Management.
 * Grants access to admin users (JWT) or A2A agents with 'checkpoint:manage' permission.
 */
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function requireCheckpointManage(req, res, next) {
  try {
    // Do not trust a pre-existing req.user/req.agent set by other middleware.
    // Always validate credentials from the request headers in this route.
    let authenticated = false;
    req.user = null;
    req.agent = null;

    // 1. Try A2A API Key Header (X-Agent-API-Key or X-API-Key)
    const rawApiKey = req.headers['x-agent-api-key'] || req.headers['x-api-key'];
    const apiKey = /** @type {string | undefined} */ (Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey);
    if (!authenticated && apiKey) {
      const apiResult = await validateApiKey(apiKey);
      if (apiResult?.valid) {
        req.agent = {
          id: apiResult.label || 'a2a-apikey',
          permissions: apiResult.permissions || [],
          type: 'apikey',
        };
        authenticated = true;
      }
    }

    // 2. Try Bearer Token (A2A JWT Token or User JWT)
    const rawAuthHeader = req.headers.authorization;
    const authHeader = /** @type {string | undefined} */ (Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader);
    if (!authenticated && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // Try as A2A Token first
      const a2aResult = await validateToken(token);
      if (a2aResult?.valid) {
        const payload = /** @type {Record<string, unknown>} */ (a2aResult.payload || {});
        const sub = /** @type {string | undefined} */ (payload.sub);
        const permissions = /** @type {string[] | undefined} */ (payload.permissions);
        req.agent = {
          id: sub || 'a2a-bearer',
          permissions: permissions || [],
          type: 'bearer',
        };
        authenticated = true;
      } else if (process.env.JWT_SECRET) {
        // Try as standard User JWT
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const userId = resolveUserId(decoded);
          if (userId) {
            const user = await prisma.user.findUnique({
              where: { id: userId },
            });
            if (user) {
              req.user = user;
              authenticated = true;
            }
          }
        } catch {
          // Token verification failed
        }
      }
    }

    if (!authenticated) {
      return next(new ApiError(
        'XACT_4001',
        401,
        'Authentication required. Provide a valid JWT Bearer token or A2A API Key.'
      ));
    }

    // Authorization check
    const isUserAdmin = req.user?.isAdmin === true;
    const isAgentPermitted = req.agent && checkPermission(/** @type {{ permissions: string[] }} */ (req.agent), 'checkpoint:manage');

    if (!isUserAdmin && !isAgentPermitted) {
      return next(new ApiError(
        'XACT_4003',
        403,
        'checkpoint:manage permission or admin role required.'
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/checkpoints
 * List checkpoints with pagination and filters.
 * Request keeps `offset` (compat) and also accepts an opaque `cursor`;
 * the response is the canonical pagination envelope.
 */
router.get('/', requireCheckpointManage, validate({ query: CheckpointListQuery }), asyncHandler(async (req, res) => {
  const { platform, targetType, targetKey, status, limit, offset, cursor, sortBy, order } = req.query;

  // Opaque cursor wins over a raw offset when present.
  const effectiveOffset = cursor ? decodeOffsetCursor(cursor) : (offset ?? 0);

  const result = await listCheckpoints({
    platform,
    targetType,
    targetKey,
    status,
    limit: limit ?? 50,
    offset: effectiveOffset,
    sortBy,
    order,
    prisma,
  });

  const nextOffset = result.offset + result.checkpoints.length;
  const nextCursor =
    result.checkpoints.length > 0 && nextOffset < result.total ? encodeOffsetCursor(nextOffset) : null;

  res.sendPage(result.checkpoints, {
    cursor: nextCursor,
    limit: result.limit,
    total: result.total,
  });
}));

/**
 * GET /api/checkpoints/:id
 * Get single checkpoint by ID.
 */
router.get('/:id', requireCheckpointManage, validate({ params: CheckpointIdParams }), asyncHandler(async (req, res) => {
  const checkpoint = await getCheckpoint(req.params.id, { prisma });
  res.sendData({ checkpoint });
}));

/**
 * POST /api/checkpoints/:id/resume
 * Resume a paused, failed, or stalled checkpoint.
 */
router.post('/:id/resume', requireCheckpointManage, validate({ params: CheckpointIdParams }), asyncHandler(async (req, res) => {
  const checkpoint = await resumeCheckpoint(req.params.id, { prisma });
  res.sendData({ checkpoint });
}));

/**
 * POST /api/checkpoints/:id/pause
 * Pause a running or stalled checkpoint.
 */
router.post('/:id/pause', requireCheckpointManage, validate({ params: CheckpointIdParams }), asyncHandler(async (req, res) => {
  const checkpoint = await pauseCheckpoint(req.params.id, { prisma });
  res.sendData({ checkpoint });
}));

/**
 * POST /api/checkpoints/:id/retry
 * Retry a failed or stalled checkpoint.
 */
router.post('/:id/retry', requireCheckpointManage, validate({ params: CheckpointIdParams }), asyncHandler(async (req, res) => {
  const checkpoint = await retryCheckpoint(req.params.id, { prisma });
  res.sendData({ checkpoint });
}));

// Per-router error middleware removed in Story 46.2 — the global
// errorMiddleware owns PlatformError serialization (details = toEnvelope()).

export default router;
