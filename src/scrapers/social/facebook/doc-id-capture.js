// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook doc_id capture flow.
 *
 * Opens a real browser session (puppeteer), listens for POST /api/graphql/
 * requests via GraphQLCaptureHook, and records every doc_id the Facebook web
 * app issues - mapped to the crawler's ACTION keys and persisted through
 * DocIdStore so all future scrapes (any account, guest included) reuse them.
 *
 * First run: `medirus fb capture-docids` (visible browser, log in by hand,
 * pass --save-cookies). Later runs - and the automatic refresh path in
 * doc-id-store.noteDocIdFailure - reuse the saved cookies and run headless.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GraphQLCaptureHook } from './graphql-replay.js';
import { getActiveDocIdStore, mapFriendlyName } from './doc-id-store.js';
import { createBrowser, createPage } from '../../browser.js';
import { loginWithCookie as loginWithFbCookie } from './url-helpers.js';

const COOKIE_KEYS = ['c_user', 'xs', 'sb', 'datr', 'fr', 'fbl_st'];
const SAVED_COOKIES_PATH = path.join(os.homedir(), '.medirus', 'facebook-cookies.json');
const FACEBOOK_BASE = 'https://www.facebook.com';

/** Pages visited in order so the web app fires the queries we want to capture. */
const NAVIGATION_TARGETS = [
  { url: `${FACEBOOK_BASE}/`, label: 'home feed' },
  { url: `${FACEBOOK_BASE}/zuck`, label: 'public profile' },
  { url: `${FACEBOOK_BASE}/marketplace/`, label: 'marketplace' },
  { url: `${FACEBOOK_BASE}/watch/`, label: 'watch' },
];

/**
 * Normalize cookie input to a plain { name: value } object limited to FB keys.
 * Accepts puppeteer-style arrays ([{ name, value }, ...]) or plain objects.
 * @param {any} input
 * @returns {Record<string, string>}
 */
function normalizeCookies(input) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!input) return out;
  const list = Array.isArray(input)
    ? input
    : (typeof input === 'object' ? Object.entries(input).map(([name, value]) => ({ name, value })) : []);
  for (const item of list) {
    const name = String(item?.name || '').trim();
    const value = String(item?.value ?? '').trim();
    if (name && value) out[name] = value;
  }
  return out;
}

/**
 * Load Facebook cookies from the first available source.
 * Priority: cookieFile arg > FACEBOOK_COOKIES / FACEBOOK_COOKIE env (JSON) > saved file.
 * @param {{ cookieFile?: string|null }} [options]
 * @returns {Promise<{ cookies: Record<string, string>, source: string } | null>}
 */
export async function loadFacebookCookies({ cookieFile = null } = {}) {
  const candidates = [];
  if (cookieFile) candidates.push({ path: cookieFile, source: 'cookie-file' });
  for (const envName of ['FACEBOOK_COOKIES', 'FACEBOOK_COOKIE']) {
    if (process.env[envName]) candidates.push({ raw: process.env[envName], source: `env:${envName}` });
  }
  candidates.push({ path: SAVED_COOKIES_PATH, source: 'saved-cookies' });

  for (const candidate of candidates) {
    try {
      const raw = candidate.raw ?? fs.readFileSync(candidate.path, 'utf-8');
      const parsed = JSON.parse(raw);
      // A saved file may wrap cookies: { cookies: [...] } or a bare jar.
      const jar = parsed?.cookies ?? parsed;
      const cookies = normalizeCookies(jar);
      if (cookies.c_user && cookies.xs) return { cookies, source: candidate.source };
    } catch {
      // missing/unreadable source - try the next one
    }
  }
  return null;
}

/**
 * Drain the capture hook into the store: map friendly names to ACTION keys,
 * keep unmapped queries under `extra`, and store the freshest auth tokens.
 * @param {GraphQLCaptureHook} hook
 * @param {import('./doc-id-store.js').DocIdStore} store
 * @returns {{ mapped: number, extra: number, total: number }}
 */
function collectCaptured(hook, store) {
  const entries = typeof hook.getCapturedEntries === 'function' ? hook.getCapturedEntries() : [];
  let mapped = 0;
  let extra = 0;
  /** @type {Record<string, string>} */
  const latestTokens = {};

  for (const entry of entries) {
    if (!entry?.docId) continue;
    const action = mapFriendlyName(entry.friendlyName);
    if (action) {
      store.set(action, { docId: entry.docId, friendlyName: entry.friendlyName, source: 'capture' });
      mapped += 1;
      // Persist a sample of the variables the real client sent so the
      // expected shape of this persisted query can be inspected later.
      if (entry.variables && Object.keys(entry.variables).length > 0) {
        store.setVariablesSample(action, entry.variables);
      }
    } else if (entry.friendlyName) {
      store.setExtra(entry.friendlyName, { docId: entry.docId });
      extra += 1;
    }
    for (const tokenKey of ['fb_dtsg', 'lsd']) {
      const value = entry.tokens?.[tokenKey];
      if (typeof value === 'string' && value.length > 0) latestTokens[tokenKey] = value;
    }
  }
  if (Object.keys(latestTokens).length > 0) store.setTokens(latestTokens);
  return { mapped, extra, total: entries.length };
}

/**
 * Capture Facebook GraphQL doc_ids from a live browser session and persist them.
 *
 * @param {Object} [options]
 * @param {boolean} [options.headless=false] - run without UI (requires cookies)
 * @param {number} [options.timeoutMs=120000] - overall capture budget
 * @param {Record<string, string>|Array<{name: string, value: string}>|null} [options.cookies]
 * @param {string|null} [options.cookieFile] - JSON file with cookies
 * @param {boolean} [options.saveCookies=false] - persist session cookies for future headless refreshes
 * @param {((message: string) => void)|null} [options.onProgress]
 * @returns {Promise<{ mapped: number, extra: number, total: number, actions: string[], storePath: string, cookiesSaved: boolean }>}
 */
export async function captureDocIds({
  headless = false,
  timeoutMs = 120000,
  cookies = null,
  cookieFile = null,
  saveCookies = false,
  onProgress = null,
} = {}) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  const store = getActiveDocIdStore();
  const hook = new GraphQLCaptureHook();
  const browser = await createBrowser({ headless });
  let cookiesSaved = false;

  try {
    const page = await createPage(browser);
    hook.attach(page);

    const resolved = cookies
      ? { cookies: normalizeCookies(cookies), source: 'argument' }
      : await loadFacebookCookies({ cookieFile });

    if (resolved?.cookies?.c_user && resolved?.cookies?.xs) {
      report(`Dang nhap bang cookie (nguon: ${resolved.source})...`);
      await loginWithFbCookie(page, resolved.cookies, { headless });
      report('Da dang nhap.');
    } else {
      if (headless) {
        throw new Error(
          'Headless capture can phai co cookie (c_user + xs). ' +
            'Chay `medirus fb capture-docids` (khong --headless) de dang nhap tay, them --save-cookies, ' +
            'hoac dat FACEBOOK_COOKIES (JSON).'
        );
      }
      await page.goto(FACEBOOK_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      report('Khong co cookie - hay dang nhap Facebook trong cua so vua mo.');
    }

    const deadline = Date.now() + timeoutMs;
    for (const target of NAVIGATION_TARGETS) {
      if (Date.now() >= deadline) break;
      try {
        report(`Duyet ${target.label} (${target.url})...`);
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: Math.min(45000, Math.max(5000, deadline - Date.now())) });
        await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, 2000)).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        // A blocked/failed page must not abort the whole capture.
        report(`Bo qua ${target.label} (khong truy cap duoc).`);
      }
    }

    if (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(3000, deadline - Date.now())));
    }

    const summary = collectCaptured(hook, store);
    store.markCaptured('cli-capture');
    store.saveSync();

    if (saveCookies) {
      try {
        const jar = await page.cookies(FACEBOOK_BASE);
        const filtered = (Array.isArray(jar) ? jar : [])
          .filter((c) => COOKIE_KEYS.includes(c?.name) && c?.value)
          .map((c) => ({ name: c.name, value: c.value }));
        if (filtered.some((c) => c.name === 'c_user') && filtered.some((c) => c.name === 'xs')) {
          fs.mkdirSync(path.dirname(SAVED_COOKIES_PATH), { recursive: true });
          fs.writeFileSync(SAVED_COOKIES_PATH, JSON.stringify(filtered, null, 2));
          cookiesSaved = true;
          report(`Da luu cookie tai ${SAVED_COOKIES_PATH} (cac lan refresh sau chay headless duoc).`);
        }
      } catch {
        // saving cookies is best-effort
      }
    }

    return {
      ...summary,
      actions: Object.keys(store.toDocIdMap()),
      storePath: store.filePath,
      cookiesSaved,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// --------------------------------------------------------------------------
// Automatic refresh
// --------------------------------------------------------------------------

let refreshInFlight = false;
let lastNoCookieWarnAt = 0;
const NO_COOKIE_WARN_INTERVAL_MS = 60 * 60 * 1000; // warn at most once per hour

/**
 * Re-capture doc_ids headlessly when the store is stale and cookies are available.
 * Never throws - callers treat the return value as best-effort status.
 *
 * @param {{ maxAgeMs?: number, reason?: string }} [options]
 * @returns {Promise<{ refreshed: boolean, reason: string }>}
 */
export async function maybeAutoRefreshDocIds({ maxAgeMs, reason = 'stale' } = {}) {
  if (refreshInFlight) return { refreshed: false, reason: 'in-flight' };
  const store = getActiveDocIdStore();
  if (!store.needsRefresh(maxAgeMs)) return { refreshed: false, reason: 'fresh' };

  const resolved = await loadFacebookCookies();
  if (!resolved) {
    const now = Date.now();
    if (now - lastNoCookieWarnAt > NO_COOKIE_WARN_INTERVAL_MS) {
      lastNoCookieWarnAt = now;
      console.warn(
        '[FACEBOOK] doc_ids qua cu hoac bi rotate. Chay `medirus fb capture-docids --save-cookies` ' +
          'mot lan de cac lan tu dong refresh sau nay chay headless duoc.'
      );
    }
    return { refreshed: false, reason: 'no-cookies' };
  }

  refreshInFlight = true;
  try {
    await captureDocIds({ headless: true, cookies: resolved.cookies, timeoutMs: 90000 });
    return { refreshed: true, reason };
  } catch (err) {
    console.warn(`[FACEBOOK] Tu dong refresh doc_ids that bai: ${err?.message || err}`);
    return { refreshed: false, reason: 'capture-failed' };
  } finally {
    refreshInFlight = false;
  }
}
