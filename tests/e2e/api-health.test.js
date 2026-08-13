// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';

describe('Health & Discovery', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api/health returns 200 with service info', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'xactions-api' });
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET / returns 200 (dashboard index)', async () => {
    const res = await request(app).get('/');
    // Serves static HTML — either 200 or redirect is acceptable
    expect([200, 301, 302]).toContain(res.status);
  });

  it('unknown route returns 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('response includes helmet security headers', async () => {
    const res = await request(app).get('/health');
    // helmet sets at minimum x-content-type-options
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('GET /openapi.json returns valid OpenAPI JSON', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    // Minimal OpenAPI shape check
    expect(res.body).toHaveProperty('openapi');
  });

  it('GET /.well-known/x402 returns x402 discovery JSON', async () => {
    const res = await request(app).get('/.well-known/x402');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('/api/* endpoints have rate-limit headers after a request', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    const rateLimitHeaders = Object.keys(res.headers).filter((h) =>
      /^(x-)?ratelimit|retry-after/i.test(h)
    );
    expect(rateLimitHeaders.length).toBeGreaterThan(0);
  });
});
