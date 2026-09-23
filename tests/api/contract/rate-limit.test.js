// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — live rate-limiter contract test.
 *
 * In its own file because tripping `authLimiter` (max 10 / 15 min on
 * /api/auth/*) must not consume the shared limiter budget of other suites —
 * vitest gives each test file its own module registry and limiter store.
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../api/server.js';

describe('Story 46.2 — real rate limiter', () => {
  it('tripping authLimiter emits the 429 RATE_LIMITED envelope', async () => {
    let last;
    for (let i = 0; i < 15; i++) {
      last = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'ratelimit-probe', password: 'x'.repeat(10) });
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body.success).toBe(false);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});
