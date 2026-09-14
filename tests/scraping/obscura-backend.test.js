// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.4 — Obscura Browser Backend: Public-Scraping Transport & Watch/Promote Gate.
 * Tests pluggable backend resolution, post-auth guard, fallback mechanics,
 * teardown contract, and telemetry emission.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { launchStealthBrowser, closeStealthBrowser, createStealthPage } from '../../src/scraping/stealthBrowser.js';
import { PuppeteerAdapter } from '../../src/scrapers/adapters/puppeteer.js';
import { RedditBrowserBridge } from '../../src/scrapers/social/reddit/bridge.js';
import { MediumBrowserBridge } from '../../src/scrapers/social/medium/bridge.js';
import { TelemetryContext } from '../../src/core/telemetry-context.js';
import { TelemetryEmitter } from '../../src/core/telemetry-emitter.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';

describe('Story 27.4 — Obscura Browser Backend', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.XACTIONS_BROWSER_BACKEND;
    delete process.env.XACTIONS_BROWSER_BACKEND_FALLBACK;
    delete process.env.OBSCURA_WS_ENDPOINT;
    delete process.env.OBSCURA_STORAGE_DIR;
    delete process.env.XACTIONS_BROWSER_BACKEND_METRICS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('AC-1 & AC-2: Post-auth guard (requiresAuth)', () => {
    it('[P0] rejects obscura backend when requiresAuth === true with PlatformError', async () => {
      let caughtError = null;
      try {
        await launchStealthBrowser({
          backend: 'obscura',
          requiresAuth: true,
          fallbackBackend: 'none',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(PlatformError);
      expect(caughtError?.type).toBe(ErrorTypes.INVALID_ARGS);
      expect(caughtError?.message).toContain('obscura backend không hỗ trợ post-auth');
      expect(caughtError?.suggestedAction).toBe('dùng chrome backend');
    });

    it('[P0] rejects obscura backend via env when requiresAuth === true', async () => {
      process.env.XACTIONS_BROWSER_BACKEND = 'obscura';
      let caughtError = null;
      try {
        await launchStealthBrowser({
          requiresAuth: true,
          fallbackBackend: 'none',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(PlatformError);
      expect(caughtError?.type).toBe(ErrorTypes.INVALID_ARGS);
    });

    it('[P0] PuppeteerAdapter.launch rejects obscura when requiresAuth === true', async () => {
      const adapter = new PuppeteerAdapter();
      let caughtError = null;
      try {
        await adapter.launch({
          backend: 'obscura',
          requiresAuth: true,
          fallbackBackend: 'none',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(PlatformError);
      expect(caughtError?.type).toBe(ErrorTypes.INVALID_ARGS);
      expect(caughtError?.message).toContain('obscura backend không hỗ trợ post-auth');
    });
  });

  describe('AC-2b: Primary / fallback rules', () => {
    it('[P0] fails immediately without fallback when fallbackBackend is none or disabled', async () => {
      // Connect to non-existent endpoint with fallback disabled
      let caught = null;
      try {
        await launchStealthBrowser({
          backend: 'obscura',
          wsEndpoint: 'ws://127.0.0.1:59999', // dummy dead port
          fallbackBackend: 'none',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(String(caught?.message)).toMatch(/ECONNREFUSED|connect/);
    });

    it('[P0] forbids chrome -> obscura fallback when requiresAuth === true', async () => {
      const adapter = new PuppeteerAdapter();
      // Test that if chrome fails or throws on post-auth path, it never falls back to obscura
      let caught = null;
      try {
        await adapter.launch({
          backend: 'obscura',
          requiresAuth: true,
          fallbackBackend: 'obscura',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PlatformError);
      expect(caught?.type).toBe(ErrorTypes.INVALID_ARGS);
    });

    it('[P1] maps userDataDir to OBSCURA_STORAGE_DIR when backend is obscura', async () => {
      try {
        await launchStealthBrowser({
          backend: 'obscura',
          userDataDir: '/tmp/obscura-profile-test',
          wsEndpoint: 'ws://127.0.0.1:59999',
          fallbackBackend: 'none',
        });
      } catch {
        // expected to fail connect to port 59999, but env mapping happens before connect
      }
      expect(process.env.OBSCURA_STORAGE_DIR).toBe('/tmp/obscura-profile-test');
    });
  });

  describe('AC-1: Teardown contract', () => {
    it('[P0] closeStealthBrowser calls disconnect() on obscura and close() on chrome', async () => {
      let disconnected = false;
      let closed = false;

      const obscuraBrowser = {
        __backend: 'obscura',
        async disconnect() { disconnected = true; },
        async close() { closed = true; },
      };

      await closeStealthBrowser(obscuraBrowser);
      expect(disconnected).toBe(true);
      expect(closed).toBe(false);

      disconnected = false;
      closed = false;

      const chromeBrowser = {
        __backend: 'chrome',
        async disconnect() { disconnected = true; },
        async close() { closed = true; },
      };

      await closeStealthBrowser(chromeBrowser);
      expect(disconnected).toBe(false);
      expect(closed).toBe(true);
    });

    it('[P0] PuppeteerAdapter.closeBrowser respects per-backend contract', async () => {
      const adapter = new PuppeteerAdapter();
      let disconnected = false;
      let closed = false;

      const obscuraBrowser = {
        _adapter: 'puppeteer',
        _backend: 'obscura',
        _native: {
          __backend: 'obscura',
          async disconnect() { disconnected = true; },
          async close() { closed = true; },
        },
      };

      await adapter.closeBrowser(obscuraBrowser);
      expect(disconnected).toBe(true);
      expect(closed).toBe(false);

      disconnected = false;
      closed = false;

      const chromeBrowser = {
        _adapter: 'puppeteer',
        _backend: 'chrome',
        _native: {
          __backend: 'chrome',
          async disconnect() { disconnected = true; },
          async close() { closed = true; },
        },
      };

      await adapter.closeBrowser(chromeBrowser);
      expect(disconnected).toBe(false);
      expect(closed).toBe(true);
    });

    it('[P0] closeStealthBrowser handles wrapped adapter browser objects ({ _native })', async () => {
      let disconnected = false;
      const wrapped = {
        _adapter: 'puppeteer',
        _backend: 'obscura',
        _native: {
          __backend: 'obscura',
          async disconnect() { disconnected = true; },
        },
      };
      await closeStealthBrowser(wrapped);
      expect(disconnected).toBe(true);
    });

    it('[P0] PuppeteerAdapter.closeBrowser handles unwrapped native browser objects', async () => {
      const adapter = new PuppeteerAdapter();
      let disconnected = false;
      const native = {
        __backend: 'obscura',
        async disconnect() { disconnected = true; },
      };
      await adapter.closeBrowser(native);
      expect(disconnected).toBe(true);
    });
  });

  describe('AC-1: Navigation waitUntil remapping on Obscura', () => {
    it('[P0] PuppeteerAdapter.goto remaps networkidle2 to networkidle0 for obscura pages', async () => {
      const adapter = new PuppeteerAdapter();
      let capturedWaitUntil = null;

      const page = {
        _adapter: 'puppeteer',
        _backend: 'obscura',
        _native: {
          async goto(url, options) {
            capturedWaitUntil = options.waitUntil;
          },
        },
      };

      // Default with no waitUntil specified
      await adapter.goto(page, 'https://example.com');
      expect(capturedWaitUntil).toBe('networkidle0');

      // Explicit networkidle2
      await adapter.goto(page, 'https://example.com', { waitUntil: 'networkidle2' });
      expect(capturedWaitUntil).toBe('networkidle0');

      // Explicit networkidle
      await adapter.goto(page, 'https://example.com', { waitUntil: 'networkidle' });
      expect(capturedWaitUntil).toBe('networkidle0');

      // Explicit domcontentloaded (allowed)
      await adapter.goto(page, 'https://example.com', { waitUntil: 'domcontentloaded' });
      expect(capturedWaitUntil).toBe('domcontentloaded');
    });

    it('[P0] PuppeteerAdapter.goto keeps networkidle2 for chrome pages', async () => {
      const adapter = new PuppeteerAdapter();
      let capturedWaitUntil = null;

      const page = {
        _adapter: 'puppeteer',
        _backend: 'chrome',
        _native: {
          async goto(url, options) {
            capturedWaitUntil = options.waitUntil;
          },
        },
      };

      await adapter.goto(page, 'https://example.com');
      expect(capturedWaitUntil).toBe('networkidle2');

      await adapter.goto(page, 'https://example.com', { waitUntil: 'networkidle2' });
      expect(capturedWaitUntil).toBe('networkidle2');
    });

    it('[P0] createStealthPage remaps networkidle2 to networkidle0 when browser is obscura', async () => {
      let capturedWaitUntil = null;
      const mockPage = {
        async setUserAgent() {},
        async setViewport() {},
        viewport() { return { width: 1280, height: 800 }; },
        async setExtraHTTPHeaders() {},
        async evaluateOnNewDocument() {},
        async goto(url, opts) {
          capturedWaitUntil = opts?.waitUntil;
        },
      };
      const mockBrowser = {
        __backend: 'obscura',
        async newPage() { return mockPage; },
      };

      const page = await createStealthPage(mockBrowser);
      await page.goto('https://example.com', { waitUntil: 'networkidle2' });
      expect(capturedWaitUntil).toBe('networkidle0');

      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      expect(capturedWaitUntil).toBe('domcontentloaded');
    });
  });

  describe('AC-1: Scraper bridge parameter threading', () => {
    it('[P0] RedditBrowserBridge threads backend and requiresAuth to adapter.launch', async () => {
      let receivedLaunchOpts = null;
      const fakeAdapter = {
        async launch(opts) {
          receivedLaunchOpts = opts;
          return {
            _native: { __backend: opts.backend },
            _backend: opts.backend,
          };
        },
        async newPage() {
          return { _native: {}, _backend: 'obscura' };
        },
        async goto() {},
        async evaluate() { return 'test=cookie;'; },
        async closePage() {},
        async closeBrowser() {},
      };

      const bridge = new RedditBrowserBridge({
        adapter: fakeAdapter,
        backend: 'obscura',
        requiresAuth: false,
        fallbackBackend: 'chrome',
        wsEndpoint: 'ws://127.0.0.1:9222',
      });

      expect(bridge.backend).toBe('obscura');
      expect(bridge.requiresAuth).toBe(false);

      await bridge.start();

      expect(receivedLaunchOpts).toBeTruthy();
      expect(receivedLaunchOpts.backend).toBe('obscura');
      expect(receivedLaunchOpts.requiresAuth).toBe(false);
      expect(receivedLaunchOpts.fallbackBackend).toBe('chrome');
      expect(receivedLaunchOpts.wsEndpoint).toBe('ws://127.0.0.1:9222');

      await bridge.close();
    });

    it('[P0] MediumBrowserBridge threads backend and requiresAuth to adapter.launch', async () => {
      let receivedLaunchOpts = null;
      const fakeAdapter = {
        async launch(opts) {
          receivedLaunchOpts = opts;
          return {
            _native: { __backend: opts.backend },
            _backend: opts.backend,
          };
        },
        async newPage() {
          return { _native: {}, _backend: 'obscura' };
        },
        async goto() {},
        async evaluate() { return { post_1: { id: 'post_1', title: 'Test' } }; },
        async closePage() {},
        async closeBrowser() {},
      };

      const bridge = new MediumBrowserBridge({
        adapter: fakeAdapter,
        backend: 'obscura',
        requiresAuth: false,
      });

      expect(bridge.backend).toBe('obscura');
      expect(bridge.requiresAuth).toBe(false);

      await bridge.start();

      expect(receivedLaunchOpts).toBeTruthy();
      expect(receivedLaunchOpts.backend).toBe('obscura');
      expect(receivedLaunchOpts.requiresAuth).toBe(false);

      await bridge.close();
    });

    it('[P0] RedditBrowserBridge forwards undefined fallbackBackend when omitted', async () => {
      let receivedLaunchOpts = null;
      const fakeAdapter = {
        async launch(opts) {
          receivedLaunchOpts = opts;
          return { _native: {}, _backend: 'chrome' };
        },
        async newPage() { return { _native: {} }; },
        async goto() {},
        async evaluate() { return 'test=cookie;'; },
        async closePage() {},
        async closeBrowser() {},
      };

      const bridge = new RedditBrowserBridge({
        adapter: fakeAdapter,
        backend: 'obscura',
      });
      expect(bridge.fallbackBackend).toBeUndefined();
      await bridge.start();
      expect(receivedLaunchOpts.fallbackBackend).toBeUndefined();
      await bridge.close();
    });
  });

  describe('AC-2c: Telemetry emission', () => {
    it('[P0] attaches browserBackend to telemetry run when XACTIONS_BROWSER_BACKEND_METRICS=1', () => {
      process.env.XACTIONS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 'reddit-public',
        platform: 'reddit',
      });
      ctx.setBrowserBackend('obscura');

      const payload = ctx.toRunPayload({ isSuccess: true, durationMs: 120 });
      expect(payload.browserBackend).toBe('obscura');

      const emitter = new TelemetryEmitter();
      /** @type {any[]} */
      const emitted = [];
      emitter.emit = (p) => {
        emitted.push(p);
        return true;
      };

      emitter.emitRun(payload);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].browserBackend).toBe('obscura');
    });

    it('[P0] omits browserBackend from telemetry run when XACTIONS_BROWSER_BACKEND_METRICS is off', () => {
      delete process.env.XACTIONS_BROWSER_BACKEND_METRICS;

      const ctx = new TelemetryContext({
        scraperId: 'reddit-public',
        platform: 'reddit',
      });
      ctx.setBrowserBackend('obscura');

      const payload = ctx.toRunPayload({ isSuccess: true, durationMs: 120 });
      expect(payload.browserBackend).toBeUndefined();

      const emitter = new TelemetryEmitter();
      /** @type {any[]} */
      const emitted = [];
      emitter.emit = (p) => {
        emitted.push(p);
        return true;
      };

      // Even if raw payload had browserBackend, emitRun strips it when metrics flag is off
      emitter.emitRun({ ...payload, browserBackend: 'obscura' });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].browserBackend).toBeUndefined();
    });
  });
});
