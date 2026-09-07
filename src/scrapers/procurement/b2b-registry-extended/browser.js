// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CloudflareWarmup — Puppeteer-based cf_clearance cookie extraction for Cloudflare-blocked sites.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { launchStealthBrowser, createStealthPage } from '../../../scraping/stealthBrowser.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * Cookie cache: domain/proxy -> { cookies: string, expiresAt: number }
 * @type {Map<string, { cookies: string, expiresAt: number }>}
 */
const cookieCache = new Map();

/**
 * In-flight warmup promises to prevent concurrent duplicate browser instances.
 * @type {Map<string, Promise<string>>}
 */
const inFlightWarmups = new Map();

/**
 * Warmup browser to extract cf_clearance cookie for Cloudflare-protected domain.
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.proxy]
 * @param {boolean} [options.headless]
 * @param {string} [options.userAgent]
 * @returns {Promise<string>} - cookie string for Cookie header
 */
export async function warmupBrowser(url, options = {}) {
  const domain = new URL(url).hostname;
  const proxyKey = options.proxy || 'direct';
  const cacheKey = `${domain}:${proxyKey}`;

  const cached = getCachedCookies(domain, proxyKey);
  if (cached) return cached;

  if (inFlightWarmups.has(cacheKey)) {
    return inFlightWarmups.get(cacheKey) || '';
  }

  const warmupPromise = (async () => {
    /** @type {any} */
    let browser;
    try {
      browser = await launchStealthBrowser({
        proxy: options.proxy,
        headless: options.headless ?? true,
        userAgent: options.userAgent,
      });
      /** @type {any} */
      const page = await createStealthPage(browser, { userAgent: options.userAgent });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

      // Extract cf_clearance cookie with short poll for challenge resolution
      const startTime = Date.now();
      /** @type {any[]} */
      let cookies = [];
      let cf = null;
      while (Date.now() - startTime < 10000) {
        cookies = await page.cookies(url);
        cf = cookies.find((/** @type {any} */ c) => c.name === 'cf_clearance');
        if (cf) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!cf) {
        throw new PlatformError({
          type: ErrorTypes.BOT_CHALLENGE,
          code: 'XACT_4030',
          message: 'cf_clearance cookie not found after warmup',
          statusCode: 403,
          suggestedAction: SuggestedActions.ROTATE_PROXY,
          platform: 'hosocongty',
        });
      }

      const cookieString = cookies.map((/** @type {any} */ c) => `${c.name}=${c.value}`).join('; ');
      const expiresAt = Date.now() + 30 * 60 * 1000; // ~30 min TTL

      cookieCache.set(cacheKey, { cookies: cookieString, expiresAt });
      cookieCache.set(domain, { cookies: cookieString, expiresAt });
      return cookieString;
    } finally {
      if (browser && typeof browser.close === 'function') await browser.close().catch(() => {});
    }
  })();

  inFlightWarmups.set(cacheKey, warmupPromise);
  try {
    return await warmupPromise;
  } finally {
    inFlightWarmups.delete(cacheKey);
  }
}

/**
 * Get cached cf_clearance cookies for a domain.
 * @param {string} domain
 * @param {string} [proxy]
 * @returns {string | null}
 */
export function getCachedCookies(domain, proxy = '') {
  const key = proxy ? `${domain}:${proxy}` : domain;
  const entry = cookieCache.get(key) || cookieCache.get(domain);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cookieCache.delete(key);
    cookieCache.delete(domain);
    return null;
  }
  return entry.cookies;
}

/**
 * Clear cached cookies for a domain.
 * @param {string} domain
 * @param {string} [proxy]
 */
export function clearCachedCookies(domain, proxy = '') {
  if (proxy) cookieCache.delete(`${domain}:${proxy}`);
  cookieCache.delete(domain);
}
