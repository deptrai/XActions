// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook URL and Handle Utilities
 * Pure string/URL validation helpers extracted from legacy facebook core.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license BSL 1.1
 */

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomDelay = (min = 1000, max = 3000) => sleep(min + Math.random() * (max - min));

export const FACEBOOK_BASE = 'https://www.facebook.com';
export const MBASIC_BASE = 'https://mbasic.facebook.com';
export const MOBILE_BASE = 'https://m.facebook.com';
export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
export const MOBILE_VIEWPORT = { width: 390, height: 844, isMobile: true };

/**
 * Login to Facebook using c_user/xs session cookies.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {Record<string, string>} cookies - { c_user, xs, sb?, datar?, fr?, fbl_st? }
 * @param {Record<string, any>} [options]
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function loginWithCookie(page, cookies = {}, options = {}) {
  const combined = { ...cookies, ...options };
  const cUser = String(combined.c_user ?? '').trim();
  const xsVal = String(combined.xs ?? '').trim();
  if (!cUser || !xsVal) {
    throw new Error('❌ Facebook login requires both c_user and xs cookies');
  }
  const { sb, datar, datr, fr, fbl_st, headless = true, skipWarmup = false } = combined;

  const navTimeout = 60000;
  const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  if (typeof page.setUserAgent === 'function') await page.setUserAgent(DESKTOP_UA);
  if (typeof page.setViewport === 'function') await page.setViewport({ width: 1280, height: 720 });
  await page.goto(MBASIC_BASE, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await randomDelay(1000, 2000);

  const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  /** @type {import('puppeteer').CookieParam[]} */
  const fbCookies = [
    { name: 'c_user', value: cUser, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
    { name: 'xs', value: xsVal, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
  ];

  const sbVal = String(sb ?? '').trim();
  if (sbVal) fbCookies.push({ name: 'sb', value: sbVal, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  const datrVal = String(datr || datar || '').trim();
  if (datrVal) fbCookies.push({ name: 'datr', value: datrVal, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (fr?.trim()) fbCookies.push({ name: 'fr', value: fr, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (fbl_st?.trim()) fbCookies.push({ name: 'fbl_st', value: fbl_st, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });

  await page.setCookie(...fbCookies);
  await page.goto(FACEBOOK_BASE, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await randomDelay(1500, 3000);

  return page;
}
