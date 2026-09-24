// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Viral DNA Mining schemas — Story 46.2 pilot mount `/api/viral`.
 *
 * Session transport: canonical `x-session-cookie` header (declared via the
 * `sessionCookie` security scheme). The legacy `body.sessionCookie` field is
 * still accepted on POSTs — `sessionCookieShim` copies it into the header when
 * the header is absent (body precedence preserved for dual-read handlers).
 *
 * @module api/schemas/viral
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { isoDateTime, nonEmptyId } from './common.js';

// ── Request parts ────────────────────────────────────────────────────────────

/**
 * Declared session header — optional at the schema layer: `sessionCookieShim`
 * fills it from `body.sessionCookie` and `requireSession` owns the 401/dev-
 * fallback decision, so a missing header must not produce VALIDATION_FAILED.
 */
export const ViralSessionHeaders = z.object({
  'x-session-cookie': z
    .string()
    .min(1)
    .optional()
    .describe('X/Twitter auth_token cookie value (sessionCookie body field also accepted on POST routes)'),
});

const legacySessionCookieField = {
  sessionCookie: z
    .string()
    .min(1)
    .optional()
    .describe('Legacy transport — copied to x-session-cookie header when absent'),
};

export const ViralMineBody = z.object({
  platform: z.string().min(1),
  niche: z.string().min(1),
  count: z.coerce.number().int().min(1).max(10000).default(1000),
  ...legacySessionCookieField,
});

export const ViralBacktestBody = z.object({
  platform: z.string().min(1),
  niche: z.string().min(1),
  days: z.coerce.number().int().min(1).max(365).default(7),
  ...legacySessionCookieField,
});

export const ViralJobIdParams = z.object({ jobId: nonEmptyId });
export const ViralReportIdParams = z.object({ reportId: nonEmptyId });
export const ViralStatsParams = z.object({
  platform: z.string().min(1),
  niche: z.string().min(1),
});

// ── Response payloads (T — envelope wrapped by the builder) ──────────────────

export const ViralJob = z.looseObject({
  id: z.string(),
  platform: z.string(),
  niche: z.string(),
  status: z.string(),
  createdAt: isoDateTime,
  progress: z
    .looseObject({
      scraped: z.number().int().optional(),
      classified: z.number().int().optional(),
      total: z.number().int().optional(),
      percentage: z.number().optional(),
    })
    .optional(),
  cost: z.looseObject({ estimated: z.number().optional(), currency: z.string().optional() }).optional(),
  result: z.unknown().optional(),
  outputPath: z.string().optional(),
  error: z.string().optional(),
});

export const ViralMineResponse = z.looseObject({
  jobId: z.string(),
  status: z.string(),
  job: ViralJob,
});

export const ViralJobResponse = z.looseObject({ job: ViralJob });

export const ViralStatsResponse = z.looseObject({
  platform: z.string(),
  niche: z.string(),
  stats: z.unknown(),
});

export const ViralStatsListResponse = z.looseObject({
  stats: z.array(z.unknown()),
});

export const ViralReport = z.looseObject({
  id: z.string(),
  platform: z.string(),
  niche: z.string(),
  days: z.number(),
  status: z.string(),
  createdAt: isoDateTime,
});

export const ViralBacktestResponse = z.looseObject({
  reportId: z.string(),
  status: z.string(),
  report: ViralReport,
});

export const ViralReportResponse = z.looseObject({ report: ViralReport });

export const ViralCorpusResponse = z.looseObject({
  platform: z.string(),
  niche: z.string(),
  message: z.string(),
});

export const ViralPlatformsResponse = z.looseObject({
  platforms: z.record(z.string(), z.array(z.string())),
  total: z.number().int(),
});

// ── Operation registrations ──────────────────────────────────────────────────

const SESSION_SECURITY = [{ sessionCookie: [] }];
const PUBLIC_SECURITY = [{}];

registerPath({
  method: 'post',
  path: '/api/viral/mine',
  summary: 'Trigger a viral mining job',
  tags: ['Viral'],
  schemas: { body: ViralMineBody, headers: ViralSessionHeaders, response: ViralMineResponse },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/mine/{jobId}',
  summary: 'Get mining job status/progress',
  tags: ['Viral'],
  schemas: { params: ViralJobIdParams, headers: ViralSessionHeaders, response: ViralJobResponse },
  security: SESSION_SECURITY,
  errors: [400, 401, 404, 429, 500],
});

registerPath({
  method: 'delete',
  path: '/api/viral/mine/{jobId}',
  summary: 'Cancel a running mining job',
  tags: ['Viral'],
  schemas: { params: ViralJobIdParams, headers: ViralSessionHeaders, response: ViralJobResponse },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 404, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/stats/{platform}/{niche}',
  summary: 'Get latest viral stats for platform+niche',
  tags: ['Viral'],
  schemas: { params: ViralStatsParams, response: ViralStatsResponse },
  security: PUBLIC_SECURITY,
  errors: [400, 404, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/stats',
  summary: 'List all available viral stats',
  tags: ['Viral'],
  schemas: { response: ViralStatsListResponse },
  security: PUBLIC_SECURITY,
  errors: [500],
});

registerPath({
  method: 'post',
  path: '/api/viral/backtest',
  summary: 'Run a prediction backtest for platform+niche',
  tags: ['Viral'],
  schemas: { body: ViralBacktestBody, headers: ViralSessionHeaders, response: ViralBacktestResponse },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/backtest/{reportId}',
  summary: 'Get backtest report status',
  tags: ['Viral'],
  schemas: { params: ViralReportIdParams, headers: ViralSessionHeaders, response: ViralReportResponse },
  security: SESSION_SECURITY,
  errors: [400, 401, 404, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/corpus/{platform}/{niche}',
  summary: 'Get corpus metadata for platform+niche (JSON envelope; file streaming not yet implemented)',
  tags: ['Viral'],
  schemas: { params: ViralStatsParams, headers: ViralSessionHeaders, response: ViralCorpusResponse },
  security: SESSION_SECURITY,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/viral/platforms',
  summary: 'List all supported platforms with categories',
  tags: ['Viral'],
  schemas: { response: ViralPlatformsResponse },
  security: PUBLIC_SECURITY,
  errors: [500],
});
