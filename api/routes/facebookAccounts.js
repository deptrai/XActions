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

export function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY || 'dev-only-key', salt, 32);
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
    console.error('❌ POST /api/facebook/accounts error:', err.message);
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
      select: { id: true, label: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    // NFR3: encryptedCookie never selected or returned
    return res.json({ ok: true, accounts });
  } catch (err) {
    console.error('❌ GET /api/facebook/accounts error:', err.message);
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

    // Block delete if a run is in progress for this user (conservative guard)
    const activeRun = await prisma.operation.findFirst({
      where: { userId: req.user.id, status: 'running' },
      select: { id: true },
    });
    if (activeRun) {
      return res.status(409).json({ ok: false, error: 'Cannot remove account while a run is in progress' });
    }

    await prisma.facebookAccount.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/facebook/accounts error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to remove account' });
  }
});

export default router;
