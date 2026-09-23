// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * OpenAPI registry — Story 46.2 (Epic 46, spine contract pipeline).
 *
 * Single `OpenAPIRegistry` instance shared by every schema module. Domain
 * schema files declare their operations via `registerPath({...})`; the barrel
 * (`api/schemas/index.js`) evaluates them for side effects and exposes
 * `buildGeneratedDocument()`, which `api/openapi.js` merges with the literal
 * `/api/ai` section through the normalization pass.
 *
 * @module api/schemas/registry
 */

import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

/**
 * Deterministic operationId fallback: `{method}_{sanitized path}`.
 * `/api/viral/mine/{jobId}` + get → `get_api_viral_mine_jobId`.
 * @param {string} method
 * @param {string} path
 */
export function deriveOperationId(method, path) {
  const sanitized = String(path)
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${String(method).toLowerCase()}_${sanitized}`;
}

const API_ERROR_REF = { $ref: '#/components/schemas/ApiError' };

function apiErrorResponse(description) {
  return {
    description,
    content: { 'application/json': { schema: API_ERROR_REF } },
  };
}

const ERROR_DESCRIPTIONS = {
  400: 'Validation failed',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  413: 'Payload too large',
  415: 'Unsupported media type',
  429: 'Rate limited',
  500: 'Internal server error',
  503: 'Service unavailable',
};

// Canonical pagination block — keep in sync with `PageInfo` in common.js.
const pageInfoSchema = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int(),
  total: z.number().int().optional(),
});

/**
 * Register one pilot operation. Generated ops always emit their own `security`
 * (the global `[{x402Payment}]` security governs only the literal /api/ai ops).
 *
 * @param {object} opts
 * @param {string} opts.method   http method (lowercase)
 * @param {string} opts.path     OpenAPI path (`/api/...`, `{param}` style)
 * @param {string} [opts.operationId]  explicit id; falls back to deriveOperationId
 * @param {string} [opts.summary]
 * @param {string} [opts.description]
 * @param {string[]} [opts.tags]
 * @param {object} opts.schemas  { body?, query?, params?, headers?, response? }
 *   `response` is the payload schema T — the canonical envelope is wrapped by
 *   the builder (`{success:true,data:T}`, or `data:T[]`+`page` when paginated).
 * @param {boolean} [opts.paginated]   wrap `response` as PaginatedResponse<T>
 * @param {number} [opts.statusCode]   success status (default 200)
 * @param {number[]} [opts.errors]     error statuses to document (default [400,500])
 * @param {Array<Record<string, string[]>>} opts.security  per-op security, always emitted
 * @param {boolean} [opts.xTryItOut]   TryIt console extension
 * @param {Record<string, unknown>} [opts.xPaymentInfo]  x402 payment metadata
 * @param {Record<string, unknown>} [opts.xBazaar]       x-bazaar discovery metadata
 */
export function registerPath({
  method,
  path,
  operationId,
  summary,
  description,
  tags = [],
  schemas = {},
  paginated = false,
  statusCode = 200,
  errors = [400, 500],
  security = [{}],
  xTryItOut,
  xPaymentInfo,
  xBazaar,
}) {
  const request = {};
  if (schemas.body) {
    request.body = {
      required: true,
      content: { 'application/json': { schema: schemas.body } },
    };
  }
  if (schemas.params) request.params = schemas.params;
  if (schemas.query) request.query = schemas.query;
  if (schemas.headers) request.headers = schemas.headers;

  const responses = {};
  if (schemas.response) {
    const successSchema = paginated
      ? z.object({
          success: z.literal(true),
          data: z.array(schemas.response),
          page: pageInfoSchema,
        })
      : z.object({ success: z.literal(true), data: schemas.response });
    responses[String(statusCode)] = {
      description: summary ?? description ?? 'Success',
      content: { 'application/json': { schema: successSchema } },
    };
  } else {
    responses[String(statusCode)] = { description: summary ?? description ?? 'Success' };
  }

  for (const code of errors) {
    responses[String(code)] = apiErrorResponse(ERROR_DESCRIPTIONS[code] ?? 'Error');
  }

  registry.registerPath({
    method,
    path,
    operationId: operationId ?? deriveOperationId(method, path),
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(tags.length ? { tags } : {}),
    request,
    responses,
    security,
    ...(xTryItOut !== undefined ? { 'x-tryitout': xTryItOut } : {}),
    ...(xPaymentInfo ? { 'x-payment-info': xPaymentInfo } : {}),
    ...(xBazaar ? { 'x-bazaar': xBazaar } : {}),
  });
}

/**
 * Generate the registry-driven document fragment (paths + components.schemas)
 * that `api/openapi.js` merges into the literal spec.
 */
export function buildGeneratedDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'XActions API', version: '2.0.0' },
  });
}
