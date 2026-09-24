// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Content Optimizer schemas — Story 46.2 pilot mount `/api/optimizer`.
 * Public endpoints (no auth today) — declared optional-auth `[{}]`.
 *
 * @module api/schemas/optimizer
 */

import { z } from 'zod';
import { registerPath } from './registry.js';

// ── Request bodies ───────────────────────────────────────────────────────────

export const OptimizeBody = z.object({
  text: z.string().min(1),
  goal: z.string().optional(),
});

export const HashtagsBody = z.object({
  text: z.string().min(1),
  count: z.coerce.number().int().min(1).max(50).default(5),
});

export const PredictBody = z.object({
  text: z.string().min(1),
});

export const VariationsBody = z.object({
  text: z.string().min(1),
  count: z.coerce.number().int().min(1).max(20).default(3),
});

// ── Response payloads ────────────────────────────────────────────────────────

export const OptimizeResponse = z.looseObject({
  optimized: z.string().optional(),
  original: z.string().optional(),
  changes: z.array(z.unknown()).optional(),
});
export const HashtagsResponse = z.looseObject({
  hashtags: z.array(z.unknown()).optional(),
});
export const PredictResponse = z.looseObject({
  score: z.number().optional(),
  prediction: z.unknown().optional(),
});
export const VariationsResponse = z.looseObject({
  variations: z.array(z.unknown()),
});

// ── Operation registrations ──────────────────────────────────────────────────

const PUBLIC = [{}];

registerPath({
  method: 'post',
  path: '/api/optimizer/optimize',
  summary: 'Optimize tweet text for a goal',
  tags: ['Optimizer'],
  schemas: { body: OptimizeBody, response: OptimizeResponse },
  security: PUBLIC,
  xTryItOut: false,
  errors: [400, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/optimizer/hashtags',
  summary: 'Suggest hashtags for tweet text',
  tags: ['Optimizer'],
  schemas: { body: HashtagsBody, response: HashtagsResponse },
  security: PUBLIC,
  xTryItOut: false,
  errors: [400, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/optimizer/predict',
  summary: 'Predict tweet performance',
  tags: ['Optimizer'],
  schemas: { body: PredictBody, response: PredictResponse },
  security: PUBLIC,
  xTryItOut: false,
  errors: [400, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/optimizer/variations',
  summary: 'Generate tweet variations',
  tags: ['Optimizer'],
  schemas: { body: VariationsBody, response: VariationsResponse },
  security: PUBLIC,
  xTryItOut: false,
  errors: [400, 429, 500],
});
