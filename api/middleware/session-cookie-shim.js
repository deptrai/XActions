// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * sessionCookie transport shim — Story 46.2 (Epic 46, AD-6).
 *
 * The canonical session transport is the `x-session-cookie` header, but legacy
 * callers still send `sessionCookie` in the JSON body. This middleware copies
 * `req.body.sessionCookie` into `req.headers['x-session-cookie']` **only when
 * the header is absent** — it never overwrites an explicit header and never
 * deletes the body field (dual-read handlers keep their body-first precedence).
 *
 * Mount per-route next to `validate` on routes that declare the `sessionCookie`
 * security scheme. Do NOT mount on `POST /api/session/save-session` — there
 * `sessionCookie` is the payload itself, not a transport alias.
 *
 * @module api/middleware/session-cookie-shim
 */

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export function sessionCookieShim(req, _res, next) {
  const body = req.body;
  if (
    !req.headers['x-session-cookie'] &&
    body &&
    typeof body === 'object' &&
    typeof body.sessionCookie === 'string' &&
    body.sessionCookie.length > 0
  ) {
    req.headers['x-session-cookie'] = body.sessionCookie;
  }
  next();
}

export default sessionCookieShim;
