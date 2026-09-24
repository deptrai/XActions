// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Framework-free session & cookie transport utilities.
 * Handles parsing, serialization, and auth header mapping for the BFF layer.
 */

export const COOKIE_XA_BEARER = 'xa_bearer';
export const COOKIE_XA_SESSION = 'xa_session';

export interface CookieOptions {
  path?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
  maxAge?: number;
  expires?: Date;
}

/**
 * Parses cookies from a Request instance, a Cookie header string, or null/undefined.
 */
export function parseCookies(req: Request | string | null | undefined): Record<string, string> {
  const cookieHeader = typeof req === 'string'
    ? req
    : req && typeof req === 'object' && 'headers' in req
      ? req.headers.get('cookie') || ''
      : '';

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  const result: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }

  return result;
}

/**
 * Maps session cookies to upstream authentication headers.
 * xa_bearer -> Authorization: Bearer <token>
 * xa_session -> x-session-cookie: <cookie>
 */
export function sessionHeaders(cookies: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};

  if (cookies[COOKIE_XA_BEARER]) {
    headers['authorization'] = `Bearer ${cookies[COOKIE_XA_BEARER]}`;
  }

  if (cookies[COOKIE_XA_SESSION]) {
    headers['x-session-cookie'] = cookies[COOKIE_XA_SESSION];
  }

  return headers;
}

/**
 * Builds a Set-Cookie header value with secure defaults.
 * Default: HttpOnly, SameSite=Lax, Path=/, Secure in production.
 */
export function buildSetCookie(
  name: string,
  value: string,
  opts: CookieOptions = {}
): string {
  const encodedVal = encodeURIComponent(value);
  const parts: string[] = [`${name}=${encodedVal}`];

  const path = opts.path ?? '/';
  parts.push(`Path=${path}`);

  if (opts.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  const sameSite = opts.sameSite ?? 'lax';
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase()}`);

  const isProd = process.env.NODE_ENV === 'production';
  const secure = opts.secure ?? isProd;
  if (secure) {
    parts.push('Secure');
  }

  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${opts.maxAge}`);
  } else if (opts.expires) {
    parts.push(`Expires=${opts.expires.toUTCString()}`);
  }

  return parts.join('; ');
}

/**
 * Builds a Set-Cookie header string that immediately clears/expires the given cookie.
 */
export function buildClearCookie(
  name: string,
  opts: Omit<CookieOptions, 'maxAge' | 'expires'> = {}
): string {
  return buildSetCookie(name, '', {
    ...opts,
    maxAge: 0,
    expires: new Date(0),
  });
}
