// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
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
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

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

export function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(KEY_MATERIAL, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) return null;
    const salt = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY || 'dev-only-key', salt, 32);
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[3], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Never log the error detail — may contain key material
    return null;
  }
}

// ============================================================================
// Validation helpers
// ============================================================================

const LABEL_MAX = 50;
const XS_MAX = 4096; // upper bound — guards against storage-amplification abuse
const C_USER_RE = /^\d{10,20}$/;

export function validateAccountBody(body) {
  const { label, c_user, xs } = body ?? {};
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
  return null;
}

// ============================================================================
// POST /api/facebook/accounts — import & encrypt (AC2 #4)
// ============================================================================

router.post('/', authenticate, async (req, res) => {
  try {
    const validationError = validateAccountBody(req.body);
    if (validationError) return res.status(400).json({ ok: false, error: validationError });

    const label = req.body.label.trim();
    const c_user = String(req.body.c_user).trim();
    const xs = String(req.body.xs).trim();

    // Duplicate label check (AC1 #3)
    const existing = await prisma.facebookAccount.findFirst({
      where: { userId: req.user.id, label },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ ok: false, error: `An account with label "${label}" already exists` });
    }

    // Encrypt cookie pair as JSON — c_user and xs never stored in plaintext
    const cookiePayload = JSON.stringify({ c_user, xs });
    const encryptedCookie = encrypt(cookiePayload);

    const account = await prisma.facebookAccount.create({
      data: { userId: req.user.id, label, encryptedCookie },
      select: { id: true, label: true },  // NFR3: never return encrypted blob
    });

    return res.status(201).json({ ok: true, id: account.id, label: account.label });
  } catch (err) {
    // Prisma unique-constraint (userId+label) race: two concurrent POSTs both pass
    // the findFirst check, the second create hits @@unique → P2002. Return 409, not 500.
    if (err?.code === 'P2002') {
      return res.status(409).json({ ok: false, error: 'An account with that label already exists' });
    }
    // Log a code/type only — Prisma messages can echo field values (NFR3).
    console.error('❌ POST /api/facebook/accounts error:', err?.code || err?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to save account' });
  }
});

// ============================================================================
// GET /api/facebook/accounts — list (label + opaque id only, AC2 #5, AC9 #26)
// ============================================================================

router.get('/', authenticate, async (req, res) => {
  try {
    const accounts = await prisma.facebookAccount.findMany({
      where: { userId: req.user.id },
      select: { id: true, label: true },  // AC2 #5 / AC9 #26: label + opaque id only
      orderBy: { createdAt: 'asc' },
    });
    // NFR3: encryptedCookie never selected or returned
    return res.json({ ok: true, accounts });
  } catch (err) {
    console.error('❌ GET /api/facebook/accounts error:', err?.code || err?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to list accounts' });
  }
});

// ============================================================================
// DELETE /api/facebook/accounts/:id — remove (AC2 #6, AC3 #10)
// ============================================================================

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Own-account guard first
    const account = await prisma.facebookAccount.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true },
    });
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    // Block delete only if a Facebook run referencing THIS account is in progress.
    // Scope by type prefix + accountId so an unrelated op (e.g. Twitter unfollow)
    // never blocks Facebook account removal.
    const activeRun = await prisma.operation.findFirst({
      where: {
        userId: req.user.id,
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
    await prisma.facebookAccount.delete({ where: { id, userId: req.user.id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/facebook/accounts error:', err?.code || err?.name || 'unknown');
    return res.status(500).json({ ok: false, error: 'Failed to remove account' });
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
export async function resolveAccountCookie(userId, accountId) {
  const account = await prisma.facebookAccount.findFirst({
    where: { id: accountId, userId },
    select: { encryptedCookie: true },
  });
  if (!account) {
    const err = new Error('Facebook account not found');
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }
  const decrypted = decrypt(account.encryptedCookie);
  if (!decrypted) {
    const err = new Error('Failed to decrypt stored account cookie');
    err.code = 'ACCOUNT_DECRYPT_FAILED';
    throw err;
  }
  const { c_user, xs } = JSON.parse(decrypted);
  return { c_user, xs };
}

export default router;
