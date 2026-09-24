// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.5 — Data, Ops & Admin mounts contract tests.
 *
 * Verifies that the new operations:
 *   - Are present in the OpenAPI specification
 *   - Total paths count reaches >= 380
 *   - Admin and Agent mutation endpoints carry x-tryitout: false
 *   - A2A endpoints declare a2aApiKey security scheme
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import { generateSpec } from '../../../api/openapi.js';

const spec = generateSpec();

describe('Story 46.5 — Ops & Admin Routes Contract', () => {
  it('total OpenAPI paths reach >= 380', () => {
    const paths = Object.keys(spec.paths || {});
    expect(paths.length).toBeGreaterThanOrEqual(380);
  });

  it('spec contains core ops, admin and infrastructure paths', () => {
    const requiredPaths = [
      '/api/admin/stats',
      '/api/admin/webhooks',
      '/api/license/verify',
      '/api/billing/plans',
      '/api/operations',
      '/api/agent/start',
      '/api/agent/stop',
      '/api/workflows',
      '/api/scripts/browser',
      '/api/proxies',
      '/api/governor/status',
      '/api/benchmark/summary',
      '/api/datasets',
      '/api/schemas/registry',
      '/api/analytics/overview',
      '/api/osint/lookup',
      '/api/a2a/agents',
      '/api/schedule/tweet',
      '/api/teams',
      '/api/video/download',
    ];

    for (const p of requiredPaths) {
      expect(spec.paths[p], `missing ops path: ${p}`).toBeTruthy();
    }
  });

  it('agent and admin mutations carry x-tryitout: false', () => {
    const mutations = [
      ['post', '/api/admin/webhooks'],
      ['post', '/api/agent/start'],
      ['post', '/api/agent/stop'],
      ['post', '/api/workflows/run'],
      ['post', '/api/proxies'],
      ['post', '/api/schedule/tweet'],
      ['post', '/api/teams'],
    ];

    for (const [method, path] of mutations) {
      const op = spec.paths[path]?.[method];
      expect(op, `operation not found: ${method.toUpperCase()} ${path}`).toBeTruthy();
      expect(op['x-tryitout']).toBe(false);
    }
  });

  it('/api/a2a/agents declares A2A API key security schemes', () => {
    const a2aOp = spec.paths['/api/a2a/agents']?.get;
    expect(a2aOp).toBeTruthy();
    const securities = a2aOp.security || [];
    const keys = securities.flatMap((s) => Object.keys(s));
    expect(keys).toContain('a2aApiKey');
  });
});
