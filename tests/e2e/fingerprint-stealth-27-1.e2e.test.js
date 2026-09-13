// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.1 — E2E: stealth browser applies a FingerprintManager fingerprint.
 * Launches a real Puppeteer browser via launchStealthBrowser + createStealthPage,
 * then reads navigator.* on about:blank and asserts it matches the fingerprint.
 * Skipped when Puppeteer/a Chromium binary is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FingerprintManager } from '../../src/core/fingerprint-manager.js';
import { launchStealthBrowser, createStealthPage } from '../../src/scraping/stealthBrowser.js';

let browser = null;
let fp = null;
let launchError = null;

beforeAll(async () => {
  const fm = new FingerprintManager({ prisma: null });
  fp = await fm.getForAccount('twitter', 'e2e-27-1', { proxy: { region: 'us' } });
  try {
    browser = await launchStealthBrowser({ fingerprintManager: fm, accountId: 'e2e-27-1', platform: 'twitter', proxy: { region: 'us' }, headless: true });
  } catch (err) { launchError = err; }
}, 60000);

afterAll(async () => { if (browser) { try { await browser.close(); } catch {} } });

describe('Story 27.1 E2E — stealth browser fingerprint', () => {
  it('applies the fingerprint to navigator.* on a real page', async () => {
    if (launchError || !browser) { console.warn('skip: puppeteer unavailable —', launchError?.message); return; }
    const page = await createStealthPage(browser, { fingerprint: browser.__fingerprint });
    await page.goto('about:blank');
    const nav = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      webdriver: navigator.webdriver,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webglVendor: (() => { try { const g = document.createElement('canvas').getContext('webgl'); return g ? g.getParameter(37445) : null; } catch { return null; } })(),
      webglRenderer: (() => { try { const g = document.createElement('canvas').getContext('webgl'); return g ? g.getParameter(37446) : null; } catch { return null; } })(),
    }));
    expect(nav.userAgent).toBe(fp.userAgent);
    expect(nav.platform).toBe(fp.platform);
    expect(nav.language).toBe(fp.locale);
    expect(nav.languages[0]).toBe(fp.locale);
    expect(nav.webdriver).toBe(false);
    expect(nav.hardwareConcurrency).toBe(fp.hardwareConcurrency);
    expect(nav.webglVendor).toBe(fp.webgl.vendor);
    expect(nav.webglRenderer).toBe(fp.webgl.renderer);
    expect(nav.timezone).toBe(fp.timezone);
    await page.close();
  }, 60000);
});
