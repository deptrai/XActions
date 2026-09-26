// tests/web/api-envelope-guard.test.js
// Story 50.3 regression gate (D-1): apps/web/lib/api.ts `api()` must NOT
// unbox the unified GATEWAY envelope. A 202 async body carries
// `{success:true, mode:'async', operationId, data:[]}` — unboxing would turn
// res.data into `[]` and break isAsyncAccepted()/pollOperation on the
// pumpfun page. The canonical `{success:true, data:T}` envelope still unboxes.
//
// fetch is swapped with a real function returning Response-shaped objects —
// an injected transport seam, not a module mock (repo mandate).
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;

/** Build a minimal Response-shaped object api() can consume. */
function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

let api;
beforeEach(async () => {
  ({ api } = await import('../../apps/web/lib/api.ts'));
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('api() — gateway envelope unbox guard (Story 50.3 D-1)', () => {
  it('canonical {success:true, data:T} STILL unboxes (envelope semantics preserved)', async () => {
    globalThis.fetch = async () => jsonResponse(200, { success: true, data: { coins: 7 } });
    const res = await api('GET', '/api/health');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ coins: 7 });
  });

  it('gateway 202 {success,mode,operationId,data:[]} is NOT unboxed — res.data is the full envelope', async () => {
    const env = {
      success: true,
      ok: true,
      mode: 'async',
      operationId: 'opq_1',
      statusUrl: '/api/ai/action/status/opq_1',
      metadata: { request_id: 'req_1_abcd1234' },
      stream: { enabled: false },
      preview: [],
      data: [],
    };
    globalThis.fetch = async () => jsonResponse(202, env);
    const res = await api('POST', '/api/platform/pumpfun/scrape', { body: { action: 'x' } });
    expect(res.ok).toBe(true);
    // THE regression: unboxed would be `[]` → isAsyncAccepted fails → poll dies.
    expect(res.data).toEqual(env);
    expect(res.data.mode).toBe('async');
    expect(res.data.operationId).toBe('opq_1');
  });

  it('gateway 200 sync {success,mode,metadata,data:[...]} is NOT unboxed — pumpfun scrape() reads env.result', async () => {
    const env = {
      success: true,
      ok: true,
      mode: 'sync',
      metadata: { request_id: 'req_2_beef5678', platform: 'pumpfun' },
      stream: { enabled: false },
      preview: [{ mint: 'So111' }],
      data: [{ mint: 'So111' }],
      result: { mint: 'So111' }, // deprecated verbatim mirror the page reads
    };
    globalThis.fetch = async () => jsonResponse(200, env);
    const res = await api('POST', '/api/platform/pumpfun/scrape', { body: { action: 'fetch_coin_meta' } });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(env);
    // The pumpfun page's scrape() helper does `'result' in env` then reads
    // env.result — surviving means the whole envelope reached res.data.
    expect('result' in res.data).toBe(true);
    expect(res.data.result).toEqual({ mint: 'So111' });
  });

  it('canonical envelope {success:true, data, page?} unboxes (page key does not trigger guard)', async () => {
    globalThis.fetch = async () => jsonResponse(200, {
      success: true,
      data: [1, 2],
      page: { cursor: 'c', limit: 25 },
    });
    const res = await api('GET', '/api/list');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual([1, 2]);
  });

  it('non-envelope payloads pass through untouched', async () => {
    globalThis.fetch = async () => jsonResponse(200, { hello: 'world' });
    const res = await api('GET', '/api/raw');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ hello: 'world' });
  });
});
