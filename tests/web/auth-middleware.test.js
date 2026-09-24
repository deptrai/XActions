// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.2 — Auth Cookie-Guard Middleware Tests.
 *
 * Verifies that:
 *   - apps/web/middleware.ts exists and exports middleware and route matcher config
 *   - Public routes (/login, /session, /api/*, /_next/*, /favicon.ico) pass through without redirect
 *   - Protected routes (/admin, /crm, /viral-miner, /optimizer, /explorer, /) without cookies redirect to /login
 *   - Protected routes with xa_bearer or xa_session cookies pass through
 *   - Empty / whitespace cookies are rejected and redirected to /login
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicPath, hasAuthCookies, middleware, config } from '../../apps/web/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const middlewarePath = resolve(rootDir, 'apps', 'web', 'middleware.ts');

describe('Story 48.2 — Middleware File & Configuration', () => {
  it('apps/web/middleware.ts exists', () => {
    expect(existsSync(middlewarePath)).toBe(true);
  });

  it('middleware config defines matcher excluding static assets', () => {
    expect(config).toBeDefined();
    expect(config.matcher).toBeInstanceOf(Array);
    const src = readFileSync(middlewarePath, 'utf8');
    expect(src).toContain('_next/static');
    expect(src).toContain('favicon.ico');
  });
});

describe('Story 48.2 — Public Path Classification', () => {
  it('correctly identifies public paths that bypass auth checks', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/login/')).toBe(true);
    expect(isPublicPath('/session')).toBe(true);
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/auth/login')).toBe(true);
    expect(isPublicPath('/api-docs')).toBe(true);
    expect(isPublicPath('/api-docs/swagger.json')).toBe(true);
    expect(isPublicPath('/_next/static/chunks/main.js')).toBe(true);
    expect(isPublicPath('/favicon.ico')).toBe(true);
    expect(isPublicPath('/logo.svg')).toBe(true);
  });

  it('correctly identifies protected paths that require auth cookies', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/admin')).toBe(false);
    expect(isPublicPath('/crm')).toBe(false);
    expect(isPublicPath('/viral-miner')).toBe(false);
    expect(isPublicPath('/optimizer')).toBe(false);
    expect(isPublicPath('/explorer')).toBe(false);
  });
});

describe('Story 48.2 — Auth Cookie Validation Helper', () => {
  it('returns true when xa_bearer is present', () => {
    expect(hasAuthCookies({ xa_bearer: 'jwt-token-123' })).toBe(true);
  });

  it('returns true when xa_session is present', () => {
    expect(hasAuthCookies({ xa_session: 'session-cookie-xyz' })).toBe(true);
  });

  it('returns true when both cookies are present', () => {
    expect(hasAuthCookies({ xa_bearer: 'jwt-123', xa_session: 'sess-456' })).toBe(true);
  });

  it('returns false when no auth cookies are present', () => {
    expect(hasAuthCookies({})).toBe(false);
    expect(hasAuthCookies({ other_cookie: 'abc' })).toBe(false);
  });

  it('returns false when auth cookies contain only empty string or whitespace', () => {
    expect(hasAuthCookies({ xa_bearer: '' })).toBe(false);
    expect(hasAuthCookies({ xa_bearer: '   ' })).toBe(false);
    expect(hasAuthCookies({ xa_session: '' })).toBe(false);
  });
});

describe('Story 48.2 — Middleware Execution Behavior', () => {
  it('allows public route /login through without cookies', () => {
    const req = new Request('http://localhost:3000/login');
    const res = middleware(req);
    expect(res.status).toBe(200);
    // Not a redirect
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows public route /session through without cookies', () => {
    const req = new Request('http://localhost:3000/session');
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated request to /admin to /login', () => {
    const req = new Request('http://localhost:3000/admin');
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost:3000/login');
  });

  it('redirects unauthenticated request to root / to /login', () => {
    const req = new Request('http://localhost:3000/');
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost:3000/login');
  });

  it('allows protected request to /admin when xa_bearer cookie is present', () => {
    const req = new Request('http://localhost:3000/admin', {
      headers: {
        cookie: 'xa_bearer=valid-jwt-token-operator',
      },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows protected request to /admin when xa_session cookie is present', () => {
    const req = new Request('http://localhost:3000/admin', {
      headers: {
        cookie: 'xa_session=valid-session-cookie-operator',
      },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
