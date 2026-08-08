// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import { resolveAccountCookie } from './facebookAccounts.js';

const prisma = new PrismaClient();

const router = express.Router();
router.use(authMiddleware);

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
      browser = await createBrowser({ headless: true });
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
 * Scrape Facebook data: profile, posts, followers, or search.
 *
 * Body: {
 *   action: 'profile' | 'posts' | 'followers' | 'search',
 *   url?: string,       // required for profile/posts/followers
 *   query?: string,     // required for search
 *   authCookie?: { c_user, xs }  // optional; enables authenticated scrape
 * }
 */
router.post('/scrape', async (req, res) => {
  try {
    const { action, url, query, authCookie } = req.body ?? {};

    const VALID_ACTIONS = ['profile', 'posts', 'followers', 'search', 'group-members'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
      });
    }

    if (['profile', 'posts', 'followers', 'group-members'].includes(action) && !url?.trim()) {
      return res.status(400).json({ ok: false, error: `action "${action}" requires url` });
    }
    if (action === 'search' && !query?.trim()) {
      return res.status(400).json({ ok: false, error: 'action "search" requires query' });
    }

    // Dynamic import — avoids loading Puppeteer until needed
    const { scrape } = await import('../../src/scrapers/index.js');

    const options = {
      userId: req.user.id,
      // Pass all cookie fields for full session auth (never log values)
      ...(authCookie?.c_user?.trim() && authCookie?.xs?.trim()
        ? { authCookie: {
            c_user: authCookie.c_user,
            xs: authCookie.xs,
            sb: authCookie.sb,
            datar: authCookie.datatar || authCookie.datar,
            fr: authCookie.fr,
            fbl_st: authCookie.fbl_st,
            locale: authCookie.locale,
          } }
        : {}),
    };

    // Dispatcher resolves target from options.url / options.query (NOT options.target).
    // Pass the keys it actually reads, else the target is silently dropped → scrape fails.
    const scrapeArgs = {
      ...options,
      ...(action === 'search' ? { query: query.trim() } : { url: url.trim() }),
    };
    const result = await scrape('facebook', action, scrapeArgs);

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
      'like', 'comment', 'post', 'messenger-share',
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
      const runArgs = {
        accounts, links: allLinks, recipients, content,
        dryRun: resolvedDryRun, maxBatch, delay: messengerDelay,
        deps: { createBrowser, createPage, loginWithCookie, messengerShareCampaign },
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
        const { groupUrls = [] } = req.body ?? {};
        return await joinFacebookGroups(page, groupUrls, options);
      }
      if (action === 'batch-post-groups') {
        const { groupUrls = [] } = req.body ?? {};
        return await postToFacebookGroups(page, groupUrls, text, options);
      }
      if (action === 'send-friend-requests') {
        const { targets = [] } = req.body ?? {};
        return await sendFriendRequests(page, targets, options);
      }
      if (action === 'cancel-friend-requests') {
        const { olderThanDays, limit } = req.body ?? {};
        return await cancelPendingFriendRequests(page, {
          ...options,
          ...(olderThanDays != null && { olderThanDays: Number(olderThanDays) }),
          ...(limit != null && { limit: Number(limit) }),
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
    if (resolvedDryRun) {
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

    let result;
    let browser;
    try {
      // createBrowser INSIDE try — else a launch failure orphans the Operation as 'running' forever
      browser = await createBrowser({ headless: true });
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
