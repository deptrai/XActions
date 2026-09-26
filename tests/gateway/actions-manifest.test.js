// tests/gateway/actions-manifest.test.js
// Story 50.5 — GET /api/actions public manifest + syncCapable surfacing
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import actionsRouter from '../../api/routes/actions.js';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';
import { _resetActionsCache } from '../../api/routes/actions.js';

const ORIGINAL_ENV = { ...process.env };

let app;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  _resetActionsCache();
  app = express();
  app.use(express.json());
  app.use('/api/actions', actionsRouter);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('GET /api/actions — public manifest (Story 50.5)', () => {
  it('M-1: returns full manifest unauthenticated with canonical envelope shape', async () => {
    const res = await request(app).get('/api/actions');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBe(res.body.data.length);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThan(3);
    expect(typeof res.body.generatedAt).toBe('string');

    const redditSearch = res.body.data.find(a => a.platform === 'reddit' && a.action === 'search');
    expect(redditSearch).toBeDefined();
    expect(redditSearch.syncCapable).toBe(true);
    expect(redditSearch.requiredArgs).toContain('query');
    expect(redditSearch.category).toBe('social');
    expect(redditSearch.status).toBe('stable');
  });

  it('M-2: ?platform=reddit filters to reddit actions only', async () => {
    const res = await request(app).get('/api/actions?platform=reddit');
    expect(res.status).toBe(200);
    expect(res.body.data.every(a => a.platform === 'reddit')).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(3);
  });

  it('M-2b: ?platform=x resolves alias → twitter actions', async () => {
    const res = await request(app).get('/api/actions?platform=x');
    expect(res.status).toBe(200);
    // x is a twitter alias — canonicalized
    const platforms = new Set(res.body.data.map(a => a.platform));
    expect(platforms.has('twitter') || platforms.has('x')).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(5);
  });

  it('M-3: ?category=procurement filters by category (alias-normalized)', async () => {
    const res = await request(app).get('/api/actions?category=procurement');
    expect(res.status).toBe(200);
    const cats = new Set(res.body.data.map(a => a.category));
    expect(cats.size <= 1 || [...cats].every(c => c === 'procurement' || c === 'unknown')).toBe(true);
  });

  it('M-4: ?detailLevel=summary returns slim shape with syncCapable', async () => {
    const res = await request(app).get('/api/actions?detailLevel=summary&platform=reddit');
    expect(res.status).toBe(200);
    const action = res.body.data.find(a => a.action === 'search');
    expect(action).toBeDefined();
    expect(action.syncCapable).toBe(true);
    expect(action.requiredArgs).toEqual(['query']);
    // slim shape does not include heavy fields
    expect(action.example).toBeUndefined();
  });

  it('M-6: cache hit on second identical request (X-Actions-Cache header)', async () => {
    const r1 = await request(app).get('/api/actions');
    expect(r1.headers['x-actions-cache']).toBe('miss');
    const r2 = await request(app).get('/api/actions');
    expect(r2.headers['x-actions-cache']).toBe('hit');
    expect(r2.body.generatedAt).toBe(r1.body.generatedAt); // same cached payload
  });

  it('M-7: unauthenticated request is allowed (200, no auth required)', async () => {
    // No Authorization header at all — public browse ≠ call per UX-1
    const res = await request(app).get('/api/actions');
    expect(res.status).toBe(200);
  });

  it('M-8: ?platform=nonexistent returns 200 with empty data, not 404', async () => {
    const res = await request(app).get('/api/actions?platform=zzz-nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('REST ≡ MCP structural equality: executeActionListTool output matches route payload data', async () => {
    const direct = await executeActionListTool({ detailLevel: 'summary' });
    const res = await request(app).get('/api/actions?detailLevel=summary&refresh=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(direct); // shared executor → identical payload
  });

  it('M-9: every action entry carries syncCapable + status fields', async () => {
    const res = await request(app).get('/api/actions?detailLevel=summary&refresh=true');
    for (const a of res.body.data) {
      expect(typeof a.syncCapable).toBe('boolean');
      expect(['stable', 'beta', 'coming_soon']).toContain(a.status);
    }
  });
});
