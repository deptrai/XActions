// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Canonical HTTP response envelope — Story 46.2 (Epic 46, AD-2/AD-3/AD-5).
 *
 * This module is the SOLE owner of the wire envelope:
 *
 *   success    → { success: true,  data: T }
 *   pagination → { success: true,  data: T[], page: { cursor, limit, total? } }
 *   error      → { success: false, error: { code, message, type?, details? } }
 *
 * It deliberately does NOT wrap `res.json` — `res.sendData`/`res.sendPage` are
 * opt-in helpers so that x402 SDK bodies, /api/ai helpers, streaming responses,
 * and `brandingMiddleware` (which overrides res.send) keep their own shapes.
 *
 * Error serialization lives in `errorMiddleware`/`notFoundHandler` and emits
 * directly (never through res.sendData) so it also works when a request dies
 * before `envelopeMiddleware` ran — e.g. body-parser failures.
 *
 * @module api/middleware/envelope
 */

import { PlatformError } from '../../src/core/error-envelope.js';

/**
 * Non-domain API error. Carries the canonical taxonomy code, HTTP status,
 * human message, and optional free-form details bag.
 */
export class ApiError extends Error {
  /**
   * @param {string} code      canonical error code (VALIDATION_FAILED, UNAUTHORIZED, ...)
   * @param {number} statusCode HTTP status
   * @param {string} [message] human-readable message
   * @param {unknown} [details] arbitrary detail bag (zod issues, auth extras, ...)
   */
  constructor(code, statusCode, message, details) {
    super(message ?? code);
    this.name = 'ApiError';
    this.isApiError = true;
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Express 4 does not forward async handler rejections — wrap pilot handlers so
 * throws reach the error middleware.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} fn
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Installs the opt-in envelope helpers on `res`. Mount before body parsers so
 * the helpers exist even when a later middleware throws.
 *
 * - `res.sendData(value, statusCode?)` → `{ success: true, data: value }`
 * - `res.sendPage(items, {cursor, limit, total?})` → canonical paginated shape
 */
export function envelopeMiddleware(_req, res, next) {
  res.sendData = (data, statusCode = 200) =>
    res.status(statusCode).json({ success: true, data });

  res.sendPage = (items, page = {}) =>
    res.json({
      success: true,
      data: items,
      page: {
        cursor: page.cursor ?? null,
        limit: page.limit ?? (Array.isArray(items) ? items.length : 0),
        ...(page.total !== undefined ? { total: page.total } : {}),
      },
    });

  next();
}

/**
 * Serialize one canonical error envelope. Used by the error middleware and the
 * 404 handler — emits directly so it never depends on helper availability.
 */
export function sendErrorEnvelope(res, { status, code, message, type, details }) {
  if (res.headersSent) return;
  const error = { code, message };
  if (type) error.type = type;
  if (details !== undefined) error.details = details;
  res.status(status).json({ success: false, error });
}

// Body-parser (`body-parser`/Express) error type → canonical taxonomy mapping.
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Malformed JSON body' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request payload too large' },
  'charset.unsupported': { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported charset' },
  'encoding.unsupported': { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content encoding' },
  'entity.verify.failed': { status: 400, code: 'VALIDATION_FAILED', message: 'Request body verification failed' },
};

/**
 * Final error middleware — emits the canonical error envelope for every error
 * that reaches it:
 *
 * - `PlatformError` (domain) → code/type/message from the error, `details` =
 *   `toEnvelope()` verbatim (no allowlist — additive domain fields survive),
 *   status from `statusCode`.
 * - `ApiError` → code/status/message/details as constructed.
 * - body-parser `entity.*` errors → INVALID_JSON / PAYLOAD_TOO_LARGE / etc.
 * - anything else → INTERNAL 500 (message scrubbed in production).
 */
export function errorMiddleware(err, req, res, next) {
  void req;
  if (res.headersSent) return next(err);

  if (err instanceof PlatformError) {
    return sendErrorEnvelope(res, {
      status: err.statusCode ?? 500,
      code: err.code,
      type: err.type,
      message: err.message,
      details: err.toEnvelope(),
    });
  }

  if (err instanceof ApiError) {
    const status =
      Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    return sendErrorEnvelope(res, {
      status,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  const parserHit = typeof err?.type === 'string' ? BODY_PARSER_ERRORS[err.type] : undefined;
  if (parserHit) return sendErrorEnvelope(res, parserHit);
  if (typeof err?.type === 'string' && err.type.startsWith('entity.')) {
    return sendErrorEnvelope(res, { status: 400, code: 'VALIDATION_FAILED', message: 'Invalid request body' });
  }

  console.error('❌ Unhandled error:', err?.message ?? err);
  if (process.env.NODE_ENV !== 'production' && err?.stack) {
    console.error(err.stack);
  }

  const status = Number(err?.statusCode ?? err?.status ?? 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  return sendErrorEnvelope(res, {
    status: safeStatus,
    code: typeof err?.code === 'string' ? err.code : 'INTERNAL',
    message:
      safeStatus >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err?.message || 'Internal server error',
  });
}

/**
 * 404 handler — canonical NOT_FOUND envelope for unmatched routes.
 */
export function notFoundHandler(req, res) {
  sendErrorEnvelope(res, {
    status: 404,
    code: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl ?? req.path}`,
  });
}

/**
 * express-rate-limit `handler` option — converts every limiter trip into the
 * canonical RATE_LIMITED envelope via the error middleware. Reuses the
 * configured `message` (string or `{error}` object) as the human message.
 */
export function rateLimitedHandler(req, res, next, options = {}) {
  const configured = options.message;
  const message =
    typeof configured === 'string'
      ? configured
      : typeof configured?.error === 'string'
        ? configured.error
        : 'Too many requests, please try again later';
  next(
    new ApiError('RATE_LIMITED', options.statusCode ?? 429, message, {
      limit: options.limit,
      windowMs: options.windowMs,
    })
  );
}
