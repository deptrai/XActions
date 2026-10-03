// tests/scraping/stealthBrowser-pooled.test.js
// Story 53.2: `pooled` opt in launchStealthBrowser / createStealthPage /
// closeStealthBrowser + default per-backend pool registry.
// browserPool.js is fully mocked — pool internals are covered by
// browserPool.test.js; here we test the wrapper contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { ctorCalls, mockAcquire, mockRelease, mockDrain, PoolDrainingError, PoolAcquireTimeoutError } = vi.hoisted(() => {
  const ctorCalls = [];
  const mockAcquire = vi.fn();
  const mockRelease = vi.fn();
  const mockDrain = vi.fn();
  class PoolDrainingError extends Error {
    constructor(m) { super(m || 'pool is draining'); this.name = 'PoolDrainingError'; }
  }
  class PoolAcquireTimeoutError extends Error {
    constructor(m) { super(m || 'acquire timed out'); this.name = 'PoolAcquireTimeoutError'; }
  }
  return { ctorCalls, mockAcquire, mockRelease, mockDrain, PoolDrainingError, PoolAcquireTimeoutError };
});

vi.mock('../../src/scraping/browserPool.js', () => ({
  PoolDrainingError,
  PoolAcquireTimeoutError,
  BrowserPool: vi.fn().mockImplementation(function (opts) {
    ctorCalls.push(opts);
    this._opts = opts;
    this.acquire = mockAcquire;
    this.release = mockRelease;
    this.drain = mockDrain;
    this.stats = () => ({ size: opts.size, active: 0, queued: 0, browsers: 1, draining: false });
  }),
  SharedContextPool: vi.fn(),
}));

import {
  launchStealthBrowser,
  createStealthPage,
  closeStealthBrowser,
  getDefaultPool,
  resetDefaultPools,
} from '../../src/scraping/stealthBrowser.js';

function makeLease(backend = 'chrome') {
  const page = { __fake: 'page', close: vi.fn(), goto: vi.fn() };
  const context = { __fake: 'context', close: vi.fn(), newPage: vi.fn() };
  return { page, context, backend, waitMs: 0, pageMs: 1 };
}

describe('launchStealthBrowser({pooled})', () => {
  beforeEach(async () => {
    ctorCalls.length = 0;
    mockAcquire.mockReset();
    mockRelease.mockReset();
    mockDrain.mockReset();
    await resetDefaultPools();
    vi.unstubAllEnvs();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('POOLED_CHROME: returns browser-shaped handle wrapping a pool lease', async () => {
    const lease = makeLease('chrome');
    mockAcquire.mockResolvedValue(lease);

    const handle = await launchStealthBrowser({ pooled: true });

    expect(handle._pooled).toBe(true);
    expect(handle.__backend).toBe('chrome');
    expect(handle._native).toBe(lease.context);
    expect(handle._lease).toBe(lease);
    expect(handle._lease.page).toBe(lease.page);
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    // Default pool lazily created with chrome backend + fallback 'none'
    expect(ctorCalls).toHaveLength(1);
    expect(ctorCalls[0].backend).toBe('chrome');
    expect(ctorCalls[0].fallbackBackend).toBe('none');
  });

  it('POOLED_OBSCURA: backend resolved to obscura propagates to handle + registry key', async () => {
    const lease = makeLease('obscura');
    mockAcquire.mockResolvedValue(lease);

    const handle = await launchStealthBrowser({ pooled: true, backend: 'obscura' });

    expect(handle.__backend).toBe('obscura');
    expect(ctorCalls).toHaveLength(1);
    expect(ctorCalls[0].backend).toBe('obscura');
  });

  it('POST_AUTH_GUARD: requiresAuth + obscura rejects BEFORE pool acquire', async () => {
    await expect(
      launchStealthBrowser({ pooled: true, requiresAuth: true, backend: 'obscura' })
    ).rejects.toMatchObject({ type: expect.any(String) });
    expect(mockAcquire).not.toHaveBeenCalled();
    // No default pool was created for the rejected request
    expect(ctorCalls).toHaveLength(0);
  });

  it('CREATE_PAGE: createStealthPage returns the lease page as-is, ignores options', async () => {
    const lease = makeLease('chrome');
    mockAcquire.mockResolvedValue(lease);
    const handle = await launchStealthBrowser({ pooled: true });

    const page = await createStealthPage(handle, { userAgent: 'x' });
    expect(page).toBe(lease.page);
    // No new page was created on the context
    expect(lease.context.newPage).not.toHaveBeenCalled();
  });

  it('TEARDOWN: closeStealthBrowser releases the lease — never touches shared browser/context', async () => {
    const lease = makeLease('chrome');
    mockAcquire.mockResolvedValue(lease);
    const handle = await launchStealthBrowser({ pooled: true });

    await closeStealthBrowser(handle);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(lease.page);
    expect(lease.context.close).not.toHaveBeenCalled();

    // Double close is a no-op (release() itself is idempotent in real pool)
    mockRelease.mockResolvedValue(undefined);
    await closeStealthBrowser(handle);
    expect(mockRelease).toHaveBeenCalledTimes(2); // called but pool no-ops internally
  });

  it('BYO_POOL: pooled:<pool instance> acquires from that pool, registry untouched', async () => {
    const lease = makeLease('chrome');
    const customPool = {
      acquire: vi.fn().mockResolvedValue(lease),
      release: vi.fn(),
      drain: vi.fn(),
    };

    const handle = await launchStealthBrowser({ pooled: customPool });

    expect(customPool.acquire).toHaveBeenCalledTimes(1);
    expect(ctorCalls).toHaveLength(0); // no default pool created
    expect(handle._pool).toBe(customPool);
    expect(handle._lease).toBe(lease);
  });

  it('DEFAULT_POOL_REUSE: two pooled launches on same backend share one pool', async () => {
    mockAcquire.mockResolvedValue(makeLease('chrome'));
    await launchStealthBrowser({ pooled: true });
    await launchStealthBrowser({ pooled: true });
    expect(ctorCalls).toHaveLength(1);

    // Different backend → separate pool (sharded, AD-24 r3)
    mockAcquire.mockResolvedValue(makeLease('obscura'));
    await launchStealthBrowser({ pooled: true, backend: 'obscura' });
    expect(ctorCalls).toHaveLength(2);
  });

  it('ENV_SIZE: XACTIONS_BROWSER_POOL_SIZE > 0 sets default pool size; unset/garbage → 4', async () => {
    mockAcquire.mockResolvedValue(makeLease('chrome'));

    vi.stubEnv('XACTIONS_BROWSER_POOL_SIZE', '2');
    await launchStealthBrowser({ pooled: true });
    expect(ctorCalls[0].size).toBe(2);

    await resetDefaultPools();
    ctorCalls.length = 0;
    vi.stubEnv('XACTIONS_BROWSER_POOL_SIZE', '0');
    await launchStealthBrowser({ pooled: true });
    expect(ctorCalls[0].size).toBe(4);

    await resetDefaultPools();
    ctorCalls.length = 0;
    vi.stubEnv('XACTIONS_BROWSER_POOL_SIZE', 'banana');
    await launchStealthBrowser({ pooled: true });
    expect(ctorCalls[0].size).toBe(4);
  });

  it('acquire errors propagate (e.g. PoolDrainingError)', async () => {
    mockAcquire.mockRejectedValue(new PoolDrainingError());
    await expect(launchStealthBrowser({ pooled: true })).rejects.toThrow(PoolDrainingError);
  });

  it('telemetryContext.setBrowserBackend is called with lease backend', async () => {
    const lease = makeLease('obscura');
    mockAcquire.mockResolvedValue(lease);
    const telemetryContext = { setBrowserBackend: vi.fn() };

    await launchStealthBrowser({ pooled: true, backend: 'obscura', telemetryContext });
    expect(telemetryContext.setBrowserBackend).toHaveBeenCalledWith('obscura');
  });

  it('getDefaultPool returns cached instance per backend; resetDefaultPools drains all', async () => {
    const p1 = await getDefaultPool('chrome');
    const p2 = await getDefaultPool('chrome');
    const p3 = await getDefaultPool('obscura');
    expect(p1).toBe(p2);
    expect(p1).not.toBe(p3);

    await resetDefaultPools();
    expect(mockDrain).toHaveBeenCalledTimes(2);

    const p4 = await getDefaultPool('chrome');
    expect(p4).not.toBe(p1);
  });
});
