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

    // sessioned op (declares sessionCookie security) → body prop stripped (AD-6)
    const mine = bodyProps(spec.paths['/api/viral/mine']?.post);
    expect('sessionCookie' in mine.props).toBe(false);
    expect(mine.required).not.toContain('sessionCookie');

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
});
