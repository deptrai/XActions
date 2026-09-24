// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Social & Accounts schemas — Story 46.4.
 *
 * Covers:
 *   - /api/facebook (profile scrape, marketplace, posts, comments)
 *   - /api/facebook/accounts (account management, session pool)
 *
 * @module api/schemas/social-facebook
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const BEARER_SECURITY = [{ bearerAuth: [] }];

// ── Request Schemas ─────────────────────────────────────────────────────────

export const FacebookScrapeProfileBody = z.object({
  profileUrl: z.string().url(),
  includePosts: z.boolean().default(true),
});

export const FacebookPostCommentBody = z.object({
  postId: nonEmptyId,
  message: z.string().min(1).max(5000),
});

export const FacebookAddAccountBody = z.object({
  cookies: z.string().min(1),
  label: z.string().optional(),
});

// ── Registration ───────────────────────────────────────────────────────────

registerPath({
  method: 'post',
  path: '/api/facebook/scrape/profile',
  summary: 'Scrape a public Facebook profile or page',
  tags: ['Facebook'],
  schemas: { body: FacebookScrapeProfileBody },
  security: BEARER_SECURITY,
  errors: [400, 401, 500],
});

registerPath({
  method: 'post',
  path: '/api/facebook/comment',
  summary: 'Post a comment on a Facebook post',
  tags: ['Facebook'],
  schemas: { body: FacebookPostCommentBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/facebook/accounts',
  summary: 'List available Facebook automation accounts',
  tags: ['Facebook'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/facebook/accounts',
  summary: 'Register a new Facebook automation session cookie',
  tags: ['Facebook'],
  schemas: { body: FacebookAddAccountBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});
