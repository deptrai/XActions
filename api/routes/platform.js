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

const router = express.Router();

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
  }

  return null;
}

/**
 * @param {string} platform
 * @param {Record<string, unknown>} body
 * @returns {Record<string, string>}
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
function buildAuthCookie(platform, cookie) {
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
  return cookie;
}

router.use(authenticate);

/**
 * GET /api/platform/:platform/accounts
 */
router.get('/:platform/accounts', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const { platform } = req.params;

  try {
    const prefix = `${platform}:`;
    const accounts = await prisma.facebookAccount.findMany({
      where: {
        userId: reqUser.id,
        label: { startsWith: prefix },
      },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });

    // Strip the platform prefix for display
    const stripped = accounts.map(a => ({
      id: a.id,
      label: a.label.slice(prefix.length),
    }));

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
  const { platform } = req.params;
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
  const { platform, id } = req.params;

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
 * @param {string} userId
 * @param {string} accountId
 * @param {string} platform
 */
async function resolveAccountCookie(userId, accountId, platform) {
  const prefix = `${platform}:`;
  const account = await prisma.facebookAccount.findFirst({
    where: { id: accountId, userId, label: { startsWith: prefix } },
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
 */
router.post('/:platform/scrape', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const { platform } = req.params;
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

    // Resolve account if provided
    const accountIds = /** @type {string[] | undefined} */ (body.accountIds);
    if (Array.isArray(accountIds) && accountIds.length > 0) {
      const cookie = await resolveAccountCookie(reqUser.id, accountIds[0], platform);
      options.authCookie = buildAuthCookie(platform, cookie);
      options.accountId = accountIds[0];
    }

    const result = await scrape(platform, action, options);
    res.json({ ok: true, platform, action, dryRun: false, result });
  } catch (err) {
    console.error(`❌ POST /platform/${platform}/scrape error:`, err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Scrape failed',
    });
  }
});

/**
 * POST /api/platform/:platform/automate
 */
router.post('/:platform/automate', async (req, res) => {
  const reqUser = /** @type {import('@prisma/client').User} */ (req.user);
  const { platform } = req.params;
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
    }

    // For platforms without a dedicated automation service, the unified
    // scraper dispatcher handles state-changing actions too.
    const result = await scrape(platform, action, options);
    res.json({ ok: true, platform, action, dryRun: Boolean(body.dryRun), result });
  } catch (err) {
    console.error(`❌ POST /platform/${platform}/automate error:`, err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Automation failed',
    });
  }
});

export default router;
