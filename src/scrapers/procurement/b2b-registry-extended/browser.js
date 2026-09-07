// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CloudflareWarmup — Puppeteer-based cf_clearance cookie extraction for Cloudflare-blocked sites.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { launchStealthBrowser, createStealthPage } from '../../../scraping/stealthBrowser.js';

/**
 * Cookie cache: domain → { cookies: string, expiresAt: number }
 * @type {Map<string, { cookies: string, expiresAt: number }>}
 */
const cookieCache = new Map();

/**
 * Warmup browser to extract cf_clearance cookie for Cloudflare-protected domain.
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.proxy]
 * @param {boolean} [options.headless]
 * @param {string} [options.userAgent]
 * @returns {Promise<string>} — cookie string for Cookie header
 */
export async function warmupBrowser(url, options = {}) {
  const domain = new URL(url).hostname;
  const cached = getCachedCookies(domain);
  if (cached) return cached;

  let browser;
  try {
    browser = await launchStealthBrowser({
      proxy: options.proxy,
      headless: options.headless ?? true,
      userAgent: options.userAgent,
    });
    const page = await createStealthPage(browser, { userAgent: options.userAgent });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract cf_clearance cookie
    const cookies = await page.cookies(url);
    const cf = cookies.find((c) => c.name === 'cf_clearance');
    if (!cf) {
      throw new Error('cf_clearance cookie not found after warmup');
    }

    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const expiresAt = Date.now() + 30 * 60 * 1000; // ~30 min TTL

    cookieCache.set(domain, { cookies: cookieString, expiresAt });
    return cookieString;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Get cached cf_clearance cookies for a domain.
 * @param {string} domain
 * @returns {string | null}
 */
export function getCachedCookies(domain) {
  const entry = cookieCache.get(domain);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cookieCache.delete(domain);
    return null;
  }
  return entry.cookies;
}

/**
 * Clear cached cookies for a domain.
 * @param {string} domain
 */
export function clearCachedCookies(domain) {
  cookieCache.delete(domain);
}
