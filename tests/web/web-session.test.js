// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Unit & Integration tests for Session Route and Session Library.
 * Tests cookie parsing, serialization, and session route handler operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  parseCookies,
  sessionHeaders,
  buildSetCookie,
  buildClearCookie,
  COOKIE_XA_BEARER,
  COOKIE_XA_SESSION,
} from '../../apps/web/lib/session.js';
import { POST, GET, DELETE } from '../../apps/web/app/session/route.js';

describe('Web Session Library (lib/session.ts)', () => {
  it('parses cookies from Request and string headers', () => {
    const cookieStr = 'xa_bearer=token123; xa_session=sess456; other=val';
    const parsed = parseCookies(cookieStr);
    expect(parsed.xa_bearer).toBe('token123');
    expect(parsed.xa_session).toBe('sess456');
    expect(parsed.other).toBe('val');

    const req = new Request('http://localhost:3000/api', {
      headers: { cookie: cookieStr },
    });
    const parsedFromReq = parseCookies(req);
    expect(parsedFromReq).toEqual(parsed);

    expect(parseCookies(null)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('maps session cookies to upstream auth headers', () => {
    const cookies = {
      [COOKIE_XA_BEARER]: 'bearer_token_abc',
      [COOKIE_XA_SESSION]: 'session_cookie_xyz',
    };
    const headers = sessionHeaders(cookies);
    expect(headers['authorization']).toBe('Bearer bearer_token_abc');
    expect(headers['x-session-cookie']).toBe('session_cookie_xyz');
  });

  it('builds secure Set-Cookie and clear cookie strings', () => {
    const setCookie = buildSetCookie(COOKIE_XA_BEARER, 'jwt.token.val', {
      sameSite: 'lax',
    });
    expect(setCookie).toContain('xa_bearer=jwt.token.val');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const clearCookie = buildClearCookie(COOKIE_XA_SESSION);
    expect(clearCookie).toContain('xa_session=');
    expect(clearCookie).toContain('Max-Age=0');
  });
});

describe('Web Session Route Handler (app/session/route.ts)', () => {
  let mockServer;
  let mockServerUrl;

  beforeAll(async () => {
    // Ephemeral upstream for login scenario testing
    mockServer = http.createServer((req, res) => {
      if (req.url === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const payload = JSON.parse(body || '{}');
          if (payload.identifier === 'user@example.com' && payload.password === 'valid123') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              data: {
                token: 'mock-jwt-token-777',
                user: { id: 'u1', email: 'user@example.com' },
              },
            }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
            }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address();
        mockServerUrl = `http://127.0.0.1:${addr.port}`;
        process.env.API_INTERNAL_URL = mockServerUrl;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => mockServer.close(resolve));
  });

  it('POST /session sets cookies from explicit tokens', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bearerToken: 'my_bearer_token',
        sessionCookie: 'my_session_cookie',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('xa_bearer=my_bearer_token');
    expect(setCookie).toContain('xa_session=my_session_cookie');

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('POST /session handles empty or invalid body with 400', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('POST /session exchanges email/password with backend and sets xa_bearer', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'valid123',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('xa_bearer=mock-jwt-token-777');

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.hasBearer).toBe(true);
  });

  it('POST /session forwards 401 when backend login fails', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'wrong_password',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /session returns hasBearer and hasSession flags', async () => {
    const reqWithCookies = new Request('http://localhost:3000/session', {
      method: 'GET',
      headers: {
        cookie: 'xa_bearer=token123; xa_session=session456',
      },
    });

    const res1 = await GET(reqWithCookies);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1).toEqual({ hasBearer: true, hasSession: true });

    const reqEmpty = new Request('http://localhost:3000/session', {
      method: 'GET',
    });
    const res2 = await GET(reqEmpty);
    const data2 = await res2.json();
    expect(data2).toEqual({ hasBearer: false, hasSession: false });
  });

  it('DELETE /session clears both auth cookies', async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('xa_bearer=;');
    expect(setCookie).toContain('xa_session=;');
    expect(setCookie).toContain('Max-Age=0');

    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
