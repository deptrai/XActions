// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook auth resolution for MCP tools.
 *
 * Supports two ways to authenticate a Facebook action:
 * - Raw session cookie: authCookie { c_user, xs }
 * - Stored account:     authCookie { accountId } (references FacebookAccount table)
 *
 * When accountId is used, the encrypted cookie is decrypted server-side and the
 * owning userId is returned so real runs can record Operation/Schedule rows.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../api/routes/facebookAccounts.js';

/**
 * Resolve a Facebook authCookie to a raw { c_user, xs } pair.
 * @param {Object} authCookie
 * @returns {Promise<{ c_user: string, xs: string, userId: string|null, accountId: string|null }>}
 * @throws {Error} if the cookie cannot be resolved
 */
export async function resolveMcpFacebookAuth(authCookie) {
  if (!authCookie || typeof authCookie !== 'object') {
    throw new Error('❌ requires authCookie: provide { c_user, xs } or { accountId }');
  }

  // Raw cookie path — pass through unchanged.
  const cUserRaw = String(authCookie.c_user ?? '').trim();
  const xsRaw = String(authCookie.xs ?? '').trim();
  if (cUserRaw && xsRaw) {
    return { c_user: cUserRaw, xs: xsRaw, userId: null, accountId: null };
  }

  // Stored account path — look up and decrypt server-side.
  const accountId = authCookie.accountId;
  if (accountId) {
    const prisma = new PrismaClient();
    try {
      const account = await prisma.facebookAccount.findUnique({
        where: { id: accountId },
        select: { userId: true, encryptedCookie: true },
      });
      if (!account) {
        throw new Error(`❌ Facebook account "${accountId}" not found`);
      }

      const decrypted = decrypt(account.encryptedCookie);
      if (!decrypted) {
        throw new Error(`❌ Failed to decrypt Facebook account "${accountId}"`);
      }

      const { c_user, xs } = JSON.parse(decrypted);
      return {
        c_user: String(c_user).trim(),
        xs: String(xs).trim(),
        userId: account.userId,
        accountId,
      };
    } finally {
      await prisma.$disconnect();
    }
  }

  throw new Error('❌ requires authCookie: must contain either { c_user, xs } or { accountId }');
}
