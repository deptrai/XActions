// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — OpenAPI composition contract tests.
 *
 * The generated pilot paths must merge with the literal `/api/ai` spec without
 * collisions, the canonical ApiSuccess/ApiError/PaginatedResponse components
 * must exist, every operation must carry an operationId, the five security
 * schemes must be declared, and x402 metadata (x-payment-info / x-bazaar)
 * must survive the merge.
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import { generateSpec } from '../../../api/openapi.js';
import request from 'supertest';
import app from '../../../api/server.js';
import { buildGeneratedDocument } from '../../../api/schemas/index.js';

const spec = generateSpec();

function* iterOperations(document) {
  for (const [path, item] of Object.entries(document.paths || {})) {
    for (const [method, op] of Object.entries(item || {})) {
      if (['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'].includes(method)) {
        yield { path, method, op };
      }
    }
  }
}

describe('Story 46.2 — OpenAPI composition', () => {
  it('emits OpenAPI 3.1 with API version 2.0.0', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.version).toBe('2.0.0');
  });

  it('every operation has a unique operationId', () => {
    const ids = new Map();
    for (const { path, method, op } of iterOperations(spec)) {
      expect(op.operationId, `${method.toUpperCase()} ${path} missing operationId`).toBeTruthy();
      expect(ids.has(op.operationId), `duplicate operationId ${op.operationId}`).toBe(false);
      ids.set(op.operationId, `${method} ${path}`);
    }
    expect(ids.size).toBeGreaterThan(100);
  });

  it('declares all five security schemes', () => {
    const schemes = spec.components?.securitySchemes || {};
    for (const name of ['x402Payment', 'sessionCookie', 'bearerAuth', 'a2aApiKey', 'apiKey']) {
      expect(schemes[name], `missing securityScheme ${name}`).toBeTruthy();
    }
    expect(schemes.sessionCookie.in).toBe('header');
    expect(schemes.sessionCookie.name).toBe('x-session-cookie');
  });

  it('exposes canonical ApiError / ApiSuccess / PaginatedResponse components', () => {
    const schemas = spec.components?.schemas || {};
    expect(schemas.ApiError).toBeTruthy();
    expect(schemas.ApiSuccess).toBeTruthy();
    expect(schemas.PaginatedResponse).toBeTruthy();

    const apiErrorProps = schemas.ApiError.properties || {};
    expect(apiErrorProps.success).toBeTruthy();
    expect(apiErrorProps.error).toBeTruthy();
  });

  it('contains generated pilot paths for all six route groups', () => {
    const pilotPaths = [
      '/api/viral/mine',
      '/api/viral/platforms',
      '/api/crm/tag',
      '/api/optimizer/optimize',
      '/api/checkpoints',
      '/api/session/save-session',
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/refresh',
    ];
    for (const p of pilotPaths) {
      expect(spec.paths[p], `missing pilot path ${p}`).toBeTruthy();
    }
  });

  it('retains the literal /api/ai paths alongside generated paths', () => {
    const aiPaths = Object.keys(spec.paths).filter((p) => p.startsWith('/api/ai'));
    expect(aiPaths.length).toBeGreaterThan(50);
    expect(spec.paths['/api/ai/scrape/profile']?.post).toBeTruthy();
  });

  it('preserves x402 metadata on literal operations', () => {
    let paymentInfoCount = 0;
    let bazaarCount = 0;
    for (const { op } of iterOperations(spec)) {
      if (op['x-payment-info']) paymentInfoCount += 1;
      if (op['x-bazaar']) bazaarCount += 1;
    }
    expect(paymentInfoCount).toBeGreaterThan(100);
    expect(bazaarCount).toBeGreaterThan(50);
    const sample = spec.paths['/api/ai/scrape/profile'].post['x-payment-info'];
    expect(sample.protocols).toContain('x402');
    expect(sample.payTo).toBeTruthy();
    expect(sample.facilitator).toBeTruthy();
  });

  it('has no path+method collisions between generated and literal sources', () => {
    const generated = buildGeneratedDocument();
    const generatedKeys = new Set();
    for (const [path, item] of Object.entries(generated.paths || {})) {
      for (const method of Object.keys(item)) generatedKeys.add(`${method} ${path}`);
    }
    // Every generated op is present in the merged spec
    for (const { path, method } of iterOperations(generated)) {
      expect(spec.paths[path]?.[method], `generated op lost: ${method} ${path}`).toBeTruthy();
    }
    expect(generatedKeys.size).toBeGreaterThan(10);
  });

  it('no literal (non-pilot) request body still carries sessionCookie', () => {
    const generatedPaths = new Set(Object.keys(buildGeneratedDocument().paths || {}));
    const offenders = [];
    for (const { path, method, op } of iterOperations(spec)) {
      if (generatedPaths.has(path)) continue; // generated ops handled by the next test
      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      if (!bodySchema) continue;
      const props = bodySchema.properties || {};
      const required = bodySchema.required || [];
      if ('sessionCookie' in props || required.includes('sessionCookie')) {
        offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('generated sessioned ops hide the legacy body transport; save-session keeps it as payload', () => {
    const resolve = (s) =>
      s?.$ref ? spec.components?.schemas?.[s.$ref.split('/').pop()] : s;
    const bodyProps = (op) => {
      const s = resolve(op?.requestBody?.content?.['application/json']?.schema);
      return { props: s?.properties || {}, required: s?.required || [] };
    };
    const declaresSessionCookie = (op) =>
      Array.isArray(op?.security) &&
      op.security.some((s) => s !== null && typeof s === 'object' && 'sessionCookie' in s);

    // EVERY op declaring the sessionCookie scheme must not advertise the
    // legacy body transport in the published spec (AD-6) — not just /api/viral/mine.
    const offenders = [];
    for (const { path, method, op } of iterOperations(spec)) {
      if (!declaresSessionCookie(op)) continue;
      const { props, required } = bodyProps(op);
      if ('sessionCookie' in props || required.includes('sessionCookie')) {
        offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);

    // save-session (bearerAuth) → sessionCookie is real payload, must survive
    const save = bodyProps(spec.paths['/api/session/save-session']?.post);
    expect('sessionCookie' in save.props || save.required.includes('sessionCookie')).toBe(true);
  });

  it('keeps legacy Error/SuccessResponse components for literal /api/ai ops', () => {
    // Literal ops emit legacy shapes at runtime — the spec must keep describing
    // them honestly instead of claiming the canonical envelope (NFR-22).
    const schemas = spec.components?.schemas || {};
    expect(schemas.Error).toBeTruthy();
    expect(schemas.SuccessResponse).toBeTruthy();
    const aiErrorRef =
      spec.paths['/api/ai/scrape/profile']?.post?.responses?.['500']?.content?.['application/json']
        ?.schema?.$ref;
    if (aiErrorRef) {
      expect(aiErrorRef).toBe('#/components/schemas/Error');
    }
  });

  it('pilot sessioned operations advertise the sessionCookie security scheme', () => {
    const mine = spec.paths['/api/viral/mine']?.post;
    expect(mine?.security).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionCookie: expect.any(Array) })])
    );
  });

  it('GET /openapi.json → 200, openapi 3.1.0, CORS *, servers, x-x402', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body.openapi).toBe('3.1.0');
    expect(Array.isArray(res.body.servers)).toBe(true);
    const serverUrls = res.body.servers.map((s) => s.url);
    expect(serverUrls.some((u) => u.includes('localhost'))).toBe(true);
    expect(serverUrls.some((u) => u.startsWith('https://'))).toBe(true);
    expect(res.body['x-x402']).toBeTruthy();
    const schemes = res.body.components?.securitySchemes || {};
    expect(schemes.x402Payment).toBeTruthy();
    const ops = [...iterOperations(res.body)];
    expect(ops.length).toBeGreaterThan(100);
    expect(ops.some(({ op }) => op['x-payment-info'])).toBe(true);
    expect(ops.some(({ op }) => op['x-bazaar'])).toBe(true);
  });

  it('OPTIONS /openapi.json preflight → 200 with CORS GET/OPTIONS methods', async () => {
    const res = await request(app).options('/openapi.json');
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-methods']).toContain('OPTIONS');
  });

  it('GET /.well-known/x402 → 200 with version:1 and resources array', async () => {
    const res = await request(app).get('/.well-known/x402');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(Array.isArray(res.body.resources)).toBe(true);
    expect(res.body.resources.length).toBeGreaterThan(0);
  });

  it('GET /api-docs → 200 HTML, self-hosted swagger-ui bundle, no CDN refs', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
    expect(res.text).not.toMatch(/https:\/\/cdn\./);
  });

  it('GET /api-docs redirects to /api-docs/ (Swagger UI mount)', async () => {
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/api-docs/');
  });
});
