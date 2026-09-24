// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.2 — Auth & Session UI (/login) and Header Auth Tests.
 *
 * Verifies that:
 *   - apps/web/app/login/page.tsx exists and is a client component
 *   - login form contains email, password, error display, and submit button
 *   - login page uses typed api() helper (zero raw fetch to localhost:3001)
 *   - POST /session authenticates credentials and sets httpOnly cookies
 *   - Header component displays Connected / Disconnected badge and Logout button
 *   - Header handles DELETE /session to clear cookies
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { POST, GET, DELETE } from '../../apps/web/app/session/route.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const loginPagePath = resolve(rootDir, 'apps', 'web', 'app', 'login', 'page.tsx');
const headerPath = resolve(rootDir, 'apps', 'web', 'components', 'header.tsx');

describe('Story 48.2 — Login Page & Form Specification', () => {
  it('apps/web/app/login/page.tsx exists as a client component', () => {
    expect(existsSync(loginPagePath)).toBe(true);
    const src = readFileSync(loginPagePath, 'utf8');
    expect(src).toMatch(/['"]use client['"]/);
    expect(src).toContain('export default function LoginPage');
  });

  it('login page uses typed api() helper and no raw fetch to backend', () => {
    const src = readFileSync(loginPagePath, 'utf8');
    expect(src).toContain("import { api } from '@/lib/api'");
    expect(src).toContain("'POST', '/session'");
    expect(src).toContain('/session');
    expect(src).not.toContain('localhost:3001');
  });

  it('login page defines email and password inputs with validation and error display', () => {
    const src = readFileSync(loginPagePath, 'utf8');
    expect(src).toContain('id="email"');
    expect(src).toContain('id="password"');
    expect(src).toContain('type="password"');
    expect(src).toContain('role="alert"');
    expect(src).toContain('handleSubmit');
    expect(src).toContain('Signing in...');
  });

  it('login page enforces zero credentials stored in localStorage and mentions httpOnly session', () => {
    const src = readFileSync(loginPagePath, 'utf8');
    expect(src).not.toContain('localStorage.setItem("token"');
    expect(src).not.toContain('localStorage.setItem("bearer"');
    expect(src).toContain('httpOnly');
  });
});

describe('Story 48.2 — Session Login Flow (POST /session)', () => {
  let mockServer;
  let mockServerUrl;

  beforeAll(async () => {
    // Ephemeral real upstream backend (NFR-20 zero mocks)
    mockServer = http.createServer((req, res) => {
      if (req.url === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const payload = JSON.parse(body || '{}');
          if (payload.identifier === 'operator@xactions.app' && payload.password === 'correct-secret-123') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                data: {
                  token: 'jwt.token.operator-valid-789',
                  user: { id: 'u-operator-1', email: 'operator@xactions.app' },
                },
              })
            );
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid operator credentials' },
              })
            );
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

  it('happy path: POST /session with email and password sets xa_bearer cookie and returns success', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'operator@xactions.app',
        password: 'correct-secret-123',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('xa_bearer=jwt.token.operator-valid-789');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.hasBearer).toBe(true);
  });

  it('error path: POST /session with wrong password forwards 401 error message', async () => {
    const req = new Request('http://localhost:3000/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'operator@xactions.app',
        password: 'wrong-password',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INVALID_CREDENTIALS');
    expect(json.error.message).toBe('Invalid operator credentials');
  });
});

describe('Story 48.2 — Header Auth State Badge & Logout Spec', () => {
  it('header component contains Connected and Disconnected badge render logic', () => {
    const src = readFileSync(headerPath, 'utf8');
    expect(src).toContain('Connected');
    expect(src).toContain('Disconnected');
    expect(src).toContain('hasBearer');
    expect(src).toContain('hasSession');
    expect(src).toContain('/session');
    expect(src).toContain('handleLogout');
    expect(src).toContain('Logout');
  });

  it('GET /session returns auth flags for header consumption', async () => {
    const authedReq = new Request('http://localhost:3000/session', {
      method: 'GET',
      headers: {
        cookie: 'xa_bearer=valid.jwt.token',
      },
    });

    const res = await GET(authedReq);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ hasBearer: true, hasSession: false });
  });

  it('DELETE /session clears auth cookies for logout action', async () => {
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
