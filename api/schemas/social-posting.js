// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Posting & Thread schemas — Story 46.4.
 *
 * Covers:
 *   - /api/posting (tweet, schedule, thread, poll)
 *   - /api/thread (unroll, thread-composer)
 *
 * @module api/schemas/social-posting
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const SESSION_SECURITY = [{ sessionCookie: [] }];

// ── Request Schemas ─────────────────────────────────────────────────────────

export const TweetBody = z.object({
  text: z.string().min(1).max(25000),
  mediaIds: z.array(z.string()).optional(),
  replyToTweetId: z.string().optional(),
  sessionCookie: z.string().optional(),
});

export const ThreadBody = z.object({
  tweets: z.array(z.string().min(1)).min(1),
  delayMs: z.number().int().min(1000).max(60000).default(3000),
  sessionCookie: z.string().optional(),
});

export const PollBody = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  durationMinutes: z.number().int().min(5).max(10080).default(1440),
  sessionCookie: z.string().optional(),
});

export const UnrollParams = z.object({
  tweetId: nonEmptyId,
});

// ── Registration ───────────────────────────────────────────────────────────

registerPath({
  method: 'post',
  path: '/api/posting/tweet',
  summary: 'Post a new tweet',
  tags: ['Posting'],
  schemas: { body: TweetBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/posting/thread',
  summary: 'Post a multi-tweet thread',
  tags: ['Posting'],
  schemas: { body: ThreadBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/posting/poll',
  summary: 'Post a tweet with an attached poll',
  tags: ['Posting'],
  schemas: { body: PollBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'get',
  path: '/api/thread/unroll/{tweetId}',
  summary: 'Unroll and reconstruct a tweet thread',
  tags: ['Posting'],
  schemas: { params: UnrollParams },
  security: SESSION_SECURITY,
  errors: [400, 404, 500],
});
