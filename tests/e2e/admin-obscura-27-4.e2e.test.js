// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 27.4: Obscura Browser Backend & Pluggable Fallback.
 *
 * Validates:
 *   1. Pluggable backend resolution: default 'chrome' launches active browser.
 *   2. Post-auth guard: rejects 'obscura' when requiresAuth is true with PlatformError.
 *   3. Fallback failover: switches from unreachable primary to fallback backend.
 *   4. Teardown contract: closeStealthBrowser cleans up gracefully.
 *   5. Navigation remapping: createStealthPage transparently remaps networkidle2.
 *   6. Live UI pilot: Dashboard and Benchmark pages render cleanly without console errors.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import { launchStealthBrowser, closeStealthBrowser, createStealthPage } from '../../src/scraping/stealthBrowser.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';

test.describe('Story 27.4 E2E — Obscura Browser Backend & Fallback Contract', () => {
  let browserInstance = null;

  test.afterEach(async () => {
    if (browserInstance) {
      await closeStealthBrowser(browserInstance).catch(() => {});
      browserInstance = null;
    }
  });

  test('E2E-1: post-auth guard blocks obscura backend when requiresAuth is true', async () => {
    let caught = null;
    try {
      await launchStealthBrowser({
        backend: 'obscura',
        requiresAuth: true,
        fallbackBackend: 'none',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PlatformError);
    expect(caught?.type).toBe(ErrorTypes.INVALID_ARGS);
    expect(caught?.message).toContain('obscura backend không hỗ trợ post-auth');
    expect(caught?.suggestedAction).toBe('dùng chrome backend');
  });

  test('E2E-2: fallback failover switches from unreachable primary to chrome on public scraping', async () => {
    browserInstance = await launchStealthBrowser({
      backend: 'obscura',
      wsEndpoint: 'ws://127.0.0.1:59998', // dead dummy port
      fallbackBackend: 'chrome',
      requiresAuth: false,
      headless: true,
    });

    expect(browserInstance).toBeTruthy();
    expect(browserInstance.__backend).toBe('chrome');

    const page = await createStealthPage(browserInstance);
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    expect(typeof title).toBe('string');
    await page.close();
  });

  test('E2E-3: teardown contract closes Chrome browser cleanly without errors', async () => {
    browserInstance = await launchStealthBrowser({
      backend: 'chrome',
      headless: true,
    });
    expect(browserInstance).toBeTruthy();

    await closeStealthBrowser(browserInstance);
    // After close, creating a page on the closed browser should fail
    await expect(browserInstance.newPage()).rejects.toThrow();
    browserInstance = null;
  });

  test('E2E-4: createStealthPage remaps networkidle2 to networkidle0 for obscura backend', async () => {
    let capturedWaitUntil = null;
    const fakePage = {
      async setUserAgent() {},
      async setViewport() {},
      viewport() { return { width: 1280, height: 800 }; },
      async setExtraHTTPHeaders() {},
      async evaluateOnNewDocument() {},
      async goto(url, opts) {
        capturedWaitUntil = opts?.waitUntil;
      },
      async close() {},
    };

    const fakeObscuraBrowser = {
      __backend: 'obscura',
      async newPage() { return fakePage; },
      async disconnect() {},
    };

    const stealthPage = await createStealthPage(fakeObscuraBrowser);
    await stealthPage.goto('https://example.com', { waitUntil: 'networkidle2' });
    expect(capturedWaitUntil).toBe('networkidle0');

    await stealthPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    expect(capturedWaitUntil).toBe('domcontentloaded');
  });

  test('E2E-5: live pilot — dashboard operations and benchmark scorecard load cleanly', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Visit main dashboard
    await page.goto('http://localhost:3001/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();

    // 2. Visit Benchmark Scorecard (Epic 34 / Epic 27 metrics)
    await page.goto('http://localhost:3001/benchmark');
    await expect(page.getByRole('heading', { name: /Benchmark Scorecard/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();

    // Verify 0 non-favicon errors
    expect(consoleErrors).toHaveLength(0);
  });
});
