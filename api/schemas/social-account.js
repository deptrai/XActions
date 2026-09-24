// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Account & Profile schemas — Story 46.4.
 *
 * Covers:
 *   - /api/twitter (user info, status, followers)
 *   - /api/unfollowers (detect, list, sync)
 *   - /api/profile (get, update bio/avatar)
 *   - /api/settings (preferences, notifications)
 *   - /api/user (details, credits, subscription)
 *   - /api/creator (monetization, analytics)
 *
 * @module api/schemas/social-account
 */

import { z } from 'zod';
import { registerPath } from './registry.js';

const SESSION_SECURITY = [{ sessionCookie: [] }];
const BEARER_SECURITY = [{ bearerAuth: [] }];

// ── Request Schemas ─────────────────────────────────────────────────────────

export const UpdateProfileBody = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(160).optional(),
  location: z.string().max(30).optional(),
  url: z.string().url().optional(),
  sessionCookie: z.string().optional(),
});

export const DetectUnfollowersBody = z.object({
  limit: z.number().int().min(1).max(5000).default(100),
  sessionCookie: z.string().optional(),
});

// ── Registration ───────────────────────────────────────────────────────────

registerPath({
  method: 'get',
  path: '/api/twitter/user',
  summary: 'Get current authenticated Twitter user details',
  tags: ['Twitter'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/unfollowers/detect',
  summary: 'Detect recent unfollowers',
  tags: ['Unfollowers'],
  schemas: { body: DetectUnfollowersBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/unfollowers/list',
  summary: 'List detected unfollowers',
  tags: ['Unfollowers'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/profile',
  summary: 'Get account profile information',
  tags: ['Profile'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/profile/update',
  summary: 'Update account profile metadata',
  tags: ['Profile'],
  schemas: { body: UpdateProfileBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/settings',
  summary: 'Get user application settings',
  tags: ['Settings'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/user/me',
  summary: 'Get current platform user record',
  tags: ['User'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/creator/stats',
  summary: 'Get creator monetization and analytics metrics',
  tags: ['Creator'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});
