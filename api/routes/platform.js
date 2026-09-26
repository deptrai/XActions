// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Universal Platform Dispatcher
 *
 * One route file serves all platform automation/scraping for the dashboard.
 * Endpoints:
 *   GET    /api/platform/:platform/accounts
 *   POST   /api/platform/:platform/accounts
 *   DELETE /api/platform/:platform/accounts/:id
 *   POST   /api/platform/:platform/automate
 *   POST   /api/platform/:platform/scrape
 *
 * NOTE: Account storage currently reuses the FacebookAccount table as a
 * generic encrypted session store. A future migration should introduce a
 * PlatformAccount table with a platform discriminator.
 */

import express from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { eitherAuth } from '../middleware/serviceAuth.js';
import { requestId } from '../middleware/requestId.js';
import { errorBody, scrapeErrorKind, isRetryableError } from '../services/gatewayEnvelope.js';

const router = express.Router();

/** @type {string[]} */
const VALID_PLATFORMS = [
  'facebook', 'x', 'twitter', 'threads', 'bluesky', 'mastodon', 'tiktok',
  'reddit', 'rdt', 'shopee', 'tiktokshop', 'tiktok-shop', 'topcv',
  'vietnamworks', 'linkedin', 'batdongsan', 'chotot', 'youtube', 'zalo',
  'instagram', 'ig', 'insta', 'pumpfun', 'pump', 'pump.fun',
];

/** @type {Record<string, string>} */
export const PLATFORM_ALIASES = { 'tiktok-shop': 'tiktokshop', 'pump': 'pumpfun', 'pump.fun': 'pumpfun' };

/**
 * @param {string} platform
 * @returns {string | null}
 */
function normalizePlatform(platform) {
  const raw = String(platform || '').toLowerCase().trim();
  const alias = /** @type {string | undefined} */ (PLATFORM_ALIASES[raw]);
  const candidate = alias || raw;
  return VALID_PLATFORMS.includes(candidate) ? candidate : null;
}

// Reuse the same AES-256-GCM pattern as facebookAccounts.js
const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.JWT_SECRET;
const ALGORITHM = 'aes-256-gcm';
const KEY_MATERIAL = ENCRYPTION_KEY || 'dev-only-key';

/** @param {string} text */
function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(KEY_MATERIAL, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/** @param {string} encryptedData */
function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) return null;
    const salt = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(KEY_MATERIAL, salt, 32);
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[3], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * @param {string} platform
 * @param {Record<string, unknown>} body
 * @returns {string | null}
 */
function validatePlatformAccount(platform, body) {
  const { label } = body ?? {};
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return 'label is required';
  }
  if (label.trim().length > 50) {
    return 'label must be 50 characters or fewer';
  }

  // Per-platform cookie validation
  if (platform === 'facebook') {
    const { c_user, xs } = body;
    if (!c_user || !/^\d{10,20}$/.test(String(c_user).trim())) {
      return 'c_user must be 10-20 digits';
    }
    if (!xs || typeof xs !== 'string' || xs.trim().length === 0) {
      return 'xs is required';
    }
    if (xs.trim().length > 4096) {
      return 'xs too long';
    }
  } else if (platform === 'x' || platform === 'twitter') {
    const { auth_token, ct0 } = body;
    if (!auth_token || typeof auth_token !== 'string' || auth_token.trim().length === 0) {
      return 'auth_token is required';
    }
    if (!ct0 || typeof ct0 !== 'string' || ct0.trim().length === 0) {
      return 'ct0 is required';
    }
  } else if (platform === 'bluesky') {
    const { identifier, password } = body;
    if (!identifier || typeof identifier !== 'string' || identifier.trim().length === 0) {
      return 'identifier is required';
    }
    if (!password || typeof password !== 'string' || password.trim().length === 0) {
      return 'password is required';
    }
  } else if (platform === 'mastodon') {
    const { instance, accessToken } = body;
    if (!instance || typeof instance !== 'string' || instance.trim().length === 0) {
      return 'instance is required';
    }
  } else if (platform === 'threads') {
    const { auth_token, userId } = body;
    if (!auth_token || typeof auth_token !== 'string' || auth_token.trim().length === 0) {
      return 'auth_token is required';
    }
  } else if (platform === 'tiktok') {
    const { sessionid } = body;
    if (!sessionid || typeof sessionid !== 'string' || sessionid.trim().length === 0) {
      return 'sessionid is required';
    }
  } else if (platform === 'reddit' || platform === 'rdt') {
    const { clientId, clientSecret } = body;
    if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
      return 'clientId is required';
    }
    if (!clientSecret || typeof clientSecret !== 'string' || clientSecret.trim().length === 0) {
      return 'clientSecret is required';
    }
  } else if (platform === 'instagram' || platform === 'ig' || platform === 'insta') {
    const { sessionid, username, password } = body;
    const hasCookie = sessionid && typeof sessionid === 'string' && sessionid.trim().length > 0;
    const hasCreds = username && typeof username === 'string' && username.trim().length > 0
      && password && typeof password === 'string' && password.trim().length > 0;
    if (!hasCookie && !hasCreds) {
      return 'sessionid cookie or username+password is required';
    }
    if (hasCookie && String(sessionid).trim().length > 4096) {
      return 'sessionid too long';
    }
  }

  return null;
}

/**
 * @param {string} platform
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function buildCookie(platform, body) {
  const { label, ...rest } = body;
  // Strip proxy if present; store it separately if needed
  const cookie = { ...rest };
  return cookie;
}

/**
 * @param {string} platform
 * @param {Record<string, string>} cookie
 * @returns {Record<string, unknown>}
 */
export function buildAuthCookie(platform, cookie) {
  if (platform === 'facebook') {
    return { c_user: cookie.c_user, xs: cookie.xs };
  }
  if (platform === 'x' || platform === 'twitter') {
    return { auth_token: cookie.auth_token, ct0: cookie.ct0 };
  }
  if (platform === 'bluesky') {
    return { identifier: cookie.identifier, password: cookie.password };
  }
  if (platform === 'mastodon') {
    return { instance: cookie.instance, accessToken: cookie.accessToken };
  }
  if (platform === 'threads') {
    return { auth_token: cookie.auth_token, userId: cookie.userId };
  }
  if (platform === 'tiktok') {
    return { sessionid: cookie.sessionid };
  }
  if (platform === 'reddit' || platform === 'rdt') {
    return {
      clientId: cookie.clientId,
      clientSecret: cookie.clientSecret,
      username: cookie.username || cookie.redditUsername,
    };
  }
  if (platform === 'instagram' || platform === 'ig' || platform === 'insta') {
    return {
      sessionid: cookie.sessionid,
      ds_user_id: cookie.ds_user_id,
      csrftoken: cookie.csrftoken,
      username: cookie.username,
      password: cookie.password,
    };
  }
  return cookie;
}

// Story 50.1 — Scope user-JWT to accounts/automate only. `/:platform/scrape`
// mounts `eitherAuth` at the route level so machine consumers can hit it with a
// Bearer service key instead of a user session.
router.use('/:platform/accounts', authenticate);
router.use('/:platform/accounts/:id', authenticate);
router.use('/:platform/automate', authenticate);

/**
 * Validate :platform on all /api/platform/:platform/* routes.
 * @type {import('express-serve-static-core').RequestParamHandler}
 */
const platformParamHandler = (req, res, next, value) => {
  // Story 50.2 (D-3): 'all' batch fan-out is admitted ONLY on the /scrape
  // route — whitelisting it router-wide would open POST /all/automate write
  // fan-out via UniversalActionDispatcher and literal `all:` account labels.
  if (String(value).toLowerCase().trim() === 'all') {
    // Normalize before the scrape check — '/all/scrape/' and '/all/SCRAPE'
    // (case-insensitive router match) must admit like '/all/scrape'.
    const reqPath = String(req.path || '').toLowerCase().replace(/\/+$/, '');
    if (reqPath.endsWith('/scrape')) {
      /** @type {any} */ (req).platform = 'all';
      return next();
    }
    return res.status(400).json({ ok: false, error: `Unknown platform: ${value}` });
  }
  const normalized = normalizePlatform(value);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: `Unknown platform: ${value}` });
  }
  /** @type {any} */ (req).platform = normalized;
  next();
};

(/** @type {any} */ (router)).param('platform', platformParamHandler);

/**
 * GET /api/platform/:platform/accounts
 */
router.get('/:platform/accounts', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const platform = /** @type {string} */ (req.platform || req.params.platform);

  try {
    const isTwitter = platform === 'x' || platform === 'twitter';
    const where = isTwitter
      ? {
          userId: reqUser.id,
          OR: [{ label: { startsWith: 'x:' } }, { label: { startsWith: 'twitter:' } }],
        }
      : {
          userId: reqUser.id,
          label: { startsWith: `${platform}:` },
        };

    const accounts = await prisma.facebookAccount.findMany({
      where,
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });

    // Strip the platform prefix for display
    const stripped = accounts.map(a => {
      const p = a.label.startsWith('x:') ? 'x:' : (a.label.startsWith('twitter:') ? 'twitter:' : `${platform}:`);
      return {
        id: a.id,
        label: a.label.slice(p.length),
      };
    });

    res.json({ ok: true, accounts: stripped });
  } catch (err) {
    console.error(`❌ GET /platform/${platform}/accounts error:`, err);
    res.status(500).json({ ok: false, error: 'Failed to list accounts' });
  }
});

/**
 * POST /api/platform/:platform/accounts
 */
router.post('/:platform/accounts', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const platform = /** @type {string} */ (req.platform || req.params.platform);
  const body = /** @type {Record<string, unknown>} */ (req.body ?? {});

  const error = validatePlatformAccount(platform, body);
  if (error) {
    return res.status(400).json({ ok: false, error });
  }

  const label = `${platform}:${String(body.label).trim()}`;
  const cookie = buildCookie(platform, body);

  try {
    await prisma.facebookAccount.create({
      data: {
        userId: reqUser.id,
        label,
        encryptedCookie: encrypt(JSON.stringify(cookie)),
      },
    });
    res.json({ ok: true, message: 'Account saved' });
  } catch (err) {
    console.error(`❌ POST /platform/${platform}/accounts error:`, err);
    res.status(500).json({ ok: false, error: 'Failed to save account' });
  }
});

/**
 * DELETE /api/platform/:platform/accounts/:id
 */
router.delete('/:platform/accounts/:id', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const platform = /** @type {string} */ (req.platform || req.params.platform);
  const { id } = req.params;

  try {
    const prefix = `${platform}:`;
    const account = await prisma.facebookAccount.findFirst({
      where: { id, userId: reqUser.id, label: { startsWith: prefix } },
    });
    if (!account) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    await prisma.facebookAccount.delete({ where: { id } });
    res.json({ ok: true, message: 'Account deleted' });
  } catch (err) {
    console.error(`❌ DELETE /platform/${platform}/accounts/:id error:`, err);
    res.status(500).json({ ok: false, error: 'Failed to delete account' });
  }
});

/**
 * Resolve decrypted account cookie for a run.
 * Exported for the scrape worker processor (Story 50.2 — re-resolves
 * server-side so credential plaintext never enters the Bull payload).
 * @param {string} userId
 * @param {string} accountId
 * @param {string} platform
 */
export async function resolveAccountCookie(userId, accountId, platform) {
  const isTwitter = platform === 'x' || platform === 'twitter';
  const isReddit = platform === 'reddit' || platform === 'rdt';
  const labelPrefix = isReddit ? 'reddit:' : `${platform}:`;
  const where = isTwitter
    ? {
        id: accountId,
        userId,
        OR: [{ label: { startsWith: 'x:' } }, { label: { startsWith: 'twitter:' } }],
      }
    : isReddit
      ? {
          id: accountId,
          userId,
          OR: [{ label: { startsWith: 'reddit:' } }, { label: { startsWith: 'rdt:' } }],
        }
      : {
          id: accountId,
          userId,
          label: { startsWith: labelPrefix },
        };

  const account = await prisma.facebookAccount.findFirst({
    where,
  });
  if (!account) {
    const err = /** @type {Error & { code?: string }} */ (new Error('Selected account not found'));
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  const decrypted = decrypt(account.encryptedCookie);
  if (!decrypted) {
    const err = /** @type {Error & { code?: string }} */ (new Error('Failed to decrypt account session'));
    err.code = 'ACCOUNT_DECRYPT_FAILED';
    throw err;
  }

  try {
    return JSON.parse(decrypted);
  } catch {
    const err = /** @type {Error & { code?: string }} */ (new Error('Invalid account session'));
    err.code = 'ACCOUNT_DECRYPT_FAILED';
    throw err;
  }
}

/**
 * POST /api/platform/:platform/scrape
 *
 * Story 50.1 — `eitherAuth` accepts user-JWT (dashboard) OR Bearer service key
 * (machine consumer). `req.user` is only populated for the JWT lane;
 * `req.consumer` is populated by either lane.
 *
 * Story 50.2 — mode dispatch. `mode` (body) selects the lane:
 *   'sync'  → in-process scrape() under a hard 1.5s ceiling; breach or typed
 *             upstream failure degrades to `202 + operationId + Retry-After`
 *             (poll /api/ai/action/status/:id).
 *   'async' → Bull job + `202 {operationId, statusUrl}` immediately.
 *   absent  → per-action `syncCapableActions` manifest decides.
 * `platform` in the body overrides the path (string | 'all' | string[]≤25);
 * batch fans out via Promise.allSettled with the ceiling per-platform.
 *
 * Story 50.3 — unified envelope + request-id. `requestId` middleware mounts
 * BEFORE `eitherAuth` so even a 401 auth failure carries `request_id`
 * end-to-end (echoed via the `X-Request-Id` response header). Every response
 * — sync 200, async/degraded 202, batch, guards, catch — emits the unified
 * envelope shape owned by `api/services/gatewayEnvelope.js`.
 *
 * The route owns every `res` write: scrapeDispatch returns outcome
 * descriptors `{kind:'json', status, body, headers?}` — it never touches
 * `res` and never throws contract errors. The catch below only handles
 * non-contract infra throws, flattened to the unified ErrorEnvelope.
 */
router.post('/:platform/scrape', requestId, eitherAuth, async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User | undefined} */ (req.user);
  const platform = /** @type {string} */ (req.platform || req.params.platform);
  const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
  const action = /** @type {string | undefined} */ (body.action);
  const reqId = /** @type {string | undefined} */ (req.requestId);

  if (!action || typeof action !== 'string') {
    return res.status(400).json(errorBody({
      code: 'XACT_4001',
      type: 'validation',
      kind: 'validation',
      message: 'action is required',
      status: 400,
      requestId: reqId,
      retryable: false,
    }));
  }

  // Stored-account resolution requires a user session — this guard runs
  // BEFORE mode dispatch (covers single and batch alike; EDGE_ACCOUNTIDS_SERVICE).
  const accountIds = body.accountIds;
  // A truthy non-array accountIds is a caller bug — 400, not silent drop.
  if (accountIds !== undefined && accountIds !== null && !Array.isArray(accountIds)) {
    return res.status(400).json(errorBody({
      code: 'VALIDATION_FAILED',
      type: 'validation',
      kind: 'validation',
      message: 'accountIds must be an array of account ids',
      status: 400,
      requestId: reqId,
      retryable: false,
    }));
  }
  if (Array.isArray(accountIds) && accountIds.length > 0 && (!reqUser || typeof reqUser.id !== 'string')) {
    return res.status(400).json(errorBody({
      code: 'VALIDATION_FAILED',
      type: 'validation',
      kind: 'validation',
      message: 'Stored account resolution requires user session authentication',
      status: 400,
      requestId: reqId,
      retryable: false,
    }));
  }

  try {
    const { dispatch } = await import('../services/scrapeDispatch.js');
    const outcome = await dispatch({
      pathPlatform: platform,
      body,
      action,
      userId: reqUser && typeof reqUser.id === 'string' ? reqUser.id : null,
      accountIds: Array.isArray(accountIds) ? accountIds : undefined,
      consumer: /** @type {Record<string, unknown> | null} */ (req.consumer ?? null),
      requestId: reqId,
      traceparent: /** @type {string | undefined} */ (req.traceparent),
    });
    if (outcome.headers) {
      for (const [name, value] of Object.entries(outcome.headers)) {
        res.setHeader(name, value);
      }
    }
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error(`❌ POST /platform/${platform}/scrape error:`, err);
    const status = typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    const retryable = isRetryableError(err) || status === 503 || status === 429;
    const retryAfterMs = typeof /** @type {any} */ (err)?.retryAfterMs === 'number' ? /** @type {any} */ (err).retryAfterMs : undefined;
    const errBody = errorBody({
      code: typeof /** @type {any} */ (err)?.code === 'string' ? /** @type {any} */ (err).code : 'XACT_5000',
      type: typeof /** @type {any} */ (err)?.type === 'string' ? /** @type {any} */ (err).type : undefined,
      kind: scrapeErrorKind(err),
      message: err instanceof Error ? err.message : 'Scrape failed',
      status,
      requestId: reqId,
      retryable,
      retryAfterMs,
    });
    if (retryable) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((errBody.error.retry_after_ms ?? 2000) / 1000))));
    }
    return res.status(status).json(errBody);
  }
});

/**
 * POST /api/platform/:platform/automate
 */
router.post('/:platform/automate', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const platform = /** @type {string} */ (req.platform || req.params.platform);
  const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
  const action = /** @type {string | undefined} */ (body.action);

  if (!action) {
    return res.status(400).json({ ok: false, error: 'action is required' });
  }

  try {
    const { scrape } = await import('../../src/scrapers/index.js');

    /** @type {Record<string, unknown>} */
    const options = { ...body };
    delete options.action;

    const accountIds = /** @type {string[] | undefined} */ (body.accountIds);
    if (Array.isArray(accountIds) && accountIds.length > 0) {
      const cookie = await resolveAccountCookie(reqUser.id, accountIds[0], platform);
      options.authCookie = buildAuthCookie(platform, cookie);
      options.accountId = accountIds[0];
      if (cookie && typeof cookie === 'object') {
        if (cookie.clientId && !options.clientId) options.clientId = cookie.clientId;
        if (cookie.clientSecret && !options.clientSecret) options.clientSecret = cookie.clientSecret;
        if (cookie.username && !options.redditUsername) options.redditUsername = cookie.username;
      }
    }

    // For platforms without a dedicated automation service, the unified
    // scraper dispatcher handles state-changing actions too.
    const result = await scrape(platform, action, options);
    res.json({ ok: true, platform, action, dryRun: Boolean(body.dryRun), result });
  } catch (err) {
    console.error(`❌ POST /platform/${platform}/automate error:`, err);
    const status = typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Automation failed',
    });
  }
});

export default router;
