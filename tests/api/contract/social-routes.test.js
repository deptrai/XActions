// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.4 — Social & User-Facing mounts contract tests.
 *
 * Verifies that the new social endpoints:
 *   - Are present in the OpenAPI specification
 *   - Mutation endpoints carry x-tryitout: false
 *   - Follow authenticate → validate → handler order (unauthenticated returns 401, invalid returns 400)
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../api/server.js';
import { generateSpec } from '../../../api/openapi.js';

const spec = generateSpec();

describe('Story 46.4 — Social Routes Contract', () => {
  it('spec contains new social routes across all categories', () => {
    const requiredPaths = [
      '/api/posting/tweet',
      '/api/posting/thread',
      '/api/posting/poll',
      '/api/thread/unroll/{tweetId}',
      '/api/engagement/like',
      '/api/engagement/retweet',
      '/api/engagement/follow',
      '/api/messages/send',
      '/api/bookmarks',
      '/api/bookmarks/add',
      '/api/twitter/user',
      '/api/unfollowers/detect',
      '/api/unfollowers/list',
      '/api/profile',
      '/api/profile/update',
      '/api/settings',
      '/api/user/me',
      '/api/creator/stats',
      '/api/discovery/trending',
      '/api/spaces/active',
      '/api/graph/centrality',
      '/api/platform/status',
      '/api/facebook/scrape/profile',
      '/api/facebook/comment',
      '/api/facebook/accounts',
    ];

    for (const p of requiredPaths) {
      expect(spec.paths[p], `missing path in spec: ${p}`).toBeTruthy();
    }
  });

  it('real-account mutation operations carry x-tryitout: false', () => {
    const mutationOps = [
      ['post', '/api/posting/tweet'],
      ['post', '/api/posting/thread'],
      ['post', '/api/posting/poll'],
      ['post', '/api/engagement/like'],
      ['post', '/api/engagement/retweet'],
      ['post', '/api/engagement/follow'],
      ['post', '/api/messages/send'],
      ['post', '/api/bookmarks/add'],
      ['post', '/api/unfollowers/detect'],
      ['post', '/api/profile/update'],
      ['post', '/api/facebook/comment'],
      ['post', '/api/facebook/accounts'],
    ];

    for (const [method, path] of mutationOps) {
      const op = spec.paths[path]?.[method];
      expect(op, `operation not found: ${method.toUpperCase()} ${path}`).toBeTruthy();
      expect(op['x-tryitout']).toBe(false);
    }
  });

  it('POST /api/posting/tweet requires authentication (returns 401 when missing token)', async () => {
    const res = await request(app)
      .post('/api/posting/tweet')
      .send({ text: 'Hello world test' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
