// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Scrape mode dispatch — Story 50.2 (Epic 50 — Public Scrape Gateway).
 *
 * Owns the sync/async mode resolution + execution contract for
 * `POST /api/platform/:platform/scrape`:
 *
 *   - `mode` is an optional body field ('sync' | 'async'); absent → the
 *     per-action `syncCapableActions` manifest in each platform descriptor
 *     decides (unlisted → async).
 *   - Sync lane runs `scrape()` in-process under a HARD 1.5s ceiling (C-2).
 *     Ceiling breach → 202 degrade + detached in-flight tracking row (D-4) —
 *     the promise is never re-enqueued (no double upstream execution).
 *   - Typed retryable errors inside the budget degrade via Bull retry
 *     (`bot_challenge`→`cf_challenge`, `rate_limit`→`upstream_rate_limit`),
 *     propagating `err.retryAfterMs` into `retry_after_ms`/`Retry-After` AND
 *     the Bull job `delay` so the worker doesn't retry inside the upstream
 *     rate-limit window.
 *   - Batch (`platform:'all'|string[]`) fans out via Promise.allSettled with
 *     the ceiling applied per-platform (D-5 — the gateway does NOT route
 *     through UniversalActionDispatcher).
 *
 * Contract discipline: this module NEVER touches `res` and NEVER throws
 * contract errors — it returns outcome descriptors `{kind:'json', status,
 * body, headers?}` that the route renders verbatim (the generic route catch
 * flattens errors into `{ok:false,error:<string>}` which would break the
 * 400/202/503 contract bodies).
 *
 * Secrets hygiene: dispatch fields (`mode`,`platform`,`accountIds`,
 * `callbackUrl`) are stripped from `options` before `scrape()`. Credential
 * keys DO reach `scrape()` on the sync lane (legacy body-cookie flow) but are
 * stripped from every persisted copy (tracking-row config, Bull job data,
 * Operation.config); the async lane rejects credential-bearing bodies with
 * 400 — a queued job cannot carry secrets (Bull retains 100 completed jobs —
 * plaintext credentials in Redis are a leak).
 *
 * Test seams: `_setScrapeImpl` / `_setEnqueueImpl` / `_setOperationStore` /
 * `_setSyncBudgetMs` / `_resetDispatch` — real implementations only, no
 * `vi.mock` module stubs (repo mandate).
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import {
  errorBody,
  successEnvelope,
  buildMetadata,
  buildStreamBlock,
  normalizeData,
  errorKind,
  scrapeErrorKind,
  isRetryableError,
} from './gatewayEnvelope.js';

// ── Contract constants (pinned by spec — no env overrides) ───────────────────

/** Hard sync ceiling in ms (C-2). Bound = ceiling + bookkeeping. */
export const SYNC_BUDGET_MS = 1500;
/** Explicit platform array cap ('all'-expansion is exempt — D-3). */
export const MAX_BATCH_PLATFORMS = 25;
/**
 * Default Retry-After hint for timeout/fallback degrades.
 * Re-exported from gatewayEnvelope.js (its canonical home — api/middleware/
 * envelope.js needs it too and importing scrapeDispatch there would cycle).
 */
export { RETRY_AFTER_DEFAULT_MS } from './gatewayEnvelope.js';
import { RETRY_AFTER_DEFAULT_MS } from './gatewayEnvelope.js';
/** Bound on the detached tracking-row create await — a hung prisma write must not stall the response. */
export const TRACKING_CREATE_TIMEOUT_MS = 2000;
/** Closed enum for 202 degrade bodies (C-11). */
export const DEGRADED_REASONS = Object.freeze([
  'upstream_timeout',
  'cf_challenge',
  'upstream_rate_limit',
  'queue_fallback',
]);

const SYNC_TIMEOUT = Symbol('sync-ceiling-breach');

/** Body keys that are dispatch fields, never scraper options. */
const DISPATCH_KEYS = new Set(['action', 'mode', 'platform', 'accountIds', 'options', 'callbackUrl']);
/**
 * Credential keys — allowed in SYNC run options (the legacy body-cookie flow
 * must still reach scrape()), but NEVER persisted to tracking-row config /
 * Bull job data / Operation.config, and rejected outright on the async lane
 * (400) because a queued job cannot carry secrets.
 */
const CREDENTIAL_KEYS = new Set([
  'sessionCookie', 'authCookie', 'clientSecret', 'cookies', 'password',
  'authToken', 'accessToken', 'token', 'apiKey', 'clientId',
  'sessionid', 'csrftoken', 'auth_token', 'ct0', 'c_user', 'xs',
  'identifier', 'redditClientSecret', 'redditClientId', 'session',
]);

// ── Injected seams (test-only) ────────────────────────────────────────────────

let _syncBudgetMs = SYNC_BUDGET_MS;
/** @type {null | ((platform: string, action: string, options: Record<string, unknown>) => Promise<unknown>)} */
let _scrapeImpl = null;
/** @type {null | ((type: string, data: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>)} */
let _enqueueImpl = null;
/** @type {null | { create(data: Record<string, unknown>): Promise<Record<string, unknown>>, update(id: string, data: Record<string, unknown>): Promise<unknown> }} */
let _operationStore = null;

/** @param {number} ms */
export function _setSyncBudgetMs(ms) {
  const n = Number(ms);
  if (Number.isFinite(n) && n > 0) _syncBudgetMs = n;
}

/** @param {((platform: string, action: string, options: Record<string, unknown>) => Promise<unknown>) | null} fn */
export function _setScrapeImpl(fn) {
  _scrapeImpl = typeof fn === 'function' ? fn : null;
}

/** @param {((type: string, data: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null} fn */
export function _setEnqueueImpl(fn) {
  _enqueueImpl = typeof fn === 'function' ? fn : null;
}

/** @param {{ create(data: Record<string, unknown>): Promise<Record<string, unknown>>, update(id: string, data: Record<string, unknown>): Promise<unknown> } | null} store */
export function _setOperationStore(store) {
  _operationStore = store && typeof store.create === 'function' && typeof store.update === 'function' ? store : null;
}

/** Restore all seams + budget — call in test teardown. */
export function _resetDispatch() {
  _syncBudgetMs = SYNC_BUDGET_MS;
  _scrapeImpl = null;
  _enqueueImpl = null;
  _operationStore = null;
}

// ── Lazy dependencies (dynamic import = codebase pattern + avoids cycles) ─────

async function getRegistry() {
  return import('../../src/scrapers/index.js');
}

async function getScrapeFn() {
  if (_scrapeImpl) return _scrapeImpl;
  const m = await getRegistry();
  return m.scrape;
}

async function getEnqueueFn() {
  if (_enqueueImpl) return _enqueueImpl;
  const m = await import('./jobQueue.js');
  return m.addJob;
}

const prismaOperationStore = {
  /** @param {Record<string, unknown>} data */
  async create(data) {
    const { default: prisma } = await import('../lib/prisma.js');
    return prisma.operation.create({ data });
  },
  /**
   * @param {string} id
   * @param {Record<string, unknown>} data
   */
  async update(id, data) {
    const { default: prisma } = await import('../lib/prisma.js');
    return prisma.operation.update({ where: { id }, data });
  },
  /**
   * Conditional settle write — a mid-flight `cancelJob` 'cancelled' status
   * (or any finished state) is never clobbered by the detached continuation.
   * @param {string} id
   * @param {Record<string, unknown>} data
   */
  async updateIfProcessing(id, data) {
    const { default: prisma } = await import('../lib/prisma.js');
    return prisma.operation.updateMany({ where: { id, status: 'processing' }, data });
  },
};

async function getStore() {
  return _operationStore || prismaOperationStore;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {number} status
 * @param {Record<string, unknown>} body
 * @param {Record<string, string>} [headers]
 */
function jsonOutcome(status, body, headers) {
  return { kind: 'json', status, body, ...(headers ? { headers } : {}) };
}

/**
 * 400 contract body — unified ErrorEnvelope (C-10). `requestId` propagates so
 * a validation failure still carries the end-to-end trace id.
 * @param {string} message
 * @param {string} [requestId]
 */
function validationOutcome(message, requestId) {
  return jsonOutcome(400, errorBody({
    code: 'XACT_4001',
    type: 'validation',
    kind: 'validation',
    message,
    status: 400,
    requestId,
    retryable: false,
  }));
}

/**
 * 503 contract body — nothing to poll when no operationId could be minted.
 * Retryable: `retryable:true` + `retry_after_ms` + `Retry-After` header (C-10).
 * @param {string} [message]
 * @param {string} [requestId]
 */
function unavailableOutcome(message = 'scrape job could not be tracked — try again', requestId) {
  return jsonOutcome(503, errorBody({
    code: 'XACT_5000',
    type: 'internal',
    kind: 'internal',
    message,
    status: 503,
    requestId,
    retryable: true,
    retryAfterMs: RETRY_AFTER_DEFAULT_MS,
  }), retryAfterHeaders(RETRY_AFTER_DEFAULT_MS));
}

/**
 * Scrape-lane error → unified ErrorEnvelope. `kind` comes from
 * `scrapeErrorKind` (typed → `errorKind(type)`; untyped → 'upstream_error').
 * Status from `err.statusCode` (4xx/5xx honoured); retryable field reflects
 * `isRetryableError(err)` — and a retryable error always carries
 * `retry_after_ms` (C-10) plus a `Retry-After` header.
 * @param {unknown} err
 * @param {string} [requestId]
 */
function scrapeErrorOutcome(err, requestId) {
  const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;
  const retryable = isRetryableError(err) || status === 503 || status === 429;
  const retryAfterMs = typeof /** @type {any} */ (err)?.retryAfterMs === 'number'
    ? /** @type {any} */ (err).retryAfterMs
    : undefined;
  const body = errorBody({
    code: typeof err?.code === 'string' ? err.code : 'XACT_5000',
    type: typeof /** @type {any} */ (err)?.type === 'string' ? /** @type {any} */ (err).type : undefined,
    kind: scrapeErrorKind(err),
    message: err instanceof Error ? err.message : 'Scrape failed',
    status,
    requestId,
    retryable,
    retryAfterMs,
  });
  return jsonOutcome(status, body, retryable ? retryAfterHeaders(body.error.retry_after_ms ?? RETRY_AFTER_DEFAULT_MS) : undefined);
}

/**
 * Per-entry error object for batch results — full {code,kind,type,message}
 * shape plus `retryable` when derivable (entries are not HTTP responses, so
 * no `status`/`request_id` — the top-level envelope carries those).
 * @param {unknown} err
 * @param {string} [fallbackCode]
 */
function entryError(err, fallbackCode = 'XACT_5000') {
  const type = typeof err?.type === 'string' ? err.type : 'internal';
  const out = {
    code: typeof err?.code === 'string' ? err.code : fallbackCode,
    kind: errorKind(type),
    type,
    message: err instanceof Error ? err.message : String(err),
  };
  if (isRetryableError(err)) out.retryable = true;
  return out;
}

const VALIDATION_ENTRY_ERROR = (message) => ({
  code: 'XACT_4001', kind: 'validation', type: 'validation', message,
});

/** @param {string} operationId */
function statusUrl(operationId) {
  return `/api/ai/action/status/${operationId}`;
}

/** @param {number} retryAfterMs */
function retryAfterHeaders(retryAfterMs) {
  return { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}

/**
 * 202 degrade descriptor — upstream_timeout | cf_challenge | upstream_rate_limit | queue_fallback.
 * Full success envelope + lane extras; `data`/`preview` are empty (nothing
 * returned yet) and `stream` carries `{enabled, name}` without a cursor.
 * @param {string} reason one of DEGRADED_REASONS
 * @param {string} operationId
 * @param {number} retryAfterMs
 * @param {{ metadata?: Record<string, unknown>, stream?: Record<string, unknown> }} [envelope]
 */
function degradedOutcome(reason, operationId, retryAfterMs, envelope = {}) {
  const ms = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : RETRY_AFTER_DEFAULT_MS;
  return jsonOutcome(202, successEnvelope({
    mode: 'async',
    metadata: envelope.metadata,
    stream: envelope.stream,
    data: [],
    extra: {
      operationId,
      degraded_reason: reason,
      retry_after_ms: ms,
      statusUrl: statusUrl(operationId),
    },
  }), retryAfterHeaders(ms));
}

/**
 * 202 accepted descriptor for caller-requested async — no degraded_reason.
 * @param {string} operationId
 * @param {{ metadata?: Record<string, unknown>, stream?: Record<string, unknown> }} [envelope]
 */
function queuedOutcome(operationId, envelope = {}) {
  return jsonOutcome(202, successEnvelope({
    mode: 'async',
    metadata: envelope.metadata,
    stream: envelope.stream,
    data: [],
    extra: {
      operationId,
      statusUrl: statusUrl(operationId),
    },
  }));
}

/**
 * Build the scraper RUN `options` object from the request body.
 * Flat fields win; a plain-object `options` key is merged in (CAP-1 shape).
 * Dispatch fields are stripped; credential keys are KEPT — the legacy
 * body-cookie flow must still reach scrape() on the sync lane. Persisted
 * copies go through `persistedOptions()` and the async lane rejects
 * credential-bearing bodies before enqueue.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
export function sanitizeOptions(body) {
  const opts = {};
  if (body && typeof body === 'object') {
    const nested = body.options;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      Object.assign(opts, nested);
    }
    Object.assign(opts, body);
  }
  for (const key of DISPATCH_KEYS) delete opts[key];
  // Dashboard scrapes start fresh from cursor 0 unless caller asked to resume.
  if (opts.resume === undefined) opts.resume = false;
  return opts;
}

/**
 * Credential-free copy of options for persisted state (detached tracking-row
 * config, Bull job config mirror, Operation.config).
 * @param {Record<string, unknown>} options
 * @returns {Record<string, unknown>}
 */
function persistedOptions(options) {
  const out = { ...(options || {}) };
  for (const key of CREDENTIAL_KEYS) delete out[key];
  return out;
}

/**
 * Whether any credential key is present — the async lane refuses these (a
 * queued job cannot carry secrets; use sync or stored accountIds).
 * @param {Record<string, unknown>} options
 */
function hasCredentialKeys(options) {
  if (!options || typeof options !== 'object') return false;
  for (const key of Object.keys(options)) {
    if (CREDENTIAL_KEYS.has(key)) return true;
  }
  return false;
}

/**
 * Marker error for pre-enqueue validation failures (serializability).
 * @param {string} message
 */
function dispatchValidationError(message) {
  const err = /** @type {Error & { isDispatchValidation?: boolean, code?: string, type?: string }} */ (new Error(message));
  err.isDispatchValidation = true;
  err.code = 'XACT_4001';
  // Per-entry batch errors derive `kind` from `type` — pin 'validation' so a
  // non-serializable options entry doesn't read as an internal failure.
  err.type = 'validation';
  return err;
}

/**
 * Async lane options must survive Bull's JSON serialization — reject
 * circular structures, functions, and other non-serializable values.
 * @param {Record<string, unknown>} options
 */
export function assertSerializableOptions(options) {
  // Per-path ancestor set (deleted on unwind) — a shared reference visited
  // via two paths is a diamond, which serializes fine; only true cycles and
  // lossy types are rejected.
  const ancestors = new Set();
  const fail = () => { throw dispatchValidationError('options must be JSON-serializable for async dispatch'); };
  /** @param {unknown} value @param {number} depth */
  const walk = (value, depth) => {
    if (value === null || value === undefined) return;
    const t = typeof value;
    if (t === 'function' || t === 'symbol' || t === 'bigint') fail();
    if (t === 'number' && !Number.isFinite(value)) fail(); // NaN/Infinity serialize lossy
    if (t !== 'object') return;
    if (ancestors.has(value) || depth > 50) fail();
    // Map/Set/Date/RegExp stringify lossy — reject before Bull persists junk.
    if (value instanceof Map || value instanceof Set || value instanceof Date || value instanceof RegExp) fail();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      for (const key of Object.keys(/** @type {Record<string, unknown>} */ (value))) {
        walk(/** @type {Record<string, unknown>} */ (value)[key], depth + 1);
      }
    } finally {
      ancestors.delete(value);
    }
  };
  walk(options, 0);
  try {
    JSON.stringify(options);
  } catch {
    throw dispatchValidationError('options must be JSON-serializable for async dispatch');
  }
}

/** @param {unknown} value */
function safeStringify(value) {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Canonical platform list = deduped `aliases[0]` across the DESCRIPTORS
 * registry (D-3 — superset of VALID_PLATFORMS, intended).
 * @param {Record<string, Record<string, any>>} descriptors
 * @returns {string[]}
 */
export function canonicalPlatforms(descriptors) {
  const seen = new Set();
  const list = [];
  for (const descriptor of Object.values(descriptors || {})) {
    const canonical = Array.isArray(descriptor?.aliases) ? descriptor.aliases[0] : null;
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      list.push(canonical);
    }
  }
  return list;
}

/**
 * Resolve the effective mode for one (platform, action) pair.
 * `mode:'sync'` on a non-syncCapable action is a contract violation
 * ('not_sync_capable' → 400), never a silent lane override.
 *
 * @param {{ capable: boolean, requestedMode?: string }} args
 * @returns {'sync' | 'async' | 'not_sync_capable'}
 */
export function resolveMode({ capable, requestedMode }) {
  if (requestedMode === 'sync') return capable ? 'sync' : 'not_sync_capable';
  if (requestedMode === 'async') return 'async';
  return capable ? 'sync' : 'async';
}

/**
 * Degrade classification — driven by `err.type` (PlatformError taxonomy),
 * NOT error codes. Returns null when the error is not degrade-eligible.
 * @param {unknown} err
 * @returns {'cf_challenge' | 'upstream_rate_limit' | null}
 */
export function classifyDegrade(err) {
  const type = typeof err === 'object' && err !== null ? /** @type {any} */ (err).type : undefined;
  if (type === 'bot_challenge') return 'cf_challenge';
  if (type === 'rate_limit') return 'upstream_rate_limit';
  return null;
}

// ── Target resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the effective platform targets.
 * Body `platform` overrides the path param (documented body-wins rule):
 *   string → single target | 'all' (case/space-tolerant) → all canonical
 *   descriptor platforms | string[] → explicit list (dedupe post-normalize
 *   happens BEFORE the MAX_BATCH_PLATFORMS cap — dupes don't burn budget).
 * Normalization = trim + lowercase + PLATFORM_ALIASES ('tiktok-shop'→
 * 'tiktokshop'), then canonical = descriptor `aliases[0]` so 'rdt'/'x'
 * report 'reddit'/'twitter' consistently single-or-batch.
 *
 * @param {string} pathPlatform
 * @param {unknown} bodyPlatform
 * @param {Record<string, Record<string, any>>} descriptors
 * @param {Record<string, string>} [platformAliases]
 * @returns {{ batch: false, platform: string } | { batch: true, targets: { raw: unknown, canonical: string | null }[] } | { error: Record<string, unknown> }}
 */
function resolveTargets(pathPlatform, bodyPlatform, descriptors, platformAliases = {}) {
  const raw = bodyPlatform === undefined ? pathPlatform : bodyPlatform;

  /** @param {unknown} v */
  const norm = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    return platformAliases[s] || s;
  };
  /** @param {string} key */
  const canonicalOf = (key) => {
    const descriptor = key ? descriptors[key] : null;
    return Array.isArray(descriptor?.aliases) && descriptor.aliases[0] ? descriptor.aliases[0] : null;
  };

  if (typeof raw === 'string') {
    const key = norm(raw);
    if (key === 'all') {
      return {
        batch: true,
        targets: canonicalPlatforms(descriptors).map((canonical) => ({ raw: canonical, canonical })),
      };
    }
    if (!key) {
      return { error: validationOutcome('platform must be a non-empty string, "all", or an array of platform names') };
    }
    return { batch: false, platform: canonicalOf(key) || key };
  }

  if (Array.isArray(raw)) {
    const seen = new Set();
    const targets = [];
    raw.forEach((item, i) => {
      const key = typeof item === 'string' ? norm(item) : '';
      const canonical = canonicalOf(key);
      let dedupeKey;
      if (canonical) {
        dedupeKey = `p:${canonical}`;
      } else {
        // A circular member must not throw here — fall back to its index.
        let printable;
        try { printable = JSON.stringify(item); } catch { printable = `#${i}`; }
        dedupeKey = `unknown:${typeof item === 'string' ? key : printable}`;
      }
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      targets.push({ raw: item, canonical });
    });
    if (targets.length === 0) {
      return { error: validationOutcome('platform array must not be empty') };
    }
    if (targets.length > MAX_BATCH_PLATFORMS) {
      return { error: validationOutcome(`platform array exceeds the ${MAX_BATCH_PLATFORMS}-platform batch cap`) };
    }
    return { batch: true, targets };
  }

  return { error: validationOutcome('platform must be a string, "all", or an array of platform names') };
}

/**
 * Whether the descriptor can resolve `action` — mirrors scrape() resolution:
 * dispatch-only descriptors (facebook) self-resolve → skip the check;
 * actionMap membership or a non-throwing mapAction → known. Unknown actions
 * must never reach scrape()/Bull (pre-50.2 immediate-reject contract).
 * @param {Record<string, any>} descriptor
 * @param {string} platform canonical platform name
 * @param {string} action
 * @param {Record<string, unknown>} [options]
 */
function isKnownAction(descriptor, platform, action, options) {
  if (!descriptor || typeof descriptor !== 'object') return false;
  if (typeof descriptor.dispatch === 'function' && typeof descriptor.mapAction !== 'function' && !descriptor.actionMap) {
    return true;
  }
  if (descriptor.actionMap && typeof descriptor.actionMap === 'object'
      && Object.prototype.hasOwnProperty.call(descriptor.actionMap, action)) {
    return true;
  }
  if (typeof descriptor.mapAction === 'function') {
    try {
      descriptor.mapAction(options || {}, { platform, platformName: String(platform).toLowerCase(), action });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * SPINE operational log — one structured line per degrade/queue decision
 * (Design Notes). Logging must never break dispatch. Story 50.3 adds
 * `request_id` so a log line correlates with the envelope's
 * `metadata.request_id` / `error.request_id` end-to-end.
 * @param {{ platform: string, action: string, consumerId: string | null, mode: string, degradedReason?: string, retryAfterMs?: number, upstreamStatus?: number, durationMs: number, requestId?: string }} line
 */
function logGatewayLine({ platform, action, consumerId, mode, degradedReason, retryAfterMs, upstreamStatus, durationMs, requestId }) {
  try {
    console.info(`[scrape-gateway] ${JSON.stringify({
      platform,
      action,
      consumer_id: consumerId ?? null,
      mode,
      ...(requestId ? { request_id: requestId } : {}),
      ...(degradedReason ? { degraded_reason: degradedReason } : {}),
      ...(typeof retryAfterMs === 'number' ? { retry_after_ms: retryAfterMs } : {}),
      ...(typeof upstreamStatus === 'number' ? { upstream_status: upstreamStatus } : {}),
      duration_ms: durationMs,
    })}`);
  } catch { /* observability is best-effort */ }
}

// ── Account cookie resolution (per-platform) ─────────────────────────────────

/**
 * Re-resolve stored account cookie for a platform and merge into options.
 * Runs per-platform so batch entries resolve against the right account label.
 * @param {Record<string, unknown>} options mutated in place
 * @param {string | null} userId
 * @param {string[] | undefined} accountIds
 * @param {string} platform
 */
async function applyAccountCookie(options, userId, accountIds, platform) {
  if (!userId || !Array.isArray(accountIds) || accountIds.length === 0) return;
  const { resolveAccountCookie, buildAuthCookie } = await import('../routes/platform.js');
  const cookie = await resolveAccountCookie(String(userId), accountIds[0], platform);
  options.authCookie = buildAuthCookie(platform, cookie);
  options.accountId = accountIds[0];
  if (cookie && typeof cookie === 'object') {
    if (cookie.clientId && !options.clientId) options.clientId = cookie.clientId;
    if (cookie.clientSecret && !options.clientSecret) options.clientSecret = cookie.clientSecret;
    if (cookie.username && !options.redditUsername) options.redditUsername = cookie.username;
  }
}

// ── Enqueue (async lane) ──────────────────────────────────────────────────────

/**
 * Persist an Operation row + Bull job via `addJob('scrape', ...)`.
 * Credential-bearing bodies are rejected BEFORE enqueue (a queued job cannot
 * carry secrets — 400 validation); the persisted config mirror runs through
 * `persistedOptions()` as belt-and-braces anyway.
 *
 * @param {{ platform: string, action: string, options: Record<string, unknown>, userId: string | null, consumerId: string | null, apiKeyRequired?: boolean, callbackUrl?: string, accountIds?: string[], delayMs?: number }} args
 * @returns {Promise<{ operationId: string }>}
 */
export async function enqueueScrapeJob({ platform, action, options, userId, consumerId, apiKeyRequired = false, callbackUrl, accountIds, delayMs = 0 }) {
  if (hasCredentialKeys(options)) {
    throw dispatchValidationError('credentials not allowed for queued execution — use sync or accountIds');
  }
  assertSerializableOptions(options);
  const enqueue = await getEnqueueFn();
  const delay = Number(delayMs);
  const data = {
    platform,
    action,
    options,
    userId: userId ? String(userId) : null,
    consumerId: consumerId ? String(consumerId) : null,
    // Carries the caller lane into the worker — apiKeyRequired must reflect
    // the service lane, not Boolean(consumerId) (JWT-lane jobs stay false).
    apiKeyRequired: apiKeyRequired === true,
    ...(Array.isArray(accountIds) && accountIds.length ? { accountIds } : {}),
    config: {
      platform,
      action,
      options: persistedOptions(options),
      ...(callbackUrl ? { callbackUrl } : {}),
    },
  };
  const { jobId } = /** @type {any} */ (await enqueue('scrape', data, {
    delay: Number.isFinite(delay) && delay > 0 ? delay : 0,
  }));
  return { operationId: jobId };
}

// ── Sync lane — ceiling race + detached tracking (D-4) ────────────────────────

/**
 * Attach the detached-continuation settle handler to an in-flight scrape
 * promise. MUST be called synchronously at race time — before any `await`
 * of the tracking-row create — or a rejection landing in that window is an
 * unhandledRejection crash on Node ≥15 (D-4).
 *
 * Settles that land before `bindOperation()` are buffered and flushed when
 * the operationId arrives; settles after row-bind write immediately.
 *
 * @param {Promise<unknown>} scrapeP in-flight scrape promise
 * @param {{ create(data: Record<string, unknown>): Promise<Record<string, unknown>>, update(id: string, data: Record<string, unknown>): Promise<unknown>, updateIfProcessing?(id: string, data: Record<string, unknown>): Promise<unknown> }} store
 * @returns {{ settled: { ok: true, result: unknown } | { ok: false, error: unknown } | null, bindOperation(id: string, baseConfig?: string): Promise<void> }}
 */
export function trackDetachedOperation(scrapeP, store) {
  /** @type {string | null} */
  let operationId = null;
  /** @type {string | null} the config JSON written at create — lastError merges into it */
  let baseConfig = null;
  /** @type {{ ok: true, result: unknown } | { ok: false, error: unknown } | null} */
  let settled = null;

  /** @param {{ ok: boolean, result?: unknown, error?: unknown }} s */
  const settleData = (s) => {
    if (s.ok) {
      return { status: 'completed', completedAt: new Date(), result: safeStringify(s.result ?? null) };
    }
    const err = s.error;
    /** @type {Record<string, unknown>} */
    const data = {
      status: 'failed',
      completedAt: new Date(),
      error: err instanceof Error ? err.message : String(err),
    };
    // Typed error fields survive into config.lastError so post-hoc consumers
    // can discriminate cf_challenge/rate-limit from an untyped crash.
    if (typeof baseConfig === 'string' && err && typeof err === 'object') {
      try {
        const cfg = JSON.parse(baseConfig);
        cfg.lastError = {
          ...(typeof /** @type {any} */ (err).code === 'string' ? { code: /** @type {any} */ (err).code } : {}),
          ...(typeof /** @type {any} */ (err).type === 'string' ? { type: /** @type {any} */ (err).type } : {}),
          ...(typeof /** @type {any} */ (err).statusCode === 'number' ? { statusCode: /** @type {any} */ (err).statusCode } : {}),
          ...(typeof /** @type {any} */ (err).retryAfterMs === 'number' ? { retryAfterMs: /** @type {any} */ (err).retryAfterMs } : {}),
        };
        data.config = JSON.stringify(cfg);
      } catch { /* keep the original config untouched */ }
    }
    return data;
  };

  const writeSettle = async () => {
    const op = operationId;
    const s = settled;
    if (!op || !s) return;
    // Conditional write when the store supports it — a mid-flight cancelJob
    // 'cancelled' status is never clobbered. `settled` is cleared ONLY on
    // success; a failed write is retried once.
    const doWrite = () => typeof store.updateIfProcessing === 'function'
      ? store.updateIfProcessing(op, settleData(s))
      : store.update(op, settleData(s));
    try {
      await doWrite();
      settled = null;
    } catch (e) {
      console.warn(`⚠️  detached scrape settle write failed for operation ${op} (retrying once):`, e instanceof Error ? e.message : e);
      try {
        await doWrite();
        settled = null;
      } catch (e2) {
        console.warn(`⚠️  detached scrape settle write failed again for operation ${op}:`, e2 instanceof Error ? e2.message : e2);
      }
    }
  };

  // Synchronous attach — the derived promise can never reject.
  scrapeP.then(
    (result) => { settled = { ok: true, result }; void writeSettle(); },
    (error) => { settled = { ok: false, error }; void writeSettle(); },
  ).catch(() => {});

  return {
    /** Current settle state (null while in-flight) — settle-aware fallback. */
    get settled() { return settled; },
    /**
     * @param {string} id
     * @param {string} [baseConfigJson] config JSON written at create — used for lastError merge
     */
    async bindOperation(id, baseConfigJson) {
      operationId = id;
      if (typeof baseConfigJson === 'string') baseConfig = baseConfigJson;
      if (settled) await writeSettle();
    },
  };
}

/**
 * Race `run()` against the hard sync ceiling.
 *
 * On breach the in-flight promise is NOT cancelled and NOT re-enqueued —
 * an Operation row (`status:'processing'`) tracks it and the settle handler
 * writes result/error when it lands.
 *
 * When the tracking-row create fails/stalls (transient prisma) the fallback
 * is SETTLE-AWARE, never a blind re-enqueue — re-enqueueing an in-flight
 * scrape would double upstream execution (the spec's own Never):
 *   settled-rejected → enqueueScrapeJob → 'queue_fallback' (a retry of a
 *     failed execution, not a duplicate);
 *   settled-resolved → return its result as the normal outcome;
 *   still in-flight  → 'unavailable' (503 — nothing trackable, no duplicate).
 * Both tracking AND the fallback enqueue failing → 'unavailable' (route emits
 * 503 — never a 202 without an operationId).
 *
 * @param {{ run: () => Promise<unknown>, platform: string, action: string, options: Record<string, unknown>, userId: string | null, consumerId: string | null, apiKeyRequired?: boolean, callbackUrl?: string, accountIds?: string[] }} args
 * @returns {Promise<{ outcome: 'completed', result: unknown } | { outcome: 'error', error: unknown } | { outcome: 'degraded', reason: string, operationId: string, retryAfterMs: number } | { outcome: 'unavailable' }>}
 */
export async function runSyncWithCeiling({ run, platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds }) {
  const scrapeP = Promise.resolve().then(run);
  // D-4: a rejection can land before the real settle handler attaches (the
  // getStore() await below suspends a microtask). Attach a synchronous noop
  // catch NOW so no window can produce an unhandledRejection — the tracker
  // below still observes the settle and writes the row.
  void scrapeP.catch(() => {});
  const store = await getStore();

  // Settle handler attached synchronously at race time (D-4).
  const tracker = trackDetachedOperation(scrapeP, store);

  let timer;
  try {
    const result = await Promise.race([
      scrapeP,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(SYNC_TIMEOUT), _syncBudgetMs);
      }),
    ]);
    clearTimeout(timer);
    return { outcome: 'completed', result };
  } catch (err) {
    clearTimeout(timer);
    if (err !== SYNC_TIMEOUT) {
      return { outcome: 'error', error: err };
    }

    // Ceiling breach → detached tracking row (the scrape keeps running).
    // `config` persists the credential-free option copy (test-verified).
    const baseConfig = safeStringify({
      platform,
      action,
      options: persistedOptions(options),
      ...(callbackUrl ? { callbackUrl } : {}),
      degraded_from: 'sync_ceiling',
    });
    const createP = Promise.resolve(store.create({
      type: 'scrape',
      status: 'processing',
      userId: userId ? String(userId) : null,
      consumerId: consumerId ? String(consumerId) : null,
      config: baseConfig,
      startedAt: new Date(),
    }));
    // Bound the create await — a hung prisma write can't stall the response.
    let createTimer;
    const row = await Promise.race([
      createP,
      new Promise((_, reject) => {
        createTimer = setTimeout(() => reject(new Error('tracking-row create timeout')), TRACKING_CREATE_TIMEOUT_MS);
      }),
    ]).then((r) => {
      clearTimeout(createTimer);
      return r;
    }).catch((rowErr) => {
      clearTimeout(createTimer);
      console.warn('⚠️  scrape tracking-row create failed:', rowErr instanceof Error ? rowErr.message : rowErr);
      return null;
    });

    if (row && /** @type {any} */ (row).id) {
      // A settle that landed during the create await flushes inside bind.
      await tracker.bindOperation(String(/** @type {any} */ (row).id), baseConfig);
      return {
        outcome: 'degraded',
        reason: 'upstream_timeout',
        operationId: String(/** @type {any} */ (row).id),
        retryAfterMs: RETRY_AFTER_DEFAULT_MS,
      };
    }

    // If a late create lands anyway (raced timeout), bind it so the eventual
    // settle writes the row instead of orphaning a 'processing' record.
    createP.then((late) => {
      if (late && /** @type {any} */ (late).id) {
        return tracker.bindOperation(String(/** @type {any} */ (late).id), baseConfig);
      }
      return undefined;
    }).catch(() => {});

    // Settle-aware fallback (spec Never: no double upstream execution).
    const s = tracker.settled;
    if (!s) return { outcome: 'unavailable' };         // still in-flight — untracked, not re-enqueueable
    if (s.ok) return { outcome: 'completed', result: s.result };
    try {
      const { operationId: fallbackId } = await enqueueScrapeJob({
        platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, delayMs: 0,
      });
      return {
        outcome: 'degraded',
        reason: 'queue_fallback',
        operationId: fallbackId,
        retryAfterMs: RETRY_AFTER_DEFAULT_MS,
      };
    } catch (enqErr) {
      console.error('❌ queue_fallback enqueue failed:', enqErr instanceof Error ? enqErr.message : enqErr);
      return { outcome: 'unavailable' };
    }
  }
}

// ── Single-platform dispatch ──────────────────────────────────────────────────

/**
 * @param {{ platform: string, action: string, options: Record<string, unknown>, requestedMode?: string, userId: string | null, consumerId: string | null, apiKeyRequired: boolean, callbackUrl?: string, accountIds?: string[], consumerCtx: Record<string, unknown>, dryRun: boolean, registry: Record<string, any>, requestId?: string, traceparent?: string }} args
 */
async function dispatchSingle({ platform, action, options, requestedMode, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, consumerCtx, dryRun, registry, requestId, traceparent }) {
  const startedAt = Date.now();
  const descriptor = registry.DESCRIPTORS[platform];
  if (!descriptor) {
    return validationOutcome(`Unknown platform: ${platform}`, requestId);
  }
  // Unknown actions never reach scrape()/Bull (pre-50.2 immediate-reject).
  if (!isKnownAction(descriptor, platform, action, options)) {
    return validationOutcome(`Unknown action: ${action}`, requestId);
  }

  const capable = registry.isSyncCapable(platform, action, options);
  const mode = resolveMode({ capable, requestedMode });
  if (mode === 'not_sync_capable') {
    return validationOutcome('action not sync-eligible', requestId);
  }

  const effectiveConsumerId = typeof consumerCtx?.consumerId === 'string' ? consumerCtx.consumerId : 'internal';
  const baseMetadata = () => buildMetadata({
    requestId,
    traceparent,
    platform,
    action,
    consumerId: effectiveConsumerId,
    durationMs: Date.now() - startedAt,
    syncCapable: capable,
    dryRun,
  });

  if (mode === 'async') {
    try {
      const { operationId } = await enqueueScrapeJob({
        platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds,
      });
      logGatewayLine({ platform, action, consumerId, mode: 'async', durationMs: Date.now() - startedAt, requestId });
      const stream = await buildStreamBlock({ withCursor: false });
      return queuedOutcome(operationId, { metadata: baseMetadata(), stream });
    } catch (err) {
      if (/** @type {any} */ (err)?.isDispatchValidation) {
        return validationOutcome(/** @type {Error} */ (err).message, requestId);
      }
      logGatewayLine({ platform, action, consumerId, mode: 'async', upstreamStatus: 503, durationMs: Date.now() - startedAt, requestId });
      return unavailableOutcome('scrape job could not be queued', requestId);
    }
  }

  // Sync lane — the stored-account cookie resolve runs INSIDE the raced
  // closure so a slow prisma/decrypt also burns the 1.5s ceiling.
  const opts = { ...options };
  const scrapeFn = await getScrapeFn();
  const { runWithConsumerContext } = await import('../../src/mcp/consumer-context.js');
  const outcome = await runSyncWithCeiling({
    run: async () => {
      await applyAccountCookie(opts, userId, accountIds, platform);
      return runWithConsumerContext(consumerCtx, () => scrapeFn(platform, action, opts));
    },
    platform,
    action,
    options,
    userId,
    consumerId,
    apiKeyRequired,
    callbackUrl,
    accountIds,
  });

  switch (outcome.outcome) {
    case 'completed': {
      const data = normalizeData(outcome.result);
      const stream = await buildStreamBlock({ withCursor: true });
      return jsonOutcome(200, successEnvelope({
        mode: 'sync',
        metadata: baseMetadata(),
        stream,
        data,
        extra: {
          platform,
          action,
          dryRun,
          // Deprecated verbatim mirror for the in-repo apps/web consumer.
          result: outcome.result ?? null,
        },
      }));
    }
    case 'degraded':
      logGatewayLine({
        platform, action, consumerId, mode: 'async',
        degradedReason: outcome.reason, retryAfterMs: outcome.retryAfterMs,
        durationMs: Date.now() - startedAt, requestId,
      });
      return degradedOutcome(outcome.reason, outcome.operationId, outcome.retryAfterMs, {
        metadata: baseMetadata(),
        stream: await buildStreamBlock({ withCursor: false }),
      });
    case 'unavailable':
      logGatewayLine({ platform, action, consumerId, mode: 'async', upstreamStatus: 503, durationMs: Date.now() - startedAt, requestId });
      return unavailableOutcome(undefined, requestId);
    default: {
      // Typed retryable error inside the budget → degrade via Bull retry,
      // carrying the upstream retryAfterMs into both the response and the
      // Bull job delay.
      const reason = classifyDegrade(outcome.error);
      if (reason) {
        const rawDelay = Number(/** @type {any} */ (outcome.error)?.retryAfterMs);
        const delayMs = Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : 0;
        try {
          const { operationId } = await enqueueScrapeJob({
            platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, delayMs,
          });
          logGatewayLine({
            platform, action, consumerId, mode: 'async',
            degradedReason: reason, retryAfterMs: delayMs || RETRY_AFTER_DEFAULT_MS,
            upstreamStatus: typeof /** @type {any} */ (outcome.error)?.statusCode === 'number' ? /** @type {any} */ (outcome.error).statusCode : undefined,
            durationMs: Date.now() - startedAt, requestId,
          });
          return degradedOutcome(reason, operationId, delayMs || RETRY_AFTER_DEFAULT_MS, {
            metadata: baseMetadata(),
            stream: await buildStreamBlock({ withCursor: false }),
          });
        } catch (enqErr) {
          if (/** @type {any} */ (enqErr)?.isDispatchValidation) {
            return scrapeErrorOutcome(outcome.error, requestId);
          }
          logGatewayLine({ platform, action, consumerId, mode: 'async', upstreamStatus: 503, durationMs: Date.now() - startedAt, requestId });
          return unavailableOutcome(undefined, requestId);
        }
      }
      return scrapeErrorOutcome(outcome.error, requestId);
    }
  }
}

// ── Batch dispatch ────────────────────────────────────────────────────────────

/**
 * Per-platform batch task — never throws (Promise.allSettled semantics).
 * @param {{ raw: unknown, canonical: string | null }} target
 * @param {{ action: string, options: Record<string, unknown>, requestedMode?: string, userId: string | null, consumerId: string | null, apiKeyRequired: boolean, callbackUrl?: string, accountIds?: string[], consumerCtx: Record<string, unknown>, registry: Record<string, any> }} shared
 */
async function dispatchEntry(target, shared) {
  const { action, options, requestedMode, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, consumerCtx, registry, requestId } = shared;
  const startedAt = Date.now();
  const label = target.canonical || String(target.raw);

  if (!target.canonical) {
    return { platform: label, success: false, status: 'failed', error: VALIDATION_ENTRY_ERROR('Unknown platform') };
  }
  const platform = target.canonical;

  // Unknown actions never reach scrape()/Bull — per-entry failed (XACT_4001).
  if (!isKnownAction(registry.DESCRIPTORS[platform], platform, action, options)) {
    return { platform, success: false, status: 'failed', error: VALIDATION_ENTRY_ERROR(`Unknown action: ${action}`) };
  }

  const capable = registry.isSyncCapable(platform, action, options);
  const mode = resolveMode({ capable, requestedMode });
  if (mode === 'not_sync_capable') {
    return { platform, success: false, status: 'failed', error: VALIDATION_ENTRY_ERROR('action not sync-eligible') };
  }

  if (mode === 'async') {
    try {
      const { operationId } = await enqueueScrapeJob({
        platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds,
      });
      logGatewayLine({ platform, action, consumerId, mode: 'async', durationMs: Date.now() - startedAt, requestId });
      return { platform, success: true, status: 'queued', operationId, statusUrl: statusUrl(operationId) };
    } catch (err) {
      // enqueue infra failure is XACT_5000/internal; dispatch validation
      // errors carry their own XACT_4001 code + 'validation' type.
      return { platform, success: false, status: 'failed', error: entryError(err, 'XACT_5000') };
    }
  }

  // Sync lane — stored-account cookie resolve inside the raced closure so it
  // burns the same per-platform 1.5s ceiling as the scrape itself.
  const opts = { ...options };
  const scrapeFn = await getScrapeFn();
  const { runWithConsumerContext } = await import('../../src/mcp/consumer-context.js');
  const outcome = await runSyncWithCeiling({
    run: async () => {
      await applyAccountCookie(opts, userId, accountIds, platform);
      return runWithConsumerContext(consumerCtx, () => scrapeFn(platform, action, opts));
    },
    platform,
    action,
    options,
    userId,
    consumerId,
    apiKeyRequired,
    callbackUrl,
    accountIds,
  });

  switch (outcome.outcome) {
    case 'completed':
      return { platform, success: true, status: 'completed', data: outcome.result };
    case 'degraded':
      logGatewayLine({
        platform, action, consumerId, mode: 'async',
        degradedReason: outcome.reason, retryAfterMs: outcome.retryAfterMs,
        durationMs: Date.now() - startedAt, requestId,
      });
      return {
        platform,
        success: true,
        status: 'degraded',
        operationId: outcome.operationId,
        degraded_reason: outcome.reason,
        retry_after_ms: outcome.retryAfterMs,
        statusUrl: statusUrl(outcome.operationId),
      };
    case 'unavailable':
      logGatewayLine({ platform, action, consumerId, mode: 'async', upstreamStatus: 503, durationMs: Date.now() - startedAt, requestId });
      return { platform, success: false, status: 'failed', error: { code: 'XACT_5000', kind: 'internal', type: 'internal', message: 'scrape job could not be tracked', retryable: true } };
    default: {
      const reason = classifyDegrade(outcome.error);
      if (reason) {
        const rawDelay = Number(/** @type {any} */ (outcome.error)?.retryAfterMs);
        const delayMs = Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : 0;
        try {
          const { operationId } = await enqueueScrapeJob({
            platform, action, options, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, delayMs,
          });
          logGatewayLine({
            platform, action, consumerId, mode: 'async',
            degradedReason: reason, retryAfterMs: delayMs || RETRY_AFTER_DEFAULT_MS,
            upstreamStatus: typeof /** @type {any} */ (outcome.error)?.statusCode === 'number' ? /** @type {any} */ (outcome.error).statusCode : undefined,
            durationMs: Date.now() - startedAt, requestId,
          });
          return {
            platform,
            success: true,
            status: 'degraded',
            operationId,
            degraded_reason: reason,
            retry_after_ms: delayMs || RETRY_AFTER_DEFAULT_MS,
            statusUrl: statusUrl(operationId),
          };
        } catch (enqErr) {
          return { platform, success: false, status: 'failed', error: entryError(/** @type {any} */ (enqErr)?.isDispatchValidation ? outcome.error : enqErr) };
        }
      }
      return { platform, success: false, status: 'failed', error: entryError(outcome.error) };
    }
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Dispatch a scrape request. Returns an outcome descriptor — the route owns
 * every `res` write.
 *
 * Story 50.3 threads `requestId`/`traceparent` end-to-end: every outcome
 * (2xx envelope + every error body) carries `request_id` so the consumer can
 * correlate the call, and `traceparent` lands in `metadata` when present.
 *
 * @param {{ pathPlatform: string, body: Record<string, unknown>, action: string, userId: string | null, accountIds?: string[], consumer?: Record<string, unknown> | null, requestId?: string, traceparent?: string }} args
 * @returns {Promise<{ kind: 'json', status: number, body: Record<string, unknown>, headers?: Record<string, string> }>}
 */
export async function dispatch({ pathPlatform, body = {}, action, userId, accountIds, consumer, requestId, traceparent }) {
  const dispatchStartedAt = Date.now();
  // Request-level mode validation — closed enum, whole-request 400.
  const requestedMode = body.mode;
  if (requestedMode !== undefined && requestedMode !== 'sync' && requestedMode !== 'async') {
    return validationOutcome("mode must be 'sync' or 'async'", requestId);
  }

  // callbackUrl is a dispatch field — hoisted into the Bull job config where
  // the completed/failed handlers' deliverCallback() can fire it; it must not
  // land inside scraper options.
  const callbackUrl = typeof body.callbackUrl === 'string' && body.callbackUrl ? body.callbackUrl : undefined;

  const registry = await getRegistry();
  const { PLATFORM_ALIASES } = /** @type {{ PLATFORM_ALIASES: Record<string, string> }} */ (await import('../routes/platform.js'));
  const resolved = resolveTargets(pathPlatform, body.platform, registry.DESCRIPTORS, PLATFORM_ALIASES);
  if ('error' in resolved) {
    // resolveTargets emits validationOutcome bodies — re-stamp request_id.
    if (requestId && resolved.error?.body?.error && typeof resolved.error.body.error === 'object') {
      resolved.error.body.error.request_id = requestId;
    }
    return resolved.error;
  }

  const options = sanitizeOptions(body);
  const dryRun = Boolean(body.dryRun);
  const consumerCtx = consumer && typeof consumer === 'object'
    ? {
        consumerId: typeof consumer.consumerId === 'string' ? consumer.consumerId : 'internal',
        apiKeyValid: consumer.apiKeyValid !== false,
        apiKeyRequired: consumer.source === 'serviceAuth',
      }
    : { consumerId: 'internal', apiKeyValid: true, apiKeyRequired: false };
  // consumerId is service-lane attribution ONLY — JWT/anonymous rows store
  // null so the indexed Operation.consumerId column isn't conflated.
  const apiKeyRequired = consumerCtx.apiKeyRequired === true;
  const consumerId = apiKeyRequired ? /** @type {string} */ (consumerCtx.consumerId) : null;

  if (!resolved.batch) {
    return dispatchSingle({
      platform: resolved.platform,
      action,
      options,
      requestedMode,
      userId,
      consumerId,
      apiKeyRequired,
      callbackUrl,
      accountIds,
      consumerCtx,
      dryRun,
      registry,
      requestId,
      traceparent,
    });
  }

  const settled = await Promise.allSettled(
    resolved.targets.map((target) => dispatchEntry(target, {
      action, options, requestedMode, userId, consumerId, apiKeyRequired, callbackUrl, accountIds, consumerCtx, registry, requestId,
    })),
  );

  const results = settled.map((s, i) => s.status === 'fulfilled'
    ? s.value
    : {
        platform: String(resolved.targets[i]?.raw ?? 'unknown'),
        success: false,
        status: 'failed',
        error: { code: 'XACT_5000', kind: 'internal', type: 'internal', message: s.reason instanceof Error ? s.reason.message : String(s.reason) },
      });

  const platformsList = resolved.targets
    .map((t) => t.canonical || (typeof t.raw === 'string' ? t.raw : String(t.raw)))
    .filter(Boolean);
  const batchMetadata = buildMetadata({
    requestId,
    traceparent,
    platforms: platformsList,
    action,
    consumerId: typeof consumerCtx?.consumerId === 'string' ? consumerCtx.consumerId : 'internal',
    durationMs: Date.now() - dispatchStartedAt,
    dryRun,
  });
  // data = concat of every 'completed' entry's normalized payload (verbatim);
  // preview = its ≤10 slice. Per-entry `status`/`success` semantics unchanged.
  const batchData = results
    .filter((r) => r.status === 'completed')
    .flatMap((r) => normalizeData(r.data));

  // Top-level mode mirrors the HTTP response lane: 'async' only on the
  // caller-requested 202 path; default/mixed batches land on 200/'sync'.
  if (requestedMode === 'async') {
    const operationIds = results.map((r) => r.operationId).filter(Boolean);
    // Every entry failed to enqueue → nothing is trackable → 503, not a
    // 202 that promises pollable operationIds it doesn't have. Partial
    // success stays 202 with the per-entry results.
    if (operationIds.length === 0) {
      const out = unavailableOutcome('no scrape jobs could be queued', requestId);
      out.body.results = results;
      return out;
    }
    return jsonOutcome(202, successEnvelope({
      mode: 'async',
      metadata: batchMetadata,
      stream: await buildStreamBlock({ withCursor: false }),
      data: batchData,
      extra: { results, operationIds },
    }));
  }
  return jsonOutcome(200, successEnvelope({
    mode: 'sync',
    metadata: batchMetadata,
    stream: await buildStreamBlock({ withCursor: false }),
    data: batchData,
    extra: { results },
  }));
}
