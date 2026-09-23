// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CrawlCheckpoint operational API schemas — Story 46.2 pilot mount
 * `/api/checkpoints` (`requireCheckpointManage`: X-Agent-API-Key / X-API-Key /
 * A2A bearer / admin JWT).
 *
 * `GET /api/checkpoints` keeps `?offset` request compatibility; the response
 * is the canonical pagination envelope `data:T[] + page:{cursor,limit,total}`.
 *
 * @module api/schemas/checkpoints
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { isoDateTime, nonEmptyId, opaqueCursor } from './common.js';

// ── Request parts ────────────────────────────────────────────────────────────

export const CheckpointListQuery = z.object({
  platform: z.string().optional(),
  targetType: z.string().optional(),
  targetKey: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  cursor: opaqueCursor.optional(),
  sortBy: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const CheckpointIdParams = z.object({ id: nonEmptyId });

// ── Response payloads ────────────────────────────────────────────────────────

export const Checkpoint = z.looseObject({
  id: z.string(),
  platform: z.string(),
  targetType: z.string(),
  targetKey: z.string(),
  status: z.string(),
  errorCount: z.number().int(),
  createdAt: isoDateTime.optional(),
  updatedAt: isoDateTime.optional(),
});

export const CheckpointDetailResponse = z.looseObject({
  checkpoint: Checkpoint,
});

// ── Operation registrations ──────────────────────────────────────────────────

// requireCheckpointManage accepts A2A api key (X-Agent-API-Key or X-API-Key),
// A2A bearer token, or admin user JWT.
const CHECKPOINT_SECURITY = [{ a2aApiKey: [] }, { apiKey: [] }, { bearerAuth: [] }];

registerPath({
  method: 'get',
  path: '/api/checkpoints',
  summary: 'List checkpoints with filters and pagination',
  tags: ['Checkpoints'],
  schemas: { query: CheckpointListQuery, response: Checkpoint },
  paginated: true,
  security: CHECKPOINT_SECURITY,
  errors: [400, 401, 403, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/checkpoints/{id}',
  summary: 'Get a single checkpoint by ID',
  tags: ['Checkpoints'],
  schemas: { params: CheckpointIdParams, response: CheckpointDetailResponse },
  security: CHECKPOINT_SECURITY,
  errors: [400, 401, 403, 404, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/checkpoints/{id}/resume',
  summary: 'Resume a paused/failed/stalled checkpoint',
  tags: ['Checkpoints'],
  schemas: { params: CheckpointIdParams, response: CheckpointDetailResponse },
  security: CHECKPOINT_SECURITY,
  errors: [400, 401, 403, 404, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/checkpoints/{id}/pause',
  summary: 'Pause a running/stalled checkpoint',
  tags: ['Checkpoints'],
  schemas: { params: CheckpointIdParams, response: CheckpointDetailResponse },
  security: CHECKPOINT_SECURITY,
  errors: [400, 401, 403, 404, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/checkpoints/{id}/retry',
  summary: 'Retry a failed/stalled checkpoint',
  tags: ['Checkpoints'],
  schemas: { params: CheckpointIdParams, response: CheckpointDetailResponse },
  security: CHECKPOINT_SECURITY,
  errors: [400, 401, 403, 404, 429, 500],
});
