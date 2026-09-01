// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { makeTestToken, makeTestUserId, seedTestUser } from './fixtures/test-user.js';

describe('Comprehensive All-Routes Smoke Test', () => {
  const userId = makeTestUserId('smoke');
  let authHeader = '';

  beforeAll(async () => {
    await seedTestUser(userId);
    const validToken = makeTestToken(userId, 'smokeuser');
    authHeader = `Bearer ${validToken}`;
  });

  describe('1. Discovery & Public System Endpoints', () => {
    it('GET /health returns 200 OK', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /api/health returns 200 with service info', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /openapi.json returns 200 with OpenAPI definition', async () => {
      const res = await request(app).get('/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('openapi');
    });

    it('GET /.well-known/x402 returns 200 with x402 well-known data', async () => {
      const res = await request(app).get('/.well-known/x402');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    it('GET /metrics/stream returns 200 with stream metrics', async () => {
      const res = await request(app).get('/metrics/stream');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    it('GET /api/ai/health returns 200 with AI health status', async () => {
      const res = await request(app).get('/api/ai/health');
      expect(res.status).toBe(200);
    });

    it('GET /api/ai/pricing returns 200 with pricing breakdown', async () => {
      const res = await request(app).get('/api/ai/pricing');
      expect(res.status).toBe(200);
    });

    it('GET /api/billing/plans returns 200 with pricing plans', async () => {
      const res = await request(app).get('/api/billing/plans');
      expect(res.status).toBe(200);
      expect(res.body.plans).toBeDefined();
    });

    it('GET /api/proxies/status returns 200 with proxy status', async () => {
      const res = await request(app).get('/api/proxies/status');
      expect(res.status).toBe(200);
    });

    it('GET /api/governor/status returns 200 with governor metrics', async () => {
      const res = await request(app).get('/api/governor/status');
      expect(res.status).toBe(200);
    });
  });

  describe('2. Schemas & Metadata Endpoints', () => {
    it('GET /api/schemas returns 200 with registered schemas', async () => {
      const res = await request(app).get('/api/schemas');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.schemas)).toBe(true);
    });

    it('GET /api/schemas/facebook/ecom returns 200 with schema definition', async () => {
      const res = await request(app).get('/api/schemas/facebook/ecom');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.schema).toBeDefined();
    });
  });

  describe('3. Protected Endpoints — Auth Rejection (401 when unauthenticated)', () => {
    const protectedGetEndpoints = [
      '/api/user',
      '/api/operations',
      '/api/billing/subscription',
      '/api/checkpoints',
      '/api/bookmarks',
      '/api/creator',
      '/api/spaces',
      '/api/settings',
      '/api/analytics',
      '/api/portability',
      '/api/graph',
      '/api/unfollowers',
      '/api/tweet-schedule',
      '/api/crm',
      '/api/automations',
      '/api/teams',
      '/api/facebook/accounts',
    ];

    for (const endpoint of protectedGetEndpoints) {
      it(`GET ${endpoint} without auth returns 401`, async () => {
        const res = await request(app).get(endpoint);
        expect(res.status).toBe(401);
      });
    }
  });

  describe('4. Protected Endpoints — Response with Token', () => {
    it('GET /api/operations with auth returns 200', async () => {
      const res = await request(app).get('/api/operations').set('Authorization', authHeader);
      expect([200, 204]).toContain(res.status);
    });

    it('POST /api/facebook/scrape with missing body returns 400 validation error', async () => {
      const res = await request(app)
        .post('/api/facebook/scrape')
        .set('Authorization', authHeader)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('POST /api/facebook/automate with missing body returns 400 validation error', async () => {
      const res = await request(app)
        .post('/api/facebook/automate')
        .set('Authorization', authHeader)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('5. Error Handling', () => {
    it('unknown API path returns 404 JSON', async () => {
      const res = await request(app).get('/api/non-existent-subpath-999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
