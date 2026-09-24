// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Session management route handler.
 * Outside /api/* namespace to avoid conflict with backend /api/session/*.
 * Manages httpOnly cookies xa_bearer and xa_session.
 */

import {
  parseCookies,
  buildSetCookie,
  buildClearCookie,
  COOKIE_XA_BEARER,
  COOKIE_XA_SESSION,
} from '@/lib/session';
import { getApiInternalUrl } from '@/lib/config';

interface SessionPostBody {
  bearerToken?: string;
  sessionCookie?: string;
  email?: string;
  identifier?: string;
  password?: string;
}

export async function POST(req: Request) {
  let body: SessionPostBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Expected JSON body' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Body cannot be empty' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const responseHeaders = new Headers({ 'content-type': 'application/json' });

  // Scenario 1: email + password (or identifier + password) login exchange
  const identifier = body.identifier || body.email;
  if (identifier && body.password) {
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(`${getApiInternalUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password: body.password }),
      });
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'UPSTREAM_UNREACHABLE',
            message: 'Upstream login service is unreachable',
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

    const resText = await upstreamRes.text();
    if (!upstreamRes.ok) {
      return new Response(resText, {
        status: upstreamRes.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    try {
      const data = JSON.parse(resText);
      const token = data?.data?.token ?? data?.token;
      if (token) {
        responseHeaders.append('set-cookie', buildSetCookie(COOKIE_XA_BEARER, token));
      }
      return new Response(
        JSON.stringify({ success: true, data: { hasBearer: Boolean(token) } }),
        { status: 200, headers: responseHeaders }
      );
    } catch {
      return new Response(resText, {
        status: upstreamRes.status,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Scenario 2: explicit bearerToken / sessionCookie setting
  let cookiesSet = false;
  if (body.bearerToken) {
    responseHeaders.append('set-cookie', buildSetCookie(COOKIE_XA_BEARER, body.bearerToken));
    cookiesSet = true;
  }
  if (body.sessionCookie) {
    responseHeaders.append('set-cookie', buildSetCookie(COOKIE_XA_SESSION, body.sessionCookie));
    cookiesSet = true;
  }

  if (!cookiesSet) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'INVALID_BODY', message: 'No valid credentials provided' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: responseHeaders }
  );
}

export async function GET(req: Request) {
  const cookies = parseCookies(req);
  return new Response(
    JSON.stringify({
      hasBearer: Boolean(cookies[COOKIE_XA_BEARER]),
      hasSession: Boolean(cookies[COOKIE_XA_SESSION]),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

export async function DELETE() {
  const responseHeaders = new Headers({ 'content-type': 'application/json' });
  responseHeaders.append('set-cookie', buildClearCookie(COOKIE_XA_BEARER));
  responseHeaders.append('set-cookie', buildClearCookie(COOKIE_XA_SESSION));

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: responseHeaders }
  );
}
