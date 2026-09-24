// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Engagement, Messages, Bookmarks schemas — Story 46.4.
 *
 * Covers:
 *   - /api/engagement (like, retweet, quote, follow)
 *   - /api/messages (direct messages send, conversations)
 *   - /api/bookmarks (list, add, remove, folders)
 *
 * @module api/schemas/social-engagement
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const SESSION_SECURITY = [{ sessionCookie: [] }];

// ── Request Schemas ─────────────────────────────────────────────────────────

export const LikeBody = z.object({
  tweetId: nonEmptyId,
  sessionCookie: z.string().optional(),
});

export const RetweetBody = z.object({
  tweetId: nonEmptyId,
  sessionCookie: z.string().optional(),
});

export const FollowBody = z.object({
  targetHandle: z.string().min(1),
  sessionCookie: z.string().optional(),
});

export const SendMessageBody = z.object({
  recipientId: z.string().min(1),
  text: z.string().min(1).max(10000),
  sessionCookie: z.string().optional(),
});

export const BookmarkBody = z.object({
  tweetId: nonEmptyId,
  sessionCookie: z.string().optional(),
});

// ── Registration ───────────────────────────────────────────────────────────

registerPath({
  method: 'post',
  path: '/api/engagement/like',
  summary: 'Like a target tweet',
  tags: ['Engagement'],
  schemas: { body: LikeBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/engagement/retweet',
  summary: 'Retweet a target tweet',
  tags: ['Engagement'],
  schemas: { body: RetweetBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/engagement/follow',
  summary: 'Follow a user by handle',
  tags: ['Engagement'],
  schemas: { body: FollowBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/messages/send',
  summary: 'Send a direct message to a user',
  tags: ['Messages'],
  schemas: { body: SendMessageBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/bookmarks',
  summary: 'List user bookmarks',
  tags: ['Bookmarks'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/bookmarks/add',
  summary: 'Bookmark a tweet',
  tags: ['Bookmarks'],
  schemas: { body: BookmarkBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});
