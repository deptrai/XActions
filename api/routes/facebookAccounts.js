// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.

import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
/**
 * Facebook Account Storage API (Story 5.5 — AC2, AC9)
 *
 * Server-side encrypted Facebook session storage. Cookie values are AES-256-GCM
 * encrypted at rest and NEVER returned to the client after initial import (NFR3).
 *
 * Routes:
 *   POST   /api/facebook/accounts        — import & encrypt account
 *   GET    /api/facebook/accounts        — list (label + opaque id only)
 *   DELETE /api/facebook/accounts/:id    — remove account
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { parseFlatProxy } from '../../src/scrapers/facebook/proxy.js';

const router = express.Router();
// ============================================================================
// Encryption helpers — same AES-256-GCM pattern as session-auth.js
// ============================================================================

const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.JWT_SECRET;
const ALGORITHM = 'aes-256-gcm';

// Fail-fast in production: refuse to silently encrypt with the public 'dev-only-key'.
// Dev/test may run without a secret (uses the dev fallback below) so unit tests of
// encrypt/decrypt still work without env setup.
if (process.env.NODE_ENV === 'production' && !ENCRYPTION_KEY) {
  throw new Error(
    '❌ SESSION_SECRET or JWT_SECRET is required in production to encrypt Facebook session cookies. Refusing to start with an insecure default key.',
  );
}

// Single derivation source — falls back to a clearly-marked dev key only outside production.
const KEY_MATERIAL = ENCRYPTION_KEY || 'dev-only-key';

/** @param {string} text */
export function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(KEY_MATERIAL, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  // Stryker disable next-line StringLiteral: cipher.final('') returns equivalent hex output
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/** @param {string} encryptedData */
export function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    // Stryker disable next-line EqualityOperator,ConditionalExpression: catch block handles invalid part counts equivalently
    if (parts.length !== 4) return null;
    const salt = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY || 'dev-only-key', salt, 32);
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[3], 'hex', 'utf8');
    // Stryker disable next-line StringLiteral: decipher.final('') returns equivalent utf8 output
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Never log the error detail — may contain key material
    return null;
  }
}

/** @param {string} accountId */
async function invalidateHealthCache(accountId) {
  try {
    await prisma.facebookAccountHealth.deleteMany({ where: { accountId } });
  } catch {
    // Swallow — the health row may not exist yet.
  }
}

// ============================================================================
// Validation helpers
// ============================================================================

const LABEL_MAX = 50;
const XS_MAX = 4096; // upper bound — guards against storage-amplification abuse
const C_USER_RE = /^\d{10,20}$/;

/** @param {Record<string, unknown>} body */
export function validateAccountBody(body) {
  const { label, c_user, xs, proxy } = body ?? {};
  if (!label || typeof label !== 'string' || label.trim().length === 0)
    return 'label is required';
  if (label.trim().length > LABEL_MAX)
    return `label must be ${LABEL_MAX} characters or fewer`;
  if (!c_user || !C_USER_RE.test(String(c_user).trim()))
    return 'c_user must be 10–20 digits';
  if (!xs || typeof xs !== 'string' || xs.trim().length === 0)
    return 'xs is required';
  if (xs.trim().length > XS_MAX)
    return `xs must be ${XS_MAX} characters or fewer`;
  if (proxy !== undefined && proxy !== null) {
    if (typeof proxy !== 'string' || !proxy.trim())
      return 'proxy must be a non-empty string';
    if (!parseFlatProxy(proxy.trim()))
      return 'proxy must be in "host:port" or "host:port:user:pass" format';
  }
  return null;
}

// ============================================================================
// POST /api/facebook/accounts — import & encrypt (AC2 #4)
// ============================================================================

router.post('/', authenticate, async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const validationError = validateAccountBody(req.body);
    if (validationError) return res.status(400).json({ ok: false, error: validationError });

    const body = /** @type {Record<string, unknown>} */ (req.body);
    const label = String(body.label).trim();
    const c_user = String(body.c_user).trim();
    const xs = String(body.xs).trim();

    // Duplicate label check (AC1 #3)
    const existing = await prisma.facebookAccount.findFirst({
      where: { userId: reqUser.id, label },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ ok: false, error: `An account with label "${label}" already exists` });
    }

    // Encrypt cookie pair as JSON — c_user and xs never stored in plaintext
    const cookiePayload = JSON.stringify({ c_user, xs });
    const encryptedCookie = encrypt(cookiePayload);
    const proxy = /** @type {string | undefined} */ (body.proxy);
    const encryptedProxy = proxy ? encrypt(proxy.trim()) : null;

    const account = await prisma.facebookAccount.create({
      data: { userId: reqUser.id, label, encryptedCookie, encryptedProxy },
      select: { id: true, label: true },  // NFR3: never return encrypted blob
    });
    await invalidateHealthCache(account.id);

    return res.status(201).json({ ok: true, id: account.id, label: account.label });
  } catch (err) {
    // Prisma unique-constraint (userId+label) race: two concurrent POSTs both pass
    // the findFirst check, the second create hits @@unique → P2002. Return 409, not 500.
    if ((/** @type {Record<string, unknown>} */ (err))?.code === 'P2002') {
      return res.status(409).json({ ok: false, error: 'An account with that label already exists' });
    }
    // Log a code/type only — Prisma messages can echo field values (NFR3).
    console.error('❌ POST /api/facebook/accounts error:', (/** @type {Record<string, unknown>} */ (err))?.code || (/** @type {Record<string, unknown>} */ (err))?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to save account' });
  }
});

// ============================================================================
// GET /api/facebook/accounts — list (label + opaque id only, AC2 #5, AC9 #26)
// ============================================================================

router.get('/', authenticate, async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const accounts = await prisma.facebookAccount.findMany({
      where: { userId: reqUser.id },
      select: { id: true, label: true },  // AC2 #5 / AC9 #26: label + opaque id only
      orderBy: { createdAt: 'asc' },
    });
    // NFR3: encryptedCookie never selected or returned
    return res.json({ ok: true, accounts });
  } catch (err) {
    console.error('❌ GET /api/facebook/accounts error:', (/** @type {Record<string, unknown>} */ (err))?.code || (/** @type {Record<string, unknown>} */ (err))?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to list accounts' });
  }
});

// ============================================================================
// DELETE /api/facebook/accounts/:id — remove (AC2 #6, AC3 #10)
// ============================================================================

router.delete('/:id', authenticate, async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { id } = req.params;

    // Own-account guard first
    const account = await prisma.facebookAccount.findFirst({
      where: { id, userId: reqUser.id },
      select: { id: true },
    });
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    // Block delete only if a Facebook run referencing THIS account is in progress.
    // Scope by type prefix + accountId so an unrelated op (e.g. Twitter unfollow)
    // never blocks Facebook account removal.
    const activeRun = await prisma.operation.findFirst({
      where: {
        userId: reqUser.id,
        status: 'running',
        type: { startsWith: 'facebook_' },
        config: { contains: id },
      },
      select: { id: true },
    });
    if (activeRun) {
      return res.status(409).json({ ok: false, error: 'Cannot remove account while a run is in progress' });
    }

    // Ownership enforced atomically at the DB layer (userId in the where clause).
    await prisma.facebookAccount.delete({ where: { id, userId: reqUser.id } });
    await invalidateHealthCache(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/facebook/accounts error:', (/** @type {Record<string, unknown>} */ (err))?.code || (/** @type {Record<string, unknown>} */ (err))?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to remove account' });
  }
});

// ============================================================================
// PATCH /api/facebook/accounts/:id — update proxy (Story 7.1 AC4)
// ============================================================================

router.patch('/:id', authenticate, async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { id } = req.params;
    const { proxy } = req.body ?? {};

    const account = await prisma.facebookAccount.findFirst({
      where: { id, userId: reqUser.id },
      select: { id: true },
    });
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    if (proxy === undefined || proxy === null) {
      return res.status(400).json({ ok: false, error: 'proxy is required' });
    }
    if (typeof proxy !== 'string' || !proxy.trim()) {
      return res.status(400).json({ ok: false, error: 'proxy must be a non-empty string' });
    }
    if (!parseFlatProxy(proxy.trim())) {
      return res.status(400).json({ ok: false, error: 'proxy must be in "host:port" or "host:port:user:pass" format' });
    }

    const encryptedProxy = encrypt(proxy.trim());
    await prisma.facebookAccount.update({
      where: { id, userId: reqUser.id },
      data: { encryptedProxy },
    });
    await invalidateHealthCache(id);
    return res.json({ ok: true });
  } catch (err) {
    if ((/** @type {Record<string, unknown>} */ (err))?.code === 'P2025') {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }
    console.error('❌ PATCH /api/facebook/accounts/:id error:', (/** @type {Record<string, unknown>} */ (err))?.code || (/** @type {Record<string, unknown>} */ (err))?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to update account proxy' });
  }
});

// ============================================================================
// Cookie resolution helper — accountId → decrypted { c_user, xs } (Story 5.5 D1)
// Used by /api/facebook/automate to bridge a saved account into the run pipeline
// without the raw cookie ever leaving the server (NFR3).
// ============================================================================

/**
 * Resolve a stored Facebook account to its decrypted cookie pair.
 * Enforces ownership (userId) at the query layer.
 * @returns {Promise<{c_user: string, xs: string}>} decrypted cookie
 * @throws {Error} if not found, not owned, or decryption fails
 */
/**
 * @param {string} userId
 * @param {string} accountId
 */
export async function resolveAccountCookie(userId, accountId) {
  const account = await prisma.facebookAccount.findFirst({
    where: { id: accountId, userId },
    select: { encryptedCookie: true },
  });
  if (!account) {
    const err = /** @type {Error & Record<string, unknown>} */ (new Error('Facebook account not found'));
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }
  const decrypted = decrypt(account.encryptedCookie);
  if (!decrypted) {
    const err = /** @type {Error & Record<string, unknown>} */ (new Error('Failed to decrypt stored account cookie'));
    err.code = 'ACCOUNT_DECRYPT_FAILED';
    throw err;
  }
  const { c_user, xs } = JSON.parse(decrypted);
  return { c_user, xs };
}

export default router;
