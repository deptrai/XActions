// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Analytics, OSINT, A2A, Schedule, Teams, Video schemas — Story 46.5.
 *
 * @module api/schemas/ops-intelligence
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const BEARER_SECURITY = [{ bearerAuth: [] }];
const A2A_SECURITY = [{ a2aApiKey: [] }, { apiKey: [] }];

export const OsintLookupQuery = z.object({
  handle: z.string().min(1),
  platforms: z.string().optional(),
});

export const ScheduleTweetBody = z.object({
  text: z.string().min(1).max(25000),
  scheduledAt: z.string().datetime(),
  sessionCookie: z.string().optional(),
});

export const CreateTeamBody = z.object({
  name: z.string().min(1).max(50),
});

registerPath({
  method: 'get',
  path: '/api/analytics/overview',
  summary: 'Get account growth and engagement overview',
  tags: ['Intelligence'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/osint/lookup',
  summary: 'Cross-platform reverse identity and handle search',
  tags: ['Intelligence'],
  schemas: { query: OsintLookupQuery },
  security: BEARER_SECURITY,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/a2a/agents',
  summary: 'List available agent-to-agent protocol peers',
  tags: ['Intelligence'],
  security: A2A_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/schedule/tweet',
  summary: 'Schedule a tweet for future automated publishing',
  tags: ['Intelligence'],
  schemas: { body: ScheduleTweetBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/teams',
  summary: 'List user collaborative automation teams',
  tags: ['Intelligence'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/teams',
  summary: 'Create a new automation team',
  tags: ['Intelligence'],
  schemas: { body: CreateTeamBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/video/download',
  summary: 'Download high-resolution video stream (binary mp4 stream, envelope-exempt)',
  tags: ['Intelligence'],
  schemas: { query: z.object({ url: z.string().url() }) },
  security: [{}],
  errors: [400, 404, 500],
});
