// tests/scrapers/adapters/puppeteer.test.js
// Adapter contract for Puppeteer, including CDP connect() error paths.
// These tests mock the heavy native browser modules; CDP integration is tested
// end-to-end in the 12.2 cdp-launcher tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PuppeteerAdapter } from '../../../src/scrapers/adapters/puppeteer.js';

const { mockConnect, mockUse, mockLaunch, mockFetch } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockUse: vi.fn(),
  mockLaunch: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('puppeteer-extra', () => ({
  default: {
    launch: mockLaunch,
    connect: mockConnect,
    use: mockUse,
  },
}));

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(),
}));

describe('PuppeteerAdapter', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockLaunch.mockReset();
    mockUse.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('connects to Chrome via the WebSocket URL from /json/version', async () => {
    const adapter = new PuppeteerAdapter();
    const mockBrowser = { close: vi.fn() };
    mockConnect.mockResolvedValue(mockBrowser);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc' }),
    });

    const browser = await adapter.connect('http://localhost:9222');

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:9222/json/version', expect.anything());
    expect(mockConnect).toHaveBeenCalledWith({
      browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      defaultViewport: null,
    });
    expect(browser).toEqual({
      _native: mockBrowser,
      _adapter: 'puppeteer',
      _browserType: 'chromium',
      _cdp: true,
      _preserveProfile: true,
    });
  });

  it('throws [CDP ERROR] when the CDP endpoint is unreachable', async () => {
    const adapter = new PuppeteerAdapter();

    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });

    await expect(adapter.connect('http://localhost:9222')).rejects.toThrow(
      '[CDP ERROR] Could not connect to Chrome on http://localhost:9222: 502 Bad Gateway'
    );
  });

  it('throws [CDP ERROR] when /json/version returns no WebSocket URL', async () => {
    const adapter = new PuppeteerAdapter();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(adapter.connect('http://localhost:9222')).rejects.toThrow(
      '[CDP ERROR] Chrome DevTools endpoint returned empty. Please refresh the browser and retry.'
    );
  });

  it('passes extra options through to puppeteer.connect', async () => {
    const adapter = new PuppeteerAdapter();
    const mockBrowser = { close: vi.fn() };
    mockConnect.mockResolvedValue(mockBrowser);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc' }),
    });

    await adapter.connect('http://localhost:9222', { slowMo: 100 });

    expect(mockConnect).toHaveBeenCalledWith({
      browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      defaultViewport: null,
      slowMo: 100,
    });
  });

  it('uses existing pages and does not overwrite viewport/userAgent when preserveProfile is true', async () => {
    const adapter = new PuppeteerAdapter();
    const mockPage = {
      setViewport: vi.fn(),
      setUserAgent: vi.fn(),
    };
    const mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      newPage: vi.fn(),
    };

    const adapterBrowser = {
      _native: mockBrowser,
      _adapter: 'puppeteer',
      _preserveProfile: true,
    };

    const page = await adapter.newPage(adapterBrowser, { preserveProfile: true });
    expect(mockBrowser.newPage).not.toHaveBeenCalled();
    expect(mockPage.setViewport).not.toHaveBeenCalled();
    expect(mockPage.setUserAgent).not.toHaveBeenCalled();
    expect(page._native).toBe(mockPage);
  });
});
