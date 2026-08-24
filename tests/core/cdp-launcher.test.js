// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Note: In TDD Red Phase, these tests are scaffolded with it.skip().
// Activate them task-by-task during dev-story implementation.

describe('Story 12.2 — CDP Launcher & Remote Attach (tests/core/cdp-launcher.test.js)', () => {
  describe('Chrome Path Detection (AC-1)', () => {
    it('[P0] should return macOS Chrome path on darwin platform', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('darwin');
      expect(p).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    });

    it('[P1] should return Windows Chrome path on win32 platform', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('win32');
      expect(p).toMatch(/Chrome\\Application\\chrome\.exe/i);
    });

    it('[P1] should resolve Linux Chrome or Chromium candidate binary from PATH', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const p = getChromeExecutablePath('linux');
      expect(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']).toContain(p);
    });

    it('[P2] should throw PlatformError if custom executablePath does not exist', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      expect(() => getChromeExecutablePath('darwin', '/invalid/path/chrome')).toThrow();
    });

    it('[P2] should throw PlatformError if custom executablePath is a directory', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-chrome-'));
      try {
        expect(() => getChromeExecutablePath('linux', tmpDir)).toThrow();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('[P2] should prefer an executable found on Linux PATH', async () => {
      const { getChromeExecutablePath } = await import('../../src/core/cdp-launcher.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-bin-'));
      const originalPath = process.env.PATH;
      try {
        const chromiumPath = path.join(tmpDir, 'chromium');
        fs.writeFileSync(chromiumPath, '#!/bin/sh\necho ok\n', { mode: 0o755 });
        process.env.PATH = tmpDir;
        const p = getChromeExecutablePath('linux');
        expect(p).toBe(chromiumPath);
      } finally {
        process.env.PATH = originalPath;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Chrome Launch Arguments Builder (AC-1)', () => {
    it('[P0] should build correct arguments with remote debugging port and user data dir', async () => {
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

    it('[P1] should append headless flag if explicitly requested', async () => {
      const { buildChromeArgs } = await import('../../src/core/cdp-launcher.js');
      const args = buildChromeArgs({
        port: 9223,
        userDataDir: '/tmp/test-profile',
        headless: true,
      });

      expect(args).toContain('--remote-debugging-port=9223');
      expect(args).toContain('--headless=new');
    });

    it('[P2] should reject invalid ports', async () => {
      const { buildChromeArgs } = await import('../../src/core/cdp-launcher.js');
      expect(() => buildChromeArgs({ port: 0 })).toThrow();
      expect(() => buildChromeArgs({ port: 70000 })).toThrow();
      expect(() => buildChromeArgs({ port: 'not-a-port' })).toThrow();
    });
  });

  describe('CDP WebSocket Endpoint Fetching (AC-2)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('[P0] should query /json/version and extract webSocketDebuggerUrl', async () => {
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

    it('[P1] should throw PlatformError when CDP endpoint is unreachable', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');

      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(fetchCdpWsEndpoint('http://127.0.0.1:9999', { retries: 1, delayMs: 10 })).rejects.toThrow();
    });

    it('[P2] should throw PlatformError when response is OK but webSocketDebuggerUrl is missing', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ 'Protocol-Version': '1.3' }),
      });

      await expect(fetchCdpWsEndpoint('http://127.0.0.1:9222', { retries: 1, delayMs: 10 })).rejects.toThrow();
    });

    it('[P2] should reject malformed or empty CDP URLs', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');

      await expect(fetchCdpWsEndpoint('   ')).rejects.toThrow(/Invalid CDP URL/);
      await expect(fetchCdpWsEndpoint('not a url')).rejects.toThrow(/Invalid CDP URL/);
    });

    it('[P2] should trim whitespace and accept bare host:port inputs', async () => {
      const { fetchCdpWsEndpoint } = await import('../../src/core/cdp-launcher.js');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
        }),
      });
      global.fetch = mockFetch;

      const wsUrl = await fetchCdpWsEndpoint('  127.0.0.1:9222  ');
      expect(wsUrl).toBe('ws://127.0.0.1:9222/devtools/browser/abc-123');
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version', expect.any(Object));
    });
  });

  describe('launchBrowserWithCdp Integration (AC-2)', () => {
    it('[P0] should connect adapter to CDP endpoint and preserve browser profile', async () => {
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

    it('[P1] should wrap connection failure into standard PlatformError envelope (AD-15)', async () => {
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
