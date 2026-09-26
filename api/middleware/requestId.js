// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Request-Id propagation middleware — Story 50.3 (Epic 50, AD-5 observability).
 *
 * Mounted on `POST /api/platform/:platform/scrape` BEFORE `eitherAuth` so a
 * 401 auth failure still carries `request_id` end-to-end. Synchronous, never
 * reads the body, never touches secrets.
 *
 *   - `X-Request-Id` inbound is honored verbatim when it passes
 *     `sanitizeRequestId` (allowlist `[A-Za-z0-9_\-:.]`, ≤128 chars);
 *     hostile/absent values get a generated `req_<ts>_<rand8hex>` id.
 *   - W3C `traceparent` header is captured verbatim on `req.traceparent`.
 *   - The resolved id is echoed via the `X-Request-Id` response header and
 *     lands in `metadata.request_id` / `error.request_id` / log lines.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { generateRequestId, sanitizeRequestId } from '../services/gatewayEnvelope.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requestId(req, res, next) {
  // Express `req.get` reads a header; fall back to raw headers for bare
  // {headers} req objects (middleware unit tests, non-Express callers).
  const get = typeof req.get === 'function'
    ? (name) => req.get(name)
    : (name) => req.headers?.[name];

  req.requestId = sanitizeRequestId(get('x-request-id')) || generateRequestId();

  const traceparent = get('traceparent');
  req.traceparent = typeof traceparent === 'string' && traceparent ? traceparent : undefined;

  res.setHeader('X-Request-Id', req.requestId);
  next();
}
