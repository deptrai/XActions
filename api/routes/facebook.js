// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
/** @typedef {import('puppeteer').Page} Page */
/** @typedef {import('puppeteer').Browser} Browser */
/**
 * @typedef {Object} MessengerCampaignDeps
 * @property {(options?: FacebookOptions) => Promise<Browser>} createBrowser
 * @property {(browser: Browser, options?: FacebookOptions) => Promise<Page>} createPage
 * @property {(page: Page, cookies: FacebookLoginCookieOptions, options?: FacebookOptions) => Promise<Page | void>} loginWithCookie
 * @property {(page: Page | null, campaign: { postUrl: string, recipients: string[], content?: string }, options?: FacebookOptions) => Promise<Record<string, unknown>>} messengerShareCampaign
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { resolveAccountCookie } from './facebookAccounts.js';
import { resolve as resolveFacebookAuth } from '../services/facebookAuth.js';
import { buildUserDataDir } from '../services/facebookAutomation.js';
import { scrape } from '../../src/scrapers/index.js';
const router = express.Router();
router.use(authMiddleware);

const C_USER_UID_RE = /^\d{10,20}$/;

/**
 * Validate the shape of a raw Facebook session cookie.
 * Returns an error string if c_user/xs are provided and malformed, null if OK or not provided.
 * c_user must be a numeric Facebook UID (10-20 digits) and xs must be non-empty.
 * Cookie values are never logged (NFR3).
 *
 * @param {Record<string, unknown>} authCookie
 * @returns {string|null}
 */
function validateRawCookie(authCookie) {
  const cUser = String(authCookie?.c_user ?? '').trim();
  const xs = String(authCookie?.xs ?? '').trim();
  // Not a raw cookie — nothing to validate.
  if (!cUser && !xs) return null;
  if (!C_USER_UID_RE.test(cUser)) {
    return '❌ authCookie.c_user must be a numeric Facebook UID (10-20 digits).';
  }
  if (!xs) {
    return '❌ A Facebook session is required: provide authCookie { c_user, xs }, authCookie.accountId, or accountIds[].';
  }
  return null;
}

/**
 * Validate Facebook auth presence: EITHER a stored account reference
 * (authCookie.accountId / accountIds[]) OR a raw session cookie ({ c_user, xs }).
 * Returns an error string if neither is present, null if OK.
 * Cookie values are never logged (NFR3).
 *
 * @param {Record<string, unknown>} body
 * @returns {string|null}
 */
function requireFacebookCookie(body) {
  const authCookie = /** @type {Record<string, unknown> | undefined} */ (body.authCookie);
  const accountIds = /** @type {unknown[] | undefined} */ (body.accountIds);
  // Stored-account path (Story 5.5 D1): accountId is an opaque id, resolved + decrypted server-side.
  if (authCookie?.accountId || (Array.isArray(accountIds) && (accountIds ?? []).length > 0)) {
    return null;
  }
  // Raw-cookie path. Coerce to string first — c_user is a numeric Facebook UID and may arrive as a
  // JSON number, which would crash on .trim() instead of giving a clean 400.
  const cookieError = validateRawCookie(authCookie ?? {});
  if (cookieError) return cookieError;
  const cUser = String(authCookie?.c_user ?? '').trim();
  const xs = String(authCookie?.xs ?? '').trim();
  if (!cUser || !xs) {
    return '❌ A Facebook session is required: provide authCookie { c_user, xs }, authCookie.accountId, or accountIds[].';
  }
  return null;
}

/**
 * Resolve the set of accounts a messenger-share run executes under (Story 5.5 D1+D2).
 * Accepts accountIds[] (multi), authCookie.accountId (single stored), or raw authCookie.
 * Stored accounts are decrypted server-side — raw cookie never required from the client.
 *
 * @param {string} userId
 * @param {Record<string, unknown>} body
 * @returns {Promise<Array<{label: string, cookie: FacebookLoginCookieOptions}>>}
 */
async function resolveRunAccounts(userId, body) {
  const authCookie = /** @type {Record<string, unknown> | undefined} */ (body.authCookie);
  const accountIds = /** @type {unknown[] | undefined} */ (body.accountIds);
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const out = [];
    for (const rawAid of accountIds) {
      const aid = /** @type {string} */ (rawAid);
      out.push({ label: aid, cookie: await resolveAccountCookie(userId, aid) });
    }
    return out;
  }
  if (authCookie?.accountId) {
    const accountId = /** @type {string} */ (authCookie.accountId);
    return [{ label: accountId, cookie: await resolveAccountCookie(userId, accountId) }];
  }
  return [{ label: 'raw', cookie: /** @type {FacebookLoginCookieOptions} */ ({ c_user: String(authCookie?.c_user), xs: String(authCookie?.xs) }) }];
}

/**
 * Build default browserOptions from production environment variables.
 * Allows operators to set a Facebook scraping proxy without sending it in every request.
 * Request-level browserOptions override these defaults.
 *
 * @returns {Record<string, unknown> | null}
 */
function defaultBrowserOptionsFromEnv() {
  const proxy = process.env.FACEBOOK_PROXY?.trim();
  if (!proxy) return null;

  /** @type {Record<string, unknown>} */
  const opts = { proxy };

  const username = process.env.FACEBOOK_PROXY_AUTH_USERNAME?.trim();
  const password = process.env.FACEBOOK_PROXY_AUTH_PASSWORD?.trim();
  if (username && password) {
    opts.proxyAuth = { username, password };
  }

  const timezone = process.env.FACEBOOK_PROXY_TIMEZONE?.trim();
  const lat = process.env.FACEBOOK_PROXY_LATITUDE;
  const lng = process.env.FACEBOOK_PROXY_LONGITUDE;
  const accuracy = process.env.FACEBOOK_PROXY_ACCURACY;
  if (timezone || lat || lng) {
    opts.proxyLocation = {
      ...(timezone && { timezone }),
      ...(lat && { latitude: Number(lat) }),
      ...(lng && { longitude: Number(lng) }),
      ...(accuracy && { accuracy: Number(accuracy) }),
    };
  }

  return opts;
}

/**
 * Resolve the single cookie used by /api/facebook/scrape.
 * Priority:
 *   1. Raw authCookie { c_user, xs }
 *   2. authCookie.accountId (explicit stored account)
 *   3. accountIds[] (use first for single-page scrape)
 *   4. Auto-pick the most recently verified active stored account
 *
 * Cookie values are decrypted server-side and never logged (NFR3).
 *
 * @param {string} userId
 * @param {Record<string, unknown>} authCookie
 * @param {unknown[]} [accountIds]
 * @returns {Promise<{label: string, cookie: FacebookLoginCookieOptions}>}
 */
async function resolveScrapeCookie(userId, authCookie, accountIds) {
  const cookie = /** @type {Record<string, unknown>} */ (authCookie);
  const rawUser = String(cookie.c_user ?? '').trim();
  const rawXs = String(cookie.xs ?? '').trim();
  if (rawUser || rawXs) {
    if (!rawUser || !/^\d{10,20}$/.test(rawUser)) {
      const err = /** @type {Error & Record<string, unknown>} */ (new Error('authCookie.c_user must be a numeric Facebook UID (10-20 digits).'));
      err.code = 'INVALID_RAW_COOKIE';
      throw err;
    }
    if (!rawXs) {
      const err = /** @type {Error & Record<string, unknown>} */ (new Error('authCookie.xs is required when c_user is provided.'));
      err.code = 'INVALID_RAW_COOKIE';
      throw err;
    }
    return { label: 'raw', cookie: /** @type {FacebookLoginCookieOptions} */ (cookie) };
  }

  const accountId = /** @type {string | undefined} */ (cookie.accountId);
  if (accountId && accountId !== 'auto') {
    const resolved = await resolveFacebookAuth({ accountId }, userId);
    return { label: accountId, cookie: { c_user: resolved.c_user, xs: resolved.xs } };
  }

  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const first = /** @type {string} */ (accountIds[0]);
    const resolved = await resolveFacebookAuth({ accountId: first }, userId);
    return { label: first, cookie: { c_user: resolved.c_user, xs: resolved.xs } };
  }

  // Auto-pick a live, recently-verified stored account.
  const activeHealth = await prisma.facebookAccountHealth.findFirst({
    where: { status: 'active', account: { userId } },
    include: { account: { select: { id: true, label: true } } },
    orderBy: { lastCheckAt: 'desc' },
  });
  if (!activeHealth) {
    const err = /** @type {Error & Record<string, unknown>} */ (new Error(
      'No active Facebook account found. Provide authCookie { c_user, xs }, authCookie.accountId, accountIds[], or add a stored account and run a health check.',
    ));
    err.code = 'NO_ACTIVE_ACCOUNT';
    throw err;
  }
  return { label: activeHealth.account.label, cookie: await (async () => {
    const resolved = await resolveFacebookAuth({ accountId: activeHealth.account.id }, userId);
    return /** @type {FacebookLoginCookieOptions} */ ({ c_user: resolved.c_user, xs: resolved.xs });
  })() };
}

/**
 * Parse an optional price value. Treats undefined, null, and '' as absent.
 * Returns an error for non-finite or negative numbers.
 *
 * @param {unknown} value
 * @returns {{ value?: number, error?: string }}
 */
function parseOptionalPrice(value) {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: 'must be a non-negative number' };
  }
  return { value: n };
}

/**
 * Parse a dryRun value. Accepts boolean or case-insensitive 'true'/'false' strings.
 * Rejects all other values.
 *
 * @param {unknown} value
 * @returns {{ value?: boolean, error?: string }}
 */
function parseDryRun(value) {
  if (typeof value === 'boolean') {
    return { value };
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return { value: true };
    if (normalized === 'false') return { value: false };
  }
  return { error: 'dryRun must be a boolean or the string "true" / "false"' };
}

/**
 * Execute a messenger-share campaign across N accounts and M links (Story 5.5 D2).
 * Recipients are distributed round-robin across accounts; each account opens its own
 * browser session and runs messengerShareCampaign per link (FIFO). Dry-run launches
 * no browser. Per-account/per-link results are aggregated.
 *
 * @param {Object} params
 * @param {Array<{label: string, cookie: FacebookLoginCookieOptions}>} params.accounts
 * @param {string[]} params.links
 * @param {string[]} params.recipients
 * @param {string} params.content
 * @param {boolean} params.dryRun
 * @param {number | string | undefined} [params.maxBatch]
 * @param {(min?: number, max?: number) => Promise<void>} [params.delay]
 * @param {MessengerCampaignDeps} params.deps
 * @returns {Promise<Record<string, unknown>>}
 */
async function runMessengerCampaign({ accounts, links, recipients, content, dryRun, maxBatch, delay, deps }) {
  // Round-robin recipient distribution: recipient i → accounts[i % N]
  /** @type {string[][]} */
  const buckets = accounts.map(() => []);
  recipients.forEach((/** @type {string} */ r, /** @type {number} */ i) => buckets[i % accounts.length].push(r));

  const { createBrowser, createPage, loginWithCookie, messengerShareCampaign } = deps;
  /** @type {Record<string, unknown>[]} */
  const perRun = [];

  for (let a = 0; a < accounts.length; a++) {
    const mine = buckets[a];
    if (mine.length === 0) continue; // more accounts than recipients — skip idle account

    /** @type {FacebookOptions} */
    const campaignOpts = { dryRun, delay, ...(maxBatch != null && { maxBatch: Number(maxBatch) }) };

    if (dryRun) {
      for (const link of links) {
        const r = await messengerShareCampaign(null, { postUrl: link, recipients: mine, content }, campaignOpts);
        perRun.push({ account: accounts[a].label, postUrl: link, ...r });
      }
      continue;
    }

    /** @type {Browser | undefined} */
    let browser;
    try {
      browser = await createBrowser({ headless: true, userDataDir: buildUserDataDir(accounts[a].cookie.c_user, dryRun) });
      const page = await createPage(browser);
      await loginWithCookie(page, { c_user: accounts[a].cookie.c_user, xs: accounts[a].cookie.xs });
      for (const link of links) {
        const r = await messengerShareCampaign(page, { postUrl: link, recipients: mine, content }, campaignOpts);
        perRun.push({ account: accounts[a].label, postUrl: link, ...r });
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  return {
    dryRun,
    accounts: accounts.length,
    links: links.length,
    recipients: recipients.length,
    runs: perRun,
  };
}

/**
 * POST /api/facebook/scrape
 * Scrape Facebook data: profile, posts, followers, search, or marketplace.
 *
 * Body: {
 *   action: 'profile' | 'posts' | 'followers' | 'search' | 'marketplace' | 'post_comments' | 'group_posts' | 'group_comments',
 *   url?: string,       // required for profile/posts/followers/post_comments/group_posts/group_comments
 *   query?: string,     // required for search / marketplace
 *   type?: 'posts' | 'people' | 'pages' | 'groups' | 'all', // search only
 *   parallel?: boolean, // search only, accepted and ignored in Story 7.2
 *   location?: string,  // search and marketplace
 *   category?: string,  // marketplace only
 *   categoryId?: string | number, // marketplace only
 *   minPrice?: number | string,  // marketplace only (priceMin alias accepted)
 *   maxPrice?: number | string,  // marketplace only (priceMax alias accepted)
 *   latitude?: number,
 *   longitude?: number,
 *   radiusKm?: number,
 *   cursor?: string,
 *   after?: string,
 *   limit?: number,     // positive integer
 *   dryRun?: boolean,   // marketplace only
 *   includeReplies?: boolean, // post_comments/group_comments only
 *   authCookie?: { c_user, xs } | { accountId: string }, // optional; auto-picks active stored account if omitted
 *   accountIds?: string[],                                 // optional; uses first for single-page scrape
 *   browserOptions?: { proxy, proxyAuth, proxyLocation, headless, skipWarmup }
 * }
 */
router.post('/scrape', async (/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
    const action = /** @type {string | undefined} */ (body.action);
    const url = /** @type {string | undefined} */ (body.url);
    const query = /** @type {string | null | undefined} */ (body.query);
    const type = /** @type {string | undefined} */ (body.type);
    const parallel = /** @type {boolean | undefined} */ (body.parallel);
    const location = /** @type {string | undefined} */ (body.location);
    const category = /** @type {string | undefined} */ (body.category);
    const categoryId = /** @type {string | number | undefined} */ (body.categoryId);
    const minPrice = /** @type {number | string | null | undefined} */ (body.minPrice);
    const maxPrice = /** @type {number | string | null | undefined} */ (body.maxPrice);
    const priceMin = /** @type {number | string | null | undefined} */ (body.priceMin);
    const priceMax = /** @type {number | string | null | undefined} */ (body.priceMax);
    const latitude = /** @type {number | string | undefined} */ (body.latitude);
    const longitude = /** @type {number | string | undefined} */ (body.longitude);
    const radiusKm = /** @type {number | string | undefined} */ (body.radiusKm);
    const dryRun = /** @type {boolean | string | null | undefined} */ (body.dryRun);
    const cursor = /** @type {string | undefined} */ (body.cursor);
    const after = /** @type {string | undefined} */ (body.after);
    const limit = /** @type {number | string | undefined} */ (body.limit);
    const includeReplies = /** @type {boolean | undefined} */ (body.includeReplies);
    const authCookie = /** @type {Record<string, unknown> | undefined} */ (body.authCookie);
    const browserOptions = /** @type {Record<string, unknown> | undefined} */ (body.browserOptions);
    const accountIds = /** @type {unknown[] | undefined} */ (body.accountIds);

    /** @type {string} */
    let trimmedQuery = '';

    const VALID_ACTIONS = ['profile', 'posts', 'followers', 'search', 'group-members', 'marketplace', 'post_comments', 'group_posts', 'group_comments', 'group_search'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
      });
    }

    if (['profile', 'posts', 'followers', 'group-members', 'post_comments', 'group_posts', 'group_comments', 'group_search'].includes(action) && !url?.trim()) {
      return res.status(400).json({ ok: false, error: `action "${action}" requires url` });
    }
    if (['search', 'marketplace', 'group_search'].includes(action)) {
      if (query === undefined || query === null) {
        return res.status(400).json({ ok: false, error: `action "${action}" requires query` });
      }
      if (typeof query !== 'string') {
        return res.status(400).json({ ok: false, error: 'query must be a string' });
      }
      trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return res.status(400).json({ ok: false, error: `action "${action}" requires query` });
      }
      if (trimmedQuery.length > 500) {
        return res.status(400).json({ ok: false, error: 'query must be at most 500 characters' });
      }
    }

    // group_search requires a facebook.com/groups/ URL — validate before browser launch.
    if (action === 'group_search' && !/facebook\.com\/groups\//i.test(/** @type {string} */ (url))) {
      return res.status(400).json({ ok: false, error: 'group_search requires a facebook.com/groups/ URL' });
    }

    if (action === 'search' && type !== undefined && type !== null) {
      const VALID_TYPES = ['posts', 'people', 'pages', 'groups', 'all'];
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({
          ok: false,
          error: `search type must be one of: ${VALID_TYPES.join(', ')}`,
        });
      }
    }

    // Validate optional numeric parameters before launching a browser.
    if (limit !== undefined && limit !== null) {
      const n = Number(limit);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ ok: false, error: 'limit must be a positive integer' });
      }
      if (n > 500) {
        return res.status(400).json({ ok: false, error: 'limit must be at most 500' });
      }
    }

    // Validate comment-only boolean parameter.
    if (['post_comments', 'group_comments'].includes(action)) {
      if (includeReplies !== undefined && includeReplies !== null && typeof includeReplies !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'includeReplies must be a boolean' });
      }
    }

    if (action === 'search') {
      if (location !== undefined && location !== null) {
        if (typeof location !== 'string') {
          return res.status(400).json({ ok: false, error: 'location must be a string' });
        }
        if (location.length > 200) {
          return res.status(400).json({ ok: false, error: 'location must be at most 200 characters' });
        }
      }
      if (parallel !== undefined && parallel !== null && typeof parallel !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'parallel must be a boolean' });
      }
    }

    if (browserOptions !== undefined && browserOptions !== null && (typeof browserOptions !== 'object' || Array.isArray(browserOptions))) {
      return res.status(400).json({ ok: false, error: 'browserOptions must be an object' });
    }

    /** @type {number | undefined} */
    let resolvedMinPrice;
    /** @type {number | undefined} */
    let resolvedMaxPrice;
    /** @type {boolean | undefined} */
    let resolvedDryRun;

    if (action === 'marketplace') {
      const rawMin = (minPrice !== undefined && minPrice !== null && minPrice !== '')
        ? minPrice
        : (priceMin !== undefined && priceMin !== null && priceMin !== '' ? priceMin : undefined);
      const rawMax = (maxPrice !== undefined && maxPrice !== null && maxPrice !== '')
        ? maxPrice
        : (priceMax !== undefined && priceMax !== null && priceMax !== '' ? priceMax : undefined);

      if (rawMin !== undefined) {
        const parsed = parseOptionalPrice(rawMin);
        if (parsed.error) {
          return res.status(400).json({ ok: false, error: `minPrice ${parsed.error}` });
        }
        resolvedMinPrice = parsed.value;
      }
      if (rawMax !== undefined) {
        const parsed = parseOptionalPrice(rawMax);
        if (parsed.error) {
          return res.status(400).json({ ok: false, error: `maxPrice ${parsed.error}` });
        }
        resolvedMaxPrice = parsed.value;
      }
      if (resolvedMinPrice !== undefined && resolvedMaxPrice !== undefined && resolvedMinPrice > resolvedMaxPrice) {
        return res.status(400).json({ ok: false, error: 'minPrice must not be greater than maxPrice' });
      }

      if (dryRun !== undefined && dryRun !== null) {
        const parsed = parseDryRun(dryRun);
        if (parsed.error) {
          return res.status(400).json({ ok: false, error: parsed.error });
        }
        resolvedDryRun = parsed.value;
      }
    }

    // Resolve the session: raw cookie, stored accountId/accountIds, or auto-pick a live one.
    let resolved;
    try {
      resolved = await resolveScrapeCookie(reqUser.id, authCookie ?? {}, accountIds);
    } catch (e) {
      const err = /** @type {Error & Record<string, unknown>} */ (e);
      const code = err.code;
      if (code === 'INVALID_RAW_COOKIE') {
        return res.status(400).json({ ok: false, error: (e instanceof Error ? e.message : String(e)) });
      }
      if (code === 'ACCOUNT_NOT_FOUND') {
        return res.status(400).json({ ok: false, error: 'Selected Facebook account not found' });
      }
      if (code === 'ACCOUNT_DECRYPT_FAILED') {
        return res.status(400).json({ ok: false, error: 'Failed to load the selected Facebook account session', sessionExpired: true });
      }
      if (code === 'NO_ACTIVE_ACCOUNT') {
        return res.status(400).json({ ok: false, error: (e instanceof Error ? e.message : String(e)) });
      }
      throw e;
    }

    // Merge request browserOptions with production env defaults (proxy, geo).
    const envBrowserOptions = defaultBrowserOptionsFromEnv() || {};
    const requestBrowserOptions = /** @type {Record<string, unknown>} */ (browserOptions || {});
    const proxyAuth = /** @type {Record<string, unknown>} */ ({ ...(/** @type {Record<string, unknown>} */ (envBrowserOptions.proxyAuth || {})), ...(/** @type {Record<string, unknown>} */ (requestBrowserOptions.proxyAuth || {})) });
    const proxyLocation = /** @type {Record<string, unknown>} */ ({ ...(/** @type {Record<string, unknown>} */ (envBrowserOptions.proxyLocation || {})), ...(/** @type {Record<string, unknown>} */ (requestBrowserOptions.proxyLocation || {})) });

    /** @type {Record<string, unknown>} */
    const mergedBrowserOptions = {
      ...envBrowserOptions,
      ...requestBrowserOptions,
    };
    if (Object.keys(proxyAuth).length) mergedBrowserOptions.proxyAuth = proxyAuth;
    if (Object.keys(proxyLocation).length) mergedBrowserOptions.proxyLocation = proxyLocation;

    // Dynamic import — avoids loading Puppeteer until needed
    const { run: facebookScrapeRun } = await import('../services/facebookScrape.js');

    const options = {
      userId: reqUser.id,
      ...(Object.keys(mergedBrowserOptions).length ? { browserOptions: mergedBrowserOptions } : {}),
      // Pass all cookie fields for full session auth (never log values).
      authCookie: resolved.cookie,
    };

    // Dispatcher resolves target from options.url / options.query (NOT options.target).
    // Pass the keys it actually reads, else the target is silently dropped → scrape fails.
    const scrapeArgs = {
      ...options,
      ...(action === 'search'
        ? {
            query: trimmedQuery,
            ...(type !== undefined && type !== null && { type }),
            ...(parallel !== undefined && parallel !== null && { parallel }),
            ...(location !== undefined && location !== null && { location: location.trim() }),
            ...(limit !== undefined && limit !== null && { limit: Number(limit) }),
          }
        : action === 'marketplace'
          ? {
              query: trimmedQuery,
              ...(location !== undefined && location !== null && { location: String(location).trim() }),
              ...(category !== undefined && category !== null && { category: String(category).trim() }),
              ...(categoryId !== undefined && categoryId !== null && { categoryId: String(categoryId).trim() }),
              ...(resolvedMinPrice !== undefined && { minPrice: resolvedMinPrice }),
              ...(resolvedMaxPrice !== undefined && { maxPrice: resolvedMaxPrice }),
              ...(latitude !== undefined && latitude !== null && { latitude: Number(latitude) }),
              ...(longitude !== undefined && longitude !== null && { longitude: Number(longitude) }),
              ...(radiusKm !== undefined && radiusKm !== null && { radiusKm: Number(radiusKm) }),
              ...(resolvedDryRun !== undefined && { dryRun: resolvedDryRun }),
              ...(cursor !== undefined && cursor !== null && { cursor: String(cursor).trim() }),
              ...(after !== undefined && after !== null && { after: String(after).trim() }),
              ...(limit !== undefined && limit !== null && { limit: Number(limit) }),
            }
          : action === 'group_search'
            ? { url: /** @type {string} */ (url).trim(), query: trimmedQuery }
            : { url: /** @type {string} */ (url).trim() }),
      ...(limit !== undefined && limit !== null ? { limit: Number(limit) } : {}),
      ...(['post_comments', 'group_comments'].includes(action) && includeReplies !== undefined && includeReplies !== null
        ? { includeReplies }
        : {}),
    };
    const result = await facebookScrapeRun(action, scrapeArgs);

    res.json({ ok: true, action, result });
  } catch (error) {
    // Log full detail server-side; return a user-facing message that preserves
    // key account/session signals without leaking Puppeteer/DB internals.
    console.error('❌ Facebook scrape error:', error);

    const msg = String((error instanceof Error ? error.message : String(error)) || '');
    if (msg.includes('cookie authentication failed')) {
      return res.status(400).json({ ok: false, error: 'Facebook session expired or invalid cookies.', sessionExpired: true });
    }
    if (msg.includes('security check') || msg.includes('checkpoint') || (/** @type {Error & Record<string, unknown>} */ (error)).code === 'FB_CHECKPOINT') {
      return res.status(400).json({ ok: false, error: 'Facebook security check / CAPTCHA detected. The account needs manual verification or a proxy in the cookie\'s home country.', checkpoint: true });
    }
    if ((/** @type {Error & Record<string, unknown>} */ (error)).code === 'FB_ONBOARDING_WALL' || msg.includes('onboarding wall')) {
      return res.status(400).json({ ok: false, error: 'Facebook account is showing an onboarding / friend-suggestion wall. Complete setup on a real browser before scraping.', accountRestricted: true });
    }
    res.status(500).json({ ok: false, error: 'Facebook scrape failed. See server logs.' });
  }
});

/**
 * POST /api/facebook/automate
 * Run Facebook automation with dry-run default (ADR-007, SM-2).
 *
 * Body: {
 *   action: 'like' | 'comment' | 'post',
 *   urls?: string[],     // required for like/comment
 *   text?: string,       // required for comment/post
 *   dryRun?: boolean,    // defaults true — only false enables real writes
 *   authCookie: { c_user, xs },
 *   maxBatch?: number
 * }
 */
router.post('/automate', async (/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
    const rawAction = /** @type {string | undefined} */ (body.action);
    const urls = /** @type {string[]} */ (body.urls) ?? [];
    const text = /** @type {string} */ (body.text) ?? '';
    const dryRun = /** @type {boolean | undefined} */ (body.dryRun);
    const authCookie = /** @type {FacebookLoginCookieOptions & Record<string, unknown>} */ (body.authCookie);
    const maxBatch = /** @type {number | string | undefined} */ (body.maxBatch);
    const recipients = /** @type {string[]} */ (body.recipients) ?? [];
    const content = /** @type {string} */ (body.content) ?? '';
    const postUrl = /** @type {string} */ (body.postUrl) ?? '';
    const postUrls = /** @type {string[]} */ (body.postUrls) ?? [];
    const groupUrls = /** @type {string[]} */ (body.groupUrls) ?? [];
    const targets = /** @type {unknown[]} */ (body.targets) ?? [];

    // Hard auth guard — must come before any browser launch
    const cookieError = requireFacebookCookie(req.body);
    if (cookieError) return res.status(400).json({ ok: false, error: cookieError });

    // Normalize the messenger alias to the canonical token.
    const action = rawAction === 'messenger' ? 'messenger-share' : rawAction;

    const VALID_ACTIONS = [
      'like', 'comment', 'post', 'messenger-share', 'share-link-uid',
      'share', 'schedule',
      'join-groups', 'batch-post-groups',
      'send-friend-requests', 'cancel-friend-requests',
      'warmup-account', 'warmup-scroll-feed',
    ];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')} (alias: messenger)`,
      });
    }

    // Fail-fast arg validation before browser launch (mirrors MCP/CLI guards)
    if (['like', 'comment'].includes(action) && (!Array.isArray(urls) || urls.length === 0)) {
      return res.status(400).json({
        ok: false,
        error: `action "${action}" requires at least one URL in urls`,
      });
    }
    if (['comment', 'post'].includes(action) && !String(text ?? '').trim()) {
      return res.status(400).json({
        ok: false,
        error: `action "${action}" requires non-empty text`,
      });
    }
    // messenger-share: ≥1 facebook.com link (postUrl or postUrls[]) + ≥1 recipient + non-empty content
    // Normalize single postUrl and postUrls[] into one link list (Story 5.5 D2).
    const allLinks = [
      ...(typeof postUrl === 'string' && postUrl.trim() ? [postUrl.trim()] : []),
      ...(Array.isArray(postUrls) ? postUrls.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.trim()) : []),
    ];
    if (action === 'messenger-share') {
      if (allLinks.length === 0 || !allLinks.every((u) => /facebook\.com\//i.test(u))) {
        return res.status(400).json({ ok: false, error: 'action "messenger-share" requires at least one facebook.com postUrl (or postUrls[])' });
      }
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "messenger-share" requires a non-empty recipients array' });
      }
      if (!String(content ?? '').trim()) {
        return res.status(400).json({ ok: false, error: 'action "messenger-share" requires non-empty content' });
      }
    }

    // --- New action validation guards (Story 4.x growth features) ---
    if (action === 'share') {
      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "share" requires at least one URL in urls' });
      }
    }
    if (action === 'schedule') {
      if (!String(text ?? '').trim()) {
        return res.status(400).json({ ok: false, error: 'action "schedule" requires non-empty text (content)' });
      }
      const scheduledAt = /** @type {string | undefined} */ (body.scheduledAt);
      if (!scheduledAt || isNaN(new Date(/** @type {string | number | Date} */ (scheduledAt)).getTime())) {
        return res.status(400).json({ ok: false, error: 'action "schedule" requires a valid scheduledAt (ISO-8601)' });
      }
    }
    if (action === 'join-groups') {
      if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "join-groups" requires at least one URL in groupUrls' });
      }
    }
    if (action === 'batch-post-groups') {
      if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "batch-post-groups" requires at least one URL in groupUrls' });
      }
      if (!String(text ?? '').trim()) {
        return res.status(400).json({ ok: false, error: 'action "batch-post-groups" requires non-empty text (content)' });
      }
    }
    if (action === 'send-friend-requests') {
      if (!Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "send-friend-requests" requires at least one URL in targets' });
      }
    }
    if (action === 'warmup-scroll-feed') {
      const targetUrl = /** @type {string | undefined} */ (body.targetUrl);
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
        return res.status(400).json({ ok: false, error: 'action "warmup-scroll-feed" requires a non-empty targetUrl' });
      }
    }
    // cancel-friend-requests and warmup-account: no required fields (all optional)

    // Strict dryRun gate — only explicit false enables real writes
    const resolvedDryRun = dryRun === false ? false : true;

    // headless mode: default true (invisible browser). Set false to show browser window.
    const isHeadless = body.headless !== false;

    // Per-user Socket.IO room — never broadcast operation events to all clients (NFR3 / privacy)
    const emit = (/** @type {Record<string, unknown>} */ payload) => global.io?.to(`user:${reqUser.id}`).emit('facebook:operation', payload);

    // ========================================================================
    // messenger-share — dedicated path (Story 5.5 D1+D2): multi-account
    // round-robin, multi-link, server-side cookie resolution. Each account needs
    // its own browser session, so this does NOT use the single-page dispatch()
    // model used by like/comment/post below.
    // ========================================================================
    if (action === 'messenger-share') {
      // ADR-012 delay floor: 5–15s jitter for messenger; no-op under dry-run.
      const messengerDelay = resolvedDryRun
        ? () => Promise.resolve()
        : (min = 5000, max = 15000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

      let accounts;
      try {
        accounts = await resolveRunAccounts(reqUser.id, req.body);
      } catch (e) {
        // accountId not found / decrypt failed — 400, never leak detail (NFR3)
        const err = /** @type {Error & Record<string, unknown>} */ (e);
        const sessionExpired = err.code === 'ACCOUNT_DECRYPT_FAILED';
        const msg = err.code === 'ACCOUNT_NOT_FOUND'
          ? 'Selected Facebook account not found'
          : 'Failed to load the selected Facebook account session';
        return res.status(400).json({ ok: false, error: msg, sessionExpired });
      }

      const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
      const messengerShareModule = /** @type {{ messengerShareCampaign: MessengerCampaignDeps['messengerShareCampaign'] }} */ (await import('../../src/scrapers/facebook/messengerShare.js'));
      const { messengerShareCampaign } = messengerShareModule;
      // Wrap createBrowser to pass headless option
      const createBrowserWithHeadless = (/** @type {FacebookOptions | undefined} */ opts) => createBrowser({ ...opts, headless: isHeadless });
      const runArgs = {
        accounts, links: allLinks, recipients, content,
        dryRun: resolvedDryRun, maxBatch, delay: messengerDelay,
        deps: { createBrowser: createBrowserWithHeadless, createPage, loginWithCookie, messengerShareCampaign },
      };

      // Dry-run: no browser, no Operation row (mirrors generic dry-run short-circuit).
      if (resolvedDryRun) {
        const result = await runMessengerCampaign(runArgs);
        return res.json({ ok: true, action, dryRun: true, userId: reqUser.id, operationId: null, ...result });
      }

      // Real run — PII-free Operation config (counts/lengths only, NFR3).
      const operation = await prisma.operation.create({
        data: {
          userId: reqUser.id,
          type: 'facebook_messenger_share',
          status: 'running',
          startedAt: new Date(),
          config: JSON.stringify({
            action, linksCount: allLinks.length, recipientsCount: recipients.length,
            accountsCount: accounts.length, contentLength: String(content ?? '').length,
            maxBatch: maxBatch ?? null,
          }),
        },
      });
      emit({ event: 'start', operationId: operation.id, userId: reqUser.id, type: operation.type, status: 'running' });

      try {
        const result = await runMessengerCampaign(runArgs);
        await prisma.operation.update({
          where: { id: operation.id },
          data: { status: 'completed', completedAt: new Date(), result: JSON.stringify(result) },
        });
        emit({ event: 'complete', operationId: operation.id, userId: reqUser.id, status: 'completed' });
        return res.json({ ok: true, action, dryRun: false, userId: reqUser.id, operationId: operation.id, ...result });
      } catch (runError) {
        await prisma.operation.update({
          where: { id: operation.id },
          data: { status: 'failed', completedAt: new Date(), error: (runError instanceof Error ? runError.message : String(runError)) },
        });
        emit({ event: 'error', operationId: operation.id, userId: reqUser.id, status: 'failed', error: (runError instanceof Error ? runError.message : String(runError)) });
        return res.status(500).json({ ok: false, error: 'Messenger campaign failed. See server logs.' });
      }
    }

    // ========================================================================
    // share-link-uid — share post via direct Messenger URL (UID-based)
    // Now routed through FacebookCrawler.messenger_share (hybrid).
    // ========================================================================
    if (action === 'share-link-uid') {
      const shareBody = /** @type {Record<string, unknown>} */ (req.body ?? {});
      const postUrl = /** @type {string} */ (shareBody.postUrl) ?? '';
      const postUrls = /** @type {string[]} */ (shareBody.postUrls) ?? [];
      const content = /** @type {string} */ (shareBody.content) ?? '';
      const message = /** @type {string} */ (shareBody.message) ?? '';
      const recipientUid = /** @type {string} */ (shareBody.recipientUid) ?? '';
      const recipientUids = /** @type {string[]} */ (shareBody.recipientUids) ?? [];
      const headlessParam = /** @type {boolean | undefined} */ (shareBody.headless);
      const url = postUrl || (Array.isArray(postUrls) ? postUrls[0] : '') || '';
      if (!url.trim()) {
        return res.status(400).json({ ok: false, error: 'action "share-link-uid" requires postUrl or postUrls[]' });
      }

      const allRecipients = [
        ...(recipientUid ? [recipientUid] : []),
        ...(Array.isArray(recipientUids) ? recipientUids : []),
      ];
      if (allRecipients.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "share-link-uid" requires recipientUid or recipientUids[]' });
      }

      const isHeadless = headlessParam !== false;

      try {
        const result = /** @type {Record<string, unknown>} */ (await scrape('facebook', 'messenger_share', {
          postUrl: url,
          recipients: allRecipients,
          content: content || message,
          dryRun: resolvedDryRun,
          authCookie,
          browserOptions: { headless: isHeadless },
        }));
        const rawResults = result?.results;
        const results = Array.isArray(rawResults) ? /** @type {Record<string, unknown>[]} */ (rawResults) : [];
        const successCount = results.filter((r) => Boolean(r.ok)).length;
        return res.json({
          ok: true,
          action,
          dryRun: resolvedDryRun,
          userId: reqUser.id,
          operationId: null,
          postUrl: url,
          results,
          successCount,
          totalCount: allRecipients.length,
          headless: isHeadless,
          method: 'direct-messenger-url',
        });
      } catch (runError) {
        return res.status(500).json({ ok: false, error: 'Share link by UID failed. See server logs.' });
      }
    }

    const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
    const {
      scheduleFacebookPost,
      cancelPendingFriendRequests,
      warmupAccount,
      warmupScrollFeed,
    } = await import('../services/facebookAutomation.js');

    const baseOptions = {
      dryRun: resolvedDryRun,
      ...(maxBatch != null && { maxBatch: Number(maxBatch) }),
    };

    // Actions migrated to FacebookCrawler hybrid engine.
    const HYBRID_ACTIONS = ['like', 'comment', 'post', 'share', 'join-groups', 'batch-post-groups', 'send-friend-requests'];
    const isHybrid = HYBRID_ACTIONS.includes(action);

    const envBrowserOptions = defaultBrowserOptionsFromEnv() || {};
    const requestBrowserOptions = /** @type {Record<string, unknown>} */ (body.browserOptions || {});
    const proxyAuth = /** @type {Record<string, unknown>} */ ({ ...(/** @type {Record<string, unknown>} */ (envBrowserOptions.proxyAuth || {})), ...(/** @type {Record<string, unknown>} */ (requestBrowserOptions.proxyAuth || {})) });
    const proxyLocation = /** @type {Record<string, unknown>} */ ({ ...(/** @type {Record<string, unknown>} */ (envBrowserOptions.proxyLocation || {})), ...(/** @type {Record<string, unknown>} */ (requestBrowserOptions.proxyLocation || {})) });

    /** @type {Record<string, unknown>} */
    const runBrowserOptions = {
      ...envBrowserOptions,
      ...requestBrowserOptions,
      headless: isHeadless,
      userDataDir: buildUserDataDir(authCookie.c_user),
    };
    if (Object.keys(proxyAuth).length) runBrowserOptions.proxyAuth = proxyAuth;
    if (Object.keys(proxyLocation).length) runBrowserOptions.proxyLocation = proxyLocation;

    /** @returns {Record<string, unknown>} */
    const buildHybridScrapeArgs = () => {
      /** @type {Record<string, unknown>} */
      const scrapeArgs = { ...baseOptions, authCookie, browserOptions: runBrowserOptions };
      if (['like', 'comment', 'share'].includes(action)) {
        scrapeArgs.urls = urls;
      }
      if (['comment', 'post', 'batch-post-groups'].includes(action)) {
        scrapeArgs.text = text;
      }
      if (action === 'join-groups') {
        scrapeArgs.groupUrls = groupUrls;
        if (body.keyword) scrapeArgs.keyword = String(body.keyword).trim();
        if (body.limit != null) scrapeArgs.limit = Number(body.limit);
      }
      if (action === 'batch-post-groups') {
        scrapeArgs.groupUrls = groupUrls;
      }
      if (action === 'send-friend-requests') {
        scrapeArgs.targets = targets;
        scrapeArgs.mode = /** @type {string} */ (body.mode) || 'uid_list';
        if (body.location) scrapeArgs.location = String(body.location).trim();
        if (body.limit != null) scrapeArgs.limit = Number(body.limit);
      }
      return scrapeArgs;
    };

    // Legacy dispatch for schedule, cancel, warmup (no hybrid action yet).
    const dispatch = /** @type {(page: Page) => Promise<Record<string, unknown>>} */ (async (page) => {
      if (action === 'schedule') {
        const scheduledAt = /** @type {string | undefined} */ (body.scheduledAt);
        const facebookAccountId = /** @type {string | undefined} */ (body.facebookAccountId);
        return await scheduleFacebookPost(page, { content: text, scheduledAt, facebookAccountId }, { ...baseOptions, userId: reqUser.id });
      }
      if (action === 'cancel-friend-requests') {
        const olderThanDays = /** @type {number | string | undefined} */ (body.olderThanDays);
        const limit = /** @type {number | string | undefined} */ (body.limit) ?? 10;
        return await cancelPendingFriendRequests(page, {
          ...baseOptions,
          ...(olderThanDays != null && { olderThanDays: Number(olderThanDays) }),
          limit: Number(limit),
        });
      }
      if (action === 'warmup-account') {
        const durationSeconds = /** @type {number | string | undefined} */ (body.durationSeconds);
        const allowReactions = /** @type {boolean | undefined} */ (body.allowReactions);
        const reactProbability = /** @type {number | string | undefined} */ (body.reactProbability);
        return await warmupAccount(page, {
          ...baseOptions,
          ...(durationSeconds != null && { durationSeconds: Number(durationSeconds) }),
          ...(allowReactions !== undefined && { allowReactions }),
          ...(reactProbability != null && { reactProbability: Number(reactProbability) }),
        });
      }
      if (action === 'warmup-scroll-feed') {
        const targetUrl = /** @type {string | undefined} */ (body.targetUrl);
        const durationSeconds = /** @type {number | string | undefined} */ (body.durationSeconds);
        return await warmupScrollFeed(page, /** @type {string} */ (targetUrl), {
          ...baseOptions,
          ...(durationSeconds != null && { durationSeconds: Number(durationSeconds) }),
        });
      }
      throw new Error(`Unsupported legacy action: ${action}`);
    });

    // Dry-run preview for hybrid: no browser, no Operation record.
    // Legacy cancel-friend-requests still needs a page to collect pending requests.
    if (resolvedDryRun) {
      if (isHybrid) {
        const result = /** @type {Record<string, unknown>} */ (await scrape('facebook', action, buildHybridScrapeArgs()));
        return res.json({ ok: true, action, dryRun: true, userId: reqUser.id, operationId: null, ...result });
      }
      if (action !== 'cancel-friend-requests') {
        const result = await dispatch(/** @type {Page} */ (/** @type {unknown} */ (null)));
        return res.json({ ok: true, action, dryRun: true, userId: reqUser.id, operationId: null, ...result });
      }
    }

    // Real run — create Operation record (config excludes authCookie; NFR3)
    const MAX_URLS = 100;
    const MAX_TEXT = 5000;
    const configUrls = Array.isArray(urls) ? urls.slice(0, MAX_URLS) : [];
    const configGroupUrls = Array.isArray(groupUrls) ? groupUrls.slice(0, MAX_URLS) : [];
    const configTargets = Array.isArray(targets) ? targets.slice(0, MAX_URLS) : [];
    const configText = String(text ?? '').slice(0, MAX_TEXT);
    const operationConfig = { action, urls: configUrls, groupUrls: configGroupUrls, targets: configTargets, text: configText, maxBatch: maxBatch ?? null };
    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: `facebook_${action}`,
        status: 'running',
        startedAt: new Date(),
        config: JSON.stringify(operationConfig),
      },
    });
    emit({ event: 'start', operationId: operation.id, userId: reqUser.id, type: operation.type, status: 'running' });

    /** @type {Record<string, unknown>} */
    let result;
    /** @type {Browser | undefined} */
    let browser;
    try {
      if (isHybrid) {
        result = /** @type {Record<string, unknown>} */ (await scrape('facebook', action, buildHybridScrapeArgs()));
      } else {
        browser = await createBrowser(runBrowserOptions);
        const page = await createPage(browser);
        await loginWithCookie(page, {
          c_user: authCookie.c_user,
          xs: authCookie.xs,
          sb: authCookie.sb,
          datar: authCookie.datatar ? String(authCookie.datatar) : authCookie.datar,
          fr: authCookie.fr,
          fbl_st: authCookie.fbl_st,
          locale: authCookie.locale,
        });
        result = await dispatch(page);
      }

      await prisma.operation.update({
        where: { id: operation.id },
        data: { status: 'completed', completedAt: new Date(), result: JSON.stringify(result) },
      });
      emit({ event: 'complete', operationId: operation.id, userId: reqUser.id, status: 'completed' });
    } catch (browserError) {
      await prisma.operation.update({
        where: { id: operation.id },
        data: { status: 'failed', completedAt: new Date(), error: (browserError instanceof Error ? browserError.message : String(browserError)) },
      });
      emit({ event: 'error', operationId: operation.id, userId: reqUser.id, status: 'failed', error: (browserError instanceof Error ? browserError.message : String(browserError)) });
      throw browserError;
    } finally {
      // Swallow close errors so they never mask the original failure
      if (browser) await browser.close().catch(() => {});
    }

    res.json({
      ok: true,
      action,
      dryRun: resolvedDryRun,
      userId: reqUser.id,
      operationId: operation.id,
      ...result,
    });
  } catch (error) {
    // Log full detail server-side; return a generic message (no internal leak).
    console.error('❌ Facebook automate error:', error);

    const msg = String((error instanceof Error ? error.message : String(error)) || '');
    if ((/** @type {Error & Record<string, unknown>} */ (error)).code === 'FB_ONBOARDING_WALL' || msg.includes('onboarding wall')) {
      return res.status(400).json({ ok: false, error: 'Facebook account is showing an onboarding / friend-suggestion wall. Complete setup on a real browser before automating.', accountRestricted: true });
    }
    res.status(500).json({ ok: false, error: 'Facebook automate failed. See server logs.' });
  }
});

export default router;
