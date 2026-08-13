// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { nextTestId } from '../utils/test-ids.js';
const TEST_SCOPE = 'e2e-api-health';

describe('Health & Discovery', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /health returns 200 with status ok`, async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body.timestamp).toBeDefined();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/health returns 200 with service info`, async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'xactions-api' });
    expect(res.body.timestamp).toBeDefined();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET / returns 200 (dashboard index)`, async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] unknown route returns 404 JSON`, async () => {
    const res = await request(app).get('/api/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] response includes helmet security headers`, async () => {
    const res = await request(app).get('/health');
    // helmet sets at minimum x-content-type-options
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /openapi.json returns valid OpenAPI JSON`, async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    // Minimal OpenAPI shape check
    expect(res.body).toHaveProperty('openapi');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /.well-known/x402 returns x402 discovery JSON`, async () => {
    const res = await request(app).get('/.well-known/x402');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] /api/* endpoints have rate-limit headers after a request`, async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});
