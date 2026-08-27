// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.

import prisma from '../lib/prisma.js';
/**
 * Facebook Account Health Check (Story 7.1 — AC1)
 *
 * Browser-free HTTP check that determines whether a stored Facebook account is
 * active, checkpointed, or dead. Results are cached in Prisma for 5 minutes
 * (NFR-11) and cookie values are never logged (NFR-13).
 *
 * This implementation uses the hybrid FacebookClient for the HTTP request so
 * that proxy, cookie, and retry handling are consistent with the rest of the
 * Facebook scraper (Story 13.10 / AC-13).
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

import { FacebookClient } from '../../src/scrapers/social/facebook/client.js';
import { decrypt } from '../routes/facebookAccounts.js';
const FACEBOOK_HOME = 'https://www.facebook.com/';
const TTL_MS = 5 * 60 * 1000;

/**
 * Build cookie header string from cookie map or object.
 * @param {Record<string, string>} cookieObj
 * @returns {string}
 */
function buildCookieString(cookieObj) {
  if (!cookieObj || typeof cookieObj !== 'object' || Array.isArray(cookieObj)) return '';
  return Object.entries(cookieObj)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => {
      const safe = /[;=]/.test(String(v)) ? encodeURIComponent(String(v)) : String(v);
      return `${k}=${safe}`;
    })
    .join('; ');
}

/**
 * Extract Facebook security tokens from HTML page source.
 * @param {string} html
 * @returns {{ fb_dtsg: string | null; lsd: string | null }}
 */
function parseFacebookTokens(html) {
  if (!html || typeof html !== 'string') return { fb_dtsg: null, lsd: null };
  const dtsgMatch =
    html.match(/\["DTSGInitialData",\s*\[\],\s*\{"token":"([^"]+)"\}/) ||
    html.match(/"DTSGInitialData",\s*\[\],\s*\{"token":"([^"]+)"\}/) ||
    html.match(/name="fb_dtsg"\s+value="([^"]+)"/) ||
    html.match(/d\.token\s*=\s*"([^"]+)"/) ||
    html.match(/"token"\s*:\s*"([^"]+)"/);
  const fb_dtsg = dtsgMatch ? dtsgMatch[1] : null;

  const lsdMatch =
    html.match(/name="lsd"\s+value="([^"]+)"/) ||
    html.match(/\["LSD",\s*\[\],\s*\{"token":"([^"]+)"\}/) ||
    html.match(/"LSD",\s*\[\],\s*\{"token":"([^"]+)"\}/) ||
    html.match(/"lsd"\s*:\s*"([^"]+)"/);
  const lsd = lsdMatch ? lsdMatch[1] : null;

  return { fb_dtsg, lsd };
}

/**
 * Merge initial request cookies with Set-Cookie response headers into a simple
 * cookie jar map. Keys are cookie names, values are cookie values.
 * @param {string} initialCookies
 * @param {string[]} setCookieHeaders
 * @returns {Map<string, string>}
 */
function buildCookieJar(initialCookies, setCookieHeaders = []) {
  const jar = new Map();
  for (const pair of initialCookies.split('; ').filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar.set(key, value);
  }
  for (const sc of setCookieHeaders) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar.set(key, value);
  }
  return jar;
}

/**
 * @typedef {object} HealthCheckOptions
 * @property {boolean} [force]
 * @property {(url: string, options?: Record<string, unknown>) => Promise<{ status: number; data: string; headers: Record<string, unknown> }>} [fetchImpl]
 * @property {FacebookClient} [clientImpl]
 */

/**
 * Build or inject a FacebookClient for the health check.
 * @param {Record<string, unknown>} account
 * @param {Partial<HealthCheckOptions>} [options]
 * @returns {{ client: FacebookClient; injected: boolean }}
 */
function buildClient(account, options = {}) {
  if (options.clientImpl instanceof FacebookClient) {
    return { client: options.clientImpl, injected: true };
  }
  const client = new FacebookClient({
    requiresProxy: false,
    timeout: 30000,
    httpFallback: true,
  });
  const fetchImpl = options.fetchImpl;
  if (typeof fetchImpl === 'function') {
    client.httpClient = async (/** @type {Record<string, unknown>} */ reqOpts) => {
      const res = await fetchImpl(
        /** @type {string} */ (reqOpts.url || FACEBOOK_HOME),
        reqOpts,
      );
      return res;
    };
  }
  return { client, injected: false };
}

/**
 * Determine whether the response indicates a Facebook checkpoint / challenge.
 * @param {string} html
 * @param {number} status
 * @returns {boolean}
 */
function isCheckpoint(html, status) {
  const lowerHtml = html.toLowerCase();
  return (
    status >= 400 ||
    html.includes('/checkpoint/') ||
    lowerHtml.includes('confirm that you\'re human') ||
    lowerHtml.includes('confirm you\'re human') ||
    (lowerHtml.includes('confirm that you') && lowerHtml.includes('human')) ||
    lowerHtml.includes('security check')
  );
}

/**
 * Map a FacebookClient request error to a health status.
 * @param {unknown} err
 * @returns {{ status: 'checkpoint' | 'dead', reason: string }}
 */
function mapHealthError(err) {
  const e = /** @type {Record<string, unknown>} */ (err);
  const code = typeof e.code === 'string' ? e.code : '';
  const suggested = typeof e.suggestedAction === 'string' ? e.suggestedAction : '';
  const message = typeof e.message === 'string' ? e.message : '';
  const isAuth =
    code === 'XACT_4010' ||
    suggested === 'RELOGIN' ||
    /login|auth|session|checkpoint/i.test(message);
  if (isAuth) {
    return { status: 'checkpoint', reason: 'checkpoint_or_captcha' };
  }
  return { status: 'dead', reason: 'network_error' };
}

/**
 * Determine Facebook account health by fetching the homepage and inspecting
 * the response HTML + cookie jar.
 *
 * @param {Record<string, unknown>} account - FacebookAccount record (must have id + encryptedCookie)
 * @param {Partial<HealthCheckOptions>} [options]
 * @returns {Promise<{ status: 'active' | 'checkpoint' | 'dead', reason?: string | null, lastCheckAt: Date }>}
 */
export async function checkAccountHealth(account, options = {}) {
  if (!account?.id) {
    throw new Error('❌ checkAccountHealth requires an account with id');
  }
  const force = options.force === true;

  const existing = await prisma.facebookAccountHealth.findUnique({
    where: { accountId: String(account.id) },
  });
  const now = Date.now();
  if (!force && existing && now - new Date(existing.lastCheckAt).getTime() < TTL_MS) {
    return {
      status: /** @type {'active' | 'checkpoint' | 'dead'} */ (existing.status),
      reason: existing.reason,
      lastCheckAt: existing.lastCheckAt,
    };
  }

  const cookiePayload = decrypt(/** @type {string} */ (account.encryptedCookie));
  if (!cookiePayload) {
    const record = await upsertHealth(String(account.id), 'dead', 'decrypt_failed');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  let c_user;
  let xs;
  try {
    ({ c_user, xs } = JSON.parse(cookiePayload));
  } catch {
    const record = await upsertHealth(String(account.id), 'dead', 'invalid_cookie_json');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  const cookie = buildCookieString({ c_user: String(c_user), xs: String(xs) });

  const { client, injected } = buildClient(account, options);

  /** @type {{ status: number; data: string; headers: Record<string, unknown> } | undefined} */
  let res;
  try {
    res = /** @type {{ status: number; data: string; headers: Record<string, unknown> }} */ (
      await client.request('GET', FACEBOOK_HOME, {
        requiresAuth: true,
        accountId: String(account.id),
        skipResponseValidation: true,
        headers: { cookie },
      })
    );
  } catch (err) {
    const { status, reason } = mapHealthError(err);
    if (!injected) {
      await client.close().catch(() => {});
    }
    const record = await upsertHealth(String(account.id), status, reason);
    return { status, reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  if (!injected) {
    await client.close().catch(() => {});
  }

  const html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  const rawSetCookie = res.headers?.['set-cookie'];
  const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie : typeof rawSetCookie === 'string' ? [rawSetCookie] : [];
  const jar = buildCookieJar(cookie, setCookie);

  const hasCUser = /^\d+$/.test(jar.get('c_user') || '');
  const hasXs = (jar.get('xs') || '').length > 0;
  const tokens = parseFacebookTokens(html);
  const checkpoint = isCheckpoint(html, res.status);
  const dead = !tokens.fb_dtsg || !hasCUser || !hasXs;

  /** @type {'active' | 'checkpoint' | 'dead'} */
  let status;
  /** @type {string | null} */
  let reason;
  if (checkpoint) {
    status = 'checkpoint';
    reason = 'checkpoint_or_captcha';
  } else if (dead) {
    status = 'dead';
    reason = 'missing_token_or_cookie';
  } else {
    status = 'active';
    reason = null;
  }

  const record = await upsertHealth(String(account.id), status, reason);
  return { status, reason: record.reason, lastCheckAt: record.lastCheckAt };
}

/**
 * @param {string} accountId
 * @param {'active' | 'checkpoint' | 'dead'} status
 * @param {string | null} reason
 */
async function upsertHealth(accountId, status, reason) {
  const lastCheckAt = new Date();
  return await prisma.facebookAccountHealth.upsert({
    where: { accountId },
    update: { status, reason, lastCheckAt },
    create: { accountId, status, reason, lastCheckAt },
  });
}
