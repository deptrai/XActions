// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BrowserPool unit tests — Story 53.1 (Epic 53 / AD-24)
 * Tests the pool contract with mocked stealthBrowser layer (no real Chrome).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock stealthBrowser before importing the pool ────────────────────────────
const mocks = vi.hoisted(() => {
  /** @type {{ launches: any[], teardowns: any[], launchError: any, launchErrorsByEndpoint: Record<string, any>, nextBackend: string, spawnedChildren: any[] }} */
  const state = {
    launches: [],
    teardowns: [],
    launchError: null,
    launchErrorsByEndpoint: {},
    nextBackend: 'chrome',
    spawnedChildren: [],
  };
  /** @param {string} [backend] */
  function makeFakeBrowser(backend) {
    /** @type {Record<string, Set<Function>>} */
    const listeners = {};
    /** @type {any} */
    const browser = {
      __backend: backend,
      __fingerprint: { userAgent: 'TEST-UA', locale: 'en-US' },
      _contexts: 0,
      _alive: true,
      // Minimal EventEmitter surface — pool attaches 'disconnected'.
      /** @param {string} event @param {Function} fn */
      on(event, fn) { (listeners[event] ||= new Set()).add(fn); return browser; },
      /** @param {string} event @param {Function} fn */
      off(event, fn) { listeners[event]?.delete(fn); return browser; },
      /** @param {string} event @param {...any} args */
      emit(event, ...args) { for (const fn of listeners[event] || []) fn(...args); return true; },
      isConnected() { return browser._alive; },
      /** Simulate a process crash: isConnected→false + fire 'disconnected'. */
      crash() { browser._alive = false; browser.emit('disconnected'); },
      async createBrowserContext() {
        const ctx = {
          _id: ++browser._contexts,
          _closed: false,
          _pages: 0,
          async newPage() {
            return { _ctx: ctx, _id: ++ctx._pages, _closed: false, async close() { this._closed = true; }, __backend: backend };
          },
          async close() { ctx._closed = true; },
        };
        return ctx;
      },
      async newPage() {
        return { _ctx: null, _id: ++browser._contexts, _closed: false, async close() { this._closed = true; }, __backend: backend };
      },
      async close() { browser._closed = true; browser._alive = false; },
      async disconnect() { browser._disconnected = true; browser._alive = false; },
    };
    return browser;
  }
  return {
    state,
    makeFakeBrowser,
    launchStealthBrowser: vi.fn(async (opts) => {
      if (opts.wsEndpoint && state.launchErrorsByEndpoint[opts.wsEndpoint]) {
        throw state.launchErrorsByEndpoint[opts.wsEndpoint];
      }
      if (state.launchError) throw state.launchError;
      const b = makeFakeBrowser(opts.backend === 'obscura' ? 'obscura' : (state.nextBackend || 'chrome'));
      state.launches.push({ opts, browser: b });
      return b;
    }),
    createStealthPage: vi.fn(async (src, opts) => {
      const page = await src.newPage();
      page.__stealthOpts = opts;
      return page;
    }),
    closeStealthBrowser: vi.fn(async (browser) => {
      state.teardowns.push(browser);
      if (browser.__backend === 'obscura') await browser.disconnect();
      else await browser.close();
    }),
  };
});

vi.mock('../../src/scraping/stealthBrowser.js', () => ({
  launchStealthBrowser: mocks.launchStealthBrowser,
  createStealthPage: mocks.createStealthPage,
  closeStealthBrowser: mocks.closeStealthBrowser,
}));

vi.mock('child_process', () => ({
  spawn: vi.fn((bin, args) => {
    const child = { bin, args, on: vi.fn(), kill: vi.fn() };
    mocks.state.spawnedChildren.push(child);
    return child;
  }),
}));

import { BrowserPool, SharedContextPool, PoolDrainingError, PoolAcquireTimeoutError } from '../../src/scraping/browserPool.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('BrowserPool', () => {
  beforeEach(() => {
    mocks.state.launches.length = 0;
    mocks.state.teardowns.length = 0;
    mocks.state.launchError = null;
    mocks.state.launchErrorsByEndpoint = {};
    mocks.state.nextBackend = 'chrome';
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('HAPPY_ACQUIRE — acquire trả page trong isolated context + stats đúng', async () => {
    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
    const acq = await pool.acquire();
    expect(acq.page).toBeTruthy();
    expect(acq.context).toBeTruthy(); // isolated context
    expect(acq.backend).toBe('chrome');
    expect(typeof acq.waitMs).toBe('number');
    expect(typeof acq.pageMs).toBe('number');
    expect(pool.stats().active).toBe(1);
    expect(pool.stats().browsers).toBe(1);
    // fingerprint từ browser được propagate xuống createStealthPage
    expect(/** @type {any} */ (acq.page).__stealthOpts.fingerprint?.userAgent).toBe('TEST-UA');
    await pool.release(acq.page);
    await pool.drain();
  });

  it('BACKPRESSURE — hết slot → FIFO queue, waiter thứ N chỉ được phục vụ khi có release', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    /** @type {string[]} */
    const order = [];
    const a = await pool.acquire();
    const b = await pool.acquire();
    const p3 = pool.acquire().then((r) => { order.push('c'); return r; });
    const p4 = pool.acquire().then((r) => { order.push('d'); return r; });
    await tick();
    expect(pool.stats()).toMatchObject({ active: 2, queued: 2 });
    await pool.release(a.page);
    await tick();
    expect(order).toEqual(['c']);
    await pool.release(b.page);
    await tick();
    const c = await p3;
    const d = await p4;
    expect(order).toEqual(['c', 'd']); // FIFO
    expect(c.waitMs).toBeGreaterThanOrEqual(0);
    expect(d.waitMs).toBeGreaterThan(c.waitMs); // d queued longer
    await pool.release(c.page);
    await pool.release(d.page);
    await pool.drain();
  });

  it('ACQUIRE_TIMEOUT — waiter quá acquireTimeoutMs → PoolAcquireTimeoutError', async () => {
    const pool = new BrowserPool({ size: 1, backend: 'chrome', acquireTimeoutMs: 40 });
    const a = await pool.acquire();
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
    await pool.release(a.page);
    await pool.drain();
  });

  it('CEILING_SPAWN — vượt contextsPerBrowser → spawn browser thứ hai', async () => {
    const pool = new BrowserPool({ size: 6, contextsPerBrowser: 2, backend: 'chrome' });
    const acqs = [await pool.acquire(), await pool.acquire(), await pool.acquire()];
    // 3 contexts > ceiling 2 → browser thứ hai đã spawn
    expect(mocks.state.launches.length).toBe(2);
    expect(pool.stats().browsers).toBe(2);
    for (const a of acqs) await pool.release(a.page);
    await pool.drain();
  });

  it('ISOLATION — hai acquire trả hai context khác nhau, pages thuộc đúng context', async () => {
    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
    const a = await pool.acquire();
    const b = await pool.acquire();
    expect(a.context).not.toBe(b.context);
    // Each page belongs to its own context (mock pages carry _ctx backref)
    expect(/** @type {any} */ (a.page)._ctx).toBe(a.context);
    expect(/** @type {any} */ (b.page)._ctx).toBe(b.context);
    expect(/** @type {any} */ (a.page)._ctx).not.toBe(/** @type {any} */ (b.page)._ctx);
    // createBrowserContext called per acquire — distinct invocations
    const browser = mocks.state.launches[0].browser;
    expect(browser._contexts).toBe(2);
    await pool.release(a.page);
    await pool.release(b.page);
    await pool.drain();
  });

  it('RELEASE_CLEAN — release đóng page+context, browser sống, slot được trả', async () => {
    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
    const a = await pool.acquire();
    const browser = mocks.state.launches[0].browser;
    await pool.release(a.page);
    expect(/** @type {any} */ (a.page)._closed).toBe(true);
    expect(/** @type {any} */ (a.context)._closed).toBe(true);
    expect(browser._closed).toBeUndefined(); // browser NOT closed
    expect(pool.stats().active).toBe(0);
    // acquire tiếp được — browser vẫn phục vụ
    const b = await pool.acquire();
    await pool.release(b.page);
    await pool.drain();
  });

  it('DRAIN — reject waiters, đợi in-flight, teardown browser theo backend, idempotent', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const a = await pool.acquire();
    const waiter = pool.acquire(); // will queue? size 2, only 1 active → this gets a slot
    const b = await waiter;
    const queued = pool.acquire();
    await tick();
    expect(pool.stats().queued).toBe(1);

    const d1 = pool.drain();
    await expect(queued).rejects.toBeInstanceOf(PoolDrainingError);
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolDrainingError);

    // in-flight chưa release → drain đang chờ
    await pool.release(a.page);
    await pool.release(b.page);
    await d1;
    expect(mocks.state.teardowns.length).toBe(1);
    // idempotent — same promise
    expect(pool.drain()).toBe(d1);
  });

  it('REQUIRES_AUTH — launch guard propagate lỗi', async () => {
    mocks.state.launchError = new Error('obscura backend không hỗ trợ post-auth');
    const pool = new BrowserPool({ backend: 'obscura', requiresAuth: true });
    await expect(pool.acquire()).rejects.toThrow(/post-auth/);
  });

  it('LAUNCH_FAIL — acquire fail giải phóng slot, waiter sau vẫn được phục vụ', async () => {
    mocks.state.launchError = new Error('boom');
    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
    await expect(pool.acquire()).rejects.toThrow(/launch failed.*boom/);
    expect(pool.stats().active).toBe(0);
    mocks.state.launchError = null;
    const a = await pool.acquire(); // slot not leaked
    expect(pool.stats().active).toBe(1);
    await pool.release(a.page);
    await pool.drain();
  });

  it('OBSCURA_BACKEND — default contextsPerBrowser=3, teardown qua disconnect', async () => {
    mocks.state.nextBackend = 'obscura';
    const pool = new BrowserPool({ size: 4, backend: 'obscura', wsEndpoint: 'ws://x' });
    const a = await pool.acquire();
    expect(mocks.launchStealthBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'obscura', wsEndpoint: 'ws://x/', fallbackBackend: 'none' })
    );
    await pool.release(a.page);
    await pool.drain();
    expect(mocks.state.teardowns[0]._disconnected).toBe(true);
  });

  it('release() page không thuộc pool → no-op', async () => {
    const pool = new BrowserPool({ size: 1 });
    await expect(pool.release(/** @type {any} */ ({ close: async () => {} }))).resolves.toBeUndefined();
    await pool.drain();
  });

  it('CONCURRENT_ACQUIRE — N acquires đồng thời share 1 browser khi còn headroom', async () => {
    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
    const [a, b, c, d] = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);
    expect(mocks.state.launches.length).toBe(1); // 1 browser, 4 contexts
    expect(pool.stats().browsers).toBe(1);
    for (const acq of [a, b, c, d]) await pool.release(acq.page);
    await pool.drain();
  });

  it('CONCURRENT_CEILING — concurrent acquires không vượt contextsPerBrowser', async () => {
    const pool = new BrowserPool({ size: 6, contextsPerBrowser: 2, backend: 'chrome' });
    const acqs = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);
    // 5 concurrent contexts, ceiling=2 → 3 browsers needed (2+2+1)
    expect(mocks.state.launches.length).toBe(3);
    expect(pool.stats().browsers).toBe(3);
    for (const a of acqs) await pool.release(a.page);
    await pool.drain();
  });

  it('DRAIN_ACQUIRE_FAIL — drain() resolve khi in-flight acquire fail', async () => {
    // Launch succeeds but createBrowserContext fails → acquire() in-flight throws
    mocks.state.launchError = null;
    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
    mocks.launchStealthBrowser.mockImplementationOnce(async (opts) => {
      const b = mocks.makeFakeBrowser('chrome');
      b.createBrowserContext = async () => { await sleep(30); throw new Error('ctx fail'); };
      mocks.state.launches.push({ opts, browser: b });
      return b;
    });
    const acqPromise = pool.acquire(); // in-flight: slot granted, context creating
    await sleep(5); // ensure acquire is in-flight
    const drainPromise = pool.drain();
    await expect(acqPromise).rejects.toThrow('ctx fail');
    await drainPromise; // must not hang — the deadlock bug
  });

  it('DRAIN_NO_SLOT — acquire() khi đang drain → PoolDrainingError ngay', async () => {
    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
    const a = await pool.acquire();
    const d = pool.drain();
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolDrainingError);
    await pool.release(a.page);
    await d;
  });

  it('CONTEXT_ORPHAN — createStealthPage fail → context cleanup, không chiếm slot', async () => {
    mocks.createStealthPage.mockImplementationOnce(async () => { throw new Error('page fail'); });
    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
    await expect(pool.acquire()).rejects.toThrow('page fail');
    expect(pool.stats().active).toBe(0);
    // Context was cleaned up — browser still usable for next acquire
    const a = await pool.acquire();
    expect(pool.stats().active).toBe(1);
    await pool.release(a.page);
    await pool.drain();
  });

  it('SIZE_ZERO — pool size 0 honored (không bị coerce thành 4)', async () => {
    const pool = new BrowserPool({ size: 0, backend: 'chrome', acquireTimeoutMs: 20 });
    expect(pool.stats().size).toBe(0);
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
  });

  it('SHARED_CONCURRENT — SharedContextPool concurrent acquires share 1 browser', async () => {
    const pool = new SharedContextPool({ size: 4, backend: 'chrome' });
    const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
    expect(mocks.state.launches.length).toBe(1);
    expect(a.context).toBeNull();
    expect(b.context).toBeNull();
    await pool.release(a.page);
    await pool.release(b.page);
    await pool.drain();
  });
});

describe('SharedContextPool (opt-in, public anon only)', () => {
  beforeEach(() => {
    mocks.state.launches.length = 0;
    mocks.state.teardowns.length = 0;
    mocks.state.launchError = null;
    vi.clearAllMocks();
  });

  it('SHARED_POOL_OPT — context=null, release chỉ close page', async () => {
    const pool = new SharedContextPool({ size: 2, backend: 'chrome' });
    const a = await pool.acquire();
    const b = await pool.acquire();
    expect(a.context).toBeNull();
    expect(b.context).toBeNull();
    await pool.release(a.page);
    expect(/** @type {any} */ (a.page)._closed).toBe(true);
    await pool.release(b.page);
    await pool.drain();
    expect(mocks.state.teardowns.length).toBe(1);
  });
});

describe('Story 53.4 — Obscura pool-of-processes shard strategy', () => {
  beforeEach(() => {
    mocks.state.launches.length = 0;
    mocks.state.teardowns.length = 0;
    mocks.state.launchError = null;
    mocks.state.launchErrorsByEndpoint = {};
    mocks.state.nextBackend = 'obscura';
    mocks.state.spawnedChildren.length = 0;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('FLEET_MULTI — 2 endpoints fleet, size 8, pagesPerProcess 4: leases distribute and stats reflect pages/pending', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 8, pagesPerProcess: 4, backend: 'obscura' });

    expect(pool.stats().capacity).toBe(8);
    expect(pool.stats().endpoints).toHaveLength(2);

    const acqs = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);

    // 8 leases across 2 endpoints with ceiling 4: each endpoint must have exactly 4 pages
    const stats = pool.stats();
    expect(stats.active).toBe(8);
    expect(stats.endpoints).toHaveLength(2);
    expect(stats.endpoints?.[0].pages).toBe(4);
    expect(stats.endpoints?.[0].pending).toBe(0);
    expect(stats.endpoints?.[1].pages).toBe(4);
    expect(stats.endpoints?.[1].pending).toBe(0);

    const endpointsUsed = new Set(acqs.map((a) => a.endpoint));
    expect(endpointsUsed.size).toBe(2);
    expect(endpointsUsed.has('ws://127.0.0.1:9222/')).toBe(true);
    expect(endpointsUsed.has('ws://127.0.0.1:9223/')).toBe(true);

    for (const a of acqs) {
      await pool.release(a.page);
    }
    await pool.drain();
  });

  it('FLEET_FALLBACK — singular OBSCURA_WS_ENDPOINT fallback when OBSCURA_WS_ENDPOINTS unset', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINT', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ size: 4, backend: 'obscura' });

    expect(pool.stats().capacity).toBe(3); // 1 endpoint * default 3 pagesPerProcess
    expect(pool.stats().endpoints).toHaveLength(1);
    expect(pool.stats().endpoints?.[0].endpoint).toBe('ws://127.0.0.1:9222/');

    const acq = await pool.acquire();
    expect(acq.endpoint).toBe('ws://127.0.0.1:9222/');
    await pool.release(acq.page);
    await pool.drain();
  });

  it('PARSE_MALFORMED — malformed endpoint throws loudly with the offending entry', () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,not a url');
    expect(() => new BrowserPool({ backend: 'obscura' })).toThrow(/malformed.*not a url/);
  });

  it('PARSE_DEDUPE — duplicate endpoints after URL normalization are deduped to 1', () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222, ws://127.0.0.1:9222/');
    const pool = new BrowserPool({ backend: 'obscura' });
    expect(pool.stats().endpoints).toHaveLength(1);
    expect(pool.stats().endpoints?.[0].endpoint).toBe('ws://127.0.0.1:9222/');
  });

  it('CAPACITY_CLAMP — size clamped to capacity (2 * 4 = 8); 9th acquire queues and times out', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 16, pagesPerProcess: 4, backend: 'obscura', acquireTimeoutMs: 30 });

    expect(pool.stats().capacity).toBe(8);
    expect(pool.stats().size).toBe(8); // clamped from 16 to 8

    const acqs = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);

    // 9th acquire must queue and hit PoolAcquireTimeoutError
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolAcquireTimeoutError);

    for (const a of acqs) {
      await pool.release(a.page);
    }
    await pool.drain();
  });

  it('CONNECT_FAIL_SKIP — endpoint a fails, acquire skips to live endpoint b; wrapped error when all fail', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    mocks.state.launchErrorsByEndpoint['ws://127.0.0.1:9222/'] = new Error('ECONNREFUSED 9222');

    const pool = new BrowserPool({ size: 4, pagesPerProcess: 2, backend: 'obscura' });

    // Acquire should skip 9222 and land on 9223
    const acq = await pool.acquire();
    expect(acq.endpoint).toBe('ws://127.0.0.1:9223/');
    await pool.release(acq.page);

    // Now fail both endpoints
    mocks.state.launchErrorsByEndpoint['ws://127.0.0.1:9223/'] = new Error('ECONNREFUSED 9223');
    // Drain existing browser on 9223 to force reconnect
    await pool.drain();

    const poolAllDead = new BrowserPool({ size: 4, pagesPerProcess: 2, backend: 'obscura' });
    let thrownError = /** @type {any} */ (null);
    try {
      await poolAllDead.acquire();
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeTruthy();
    expect(thrownError.message).toMatch(/launch failed for backend 'obscura'/);
    expect(thrownError.cause).toBeTruthy();
    await poolAllDead.drain();
  });

  it('DRAIN_MID_CONNECT — drain() during in-flight connect disconnects browser and rejects with PoolDrainingError', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ size: 2, backend: 'obscura' });

    mocks.launchStealthBrowser.mockImplementationOnce(async (opts) => {
      await sleep(30);
      const b = mocks.makeFakeBrowser('obscura');
      mocks.state.launches.push({ opts, browser: b });
      return b;
    });

    const acqPromise = pool.acquire();
    await sleep(5); // ensure launch is in-flight
    const drainPromise = pool.drain();

    await expect(acqPromise).rejects.toBeInstanceOf(PoolDrainingError);
    await drainPromise;

    // Disconnected, not orphaned
    expect(mocks.state.teardowns.length).toBe(1);
    expect(mocks.state.teardowns[0]._disconnected).toBe(true);
  });

  it('ISOLATED_PER_JOB — multiple jobs on same endpoint get distinct contexts; null context throws wrapped error', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ size: 2, pagesPerProcess: 2, backend: 'obscura' });

    const a = await pool.acquire();
    const b = await pool.acquire();

    expect(a.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(b.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(a.context).not.toBe(b.context);

    await pool.release(a.page);
    await pool.release(b.page);
    await pool.drain();

    // Context failure does not fall back to shared default context
    const poolFail = new BrowserPool({ size: 1, backend: 'obscura' });
    mocks.launchStealthBrowser.mockImplementationOnce(async (opts) => {
      const fb = mocks.makeFakeBrowser('obscura');
      fb.createBrowserContext = /** @type {any} */ (async () => null); // returns null
      mocks.state.launches.push({ opts, browser: fb });
      return fb;
    });

    await expect(poolFail.acquire()).rejects.toThrow(/does not support isolated contexts/);
    await poolFail.drain();
  });

  it('SHARED_PIN — SharedContextPool on obscura pins endpoints[0] only', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    // ppp 4 → shared capacity = 1 process × 4 pages; size clamps to it
    const pool = new SharedContextPool({ size: 4, pagesPerProcess: 4, backend: 'obscura' });
    expect(pool.stats().capacity).toBe(4);

    const [a, b, c] = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(),
    ]);

    expect(a.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(b.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(c.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(a.context).toBeNull();
    expect(b.context).toBeNull();
    expect(c.context).toBeNull();

    // Only 1 launch happened (pinned to endpoint 0)
    expect(mocks.state.launches.length).toBe(1);
    expect(mocks.state.launches[0].opts.wsEndpoint).toBe('ws://127.0.0.1:9222/');

    await pool.release(a.page);
    await pool.release(b.page);
    await pool.release(c.page);
    await pool.drain();
  });

  it('CONFIG_VALIDATION — pagesPerProcess fallback on invalid numbers; MEDIRUS_BROWSER_PAGES_PER_PROCESS env; MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER clamped to [4,6]', () => {
    // Obscura pagesPerProcess validation
    const poolNeg = new BrowserPool({ backend: 'obscura', pagesPerProcess: -5 });
    expect(/** @type {any} */ (poolNeg)._pagesPerProcess).toBe(3);

    const poolZero = new BrowserPool({ backend: 'obscura', pagesPerProcess: 0 });
    expect(/** @type {any} */ (poolZero)._pagesPerProcess).toBe(3);

    const poolNaN = new BrowserPool({ backend: 'obscura', pagesPerProcess: NaN });
    expect(/** @type {any} */ (poolNaN)._pagesPerProcess).toBe(3);

    const poolValid = new BrowserPool({ backend: 'obscura', pagesPerProcess: 4 });
    expect(/** @type {any} */ (poolValid)._pagesPerProcess).toBe(4);

    // MEDIRUS_BROWSER_PAGES_PER_PROCESS env path
    vi.stubEnv('MEDIRUS_BROWSER_PAGES_PER_PROCESS', '5');
    const poolEnv = new BrowserPool({ backend: 'obscura' });
    expect(/** @type {any} */ (poolEnv)._pagesPerProcess).toBe(5);

    vi.stubEnv('MEDIRUS_BROWSER_PAGES_PER_PROCESS', 'invalid');
    const poolEnvBad = new BrowserPool({ backend: 'obscura' });
    expect(/** @type {any} */ (poolEnvBad)._pagesPerProcess).toBe(3);

    vi.stubEnv('MEDIRUS_BROWSER_PAGES_PER_PROCESS', '-1');
    const poolEnvNeg = new BrowserPool({ backend: 'obscura' });
    expect(/** @type {any} */ (poolEnvNeg)._pagesPerProcess).toBe(3);

    // options.pagesPerProcess wins over env
    vi.stubEnv('MEDIRUS_BROWSER_PAGES_PER_PROCESS', '9');
    const poolOptWins = new BrowserPool({ backend: 'obscura', pagesPerProcess: 2 });
    expect(/** @type {any} */ (poolOptWins)._pagesPerProcess).toBe(2);
    vi.unstubAllEnvs();

    // Chrome MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER clamping
    vi.stubEnv('MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER', '10');
    const poolClampHigh = new BrowserPool({ backend: 'chrome' });
    expect(/** @type {any} */ (poolClampHigh)._contextsPerBrowser).toBe(6);

    vi.stubEnv('MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER', '2');
    const poolClampLow = new BrowserPool({ backend: 'chrome' });
    expect(/** @type {any} */ (poolClampLow)._contextsPerBrowser).toBe(4);

    vi.stubEnv('MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER', '5');
    const poolInBand = new BrowserPool({ backend: 'chrome' });
    expect(/** @type {any} */ (poolInBand)._contextsPerBrowser).toBe(5);
  });

  it('RELEASE_HEADROOM — release frees obscura endpoint headroom; re-acquire lands on freed endpoint', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 2, backend: 'obscura' });

    const acqs = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);
    expect(pool.stats().endpoints?.[0].pages).toBe(2);
    expect(pool.stats().endpoints?.[1].pages).toBe(2);

    // Release one lease on each endpoint → pages drop back to 1
    const byEndpoint = new Map();
    for (const a of acqs) {
      if (!byEndpoint.has(a.endpoint)) byEndpoint.set(a.endpoint, a);
    }
    for (const a of byEndpoint.values()) {
      await pool.release(a.page);
    }
    const st = pool.stats();
    expect(st.endpoints?.[0].pages).toBe(1);
    expect(st.endpoints?.[1].pages).toBe(1);

    // Re-acquire succeeds immediately — headroom was actually freed
    const again = await pool.acquire();
    expect(again.endpoint).toBeTruthy();
    expect(pool.stats().active).toBe(3);

    for (const a of acqs) { await pool.release(a.page); }
    await pool.release(again.page);
    await pool.drain();
  });

  it('CONNECT_FAIL_LIVE_FULL — dead endpoint + saturated live endpoint → capacity error, not the connect error', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    mocks.state.launchErrorsByEndpoint['ws://127.0.0.1:9222/'] = new Error('ECONNREFUSED 9222');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 2, backend: 'obscura' });

    // Fill the live endpoint to its 2-page ceiling
    const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
    expect(a.endpoint).toBe('ws://127.0.0.1:9223/');
    expect(b.endpoint).toBe('ws://127.0.0.1:9223/');

    // Third acquire: dead endpoint skipped, live endpoint full → capacity
    // error naming the real condition, not the dead endpoint's connect error
    await expect(pool.acquire()).rejects.toThrow(/at capacity/);

    await pool.release(a.page);
    await pool.release(b.page);
    await pool.drain();
  });

  it('STATS_AFTER_DRAIN — stats().endpoints keeps fleet identity after drain', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 2, backend: 'obscura' });
    const acq = await pool.acquire();
    await pool.release(acq.page);
    await pool.drain();

    const st = pool.stats();
    expect(st.endpoints).toHaveLength(2);
    expect(st.endpoints?.[0].endpoint).toBe('ws://127.0.0.1:9222/');
    expect(st.endpoints?.[1].endpoint).toBe('ws://127.0.0.1:9223/');
    expect(st.capacity).toBe(4);
    expect(st.draining).toBe(true);
  });

  it('SHARED_CAPACITY — SharedContextPool on obscura fleet clamps size to one process ceiling', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new SharedContextPool({ size: 8, pagesPerProcess: 3, backend: 'obscura' });

    // Pinned to endpoint[0]: live capacity is 1 process * 3 pages, not 2 * 3
    expect(pool.stats().capacity).toBe(3);
    expect(pool.stats().size).toBe(3);

    const [a, b, c] = await Promise.all([
      pool.acquire(), pool.acquire(), pool.acquire(),
    ]);
    expect(a.endpoint).toBe('ws://127.0.0.1:9222/');
    expect(pool.stats().endpoints?.[0].pages).toBe(3);
    expect(pool.stats().endpoints?.[1].pages).toBe(0);

    await pool.release(a.page);
    await pool.release(b.page);
    await pool.release(c.page);
    await pool.drain();
  });

  it('FALLBACK_PARSE — singular endpoint normalized like the list; whitespace treated as unset', async () => {
    // Trailing-slash normalization applies to the singular fallback too
    vi.stubEnv('OBSCURA_WS_ENDPOINT', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ backend: 'obscura' });
    expect(pool.stats().endpoints?.[0].endpoint).toBe('ws://127.0.0.1:9222/');
    await pool.drain();

    // Whitespace-only → unset → falls through to the built-in default
    vi.stubEnv('OBSCURA_WS_ENDPOINT', '   ');
    const poolWs = new BrowserPool({ backend: 'obscura' });
    expect(poolWs.stats().endpoints?.[0].endpoint).toBe('ws://127.0.0.1:9222');
    await poolWs.drain();

    // Malformed singular → loud throw, same as list entries
    vi.stubEnv('OBSCURA_WS_ENDPOINT', 'not a url');
    expect(() => new BrowserPool({ backend: 'obscura' })).toThrow(/malformed/);

    // Non-ws protocol → loud throw
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'http://127.0.0.1:9222');
    expect(() => new BrowserPool({ backend: 'obscura' })).toThrow(/ws:\/\/ or wss/);
  });

  it('OBSCURA_BIN — dev auto-spawn creates ceil(size/ppp) children and drain kills them', async () => {
    vi.stubEnv('OBSCURA_BIN', '/fake/obscura');
    vi.stubEnv('OBSCURA_PORT_BASE', '9500');
    const pool = new BrowserPool({ size: 5, pagesPerProcess: 2, backend: 'obscura' });

    // ceil(5 / 2) = 3 children on consecutive ports
    expect(mocks.state.spawnedChildren).toHaveLength(3);
    expect(mocks.state.spawnedChildren[0].args).toEqual(['serve', '--port', '9500']);
    expect(mocks.state.spawnedChildren[2].args).toEqual(['serve', '--port', '9502']);
    // Every child has an 'error' listener — an unexecutable binary must not
    // crash the process with an unhandled error event
    for (const child of mocks.state.spawnedChildren) {
      expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    }
    expect(pool.stats().endpoints).toHaveLength(3);

    await pool.drain();
    for (const child of mocks.state.spawnedChildren) {
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    }
  });
});

describe('Story 53.5 — Crash containment: dead-browser detection, respawn', () => {
  beforeEach(() => {
    mocks.state.launches.length = 0;
    mocks.state.teardowns.length = 0;
    mocks.state.launchError = null;
    mocks.state.launchErrorsByEndpoint = {};
    mocks.state.nextBackend = 'chrome';
    mocks.state.spawnedChildren.length = 0;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('CHROME_CRASH_LAZY — browser fires disconnected → entry splice; acquire kế spawn browser mới', async () => {
    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
    const acq = await pool.acquire();
    expect(pool.stats().browsers).toBe(1);

    mocks.state.launches[0].browser.crash();
    expect(pool.stats().browsers).toBe(0);
    expect(pool.stats().respawns).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('dead browser'));

    // Lease in-flight trên browser chết vẫn release sạch
    await pool.release(acq.page);
    expect(pool.stats().active).toBe(0);

    const acq2 = await pool.acquire();
    expect(acq2.page).toBeTruthy();
    expect(pool.stats().browsers).toBe(1); // browser mới
    expect(mocks.state.launches).toHaveLength(2);
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('CHROME_CRASH_INFLIGHT — page trên browser crash: CDP reject tự nhiên, release free slot', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const acq = await pool.acquire();
    mocks.state.launches[0].browser.crash();

    // Giả lập job throw do "Target closed" — release vẫn free slot
    await pool.release(acq.page);
    expect(pool.stats().active).toBe(0);
    expect(pool.stats().respawns).toBe(1);

    // Job retry (Bull) acquire trên browser mới
    const acq2 = await pool.acquire();
    expect(pool.stats().browsers).toBe(1);
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('CHROME_CTX_THROW_DEAD — createBrowserContext throw trên dead browser → mark dead + retry spawn mới', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const acq1 = await pool.acquire(); // browser[0] live
    const b0 = mocks.state.launches[0].browser;
    // Chết mà listener miss (isConnected false, không emit) → pre-scan/catch path
    b0._alive = false;
    b0.createBrowserContext = async () => { throw new Error('Target closed'); };

    const acq2 = await pool.acquire(); // phải tự respawn + retry
    expect(acq2.page).toBeTruthy();
    expect(pool.stats().respawns).toBe(1);
    expect(pool.stats().browsers).toBe(1); // b0 splice, browser mới
    expect(mocks.state.launches).toHaveLength(2);
    await pool.release(acq1.page);
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('CHROME_CTX_THROW_ALIVE — createBrowserContext throw trên live browser → propagate, không mark dead', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const acq1 = await pool.acquire();
    const b0 = mocks.state.launches[0].browser;
    b0.createBrowserContext = async () => { throw new Error('transient ctx error'); };

    await expect(pool.acquire()).rejects.toThrow('transient ctx error');
    expect(pool.stats().respawns).toBe(0);
    expect(pool.stats().browsers).toBe(1); // entry còn nguyên
    await pool.release(acq1.page);
    await pool.drain();
  });

  it('OBSCURA_CONN_DROP — endpoint A disconnect → acquire kế rơi vào B hoặc reconnect A', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 4, backend: 'obscura' });
    const acq = await pool.acquire();
    expect(pool.stats().endpoints).toHaveLength(2);
    const browserA = mocks.state.launches[0].browser;
    browserA.crash();

    const stats = pool.stats();
    expect(stats.respawns).toBe(1);
    expect(stats.endpoints).toHaveLength(2); // fleet identity giữ
    const entryA = /** @type {any} */ (stats.endpoints).find((/** @type {any} */ e) => e.endpoint === 'ws://127.0.0.1:9222/');
    expect(entryA.pages).toBe(0); // contexts cleared

    await pool.release(acq.page);

    // Acquire kế: chọn entry còn sống hoặc reconnect A — phải thành công
    const acq2 = await pool.acquire();
    expect(acq2.page).toBeTruthy();
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('OBSCURA_CTX_THROW_DEAD — ctx throw trên dead endpoint → mark + retry entry khác', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 4, backend: 'obscura' });
    // Connect cả hai endpoints trước
    const a1 = await pool.acquire();
    const a2 = await pool.acquire();
    await pool.release(a1.page);
    await pool.release(a2.page);
    expect(mocks.state.launches).toHaveLength(2);

    // Endpoint A chết ngầm (listener miss) + ctx throw
    const browserA = mocks.state.launches[0].browser;
    browserA._alive = false;
    browserA.createBrowserContext = async () => { throw new Error('Session closed'); };

    const acq = await pool.acquire();
    expect(acq.page).toBeTruthy();
    expect(pool.stats().respawns).toBe(1);
    // pending invariant: mark-dead reset + finally decrement không được để pending âm
    const epA = /** @type {any} */ (pool.stats().endpoints).find((/** @type {any} */ e) => e.endpoint === 'ws://127.0.0.1:9222/');
    expect(epA.pending).toBe(0);
    // acq mới nằm trên A (reconnect) hoặc B — không vượt trần pagesPerProcess
    const epB = /** @type {any} */ (pool.stats().endpoints).find((/** @type {any} */ e) => e.endpoint === 'ws://127.0.0.1:9223/');
    expect(epA.pages + epB.pages).toBe(1);
    expect(epA.pages).toBeLessThanOrEqual(4);
    await pool.release(acq.page);
    await pool.drain();
  });

  it('OBSCURA_CTX_NULL_DEAD — ctx trả null trên dead endpoint → mark + retry, pending không âm', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222,ws://127.0.0.1:9223');
    const pool = new BrowserPool({ size: 4, pagesPerProcess: 4, backend: 'obscura' });
    const a1 = await pool.acquire();
    const a2 = await pool.acquire();
    await pool.release(a1.page);
    await pool.release(a2.page);

    const browserA = mocks.state.launches[0].browser;
    browserA._alive = false;
    browserA.createBrowserContext = async () => null;

    const acq = await pool.acquire();
    expect(acq.page).toBeTruthy();
    expect(pool.stats().respawns).toBe(1);
    const epA = /** @type {any} */ (pool.stats().endpoints).find((/** @type {any} */ e) => e.endpoint === 'ws://127.0.0.1:9222/');
    expect(epA.pending).toBe(0);
    await pool.release(acq.page);
    await pool.drain();
  });

  it('DOUBLE_DISCONNECT_CHROME — listener fire nhiều lần trên chrome → respawns chỉ +1', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const acq = await pool.acquire();
    const b0 = mocks.state.launches[0].browser;
    b0.crash();
    b0.emit('disconnected'); // lần 2 — idempotent
    expect(pool.stats().respawns).toBe(1);
    expect(pool.stats().browsers).toBe(0);
    await pool.release(acq.page);
    await pool.drain();
  });

  it('SHARED_OBSCURA_CRASH — SharedContextPool trên obscura: conn drop → acquire kế reconnect', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222');
    const pool = new SharedContextPool({ size: 2, backend: 'obscura' });
    const acq = await pool.acquire();
    expect(acq.context).toBeNull(); // shared mode
    mocks.state.launches[0].browser.crash();
    expect(pool.stats().respawns).toBe(1);
    await pool.release(acq.page);

    const acq2 = await pool.acquire();
    expect(acq2.page).toBeTruthy();
    expect(mocks.state.launches).toHaveLength(2); // reconnect endpoint
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('OBSCURA_CTX_THROW_ALIVE — ctx throw trên live endpoint → wrapped error, không mark dead', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ size: 2, pagesPerProcess: 4, backend: 'obscura' });
    const a1 = await pool.acquire();
    await pool.release(a1.page);

    const browserA = mocks.state.launches[0].browser;
    browserA.createBrowserContext = async () => { throw new Error('transient'); };

    await expect(pool.acquire()).rejects.toThrow('transient');
    expect(pool.stats().respawns).toBe(0);
    await pool.drain();
  });

  it('DRAIN_VS_DISCONNECT — drain() đang chạy khi disconnected fires → không respawn', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
    const acq = await pool.acquire();
    const drainP = pool.drain();
    // crash trong lúc drain → mark-dead chỉ clear, không đếm respawn
    mocks.state.launches[0].browser.crash();
    await pool.release(acq.page);
    await drainP;
    expect(pool.stats().respawns).toBe(0);
  });

  it('DOUBLE_DISCONNECT — listener fire 2 lần → respawns chỉ +1; stale browser không đụng entry mới', async () => {
    vi.stubEnv('OBSCURA_WS_ENDPOINTS', 'ws://127.0.0.1:9222');
    const pool = new BrowserPool({ size: 2, pagesPerProcess: 4, backend: 'obscura' });
    const acq1 = await pool.acquire();
    const b1 = mocks.state.launches[0].browser;
    b1.crash();
    b1.emit('disconnected'); // lần 2 — idempotent
    expect(pool.stats().respawns).toBe(1);

    // Acquire → reconnect → browser mới trên cùng endpoint slot
    const acq2 = await pool.acquire();
    expect(mocks.state.launches).toHaveLength(2);

    // stale disconnect của b1 sau respawn — không được đụng b2
    b1.emit('disconnected');
    expect(pool.stats().respawns).toBe(1);
    expect(acq2.context).toBeTruthy();
    await pool.release(acq1.page);
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('STARVATION_RECOVER — tất cả browser dead, waiter được wake sau release + respawn', async () => {
    const pool = new BrowserPool({ size: 1, backend: 'chrome', acquireTimeoutMs: 5000 });
    const acq = await pool.acquire();
    const waiter = pool.acquire(); // queued — size 1
    mocks.state.launches[0].browser.crash();
    await pool.release(acq.page); // wake waiter → spawn mới
    const acq2 = await waiter;
    expect(acq2.page).toBeTruthy();
    expect(pool.stats().browsers).toBe(1);
    await pool.release(acq2.page);
    await pool.drain();
  });

  it('SHARED_CRASH — SharedContextPool browser dead → re-launch qua acquire', async () => {
    const pool = new SharedContextPool({ size: 2, backend: 'chrome' });
    const acq = await pool.acquire();
    expect(pool.stats().browsers).toBe(1);
    mocks.state.launches[0].browser.crash();
    expect(pool.stats().browsers).toBe(0);
    expect(pool.stats().respawns).toBe(1);
    await pool.release(acq.page);

    const acq2 = await pool.acquire();
    expect(acq2.context).toBeNull(); // shared mode
    expect(pool.stats().browsers).toBe(1);
    await pool.release(acq2.page);
    await pool.drain();
  });
});
