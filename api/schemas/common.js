// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Canonical schema components + shared primitives — Story 46.2 (Epic 46).
 *
 * These are the single source of truth for the wire envelope. `openapi.js`
 * re-points the literal `/api/ai` section's `Error`/`SuccessResponse` refs at
 * `ApiError`/`ApiSuccess` and merges these components into
 * `components.schemas`.
 *
 * @module api/schemas/common
 */

import { z } from 'zod';
import { registry } from './registry.js';

// ── Shared primitives ────────────────────────────────────────────────────────

/** ISO 8601 datetime string. */
export const isoDateTime = z.iso.datetime();

/** Opaque pagination cursor token. */
export const opaqueCursor = z.string().describe('Opaque pagination cursor');

/** Non-empty identifier (job id, report id, username, checkpoint id, ...). */
export const nonEmptyId = z.string().min(1);

// ── Canonical envelope components ────────────────────────────────────────────

/** Error payload — `{ code, message, type?, details? }`. */
export const ErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  type: z.string().optional(),
  details: z.unknown().optional(),
});

/** `{ success: false, error: {...} }` */
export const ApiError = z.object({
  success: z.literal(false),
  error: ErrorPayload,
});

/** `{ success: true, data: T }` (T resolved per-operation). */
export const ApiSuccess = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

/** Pagination block — keep in sync with `pageInfoSchema` in registry.js. */
export const PageInfo = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int(),
  total: z.number().int().optional(),
});

/** `{ success: true, data: T[], page: {...} }` */
export const PaginatedResponse = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  page: PageInfo,
});

/**
 * x402 `402 Payment Required` payload — emitted by the @x402/express SDK,
 * NOT wrapped in the envelope. Kept as a component so the literal section's
 * `$ref`s stay valid after the merge (generated components win on name).
 */
export const PaymentRequired = z.looseObject({
  x402Version: z.number().int(),
  accepts: z.array(
    z.looseObject({
      scheme: z.string(),
      network: z.string(),
      maxAmountRequired: z.string().optional(),
      amount: z.string().optional(),
      resource: z.string().optional(),
      payTo: z.string(),
    })
  ),
});

// Register canonical components — emitted into components.schemas.
registry.register('ApiError', ApiError);
registry.register('ApiSuccess', ApiSuccess);
registry.register('PaginatedResponse', PaginatedResponse);
registry.register('PaymentRequired', PaymentRequired);
