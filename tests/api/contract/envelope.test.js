// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — canonical envelope contract tests.
 *
 * Covers the middleware-originated error paths that must emit
 * `{ success:false, error:{code,message,...} }`: malformed JSON (INVALID_JSON),
 * unknown routes (NOT_FOUND), rate limiting (RATE_LIMITED via the shared
 * handler), and PlatformError/ApiError serialization.
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import app from '../../../api/server.js';
import {
  ApiError,
  envelopeMiddleware,
  errorMiddleware,
  notFoundHandler,
  rateLimitedHandler,
} from '../../../api/middleware/envelope.js';
import { PlatformError, ErrorTypes } from '../../../src/core/error-envelope.js';

describe('Story 46.2 — canonical error envelope (app-level)', () => {
  it('unknown API route → 404 NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/definitely-not-a-route-46-2');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) });
  });

  it('malformed JSON body → 400 INVALID_JSON envelope', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{not valid json');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('Story 46.2 — envelope helpers (unit)', () => {
  function makeRes() {
    const res = {
      statusCode: 0,
      body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return res;
  }

  it('envelopeMiddleware installs sendData/sendPage with canonical shapes', () => {
    const res = makeRes();
    let nexted = false;
    envelopeMiddleware({}, res, () => { nexted = true; });
    expect(nexted).toBe(true);

    res.sendData({ a: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { a: 1 } });

    res.sendData({ created: true }, 201);
    expect(res.statusCode).toBe(201);

    res.sendPage([1, 2], { cursor: 'abc', limit: 50, total: 100 });
    expect(res.body).toEqual({
      success: true,
      data: [1, 2],
      page: { cursor: 'abc', limit: 50, total: 100 },
    });
  });

  it('sendPage emits cursor:null and omits total when not provided', () => {
    const res = makeRes();
    envelopeMiddleware({}, res, () => {});
    res.sendPage([], { limit: 25 });
    expect(res.body.page).toEqual({ cursor: null, limit: 25 });
    expect('total' in res.body.page).toBe(false);
  });

  it('errorMiddleware serializes ApiError canonically', () => {
    const res = makeRes();
    errorMiddleware(new ApiError('VALIDATION_FAILED', 400, 'bad input', { issues: [{ path: 'x' }] }), {}, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'bad input', details: { issues: [{ path: 'x' }] } },
    });
  });

  it('errorMiddleware serializes PlatformError with toEnvelope() as details verbatim', () => {
    const err = new PlatformError({
      code: 'XACT_4041',
      message: 'Checkpoint not found',
      statusCode: 404,
      type: ErrorTypes.NOT_FOUND,
      platform: 'twitter',
      details: { checkpointId: 'ck_1' },
    });
    const res = makeRes();
    errorMiddleware(err, {}, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4041');
    expect(res.body.error.type).toBe('not_found');
    // details = toEnvelope() verbatim — domain fields survive unfiltered
    expect(res.body.error.details).toEqual(err.toEnvelope());
  });

  it('errorMiddleware emits INTERNAL 500 for unknown errors', () => {
    const res = makeRes();
    errorMiddleware(new Error('boom'), {}, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('rateLimitedHandler forwards a RATE_LIMITED ApiError (429)', () => {
    let captured;
    const res = makeRes();
    rateLimitedHandler({}, res, (err) => { captured = err; }, {
      statusCode: 429,
      message: { error: 'Too many attempts, please try again later' },
      limit: 10,
      windowMs: 900000,
    });
    expect(captured?.isApiError).toBe(true);
    expect(captured.code).toBe('RATE_LIMITED');
    expect(captured.statusCode).toBe(429);
    expect(captured.message).toBe('Too many attempts, please try again later');
    expect(captured.details).toMatchObject({ limit: 10 });
  });

  it('rateLimitedHandler emits canonical envelope end-to-end', () => {
    const mini = express();
    mini.use(envelopeMiddleware);
    const limiterStub = (req, res, next) =>
      rateLimitedHandler(req, res, next, { statusCode: 429, message: 'limited' });
    mini.get('/limited', limiterStub);
    mini.use(notFoundHandler);
    mini.use(errorMiddleware);
    return request(mini).get('/limited').then((res) => {
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  it('notFoundHandler emits canonical NOT_FOUND', () => {
    const res = makeRes();
    notFoundHandler({ method: 'GET', originalUrl: '/api/nope', path: '/api/nope' }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/nope' },
    });
  });
});
