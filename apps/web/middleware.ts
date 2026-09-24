// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Cookie-guard middleware for Next.js 15 App Router.
 * Guards protected application routes by verifying the presence of httpOnly
 * authentication cookies (xa_bearer or xa_session).
 * Redirects unauthenticated visitors to /login.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseCookies, COOKIE_XA_BEARER, COOKIE_XA_SESSION } from './lib/session';

/**
 * Determines whether a request pathname is public (unprotected).
 * Public routes: /login, /session, /api/*, /api-docs/*, /_next/*, /favicon.ico, static assets.
 */
export function isPublicPath(pathname: string): boolean {
  if (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/session' ||
    pathname.startsWith('/session/') ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/api-docs' ||
    pathname.startsWith('/api-docs/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname.includes('.')
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if cookies contain valid authentication tokens.
 * Cookie presence != validity (backend will return real 401 on expired tokens).
 */
export function hasAuthCookies(cookies: Record<string, string>): boolean {
  const bearer = cookies[COOKIE_XA_BEARER];
  const session = cookies[COOKIE_XA_SESSION];
  return Boolean((bearer && bearer.trim() !== '') || (session && session.trim() !== ''));
}

/**
 * Next.js Middleware handler.
 */
export function middleware(req: NextRequest | Request) {
  // Support both NextRequest (nextUrl) and standard Web API Request (url)
  const pathname = 'nextUrl' in req && req.nextUrl ? req.nextUrl.pathname : new URL(req.url).pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookies = parseCookies(req);
  const isAuthenticated = hasAuthCookies(cookies);

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
