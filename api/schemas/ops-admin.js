// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Admin, Webhooks, License, Billing schemas — Story 46.5.
 *
 * @module api/schemas/ops-admin
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const BEARER_SECURITY = [{ bearerAuth: [] }];

export const CreateLicenseBody = z.object({
  key: z.string().min(1),
  tier: z.enum(['basic', 'pro', 'enterprise']).default('pro'),
  expiresAt: z.string().optional(),
});

export const CreateWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
});

registerPath({
  method: 'get',
  path: '/api/admin/stats',
  summary: 'Get global system and user statistics',
  tags: ['Admin'],
  security: BEARER_SECURITY,
  errors: [401, 403, 500],
});

registerPath({
  method: 'get',
  path: '/api/admin/webhooks',
  summary: 'List registered outbound webhooks',
  tags: ['Admin'],
  security: BEARER_SECURITY,
  errors: [401, 403, 500],
});

registerPath({
  method: 'post',
  path: '/api/admin/webhooks',
  summary: 'Create a new outbound webhook',
  tags: ['Admin'],
  schemas: { body: CreateWebhookBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 403, 500],
});

registerPath({
  method: 'post',
  path: '/api/license/verify',
  summary: 'Verify an offline or enterprise license key',
  tags: ['License'],
  schemas: { body: z.object({ key: z.string().min(1) }) },
  security: [{}],
  errors: [400, 500],
});

registerPath({
  method: 'get',
  path: '/api/billing/plans',
  summary: 'Get public pricing plans',
  tags: ['Billing'],
  security: [{}],
  errors: [500],
});
