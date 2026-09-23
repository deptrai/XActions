// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — serverless (Vercel) entry-point contract smoke tests.
 *
 * `api/serverless.js` is the production entry on Vercel; it must emit the same
 * canonical envelope for middleware-originated errors (404, auth 401) even
 * though only a subset of mounts is served there.
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../api/serverless.js';

describe('Story 46.2 — serverless surface', () => {
  it('unknown /api route → 404 NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/definitely-not-a-route-46-2');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('unauthenticated request → 401 error envelope', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ token: 'not-a-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });
});
