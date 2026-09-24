// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * @xactions/api-client — typed client for the XActions API (Story 46.3).
 *
 * Re-exports the client class, ApiResult union, type guards, error payload types,
 * and the generated `paths`/`components`/`operations` types from schema.d.ts.
 */

export { XActionsClient, isPaymentRequired } from './client.js';
export type {
  XActionsClientOptions,
  ApiResult,
  ApiSuccess,
  ApiPaymentRequired,
  ApiFailure,
  ApiErrorPayload,
  PaymentRequiredPayload,
} from './client.js';
export type { paths, components, operations } from './schema.js';
