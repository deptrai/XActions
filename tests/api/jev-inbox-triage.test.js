// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — POST /api/ai/messages/triage Route Test (Story 43.3)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';

async function buildApp() {
  const { default: messagesRoutes } = await import('../../api/routes/ai/messages.js');
  const app = express();
  app.use(express.json());
  app.use('/api/ai/messages', messagesRoutes);
  return app;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 60, output_tokens: 25 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

describe('POST /api/ai/messages/triage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('triages conversations and returns actions', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'lead', confidence: 0.9 },
      toxic: { type: 'noul', noul: 0.05 },
      priority: { type: 'score', score: 3, confidence: 0.9 },
    }));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/messages/triage')
      .set('X-Session-Cookie', 'mock-session-cookie')
      .send({ conversations: [{ name: 'buyer', lastMessage: 'pricing please' }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.triaged).toHaveLength(1);
    expect(res.body.data.triaged[0].action).toBe('escalate');
    expect(res.body.data.stats.escalate).toBe(1);
  });

  it('returns 400 when conversations is empty', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/messages/triage')
      .set('X-Session-Cookie', 'mock-session-cookie')
      .send({ conversations: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when conversations field is missing', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/messages/triage')
      .set('X-Session-Cookie', 'mock-session-cookie')
      .send({});
    expect(res.status).toBe(400);
  });

  it('handles degraded Jev — returns action:review for all', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/ai/messages/triage')
      .set('X-Session-Cookie', 'mock-session-cookie')
      .send({ conversations: [{ name: 'user', lastMessage: 'hello' }] });

    process.env.TYPESAFE_API_KEY = prevKey;
    expect(res.status).toBe(200);
    expect(res.body.data.triaged[0].action).toBe('review');
    expect(res.body.data.stats.degraded).toBe(true);
  });
});
