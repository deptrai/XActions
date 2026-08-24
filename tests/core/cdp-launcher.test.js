// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi } from 'vitest';

// Note: In TDD Red Phase, these tests are scaffolded with it.skip().
// Activate them task-by-task during dev-story implementation.

describe('Story 12.2 — CDP Launcher & Remote Attach (tests/core/cdp-launcher.test.js)', () => {
  describe.skip('Chrome Path Detection (AC-1)', () => {
    it.skip('[P0] should return macOS Chrome path on darwin platform', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('darwin');
      expect(p).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    });

    it.skip('[P1] should return Windows Chrome path on win32 platform', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('win32');
      expect(p).toMatch(/Chrome\\Application\\chrome\.exe/i);
    });

    it.skip('[P1] should resolve Linux Chrome or Chromium candidate binary from PATH', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('linux');
      expect(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']).toContain(p);
    });

    it.skip('[P2] should throw PlatformError if custom executablePath does not exist', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      expect(() => getChromeExecutablePath('darwin', '/invalid/path/chrome')).toThrow();
    });
  });

  describe.skip('Chrome Launch Arguments Builder (AC-1)', () => {
    it.skip('[P0] should build correct arguments with remote debugging port and user data dir', async () => {
      const { buildChromeArgs } = await import('../../src/core/cdp-launcher.js');
      const args = buildChromeArgs({
        port: 9222,
        userDataDir: '/tmp/test-profile',
        headless: false,
      });

      expect(args).toContain('--remote-debugging-port=9222');
      expect(args).toContain('--user-data-dir=/tmp/test-profile');
      expect(args).toContain('--no-first-run');
      expect(args).toContain('--no-default-browser-check');
      expect(args).not.toContain('--headless');
    });

    it.skip('[P1] should append headless flag if explicitly requested', async () => {
      const { buildChromeArgs } = await import('../../src/core/cdp-launcher.js');
      const args = buildChromeArgs({
        port: 9223,
        userDataDir: '/tmp/test-profile',
        headless: true,
      });

      expect(args).toContain('--remote-debugging-port=9223');
      expect(args).toContain('--headless=new');
    });
  });

  describe.skip('CDP WebSocket Endpoint Fetching (AC-2)', () => {
    it.skip('[P0] should query /json/version and extract webSocketDebuggerUrl', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
          'Protocol-Version': '1.3',
        }),
      });
      global.fetch = mockFetch;

      const wsUrl = await fetchCdpWsEndpoint('http://127.0.0.1:9222');
      expect(wsUrl).toBe('ws://127.0.0.1:9222/devtools/browser/abc-123');
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version', expect.any(Object));
    });

    it.skip('[P1] should throw PlatformError when CDP endpoint is unreachable', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');
      
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(fetchCdpWsEndpoint('http://127.0.0.1:9999', { retries: 1, delayMs: 10 })).rejects.toThrow();
    });
  });

  describe.skip('launchBrowserWithCdp Integration (AC-2)', () => {
    it.skip('[P0] should connect adapter to CDP endpoint and preserve browser profile', async () => {
      const { launchBrowserWithCdp } = await import('../../src/core/cdp-launcher.js');

      const mockBrowser = {
        _cdp: true,
        close: vi.fn(),
      };
      const mockAdapter = {
        connect: vi.fn().mockResolvedValue(mockBrowser),
      };

      const browser = await launchBrowserWithCdp('http://127.0.0.1:9222', {
        adapter: mockAdapter,
        preserveProfile: true,
      });

      expect(mockAdapter.connect).toHaveBeenCalledWith('http://127.0.0.1:9222', expect.objectContaining({
        preserveProfile: true,
      }));
      expect(browser).toBe(mockBrowser);
    });

    it.skip('[P1] should wrap connection failure into standard PlatformError envelope (AD-15)', async () => {
      const { launchBrowserWithCdp } = await import('../../src/core/cdp-launcher.js');

      const mockAdapter = {
        connect: vi.fn().mockRejectedValue(new Error('CDP connection refused')),
      };

      await expect(
        launchBrowserWithCdp('http://127.0.0.1:9222', { adapter: mockAdapter })
      ).rejects.toMatchObject({
        isPlatformError: true,
      });
    });
  });
});
