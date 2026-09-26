// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Async scrape-operation polling — Story 50.2 (D-1).
 *
 * The scrape gateway returns `202 {mode:'async', operationId, statusUrl,
 * retry_after_ms?}` for explicit-async and degraded work; this module owns
 * the `GET <statusUrl>` polling loop so consumers get the same shape a sync
 * call would have produced.
 *
 * Testability (repo mandate: injected seams, no vi.mock): the api impl and
 * poll interval are injectable via `_setPollApiImpl` / `_setPollIntervalMs`
 * and restored by `_resetPollSeams`.
 */

import type { ApiErrorPayload, ApiResult } from '@xactions/api-client';
import { api } from './api';

/** 202 async accept body emitted by the mode-dispatch gateway (Story 50.2). */
export interface AsyncAccepted {
  mode?: string;
  operationId?: string;
  statusUrl?: string;
  degraded_reason?: string;
  retry_after_ms?: number;
}

/** Shape of GET /api/ai/action/status/:id `data` (post-envelope unwrap). */
export interface OperationStatusData<T> {
  status?: string;
  result?: T | null;
  error?: { message?: string } | string | null;
}

const ASYNC_POLL_INTERVAL_MS = 2_000;
// Poll cap must exceed the longest async action (~120s stream_mint_chat
// durationMs at CHAT_DURATIONS max) — 130s, not 60s (D-1).
const ASYNC_POLL_CAP_MS = 130_000;
// Transient 5xx / network blips (e.g. a prisma hiccup behind the status
// route) are tolerated up to this many CONSECUTIVE failures before giving up.
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

type ApiImpl = <T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS',
  path: string,
  opts?: { signal?: AbortSignal },
) => Promise<ApiResult<T>>;

let _apiImpl: ApiImpl = api;
let _pollIntervalMs = ASYNC_POLL_INTERVAL_MS;

/** Test seam — swap the api implementation (no vi.mock). */
export function _setPollApiImpl(fn: ApiImpl | null): void {
  _apiImpl = typeof fn === 'function' ? fn : api;
}

/** Test seam — shrink the poll interval so tests don't wait real seconds. */
export function _setPollIntervalMs(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) _pollIntervalMs = ms;
}

export function _resetPollSeams(): void {
  _apiImpl = api;
  _pollIntervalMs = ASYNC_POLL_INTERVAL_MS;
}

/**
 * Whether a POST /scrape body is a 202 async accept (explicit or degraded).
 */
export function isAsyncAccepted(data: unknown): data is AsyncAccepted {
  const d = data as AsyncAccepted | null | undefined;
  return !!d && typeof d === 'object'
    && d.mode === 'async'
    && typeof d.statusUrl === 'string'
    && d.statusUrl.length > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timeoutResult<T>(): ApiResult<T> {
  return {
    ok: false,
    status: 408,
    error: { code: 'ASYNC_TIMEOUT', message: 'Timed out waiting for the scrape job (~130s)' },
  };
}

function abortedResult<T>(): ApiResult<T> {
  return { ok: false, status: 0, error: { code: 'ABORTED', message: 'Request aborted' } };
}

/**
 * Poll `GET <statusUrl>` until the operation reaches a terminal state.
 * Returns the job result in the same shape the sync path produced.
 *
 * `firstDelayMs` honours the 202 `retry_after_ms` — the first poll waits at
 * least that long so a degrade hint isn't ignored. Transient failures
 * (network blip status:0 or any 5xx) are retried up to
 * MAX_CONSECUTIVE_POLL_FAILURES consecutive misses — a prisma blip must not
 * abandon a live job; a definitive 4xx returns immediately.
 */
export async function pollOperation<T>(
  statusUrl: string,
  signal?: AbortSignal,
  firstDelayMs?: number,
): Promise<ApiResult<T>> {
  const deadline = Date.now() + ASYNC_POLL_CAP_MS;
  let consecutiveFailures = 0;
  let pendingDelay = typeof firstDelayMs === 'number' && Number.isFinite(firstDelayMs) && firstDelayMs > 0
    ? Math.min(firstDelayMs, ASYNC_POLL_CAP_MS)
    : 0;

  for (;;) {
    if (signal?.aborted) return abortedResult();
    if (pendingDelay > 0) {
      await sleep(pendingDelay);
      pendingDelay = 0;
    }
    if (signal?.aborted) return abortedResult();
    if (Date.now() >= deadline) return timeoutResult();

    const res = await _apiImpl<OperationStatusData<T>>('GET', statusUrl, { signal });
    if (res.ok && res.data) {
      consecutiveFailures = 0;
      const status = res.data.status;
      if (status === 'completed') {
        return { ok: true, status: 200, data: (res.data.result ?? null) as T };
      }
      if (status === 'failed' || status === 'cancelled') {
        const err = res.data.error;
        const msg = typeof err === 'string' ? err : err?.message || 'Scrape job failed';
        return { ok: false, status: 500, error: { code: 'JOB_FAILED', message: msg } };
      }
      // queued / processing / retry flap → keep polling
    } else if (!res.ok) {
      const status = res.status;
      if (status !== 0 && status < 500) {
        // Definitive HTTP failure (4xx) — don't burn the whole cap.
        return res as unknown as ApiResult<T>;
      }
      // Transient (5xx / network) — tolerate up to N consecutive misses.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        // Union still includes ApiPaymentRequired whose error.message is
        // `unknown` (index signature) — coerce via ApiErrorPayload.
        const upstream = (res.error as ApiErrorPayload | undefined)?.message;
        return {
          ok: false,
          status: status || 503,
          error: {
            code: 'STATUS_POLL_FAILED',
            message: upstream || 'Status check failed repeatedly — the job may still be running',
          },
        };
      }
    }

    if (Date.now() >= deadline) return timeoutResult();
    await sleep(_pollIntervalMs);
  }
}
