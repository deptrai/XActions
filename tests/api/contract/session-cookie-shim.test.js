// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — sessionCookie transport shim contract tests.
 *
 * The canonical transport is the `x-session-cookie` header; the shim copies
 * `body.sessionCookie` into the header ONLY when the header is absent, and
 * never removes the body field (dual-read handlers keep body precedence).
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sessionCookieShim } from '../../../api/middleware/session-cookie-shim.js';
import app from '../../../api/server.js';

function runShim(req) {
  let nexted = false;
  sessionCookieShim(req, {}, () => { nexted = true; });
  return nexted;
}

describe('Story 46.2 — sessionCookieShim (unit)', () => {
  it('copies body.sessionCookie to x-session-cookie when header is absent', () => {
    const req = { headers: {}, body: { sessionCookie: 'body-cookie-123' } };
    expect(runShim(req)).toBe(true);
    expect(req.headers['x-session-cookie']).toBe('body-cookie-123');
    // Body field preserved (dual-read handlers keep body precedence)
    expect(req.body.sessionCookie).toBe('body-cookie-123');
  });

  it('does NOT overwrite an explicit x-session-cookie header', () => {
    const req = {
      headers: { 'x-session-cookie': 'header-cookie' },
      body: { sessionCookie: 'body-cookie' },
    };
    runShim(req);
    expect(req.headers['x-session-cookie']).toBe('header-cookie');
    expect(req.body.sessionCookie).toBe('body-cookie');
  });

  it('is a no-op when there is no body sessionCookie', () => {
    const req = { headers: {}, body: { platform: 'x' } };
    runShim(req);
    expect(req.headers['x-session-cookie']).toBeUndefined();
  });

  it('ignores empty-string and non-string body sessionCookie', () => {
    for (const value of ['', 123, null, undefined]) {
      const req = { headers: {}, body: { sessionCookie: value } };
      runShim(req);
      expect(req.headers['x-session-cookie']).toBeUndefined();
    }
  });

  it('handles a missing/undefined body safely', () => {
    const req = { headers: {} };
    runShim(req);
    expect(req.headers['x-session-cookie']).toBeUndefined();
  });
});

describe('Story 46.2 — shim on the real app (viral pilot)', () => {
  it('POST /api/viral/mine accepts sessionCookie in body (legacy transport)', async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .send({ platform: 'threads', niche: 'ai', count: 5, sessionCookie: 'legacy-body-cookie' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Dual-read precedence preserved: requireSession still prefers the body value.
    expect(res.body.data.job.session).toBe('legacy-body-cookie');
  });

  it('POST /api/viral/mine accepts x-session-cookie header (canonical transport)', async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .set('x-session-cookie', 'header-cookie-abc')
      .send({ platform: 'threads', niche: 'ai', count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.job.session).toBe('header-cookie-abc');
  });

  it('body sessionCookie wins over header (viral body precedence retained)', async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .set('x-session-cookie', 'header-cookie-abc')
      .send({ platform: 'threads', niche: 'ai', count: 5, sessionCookie: 'body-wins' });
    expect(res.status).toBe(200);
    expect(res.body.data.job.session).toBe('body-wins');
  });
});
