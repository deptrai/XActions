// tests/scrapers/adapters/playwright.test.js
// Adapter contract for Playwright, including CDP connectOverCDP().

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightAdapter } from '../../../src/scrapers/adapters/playwright.js';

const { mockConnectOverCDP } = vi.hoisted(() => ({
  mockConnectOverCDP: vi.fn(),
}));

vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: mockConnectOverCDP,
  },
  firefox: {},
  webkit: {},
}));

describe('PlaywrightAdapter', () => {
  beforeEach(() => {
    mockConnectOverCDP.mockReset();
  });

  it('connects to Chrome via connectOverCDP', async () => {
    const adapter = new PlaywrightAdapter();
    const mockBrowser = { close: vi.fn() };
    mockConnectOverCDP.mockResolvedValue(mockBrowser);

    const browser = await adapter.connect('http://localhost:9222');

    expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222', {});
    expect(browser).toEqual({
      _native: mockBrowser,
      _adapter: 'playwright',
      _browserType: 'chromium',
    });
  });

  it('honors browserType option', async () => {
    const adapter = new PlaywrightAdapter();
    const mockBrowser = { close: vi.fn() };
    mockConnectOverCDP.mockResolvedValue(mockBrowser);

    await adapter.connect('http://localhost:9222', { browserType: 'chromium' });
    expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222', { browserType: 'chromium' });
  });

  it('passes extra options through to connectOverCDP', async () => {
    const adapter = new PlaywrightAdapter();
    const mockBrowser = { close: vi.fn() };
    mockConnectOverCDP.mockResolvedValue(mockBrowser);

    await adapter.connect('http://localhost:9222', { timeout: 5000 });
    expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222', { timeout: 5000 });
  });

  it('surfaces connection errors', async () => {
    const adapter = new PlaywrightAdapter();
    mockConnectOverCDP.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(adapter.connect('http://localhost:9222')).rejects.toThrow('connect ECONNREFUSED');
  });
});
