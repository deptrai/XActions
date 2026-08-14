// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
import prisma from '../lib/prisma.js';
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { resolveAccountCookie } from './facebookAccounts.js';
import { resolve as resolveFacebookAuth } from '../services/facebookAuth.js';
import { buildUserDataDir } from '../services/facebookAutomation.js';
const router = express.Router();
router.use(authMiddleware);

const C_USER_UID_RE = /^\d{10,20}$/;

/**
 * Validate the shape of a raw Facebook session cookie.
 * Returns an error string if c_user/xs are provided and malformed, null if OK or not provided.
 * c_user must be a numeric Facebook UID (10-20 digits) and xs must be non-empty.
 * Cookie values are never logged (NFR3).
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
 */
function requireFacebookCookie(body) {
  const { authCookie, accountIds } = body ?? {};
  // Stored-account path (Story 5.5 D1): accountId is an opaque id, resolved + decrypted server-side.
  if (authCookie?.accountId || (Array.isArray(accountIds) && accountIds.length > 0)) {
    return null;
  }
  // Raw-cookie path. Coerce to string first — c_user is a numeric Facebook UID and may arrive as a
  // JSON number, which would crash on .trim() instead of giving a clean 400.
  const cookieError = validateRawCookie(authCookie);
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
 * @returns {Promise<Array<{label: string, cookie: {c_user, xs}}>>}
 */
async function resolveRunAccounts(userId, body) {
  const { authCookie, accountIds } = body ?? {};
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const out = [];
    for (const aid of accountIds) {
      out.push({ label: String(aid), cookie: await resolveAccountCookie(userId, aid) });
    }
    return out;
  }
  if (authCookie?.accountId) {
    return [{ label: String(authCookie.accountId), cookie: await resolveAccountCookie(userId, authCookie.accountId) }];
  }
  return [{ label: 'raw', cookie: { c_user: authCookie.c_user, xs: authCookie.xs } }];
}

/**
 * Build default browserOptions from production environment variables.
 * Allows operators to set a Facebook scraping proxy without sending it in every request.
 * Request-level browserOptions override these defaults.
 * @returns {Object|null}
 */
function defaultBrowserOptionsFromEnv() {
  const proxy = process.env.FACEBOOK_PROXY?.trim();
  if (!proxy) return null;

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
 * @returns {Promise<{label: string, cookie: Object}>}
 */
async function resolveScrapeCookie(userId, authCookie, accountIds) {
  const rawUser = String(authCookie?.c_user ?? '').trim();
  const rawXs = String(authCookie?.xs ?? '').trim();
  if (rawUser || rawXs) {
    if (!rawUser || !/^\d{10,20}$/.test(rawUser)) {
      const err = new Error('authCookie.c_user must be a numeric Facebook UID (10-20 digits).');
      err.code = 'INVALID_RAW_COOKIE';
      throw err;
    }
    if (!rawXs) {
      const err = new Error('authCookie.xs is required when c_user is provided.');
      err.code = 'INVALID_RAW_COOKIE';
      throw err;
    }
    return { label: 'raw', cookie: authCookie };
  }

  const accountId = authCookie?.accountId;
  if (accountId && accountId !== 'auto') {
    const resolved = await resolveFacebookAuth({ accountId }, userId);
    return { label: String(accountId), cookie: { c_user: resolved.c_user, xs: resolved.xs } };
  }

  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const first = accountIds[0];
    const resolved = await resolveFacebookAuth({ accountId: first }, userId);
    return { label: String(first), cookie: { c_user: resolved.c_user, xs: resolved.xs } };
  }

  // Auto-pick a live, recently-verified stored account.
  const activeHealth = await prisma.facebookAccountHealth.findFirst({
    where: { status: 'active', account: { userId } },
    include: { account: { select: { id: true, label: true } } },
    orderBy: { lastCheckAt: 'desc' },
  });
  if (!activeHealth) {
    const err = new Error(
      'No active Facebook account found. Provide authCookie { c_user, xs }, authCookie.accountId, accountIds[], or add a stored account and run a health check.',
    );
    err.code = 'NO_ACTIVE_ACCOUNT';
    throw err;
  }
  return { label: activeHealth.account.label, cookie: await (async () => {
    const resolved = await resolveFacebookAuth({ accountId: activeHealth.account.id }, userId);
    return { c_user: resolved.c_user, xs: resolved.xs };
  })() };
}

/**
 * Execute a messenger-share campaign across N accounts and M links (Story 5.5 D2).
 * Recipients are distributed round-robin across accounts; each account opens its own
 * browser session and runs messengerShareCampaign per link (FIFO). Dry-run launches
 * no browser. Per-account/​per-link results are aggregated.
 */
async function runMessengerCampaign({ accounts, links, recipients, content, dryRun, maxBatch, delay, deps }) {
  // Round-robin recipient distribution: recipient i → accounts[i % N]
  const buckets = accounts.map(() => []);
  recipients.forEach((r, i) => buckets[i % accounts.length].push(r));

  const { createBrowser, createPage, loginWithCookie, messengerShareCampaign } = deps;
  const perRun = [];

  for (let a = 0; a < accounts.length; a++) {
    const mine = buckets[a];
    if (mine.length === 0) continue; // more accounts than recipients — skip idle account

    const campaignOpts = { dryRun, delay, ...(maxBatch != null && { maxBatch: Number(maxBatch) }) };

    if (dryRun) {
      for (const link of links) {
        const r = await messengerShareCampaign(null, { postUrl: link, recipients: mine, content }, campaignOpts);
        perRun.push({ account: accounts[a].label, postUrl: link, ...r });
      }
      continue;
    }

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
 *   location?: string,  // search only
 *   limit?: number,     // positive integer
 *   includeReplies?: boolean, // post_comments/group_comments only
 *   authCookie?: { c_user, xs } | { accountId: string }, // optional; auto-picks active stored account if omitted
 *   accountIds?: string[],                                 // optional; uses first for single-page scrape
 *   browserOptions?: { proxy, proxyAuth, proxyLocation, headless, skipWarmup }
 * }
 */
router.post('/scrape', async (req, res) => {
  try {
    const { action, url, query, type, parallel, location, limit, includeReplies, authCookie, browserOptions } = req.body ?? {};

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
      if (typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ ok: false, error: `action "${action}" requires query` });
      }
      if (query.length > 500) {
        return res.status(400).json({ ok: false, error: 'query must be at most 500 characters' });
      }
    }

    // group_search requires a facebook.com/groups/ URL — validate before browser launch.
    if (action === 'group_search' && !/facebook\.com\/groups\//i.test(url)) {
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

    // Resolve the session: raw cookie, stored accountId/accountIds, or auto-pick a live one.
    let resolved;
    try {
      resolved = await resolveScrapeCookie(req.user.id, authCookie, req.body?.accountIds);
    } catch (e) {
      const code = e?.code;
      if (code === 'INVALID_RAW_COOKIE') {
        return res.status(400).json({ ok: false, error: e.message });
      }
      if (code === 'ACCOUNT_NOT_FOUND') {
        return res.status(400).json({ ok: false, error: 'Selected Facebook account not found' });
      }
      if (code === 'ACCOUNT_DECRYPT_FAILED') {
        return res.status(400).json({ ok: false, error: 'Failed to load the selected Facebook account session', sessionExpired: true });
      }
      if (code === 'NO_ACTIVE_ACCOUNT') {
        return res.status(400).json({ ok: false, error: e.message });
      }
      throw e;
    }

    // Merge request browserOptions with production env defaults (proxy, geo).
    const envBrowserOptions = defaultBrowserOptionsFromEnv() || {};
    const mergedBrowserOptions = {
      ...envBrowserOptions,
      ...browserOptions,
      proxyAuth: { ...(envBrowserOptions.proxyAuth || {}), ...(browserOptions?.proxyAuth || {}) },
      proxyLocation: { ...(envBrowserOptions.proxyLocation || {}), ...(browserOptions?.proxyLocation || {}) },
    };
    // Remove empty nested objects so downstream checks stay simple.
    if (!Object.keys(mergedBrowserOptions.proxyAuth).length) delete mergedBrowserOptions.proxyAuth;
    if (!Object.keys(mergedBrowserOptions.proxyLocation).length) delete mergedBrowserOptions.proxyLocation;

    // Dynamic import — avoids loading Puppeteer until needed
    const { run: facebookScrapeRun } = await import('../services/facebookScrape.js');

    const options = {
      userId: req.user.id,
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
            query: query.trim(),
            ...(type !== undefined && type !== null && { type }),
            ...(parallel !== undefined && parallel !== null && { parallel }),
            ...(location !== undefined && location !== null && { location: location.trim() }),
            ...(limit !== undefined && limit !== null && { limit: Number(limit) }),
          }
        : action === 'marketplace'
          ? { query: query.trim() }
          : action === 'group_search'
            ? { url: url.trim(), query: query.trim() }
            : { url: url.trim() }),
      ...(limit !== undefined && limit !== null ? { limit: Number(limit) } : {}),
      ...(['post_comments', 'group_comments'].includes(action) && includeReplies !== undefined && includeReplies !== null
        ? { includeReplies }
        : {}),
    };
    const result = await facebookScrapeRun(action, scrapeArgs);

    res.json({ ok: true, action, result });
  } catch (error) {
    // Log full detail server-side; return a generic message so Prisma/Puppeteer
    // internals (paths, SQL, selectors) are not leaked to the HTTP client.
    console.error('❌ Facebook scrape error:', error);
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
router.post('/automate', async (req, res) => {
  try {
    const { action: rawAction, urls = [], text = '', dryRun, authCookie, maxBatch,
            recipients = [], content = '', postUrl = '', postUrls = [] } = req.body ?? {};

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
      const { scheduledAt } = req.body ?? {};
      if (!scheduledAt || isNaN(new Date(scheduledAt).getTime())) {
        return res.status(400).json({ ok: false, error: 'action "schedule" requires a valid scheduledAt (ISO-8601)' });
      }
    }
    if (action === 'join-groups') {
      const { groupUrls = [] } = req.body ?? {};
      if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "join-groups" requires at least one URL in groupUrls' });
      }
    }
    if (action === 'batch-post-groups') {
      const { groupUrls = [] } = req.body ?? {};
      if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "batch-post-groups" requires at least one URL in groupUrls' });
      }
      if (!String(text ?? '').trim()) {
        return res.status(400).json({ ok: false, error: 'action "batch-post-groups" requires non-empty text (content)' });
      }
    }
    if (action === 'send-friend-requests') {
      const { targets = [] } = req.body ?? {};
      if (!Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "send-friend-requests" requires at least one URL in targets' });
      }
    }
    if (action === 'warmup-scroll-feed') {
      const { targetUrl } = req.body ?? {};
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
        return res.status(400).json({ ok: false, error: 'action "warmup-scroll-feed" requires a non-empty targetUrl' });
      }
    }
    // cancel-friend-requests and warmup-account: no required fields (all optional)

    // Strict dryRun gate — only explicit false enables real writes
    const resolvedDryRun = dryRun === false ? false : true;

    // headless mode: default true (invisible browser). Set false to show browser window.
    const isHeadless = req.body?.headless !== false;

    // Per-user Socket.IO room — never broadcast operation events to all clients (NFR3 / privacy)
    const emit = (payload) => global.io?.to(`user:${req.user.id}`).emit('facebook:operation', payload);

    // ========================================================================
    // messenger-share — dedicated path (Story 5.5 D1+D2): multi-account
    // round-robin, multi-link, server-side cookie resolution. Each account needs
    // its own browser session, so this does NOT use the single-page dispatch()
    // model used by like/comment/post below.
    // ========================================================================
    if (action === 'messenger-share') {
      // ADR-012 delay floor: 5–15s jitter for messenger; no-op under dry-run.
      const messengerDelay = resolvedDryRun
        ? () => {}
        : (min = 5000, max = 15000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

      let accounts;
      try {
        accounts = await resolveRunAccounts(req.user.id, req.body);
      } catch (e) {
        // accountId not found / decrypt failed — 400, never leak detail (NFR3)
        const sessionExpired = e?.code === 'ACCOUNT_DECRYPT_FAILED';
        const msg = e?.code === 'ACCOUNT_NOT_FOUND'
          ? 'Selected Facebook account not found'
          : 'Failed to load the selected Facebook account session';
        return res.status(400).json({ ok: false, error: msg, sessionExpired });
      }

      const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
      const { messengerShareCampaign } = await import('../../src/scrapers/facebook/messengerShare.js');
      // Wrap createBrowser to pass headless option
      const createBrowserWithHeadless = (opts) => createBrowser({ ...opts, headless: isHeadless });
      const runArgs = {
        accounts, links: allLinks, recipients, content,
        dryRun: resolvedDryRun, maxBatch, delay: messengerDelay,
        deps: { createBrowser: createBrowserWithHeadless, createPage, loginWithCookie, messengerShareCampaign },
      };

      // Dry-run: no browser, no Operation row (mirrors generic dry-run short-circuit).
      if (resolvedDryRun) {
        const result = await runMessengerCampaign(runArgs);
        return res.json({ ok: true, action, dryRun: true, userId: req.user.id, operationId: null, ...result });
      }

      // Real run — PII-free Operation config (counts/lengths only, NFR3).
      const operation = await prisma.operation.create({
        data: {
          userId: req.user.id,
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
      emit({ event: 'start', operationId: operation.id, userId: req.user.id, type: operation.type, status: 'running' });

      try {
        const result = await runMessengerCampaign(runArgs);
        await prisma.operation.update({
          where: { id: operation.id },
          data: { status: 'completed', completedAt: new Date(), result: JSON.stringify(result) },
        });
        emit({ event: 'complete', operationId: operation.id, userId: req.user.id, status: 'completed' });
        return res.json({ ok: true, action, dryRun: false, userId: req.user.id, operationId: operation.id, ...result });
      } catch (runError) {
        await prisma.operation.update({
          where: { id: operation.id },
          data: { status: 'failed', completedAt: new Date(), error: runError.message },
        });
        emit({ event: 'error', operationId: operation.id, userId: req.user.id, status: 'failed', error: runError.message });
        return res.status(500).json({ ok: false, error: 'Messenger campaign failed. See server logs.' });
      }
    }

    // ========================================================================
    // share-link-uid — share post via direct Messenger URL (UID-based)
    // ========================================================================
    if (action === 'share-link-uid') {
      const { postUrl = '', postUrls = [], content = '', message = '', recipientUid = '', recipientUids = [], headless: headlessParam } = req.body ?? {};
      const url = postUrl || postUrls[0] || '';
      if (!url.trim()) {
        return res.status(400).json({ ok: false, error: 'action "share-link-uid" requires postUrl or postUrls[]' });
      }

      // Normalize recipients: single uid or array
      const allRecipients = [
        ...(recipientUid ? [recipientUid] : []),
        ...(Array.isArray(recipientUids) ? recipientUids : []),
      ];
      if (allRecipients.length === 0) {
        return res.status(400).json({ ok: false, error: 'action "share-link-uid" requires recipientUid or recipientUids[]' });
      }

      // headless mode: default true (invisible browser). Set false to show browser window.
      const isHeadless = headlessParam !== false;

      // Dry-run: validate inputs, return preview without launching browser
      if (resolvedDryRun) {
        return res.json({
          ok: true,
          action,
          dryRun: true,
          userId: req.user.id,
          operationId: null,
          postUrl: url,
          recipients: allRecipients,
          recipientsCount: allRecipients.length,
          content: content || message || '',
          headless: isHeadless,
          method: 'direct-messenger-url',
        });
      }

      const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
      const { shareLinkByUid } = await import('../../src/scrapers/facebook/shareLinkByUid.js');

      const browser = await createBrowser({ headless: isHeadless, userDataDir: buildUserDataDir(authCookie.c_user) });
      const page = await createPage(browser);
      await loginWithCookie(page, {
        c_user: authCookie.c_user,
        xs: authCookie.xs,
        sb: authCookie.sb,
        datar: authCookie.datatar || authCookie.datar,
        fr: authCookie.fr,
        fbl_st: authCookie.fbl_st,
        locale: authCookie.locale,
        headless: isHeadless,
      });

      const results = [];
      try {
        for (const uid of allRecipients) {
          const result = await shareLinkByUid(page, {
            postUrl: url,
            recipientUid: uid,
            message: content || message,
          }, {
            dryRun: false,
            headless: isHeadless,
          });
          results.push({ uid, ...result });
        }
        await browser.close().catch(() => {});
        const successCount = results.filter((r) => r.ok).length;
        return res.json({
          ok: true,
          action,
          dryRun: false,
          userId: req.user.id,
          postUrl: url,
          results,
          successCount,
          totalCount: allRecipients.length,
          headless: isHeadless,
          method: 'direct-messenger-url',
        });
      } catch (runError) {
        await browser.close().catch(() => {});
        return res.status(500).json({ ok: false, error: 'Share link by UID failed. See server logs.' });
      }
    }

    const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
    const {
      likeFacebookPosts,
      commentOnFacebookPosts,
      createFacebookPost,
      shareFacebookPosts,
      scheduleFacebookPost,
      joinFacebookGroups,
      postToFacebookGroups,
      sendFriendRequests,
      cancelPendingFriendRequests,
      warmupAccount,
      warmupScrollFeed,
    } = await import('../services/facebookAutomation.js');

    const options = {
      dryRun: resolvedDryRun,
      ...(maxBatch != null && { maxBatch: Number(maxBatch) }),
    };

    const dispatch = async (page) => {
      if (action === 'like') return await likeFacebookPosts(page, urls, options);
      if (action === 'comment') return await commentOnFacebookPosts(page, urls, text, options);
      if (action === 'post') return await createFacebookPost(page, text, options);
      if (action === 'share') return await shareFacebookPosts(page, urls, options);
      if (action === 'schedule') {
        const { scheduledAt, facebookAccountId } = req.body ?? {};
        return await scheduleFacebookPost(page, { content: text, scheduledAt, facebookAccountId }, { ...options, userId: req.user.id });
      }
      if (action === 'join-groups') {
        const { groupUrls = [], keyword, limit } = req.body ?? {};
        return await joinFacebookGroups(page, { groupUrls, keyword, limit }, options);
      }
      if (action === 'batch-post-groups') {
        const { groupUrls = [] } = req.body ?? {};
        return await postToFacebookGroups(page, { groupUrls, content: text }, options);
      }
      if (action === 'send-friend-requests') {
        const { targets = [] } = req.body ?? {};
        return await sendFriendRequests(page, { mode: 'uid_list', targets }, options);
      }
      if (action === 'cancel-friend-requests') {
        const { olderThanDays, limit = 10 } = req.body ?? {};
        return await cancelPendingFriendRequests(page, {
          ...options,
          ...(olderThanDays != null && { olderThanDays: Number(olderThanDays) }),
          limit: Number(limit),
        });
      }
      if (action === 'warmup-account') {
        const { durationSeconds, allowReactions, reactProbability } = req.body ?? {};
        return await warmupAccount(page, {
          ...options,
          ...(durationSeconds != null && { durationSeconds: Number(durationSeconds) }),
          ...(allowReactions != null && { allowReactions }),
          ...(reactProbability != null && { reactProbability: Number(reactProbability) }),
        });
      }
      if (action === 'warmup-scroll-feed') {
        const { targetUrl, durationSeconds } = req.body ?? {};
        return await warmupScrollFeed(page, targetUrl, {
          ...options,
          ...(durationSeconds != null && { durationSeconds: Number(durationSeconds) }),
        });
      }
      return await createFacebookPost(page, text, options);
    };

    // Dry-run never touches the DOM (runGuardedBatch skips actionFn) — no browser,
    // no real Facebook login, no Operation record. Avoids account risk for a preview.
    // Exception: cancel-friend-requests needs page access even in dryRun to collect pending requests.
    if (resolvedDryRun && action !== 'cancel-friend-requests') {
      const result = await dispatch(null);
      return res.json({ ok: true, action, dryRun: true, userId: req.user.id, operationId: null, ...result });
    }

    // Real run — create Operation record (config excludes authCookie; never persist cookie values, NFR3)
    // Bound persisted sizes so a huge urls[]/text can't bloat the Operation row.
    const MAX_URLS = 100;
    const MAX_TEXT = 5000;
    const configUrls = Array.isArray(urls) ? urls.slice(0, MAX_URLS) : [];
    const configText = String(text ?? '').slice(0, MAX_TEXT);
    // messenger-share is handled in its own path above; only like/comment/post reach here.
    const operationConfig = { action, urls: configUrls, text: configText, maxBatch: maxBatch ?? null };
    const operation = await prisma.operation.create({
      data: {
        userId: req.user.id,
        type: `facebook_${action}`,
        status: 'running',
        startedAt: new Date(),
        config: JSON.stringify(operationConfig),
      },
    });
    emit({ event: 'start', operationId: operation.id, userId: req.user.id, type: operation.type, status: 'running' });

    const envBrowserOptions = defaultBrowserOptionsFromEnv() || {};
    const requestBrowserOptions = req.body?.browserOptions || {};
    const runBrowserOptions = {
      ...envBrowserOptions,
      ...requestBrowserOptions,
      proxyAuth: { ...(envBrowserOptions.proxyAuth || {}), ...(requestBrowserOptions.proxyAuth || {}) },
      proxyLocation: { ...(envBrowserOptions.proxyLocation || {}), ...(requestBrowserOptions.proxyLocation || {}) },
      headless: isHeadless,
      userDataDir: buildUserDataDir(authCookie.c_user),
    };
    if (!Object.keys(runBrowserOptions.proxyAuth).length) delete runBrowserOptions.proxyAuth;
    if (!Object.keys(runBrowserOptions.proxyLocation).length) delete runBrowserOptions.proxyLocation;

    let result;
    let browser;
    try {
      // createBrowser INSIDE try — else a launch failure orphans the Operation as 'running' forever
      browser = await createBrowser(runBrowserOptions);
      const page = await createPage(browser);
      // Cookie values are never logged (NFR3)
      await loginWithCookie(page, {
        c_user: authCookie.c_user,
        xs: authCookie.xs,
        sb: authCookie.sb,
        datar: authCookie.datatar || authCookie.datar,
        fr: authCookie.fr,
        fbl_st: authCookie.fbl_st,
        locale: authCookie.locale,
      });

      result = await dispatch(page);

      await prisma.operation.update({
        where: { id: operation.id },
        data: { status: 'completed', completedAt: new Date(), result: JSON.stringify(result) },
      });
      emit({ event: 'complete', operationId: operation.id, userId: req.user.id, status: 'completed' });
    } catch (browserError) {
      await prisma.operation.update({
        where: { id: operation.id },
        data: { status: 'failed', completedAt: new Date(), error: browserError.message },
      });
      emit({ event: 'error', operationId: operation.id, userId: req.user.id, status: 'failed', error: browserError.message });
      throw browserError;
    } finally {
      // Swallow close errors so they never mask the original failure
      if (browser) await browser.close().catch(() => {});
    }

    res.json({
      ok: true,
      action,
      dryRun: resolvedDryRun,
      userId: req.user.id,
      operationId: operation.id,
      ...result,
    });
  } catch (error) {
    // Log full detail server-side; return a generic message (no internal leak).
    console.error('❌ Facebook automate error:', error);
    res.status(500).json({ ok: false, error: 'Facebook automate failed. See server logs.' });
  }
});

export default router;
