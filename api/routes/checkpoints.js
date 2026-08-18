// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CrawlCheckpoint Operational HTTP Endpoints.
 * Story 10.4 — Express router for listing, showing, resuming, pausing, and retrying checkpoints.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { resolveUserId } from '../middleware/auth.js';
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
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';

const router = Router();

/**
 * Dual-Channel Authentication & Authorization Middleware for Checkpoint Management.
 * Grants access to admin users (JWT) or A2A agents with 'checkpoint:manage' permission.
 */
export async function requireCheckpointManage(req, res, next) {
  try {
    // Do not trust a pre-existing req.user/req.agent set by other middleware.
    // Always validate credentials from the request headers in this route.
    let authenticated = false;
    req.user = null;
    req.agent = null;

    // 1. Try A2A API Key Header (X-Agent-API-Key or X-API-Key)
    const apiKey = req.headers['x-agent-api-key'] || req.headers['x-api-key'];
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
    const authHeader = req.headers.authorization;
    if (!authenticated && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // Try as A2A Token first
      const a2aResult = await validateToken(token);
      if (a2aResult?.valid) {
        req.agent = {
          id: a2aResult.payload?.sub || 'a2a-bearer',
          permissions: a2aResult.payload?.permissions || [],
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
      return res.status(401).json({
        success: false,
        error: {
          code: 'XACT_4001',
          message: 'Authentication required. Provide a valid JWT Bearer token or A2A API Key.',
        },
      });
    }

    // Authorization check
    const isUserAdmin = req.user?.isAdmin === true;
    const isAgentPermitted = req.agent && checkPermission(req.agent, 'checkpoint:manage');

    if (!isUserAdmin && !isAgentPermitted) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'XACT_4003',
          message: 'checkpoint:manage permission or admin role required.',
        },
      });
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
 */
function parsePaginationNumber(value, defaultValue, fieldName) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `${fieldName} must be a non-negative integer`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  return parsed;
}

/**
 * GET /api/checkpoints
 * List checkpoints with pagination and filters.
 */
router.get('/', requireCheckpointManage, async (req, res, next) => {
  try {
    const { platform, targetType, targetKey, status, limit, offset, sortBy, order } = req.query;

    const result = await listCheckpoints({
      platform,
      targetType,
      targetKey,
      status,
      limit: parsePaginationNumber(limit, 50, 'limit'),
      offset: parsePaginationNumber(offset, 0, 'offset'),
      sortBy,
      order,
      prisma,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/checkpoints/:id
 * Get single checkpoint by ID.
 */
router.get('/:id', requireCheckpointManage, async (req, res, next) => {
  try {
    const checkpoint = await getCheckpoint(req.params.id, { prisma });
    res.json({
      success: true,
      data: { checkpoint },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/checkpoints/:id/resume
 * Resume a paused, failed, or stalled checkpoint.
 */
router.post('/:id/resume', requireCheckpointManage, async (req, res, next) => {
  try {
    const checkpoint = await resumeCheckpoint(req.params.id, { prisma });
    res.json({
      success: true,
      data: { checkpoint },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/checkpoints/:id/pause
 * Pause a running or stalled checkpoint.
 */
router.post('/:id/pause', requireCheckpointManage, async (req, res, next) => {
  try {
    const checkpoint = await pauseCheckpoint(req.params.id, { prisma });
    res.json({
      success: true,
      data: { checkpoint },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/checkpoints/:id/retry
 * Retry a failed or stalled checkpoint.
 */
router.post('/:id/retry', requireCheckpointManage, async (req, res, next) => {
  try {
    const checkpoint = await retryCheckpoint(req.params.id, { prisma });
    res.json({
      success: true,
      data: { checkpoint },
    });
  } catch (error) {
    next(error);
  }
});

// Error handling middleware for PlatformErrors
router.use((err, _req, res, _next) => {
  if (err instanceof PlatformError) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: {
        type: err.type,
        code: err.code,
        message: err.message,
        suggestedAction: err.suggestedAction,
      },
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      message: err.message || 'Internal server error',
    },
  });
});

export default router;
