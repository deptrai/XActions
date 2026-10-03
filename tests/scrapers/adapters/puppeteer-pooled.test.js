// tests/scrapers/adapters/puppeteer-pooled.test.js
// Story 53.2: PuppeteerAdapter.launch({pooled}) → AdapterBrowser wrapping a
// pool lease; newPage returns lease page; closeBrowser releases the lease.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PuppeteerAdapter } from '../../../src/scrapers/adapters/puppeteer.js';

const { mockGetDefaultPool, mockAcquire, mockRelease } = vi.hoisted(() => ({
  mockGetDefaultPool: vi.fn(),
  mockAcquire: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('../../../src/scraping/stealthBrowser.js', () => ({
  getDefaultPool: mockGetDefaultPool,
}));

function makeLease(backend = 'chrome') {
  const page = { __fake: 'page', close: vi.fn() };
  const context = { __fake: 'context', close: vi.fn(), newPage: vi.fn() };
  return { page, context, backend, waitMs: 0, pageMs: 1 };
}

describe('PuppeteerAdapter pooled', () => {
  beforeEach(() => {
    mockGetDefaultPool.mockReset();
    mockAcquire.mockReset();
    mockRelease.mockReset();
  });

  it('ADAPTER_POOLED: launch → newPage → closeBrowser full lifecycle', async () => {
    const lease = makeLease('chrome');
    const fakePool = { acquire: mockAcquire, release: mockRelease, drain: vi.fn() };
    mockAcquire.mockResolvedValue(lease);
    mockGetDefaultPool.mockResolvedValue(fakePool);

    const adapter = new PuppeteerAdapter();
    const browser = await adapter.launch({ pooled: true });

    expect(browser._pooled).toBe(true);
    expect(browser._adapter).toBe('puppeteer');
    expect(browser._backend).toBe('chrome');
    expect(browser._native).toBe(lease.context);
    expect(browser._pool).toBe(fakePool);
    expect(mockGetDefaultPool).toHaveBeenCalledWith('chrome', expect.objectContaining({
      backend: 'chrome',
      fallbackBackend: 'none',
    }));

    const page = await adapter.newPage(browser, { userAgent: 'x', viewport: { width: 1, height: 1 } });
    expect(page._native).toBe(lease.page);
    // Pool page used as-is — no context.newPage() call
    expect(lease.context.newPage).not.toHaveBeenCalled();

    await adapter.closeBrowser(browser);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(lease.page);
    // Shared browser/context untouched
    expect(lease.context.close).not.toHaveBeenCalled();
  });

  it('pooled:<pool instance> bypasses default registry', async () => {
    const lease = makeLease('obscura');
    const customPool = { acquire: vi.fn().mockResolvedValue(lease), release: vi.fn(), drain: vi.fn() };

    const adapter = new PuppeteerAdapter();
    const browser = await adapter.launch({ pooled: customPool, backend: 'obscura' });

    expect(customPool.acquire).toHaveBeenCalledTimes(1);
    expect(mockGetDefaultPool).not.toHaveBeenCalled();
    expect(browser._backend).toBe('obscura');
  });

  it('requiresAuth + obscura guard rejects before acquire', async () => {
    const adapter = new PuppeteerAdapter();
    await expect(
      adapter.launch({ pooled: true, requiresAuth: true, backend: 'obscura' })
    ).rejects.toMatchObject({ type: expect.any(String) });
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockGetDefaultPool).not.toHaveBeenCalled();
  });

  it('acquire errors propagate', async () => {
    const fakePool = { acquire: mockAcquire, release: mockRelease, drain: vi.fn() };
    mockGetDefaultPool.mockResolvedValue(fakePool);
    mockAcquire.mockRejectedValue(new Error('pool drained'));

    const adapter = new PuppeteerAdapter();
    await expect(adapter.launch({ pooled: true })).rejects.toThrow('pool drained');
  });

  it('telemetryContext.setBrowserBackend called with lease backend', async () => {
    const lease = makeLease('obscura');
    const fakePool = { acquire: mockAcquire, release: mockRelease, drain: vi.fn() };
    mockAcquire.mockResolvedValue(lease);
    mockGetDefaultPool.mockResolvedValue(fakePool);
    const telemetryContext = { setBrowserBackend: vi.fn() };

    const adapter = new PuppeteerAdapter();
    await adapter.launch({ pooled: true, backend: 'obscura', telemetryContext });
    expect(telemetryContext.setBrowserBackend).toHaveBeenCalledWith('obscura');
  });
});
