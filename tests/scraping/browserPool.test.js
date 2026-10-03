// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BrowserPool unit tests — Story 53.1 (Epic 53 / AD-24)
 * Tests the pool contract with mocked stealthBrowser layer (no real Chrome).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock stealthBrowser before importing the pool ────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    launches: [],
    teardowns: [],
    launchError: null,
    nextBackend: 'chrome',
  };
  function makeFakeBrowser(backend) {
    const browser = {
      __backend: backend,
      __fingerprint: { userAgent: 'TEST-UA', locale: 'en-US' },
      _contexts: 0,
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
      async close() { browser._closed = true; },
      async disconnect() { browser._disconnected = true; },
    };
    return browser;
  }
  return {
    state,
    makeFakeBrowser,
    launchStealthBrowser: vi.fn(async (opts) => {
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

import { BrowserPool, SharedContextPool, PoolDrainingError, PoolAcquireTimeoutError } from '../../src/scraping/browserPool.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('BrowserPool', () => {
  beforeEach(() => {
    mocks.state.launches.length = 0;
    mocks.state.teardowns.length = 0;
    mocks.state.launchError = null;
    mocks.state.nextBackend = 'chrome';
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
    expect(acq.page.__stealthOpts.fingerprint?.userAgent).toBe('TEST-UA');
    await pool.release(acq.page);
    await pool.drain();
  });

  it('BACKPRESSURE — hết slot → FIFO queue, waiter thứ N chỉ được phục vụ khi có release', async () => {
    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
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
    expect(a.page._ctx).toBe(a.context);
    expect(b.page._ctx).toBe(b.context);
    expect(a.page._ctx).not.toBe(b.page._ctx);
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
    expect(a.page._closed).toBe(true);
    expect(a.context._closed).toBe(true);
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
      expect.objectContaining({ backend: 'obscura', wsEndpoint: 'ws://x', fallbackBackend: 'none' })
    );
    await pool.release(a.page);
    await pool.drain();
    expect(mocks.state.teardowns[0]._disconnected).toBe(true);
  });

  it('release() page không thuộc pool → no-op', async () => {
    const pool = new BrowserPool({ size: 1 });
    await expect(pool.release({ close: async () => {} })).resolves.toBeUndefined();
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
    // Monkey-patch: launch OK but context creation fails after slot granted
    const origLaunch = mocks.launchStealthBrowser.getMockImplementation();
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
    expect(a.page._closed).toBe(true);
    await pool.release(b.page);
    await pool.drain();
    expect(mocks.state.teardowns.length).toBe(1);
  });
});
