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
import { buildCookieString, parseFacebookTokens } from '../../src/scrapers/facebook/graphql.js';
import { decrypt } from '../routes/facebookAccounts.js';
const FACEBOOK_HOME = 'https://www.facebook.com/';
const TTL_MS = 5 * 60 * 1000;

// Internal fetch seam: tests may override with a fake fetch.
async function defaultFetch(url, options = {}) {
  const res = await axios.request({
    url,
    method: options.method || 'GET',
    headers: options.headers,
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
 * @param {Object} account - FacebookAccount record (must have id + encryptedCookie)
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - bypass 5-minute cache
 * @param {Function} [options.fetchImpl=defaultFetch] - HTTP fetch seam
 * @returns {Promise<{ status: 'active' | 'checkpoint' | 'dead', reason?: string, lastCheckAt: Date }>}
 */
export async function checkAccountHealth(account, options = {}) {
  if (!account?.id) {
    throw new Error('❌ checkAccountHealth requires an account with id');
  }
  const { force = false, fetchImpl = defaultFetch } = options;

  const existing = await prisma.facebookAccountHealth.findUnique({
    where: { accountId: account.id },
  });
  const now = Date.now();
  if (!force && existing && now - new Date(existing.lastCheckAt).getTime() < TTL_MS) {
    return {
      status: existing.status,
      reason: existing.reason,
      lastCheckAt: existing.lastCheckAt,
    };
  }

  const cookiePayload = decrypt(account.encryptedCookie);
  if (!cookiePayload) {
    const record = await upsertHealth(account.id, 'dead', 'decrypt_failed');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  let c_user, xs;
  try {
    ({ c_user, xs } = JSON.parse(cookiePayload));
  } catch {
    const record = await upsertHealth(account.id, 'dead', 'invalid_cookie_json');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  const cookie = buildCookieString({ c_user, xs });

  let res;
  try {
    res = await fetchImpl(FACEBOOK_HOME, { headers: { Cookie: cookie } });
  } catch {
    const record = await upsertHealth(account.id, 'dead', 'network_error');
    return { status: 'dead', reason: record.reason, lastCheckAt: record.lastCheckAt };
  }

  const html = res.data || '';
  const jar = buildCookieJar(cookie, res.headers?.['set-cookie'] || []);

  const hasCUser = /^\d+$/.test(jar.get('c_user') || '');
  const hasXs = (jar.get('xs') || '').length > 0;
  const tokens = parseFacebookTokens(html);

  const checkpoint =
    res.status >= 400 ||
    html.includes('/checkpoint/') ||
    html.toLowerCase().includes('confirm that you\'re human') ||
    html.toLowerCase().includes('confirm you\'re human') ||
    html.toLowerCase().includes('confirm that you') && html.toLowerCase().includes('human') ||
    html.toLowerCase().includes('security check');

  const dead = !tokens.fb_dtsg || !hasCUser || !hasXs;

  let status, reason;
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

  const record = await upsertHealth(account.id, status, reason);
  return { status, reason: record.reason, lastCheckAt: record.lastCheckAt };
}

async function upsertHealth(accountId, status, reason) {
  const lastCheckAt = new Date();
  return await prisma.facebookAccountHealth.upsert({
    where: { accountId },
    update: { status, reason, lastCheckAt },
    create: { accountId, status, reason, lastCheckAt },
  });
}
