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

  it('GET /openapi.json → 200, openapi 3.1.0, serverless subset note in description', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info?.description).toContain('503');
    expect(res.body.info?.description).toContain('subset');
  });

  it('GET /api-docs → 200 self-hosted Swagger UI HTML', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
    expect(res.text).not.toMatch(/https:\/\/cdn\./);
  });
});
