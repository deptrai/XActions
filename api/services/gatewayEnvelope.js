// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Gateway envelope — Story 50.3 (Epic 50 — Public Scrape Gateway, AD-5/C-10).
 *
 * SOLE OWNER of the unified response contract for
 * `POST /api/platform/:platform/scrape`:
 *
 *   success → { success:true, ok:true, mode, metadata{request_id, platform|
 *               platforms, action, consumer_id, duration_ms, sync_capable?,
 *               dry_run, traceparent?}, stream{enabled, name?, cursor?},
 *               preview[≤10 verbatim slice of data], data[], ...lane extras }
 *
 *   error   → { success:false, error:{code, kind, type?, message, status,
 *               request_id, retryable, retry_after_ms?} }
 *
 * `preview` is ALWAYS `data.slice(0, 10)` verbatim — never a derived summary
 * (AD-5); summaries/stats belong in `metadata`. `data` is array-always
 * (`normalizeData`). `ok:true` + `result` are deprecated mirrors for the
 * in-repo `apps/web` consumer (removal is a separate cleanup story).
 *
 * `error.kind` is the CLOSED enum `ERROR_KINDS` (C-10) — consumers pick a
 * retry strategy off `kind`, never parse `message`. `retryable:true`
 * REQUIRES `retry_after_ms`. Untyped `Error`s from the scrape lane map to
 * `kind:'upstream_error'` (an upstream failure, not our bug).
 *
 * This module must stay dependency-light — `api/middleware/envelope.js`
 * imports it, so importing route/service modules here would create cycles.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import crypto from 'node:crypto';
import { isEnvTruthy, defaultRedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';
import { isRetryableType } from '../../src/core/error-envelope.js';

// ── Contract constants ────────────────────────────────────────────────────────

/**
 * Closed `error.kind` enum (C-10). Consumers choose retry strategy off this
 * field only — `consumer_quota` is reserved for Story 50.4 (no code path
 * emits it yet).
 */
export const ERROR_KINDS = Object.freeze([
  'auth',
  'validation',
  'consumer_quota',
  'upstream_rate_limit',
  'proxy_ip_block',
  'upstream_error',
  'internal',
]);

/**
 * Default `retry_after_ms` hint when a retryable error carries none.
 * Re-exported by scrapeDispatch.js (its original home) — single definition
 * lives HERE because api/middleware/envelope.js needs it and importing
 * scrapeDispatch from a middleware would create an import cycle.
 */
export const RETRY_AFTER_DEFAULT_MS = 2000;

/** Bound on the best-effort stream-cursor read — a Redis stall must never hold the response. */
export const STREAM_CURSOR_BUDGET_MS = 300;

// ── Request-id ────────────────────────────────────────────────────────────────

const REQUEST_ID_MAX_LEN = 128;
const REQUEST_ID_RE = /^[A-Za-z0-9_\-:.]+$/;

/**
 * Honor an inbound `X-Request-Id` verbatim only when it is a safe token —
 * allowlist `[A-Za-z0-9_\-:.]`, ≤128 chars. Anything else (newlines,
 * oversized, non-string) → null so the caller generates a fresh id
 * (EDGE_BAD_REQID — a hostile header is never echoed).
 *
 * @param {unknown} v
 * @returns {string | null}
 */
export function sanitizeRequestId(v) {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > REQUEST_ID_MAX_LEN) return null;
  return REQUEST_ID_RE.test(v) ? v : null;
}

/**
 * Generate a gateway request id: `req_<epochMs>_<8 hex>` — matches
 * `/^req_\d+_[0-9a-f]{8}$/` (HAPPY_REQID_GEN).
 * @returns {string}
 */
export function generateRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// ── Data normalization ────────────────────────────────────────────────────────

/**
 * `data` is array-always (C-10 contract): arrays pass through verbatim,
 * null/undefined → `[]`, a singleton result wraps as `[result]`.
 * @param {unknown} result
 * @returns {unknown[]}
 */
export function normalizeData(result) {
  if (Array.isArray(result)) return result;
  if (result === null || result === undefined) return [];
  return [result];
}

// ── Metadata block ────────────────────────────────────────────────────────────

/**
 * Build the `metadata` block — snake_case fields, absent inputs omitted.
 * Single dispatch passes `platform`; batch passes `platforms` instead (never
 * both). `sync_capable` is single-dispatch only — batch top-level omits it
 * (per-entry `status` carries the truth).
 *
 * @param {{ requestId?: string, traceparent?: string, platform?: string, platforms?: string[], action?: string, consumerId?: string, durationMs?: number, syncCapable?: boolean, dryRun?: boolean }} args
 * @returns {Record<string, unknown>}
 */
export function buildMetadata({ requestId, traceparent, platform, platforms, action, consumerId, durationMs, syncCapable, dryRun } = {}) {
  /** @type {Record<string, unknown>} */
  const metadata = {};
  if (requestId) metadata.request_id = requestId;
  if (platform) metadata.platform = platform;
  if (Array.isArray(platforms)) metadata.platforms = platforms;
  if (action) metadata.action = action;
  if (consumerId) metadata.consumer_id = consumerId;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
    metadata.duration_ms = Math.max(0, Math.round(durationMs));
  }
  if (typeof syncCapable === 'boolean') metadata.sync_capable = syncCapable;
  if (typeof dryRun === 'boolean') metadata.dry_run = dryRun;
  if (typeof traceparent === 'string' && traceparent) metadata.traceparent = traceparent;
  return metadata;
}

// ── Stream block ──────────────────────────────────────────────────────────────

/** @type {null | { streamKey?: string, xinfo?: Function, ensureClient?: Function }} */
let _streamPublisher = null;

/**
 * Test seam — swap the Redis stream publisher (injected seam, no vi.mock).
 * @param {{ streamKey?: string, xinfo?: Function, ensureClient?: Function } | null} pub
 */
export function _setStreamPublisher(pub) {
  _streamPublisher = pub && typeof pub === 'object' ? pub : null;
}

/** Restore all seams — call in test teardown. */
export function _resetGatewayEnvelope() {
  _streamPublisher = null;
}

/** @param {unknown} info */
function lastIdFromXInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const rec = /** @type {Record<string, unknown>} */ (info);
  const id = rec['last-generated-id'] ?? rec.lastGeneratedId ?? rec.last_generated_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Best-effort read of the stream's last entry id. Tries `XINFO STREAM`
 * (`last-generated-id`) first — one command, no payload transfer — then
 * falls back to `XREVRANGE key + - COUNT 1`. NEVER throws: any failure →
 * null and the caller omits `stream.cursor` (a Redis hiccup must not fail
 * the response).
 *
 * @param {{ streamKey?: string, xinfo?: Function, ensureClient?: Function }} publisher
 * @returns {Promise<string | null>}
 */
async function readStreamCursor(publisher) {
  try {
    if (typeof publisher.xinfo === 'function') {
      const id = lastIdFromXInfo(await publisher.xinfo());
      if (id) return id;
    }
    const client = typeof publisher.ensureClient === 'function' ? await publisher.ensureClient() : null;
    if (!client) return null;
    const key = publisher.streamKey;
    const anyClient = /** @type {Record<string, any>} */ (client);
    // node-redis: xRevRange(key, '+', '-', { COUNT: 1 }) → [{id, message}]
    if (typeof anyClient.xRevRange === 'function') {
      const entries = await anyClient.xRevRange(key, '+', '-', { COUNT: 1 });
      const first = Array.isArray(entries) ? entries[0] : null;
      const id = first && typeof first === 'object' ? first.id : null;
      return typeof id === 'string' && id ? id : null;
    }
    // ioredis: xrevrange(key, '+', '-', 'COUNT', 1) → [[id, [field, v, ...]]]
    if (typeof anyClient.xrevrange === 'function') {
      const entries = await anyClient.xrevrange(key, '+', '-', 'COUNT', 1);
      const first = Array.isArray(entries) ? entries[0] : null;
      const id = Array.isArray(first) ? first[0] : first?.id;
      return typeof id === 'string' && id ? id : null;
    }
    if (typeof anyClient.sendCommand === 'function') {
      const raw = await anyClient.sendCommand(['XREVRANGE', key, '+', '-', 'COUNT', '1']);
      const first = Array.isArray(raw) ? raw[0] : null;
      const id = Array.isArray(first) ? first[0] : first?.id;
      return typeof id === 'string' && id ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the `stream` block: `{enabled, name?, cursor?}`.
 * `enabled` gates on `REDIS_STREAM_ENABLED`; `name` is the publisher's
 * stream key; `cursor` (the post-completion last-entry-id, so a consumer can
 * `XREAD` forward from this call) is read best-effort ONLY when
 * `withCursor` — async/degrade paths omit it (the job has not emitted yet).
 * Every cursor-read failure resolves to "no cursor field", never a throw.
 *
 * @param {{ withCursor?: boolean }} [opts]
 * @returns {Promise<{ enabled: boolean, name?: string, cursor?: string }>}
 */
export async function buildStreamBlock({ withCursor = false } = {}) {
  const enabled = isEnvTruthy(process.env.REDIS_STREAM_ENABLED);
  if (!enabled) return { enabled: false };

  const publisher = _streamPublisher || defaultRedisStreamPublisher;
  /** @type {{ enabled: boolean, name?: string, cursor?: string }} */
  const stream = { enabled: true };
  const name = typeof publisher.streamKey === 'string' && publisher.streamKey ? publisher.streamKey : undefined;
  if (name) stream.name = name;

  if (withCursor) {
    let timer;
    try {
      const cursor = await Promise.race([
        Promise.resolve().then(() => readStreamCursor(publisher)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), STREAM_CURSOR_BUDGET_MS);
          if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
        }),
      ]).finally(() => clearTimeout(timer));
      if (typeof cursor === 'string' && cursor) stream.cursor = cursor;
    } catch {
      /* cursor is best-effort — omit the field, never fail the response */
    }
  }
  return stream;
}

// ── Envelope builders ─────────────────────────────────────────────────────────

/**
 * Success envelope — every 2xx response on the scrape route (sync 200,
 * async 202, degraded 202, batch 200/202).
 *
 * `{success:true, ok:true, mode, metadata, stream, preview, data, ...extra}`
 * where `preview = data.slice(0,10)` verbatim and `extra` carries the
 * lane-specific fields (`operationId`/`statusUrl`/`degraded_reason`/
 * `retry_after_ms`/`result`/`results`/`operationIds`).
 *
 * @param {{ mode: string, metadata?: Record<string, unknown>, stream?: Record<string, unknown>, data?: unknown[], extra?: Record<string, unknown> }} args
 * @returns {Record<string, unknown>}
 */
export function successEnvelope({ mode, metadata, stream, data, extra } = {}) {
  const list = Array.isArray(data) ? data : [];
  return {
    success: true,
    // Deprecated mirror for the in-repo apps/web consumer — a separate
    // cleanup story removes `ok`/`result` once web reads `data`/`preview`.
    ok: true,
    mode,
    metadata: metadata ?? {},
    stream: stream ?? { enabled: false },
    preview: list.slice(0, 10),
    data: list,
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

/**
 * Error envelope body — every non-2xx on the scrape route.
 *
 * `{success:false, error:{code, kind, type?, message, status, request_id?,
 * retryable, retry_after_ms?}}` — `retry_after_ms` is emitted IFF
 * `retryable:true` (C-10).
 *
 * @param {{ code?: string, type?: string, kind?: string, message?: string, status?: number, requestId?: string, retryable?: boolean, retryAfterMs?: number }} args
 * @returns {{ success: false, error: Record<string, unknown> }}
 */
export function errorBody({ code, type, kind, message, status, requestId, retryable, retryAfterMs } = {}) {
  /** @type {Record<string, unknown>} */
  const error = {
    code: typeof code === 'string' && code ? code : 'XACT_5000',
    kind: typeof kind === 'string' && kind ? kind : 'internal',
  };
  if (typeof type === 'string' && type) error.type = type;
  error.message = typeof message === 'string' && message ? message : 'Request failed';
  error.status = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  if (requestId) error.request_id = requestId;
  error.retryable = retryable === true;
  if (error.retryable) {
    const ms = Number(retryAfterMs);
    error.retry_after_ms = Number.isFinite(ms) && ms > 0 ? ms : RETRY_AFTER_DEFAULT_MS;
  }
  return { success: false, error };
}

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Map error `type` (PlatformError codebase taxonomy / ApiError type) → the
 * contract `error.kind` closed enum (C-10). Unknown types → 'internal'.
 * MOVED from scrapeDispatch.js — that module re-imports it here.
 *
 * @param {unknown} type
 * @returns {string} member of ERROR_KINDS
 */
export function errorKind(type) {
  switch (type) {
    case 'auth':
    case 'auth_expired': return 'auth';
    case 'invalid_args':
    case 'not_found':
    case 'target_not_found':
    case 'deprecated':
    case 'validation': return 'validation';
    case 'consumer_quota': return 'consumer_quota'; // reserved — Story 50.4 emits it
    case 'rate_limit':
    case 'upstream_rate_limit': return 'upstream_rate_limit';
    case 'bot_challenge':
    case 'proxy_exhausted':
    case 'proxy_ip_block': return 'proxy_ip_block';
    case 'upstream_error': return 'upstream_error';
    default: return 'internal';
  }
}

/**
 * `error.kind` for a scrape-lane error: a typed error maps its `type`
 * through `errorKind`; an UNTYPED `Error` is an upstream failure, not our
 * bug → `'upstream_error'` (never `'internal'`).
 *
 * @param {unknown} err
 * @returns {string} member of ERROR_KINDS
 */
export function scrapeErrorKind(err) {
  const type = typeof err === 'object' && err !== null && typeof /** @type {any} */ (err).type === 'string'
    ? /** @type {any} */ (err).type
    : null;
  return type ? errorKind(type) : 'upstream_error';
}

/**
 * Whether an error is retryable: explicit `isRetryable` flag, or a typed
 * retryable PlatformError type (`rate_limit|bot_challenge|proxy_exhausted|
 * hibernation`). Non-error / untyped → false.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableError(err) {
  if (!err || typeof err !== 'object') return false;
  const anyErr = /** @type {any} */ (err);
  if (anyErr.isRetryable === true) return true;
  return typeof anyErr.type === 'string' ? isRetryableType(anyErr.type) : false;
}
