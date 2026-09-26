// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Browser-side typed API helper for client components.
 * Uses `import type` only from @xactions/api-client to prevent bundling
 * the entire node/browser client runtime down to the browser.
 *
 * All requests route through the same-origin BFF (/api/*).
 * Returns the canonical ApiResult<T> union ({ok, status, data|error})
 * defined by @xactions/api-client — matching XActionsClient.request() semantics.
 */

import type { ApiResult } from '@xactions/api-client';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface ApiOptions {
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

interface BackendEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/**
 * Executes a same-origin API call through the Next.js BFF proxy.
 *
 * @param method HTTP verb
 * @param path Endpoint path, e.g. '/api/health' or '/api/crm/tag'
 * @param opts Options including body, headers, search params, and abort signal
 * @returns ApiResult<T> union ({ok, status, data|error}) from @xactions/api-client
 */
export async function api<T = unknown>(
  method: HttpMethod,
  path: string,
  opts: ApiOptions = {}
): Promise<ApiResult<T>> {
  // Ensure path starts with /
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Append query params if present
  if (opts.params) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(opts.params)) {
      if (val !== undefined) {
        searchParams.set(key, String(val));
      }
    }
    const query = searchParams.toString();
    if (query) {
      normalizedPath += (normalizedPath.includes('?') ? '&' : '?') + query;
    }
  }

  const headers: Record<string, string> = {
    ...opts.headers,
  };

  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (
      typeof opts.body === 'string' ||
      opts.body instanceof FormData ||
      opts.body instanceof Blob ||
      opts.body instanceof ArrayBuffer
    ) {
      body = opts.body as BodyInit;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  try {
    const res = await fetch(normalizedPath, {
      method,
      headers,
      body,
      signal: opts.signal,
    });

    const status = res.status;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text && ct.includes('application/json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else if (text) {
      parsed = text;
    }

    if (status >= 200 && status < 300) {
      // Unbox canonical backend envelope {success:true, data:T} when present.
      // Story 50.3 regression gate (D-1): the unified GATEWAY envelope also
      // carries {success:true, data:[]} but must NOT be unboxed — its 202
      // async body has `data:[]` which would unbox to `[]` and break
      // isAsyncAccepted()/pollOperation on the pumpfun page. Discriminate on
      // gateway-only keys (mode/operationId/metadata) — the canonical
      // {success,data,page?} envelope never carries them.
      const isObj = typeof parsed === 'object' && parsed !== null;
      const isGatewayEnvelope =
        isObj && ('mode' in parsed || 'operationId' in parsed || 'metadata' in parsed);
      const isEnvelope =
        isObj && 'success' in parsed && 'data' in parsed && !isGatewayEnvelope;
      const data: T = isEnvelope
        ? ((parsed as BackendEnvelope<T>).data as T)
        : (parsed as T);
      return { ok: true, status, data };
    }

    // Extract error payload from canonical envelope or raw object
    const isObj = typeof parsed === 'object' && parsed !== null;
    const envelopeError =
      isObj && 'error' in (parsed as object)
        ? (parsed as BackendEnvelope<unknown>).error
        : undefined;
    const errorPayload =
      envelopeError ??
      (isObj
        ? (parsed as { code?: string; message?: string })
        : { code: `HTTP_${status}`, message: String(parsed ?? res.statusText) });

    return {
      ok: false,
      status,
      error: errorPayload,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Failed to fetch',
      },
    };
  }
}
