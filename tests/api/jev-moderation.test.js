// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — POST /api/ai/moderation/jev-check Route Test (Story 43.2)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';

async function buildApp() {
  const { default: moderationRoutes } = await import('../../api/routes/ai/moderation.js');
  const app = express();
  app.use(express.json());
  app.use('/api/ai/moderation', moderationRoutes);
  return app;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 100, output_tokens: 40 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

describe('POST /api/ai/moderation/jev-check', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns block verdict for toxic content', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      virality: { type: 'score', score: 2, confidence: 0.8 },
      clarity: { type: 'score', score: 2, confidence: 0.8 },
      onBrand: { type: 'score', score: 1, confidence: 0.8 },
      toxic: { type: 'noul', noul: 0.9 },
    }));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/moderation/jev-check')
      .send({ text: 'hateful harmful content here' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verdict).toBe('block');
    expect(res.body.toxic.noul).toBeGreaterThanOrEqual(0.5);
  });

  it('returns send verdict for high-quality safe content', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      virality: { type: 'score', score: 3, confidence: 0.9 },
      clarity: { type: 'score', score: 3, confidence: 0.9 },
      onBrand: { type: 'score', score: 3, confidence: 0.9 },
      toxic: { type: 'noul', noul: 0.05 },
    }));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/moderation/jev-check')
      .send({ text: 'Excellent AI automation framework — clean implementation' });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('send');
    expect(res.body.scores.virality).toBe(3);
  });

  it('returns 400 for empty text', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/moderation/jev-check')
      .send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing text field', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/moderation/jev-check')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns review verdict when Jev degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/moderation/jev-check')
      .send({ text: 'some content' });

    process.env.TYPESAFE_API_KEY = prevKey;
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('review');
    expect(res.body.degraded).toBe(true);
    expect(res.body.scores).toBeNull();
  });
});
