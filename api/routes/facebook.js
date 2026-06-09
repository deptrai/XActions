// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const router = express.Router();
router.use(authMiddleware);

/**
 * Validate Facebook session cookie presence.
 * Returns an error string if invalid, null if OK.
 * Cookie values are never logged (NFR3).
 */
function requireFacebookCookie(body) {
  const { authCookie } = body ?? {};
  // Coerce to string first — c_user is a numeric Facebook UID and may arrive as a
  // JSON number, which would crash on .trim() instead of giving a clean 400.
  const cUser = String(authCookie?.c_user ?? '').trim();
  const xs = String(authCookie?.xs ?? '').trim();
  if (!cUser || !xs) {
    return '❌ authCookie { c_user, xs } is required for this operation. Provide a valid Facebook session cookie.';
  }
  return null;
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

    const VALID_ACTIONS = ['profile', 'posts', 'followers', 'search'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
      });
    }

    if (['profile', 'posts', 'followers'].includes(action) && !url?.trim()) {
      return res.status(400).json({ ok: false, error: `action "${action}" requires url` });
    }
    if (action === 'search' && !query?.trim()) {
      return res.status(400).json({ ok: false, error: 'action "search" requires query' });
    }

    // Dynamic import — avoids loading Puppeteer until needed
    const { scrape } = await import('../../src/scrapers/index.js');

    const options = {
      userId: req.user.id,
      // Only pass authCookie when both fields are present (never log values)
      ...(authCookie?.c_user?.trim() && authCookie?.xs?.trim()
        ? { authCookie: { c_user: authCookie.c_user, xs: authCookie.xs } }
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
    console.error('❌ Facebook scrape error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
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
    const { action, urls = [], text = '', dryRun, authCookie, maxBatch } = req.body ?? {};

    // Hard auth guard — must come before any browser launch
    const cookieError = requireFacebookCookie(req.body);
    if (cookieError) return res.status(400).json({ ok: false, error: cookieError });

    const VALID_ACTIONS = ['like', 'comment', 'post'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
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

    // Strict dryRun gate — only explicit false enables real writes
    const resolvedDryRun = dryRun === false ? false : true;

    const { createBrowser, createPage, loginWithCookie } = await import('../../src/scrapers/facebook/index.js');
    const {
      likeFacebookPosts,
      commentOnFacebookPosts,
      createFacebookPost,
    } = await import('../services/facebookAutomation.js');

    const options = {
      dryRun: resolvedDryRun,
      ...(maxBatch != null && { maxBatch: Number(maxBatch) }),
    };

    const dispatch = async (page) => {
      if (action === 'like') return await likeFacebookPosts(page, urls, options);
      if (action === 'comment') return await commentOnFacebookPosts(page, urls, text, options);
      return await createFacebookPost(page, text, options);
    };

    // Per-user Socket.IO room — never broadcast operation events to all clients (NFR3 / privacy)
    const emit = (payload) => global.io?.to(`user:${req.user.id}`).emit('facebook:operation', payload);

    // Dry-run never touches the DOM (runGuardedBatch skips actionFn) — no browser,
    // no real Facebook login, no Operation record. Avoids account risk for a preview.
    if (resolvedDryRun) {
      const result = await dispatch(null);
      return res.json({ ok: true, action, dryRun: true, userId: req.user.id, operationId: null, ...result });
    }

    // Real run — create Operation record (config excludes authCookie; never persist cookie values, NFR3)
    const operation = await prisma.operation.create({
      data: {
        userId: req.user.id,
        type: `facebook_${action}`,
        status: 'running',
        startedAt: new Date(),
        config: JSON.stringify({ action, urls, text, maxBatch: maxBatch ?? null }),
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
      await loginWithCookie(page, { c_user: authCookie.c_user, xs: authCookie.xs });

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
    console.error('❌ Facebook automate error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
