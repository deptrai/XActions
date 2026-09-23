// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Agent-to-Agent (A2A) Protocol Delegation & Discovery
 *
 * Verifies end-to-end flow:
 * 1. Skill discovery via GET /api/a2a/skills
 * 2. Task submission envelope via POST /api/a2a/task
 * 3. Input and URL validation (callbackUrl, plain object input)
 * 4. Error envelopes for non-existent skills
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-a2a-protocol';

describe('A2A — Agent-to-Agent Protocol Delegation E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/a2a/skills returns registered skills for agent discovery`, async () => {
    const res = await request(app).get('/api/a2a/skills');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.agent).toBe('XActions');
    expect(Array.isArray(res.body.data.skills)).toBe(true);
    expect(res.body.data.skills.length).toBeGreaterThan(0);
    expect(res.body.data.taskEndpoint).toBe('/api/a2a/task');

    const firstSkill = res.body.data.skills[0];
    expect(firstSkill).toHaveProperty('id');
    expect(firstSkill).toHaveProperty('description');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/a2a/task rejects invalid input structure with 400`, async () => {
    const res = await request(app)
      .post('/api/a2a/task')
      .send({
        skill: 'xactions.x_unfollow_non_followers',
        input: 'not-an-object',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/a2a/task rejects invalid callbackUrl with 400`, async () => {
    const res = await request(app)
      .post('/api/a2a/task')
      .send({
        skill: 'xactions.x_unfollow_non_followers',
        input: { count: 5 },
        callbackUrl: 'invalid-url-scheme',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/a2a/task returns 404 for unknown skill`, async () => {
    const res = await request(app)
      .post('/api/a2a/task')
      .send({
        skill: 'xactions.unknown_non_existent_skill_xyz',
        input: { test: true },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SKILL_NOT_FOUND');
    expect(res.body.hint).toBeDefined();
  });
});
