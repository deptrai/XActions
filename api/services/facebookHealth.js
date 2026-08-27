// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.

import prisma from '../lib/prisma.js';
/**
 * Facebook Account Health Check (Story 7.1 — AC1)
 *
 * Browser-free HTTP check that determines whether a stored Facebook account is
 * active, checkpointed, or dead. Results are cached in Prisma for 5 minutes
 * (NFR-11) and cookie values are never logged (NFR-13).
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

import axios from 'axios';
import { decrypt } from '../routes/facebookAccounts.js';
const FACEBOOK_HOME = 'https://www.facebook.com/';
const TTL_MS = 5 * 60 * 1000;

/**
 * Build cookie header string from cookie map or object.
 * @param {Record<string, string>} cookieObj
 * @returns {string}
 */
function buildCookieString(cookieObj) {
  if (!cookieObj || typeof cookieObj !== 'object') return '';
  return Object.entries(cookieObj)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
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
    html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
    html.match(/name="fb_dtsg"\s+value="([^"]+)"/) ||
    html.match(/"token":"([^"]+)"/);
  const fb_dtsg = dtsgMatch ? dtsgMatch[1] : null;

  const lsdMatch =
    html.match(/name="lsd"\s+value="([^"]+)"/) ||
    html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
    html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
  const lsd = lsdMatch ? lsdMatch[1] : null;

  return { fb_dtsg, lsd };
}

/**
 * @typedef {object} HealthCheckOptions
 * @property {boolean} [force]
 * @property {typeof defaultFetch} [fetchImpl]
 */

// Internal fetch seam: tests may override with a fake fetch.
/**
 * @param {string} url
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<{ status: number; data: string; headers: Record<string, unknown> }>}
 */
async function defaultFetch(url, options = {}) {
  const res = await axios.request({
    url,
    method: /** @type {string} */ (options.method) || 'GET',
    headers: /** @type {Record<string, string> | undefined} */ (options.headers),
    responseType: 'text',
    transformResponse: [(d) => d],
    maxRedirects: 5,
    validateStatus: () => true,
  });
  return {
    status: res.status,
    data: typeof res.data === 'string' ? res.data : String(res.data ?? ''),
    headers: { 'set-cookie': res.headers['set-cookie'] || [] },
  };
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
  const fetchImpl = options.fetchImpl ?? defaultFetch;

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

  let res;
  try {
    res = await fetchImpl(FACEBOOK_HOME, { headers: { Cookie: cookie } });
  } catch {
    const record = await upsertHealth(String(account.id), 'dead', 'network_error');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  const html = res.data || '';
  const setCookie = /** @type {string[]} */ (res.headers?.['set-cookie'] || []);
  const jar = buildCookieJar(cookie, setCookie);

  const hasCUser = /^\d+$/.test(jar.get('c_user') || '');
  const hasXs = (jar.get('xs') || '').length > 0;
  const tokens = parseFacebookTokens(html);

  const checkpoint =
    res.status >= 400 ||
    html.includes('/checkpoint/') ||
    html.toLowerCase().includes('confirm that you\'re human') ||
    html.toLowerCase().includes('confirm you\'re human') ||
    (html.toLowerCase().includes('confirm that you') && html.toLowerCase().includes('human')) ||
    html.toLowerCase().includes('security check');

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
