// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Zod validation middleware — Story 46.2 (Epic 46).
 *
 * Per-route order is `authenticate → validate → handler`. Validates the request
 * parts declared in `schemas` against their Zod schemas:
 *
 *   validate({ body, query, params, headers })
 *
 * - On success the *parsed* output is written back to `req.body`/`req.query`/
 *   `req.params` (unknown keys stripped, coercions/defaults applied). Request
 *   schemas are never `.strict()` — unknown keys are dropped, not rejected.
 *   `req.headers` is validated but never rewritten (headers stay verbatim).
 * - On failure → `next(ApiError('VALIDATION_FAILED', 400, ...))` with the
 *   Zod issues in `error.details.issues`.
 *
 * An absent body is treated as `{}` so empty-body POSTs fail or pass purely on
 * schema decision.
 *
 * @module api/middleware/validate
 */

import { ApiError } from './envelope.js';

const LOCATIONS = ['body', 'query', 'params', 'headers'];

/**
 * @param {object} schemas
 * @param {import('zod').ZodType} [schemas.body]
 * @param {import('zod').ZodType} [schemas.query]
 * @param {import('zod').ZodType} [schemas.params]
 * @param {import('zod').ZodType} [schemas.headers]
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    const issues = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;

      const source = location === 'body' ? req.body ?? {} : req[location] ?? {};
      const result = schema.safeParse(source);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            location,
            path: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          });
        }
        continue;
      }

      // Write back parsed data so coercions/defaults apply and unknown keys are
      // stripped. Headers are validated only — never rewritten.
      if (location !== 'headers') {
        req[location] = result.data;
      }
    }

    if (issues.length > 0) {
      return next(
        new ApiError('VALIDATION_FAILED', 400, 'Request validation failed', { issues })
      );
    }

    return next();
  };
}
