// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — POST /api/ai/jev/lead-icp Route Test (Story 42.7)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';

// Build a minimal app with only the jev router — avoids loading full server.
async function buildApp() {
  const { default: jevRoutes } = await import('../../api/routes/ai/jev.js');
  const app = express();
  app.use(express.json());
  app.use('/api/ai/jev', jevRoutes);
  return app;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 80, output_tokens: 30 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

describe('POST /api/ai/jev/lead-icp', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // jev.js holds a module-level `_brain` singleton — a test that deletes
    // TYPESAFE_API_KEY before getBrain() first runs poisons every later test
    // in the file (decide() degrades → `all:[]`). Reset the module registry so
    // each test builds a fresh router + fresh brain under the current env.
    vi.resetModules();
  });

  it('returns qualified leads with buyerIntent + leadScore', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'decision_maker', confidence: 0.92 },
      leadScore: { type: 'score', score: 3, confidence: 0.88 },
    }));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/jev/lead-icp')
      .send({ profiles: [{ username: 'cto_x', bio: 'CTO looking for automation' }], icp: 'AI tools' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.qualified).toHaveLength(1);
    expect(res.body.qualified[0].buyerIntent).toBe('decision_maker');
    expect(res.body.qualified[0].leadScore).toBe(3);
    expect(res.body.stats.total).toBe(1);
    expect(res.body.stats.qualified).toBe(1);
    expect(res.body.stats.degraded).toBe(false);
  });

  it('excludes not_a_lead profiles from qualified', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'not_a_lead', confidence: 0.95 },
      leadScore: { type: 'score', score: 0, confidence: 0.9 },
    }));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/jev/lead-icp')
      .send({ profiles: [{ username: 'memer', bio: 'cat memes' }] });

    expect(res.status).toBe(200);
    expect(res.body.qualified).toHaveLength(0);
    expect(res.body.all).toHaveLength(1);
    expect(res.body.stats.degraded).toBe(false);
  });

  it('returns 400 for empty profiles array', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/jev/lead-icp')
      .send({ profiles: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ARGS');
  });

  it('returns 400 when profiles field is missing', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/jev/lead-icp')
      .send({});
    expect(res.status).toBe(400);
  });

  it('GET /status exposes samePerson=0.85 default (conditional spread does not poison)', async () => {
    // Story 42.5 — guards the G5 regression class: an unconditional spread of
    // parseFloat(JEV_THRESHOLD_SAMEPERSON) would put NaN over the 0.85 default.
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/ai/jev/status');
    expect(res.status).toBe(200);
    expect(res.body.confidenceThresholds.samePerson).toBe(0.85);
  });

  it('handles degraded Jev — returns empty qualified with stats.degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/jev/lead-icp')
      .send({ profiles: [{ username: 'a', bio: 'test' }] });

    process.env.TYPESAFE_API_KEY = prevKey;
    expect(res.status).toBe(200);
    expect(res.body.qualified).toEqual([]);
    expect(res.body.stats.degraded).toBe(true);
  });
});
