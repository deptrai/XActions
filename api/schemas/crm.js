// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Follower CRM schemas — Story 46.2 pilot mount `/api/crm` (bearerAuth).
 *
 * @module api/schemas/crm
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

// ── Request parts ────────────────────────────────────────────────────────────

export const CrmUsernameParams = z.object({ username: nonEmptyId });
export const CrmSegmentParams = z.object({ name: nonEmptyId });

export const CrmTagBody = z.object({
  username: z.string().min(1),
  tag: z.string().min(1),
});

export const CrmSearchQuery = z.object({
  q: z.string().optional(),
});

// ── Response payloads ────────────────────────────────────────────────────────

export const CrmSyncResponse = z.looseObject({
  synced: z.number().int().optional(),
  followers: z.number().int().optional(),
  following: z.number().int().optional(),
});
export const CrmTagResponse = z.looseObject({
  status: z.string(),
  username: z.string(),
  tag: z.string(),
});
export const CrmSearchResponse = z.looseObject({
  contacts: z.array(z.unknown()),
});
export const CrmSegmentResponse = z.looseObject({
  segment: z.string(),
  members: z.array(z.unknown()),
});
export const CrmScoreResponse = z.looseObject({
  scored: z.number().int().optional(),
});

// ── Operation registrations ──────────────────────────────────────────────────

const BEARER = [{ bearerAuth: [] }];

registerPath({
  method: 'post',
  path: '/api/crm/sync/{username}',
  summary: 'Sync followers for a username into the CRM',
  tags: ['CRM'],
  schemas: { params: CrmUsernameParams, response: CrmSyncResponse },
  security: BEARER,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/crm/tag',
  summary: 'Tag a CRM contact',
  tags: ['CRM'],
  schemas: { body: CrmTagBody, response: CrmTagResponse },
  security: BEARER,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/crm/search',
  summary: 'Search CRM contacts',
  tags: ['CRM'],
  schemas: { query: CrmSearchQuery, response: CrmSearchResponse },
  security: BEARER,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/crm/segment/{name}',
  summary: 'List members of a CRM segment/tag',
  tags: ['CRM'],
  schemas: { params: CrmSegmentParams, response: CrmSegmentResponse },
  security: BEARER,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/crm/score',
  summary: 'Auto-score all CRM contacts',
  tags: ['CRM'],
  schemas: { response: CrmScoreResponse },
  security: BEARER,
  xTryItOut: false,
  errors: [401, 429, 500],
});
