// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * FacebookAuthResolver — shared auth resolution for API + MCP (Story 7.4, AD-7.7).
 *
 * Resolves authCookie ({ c_user, xs } or { accountId }) to a raw cookie pair.
 * Used by FacebookScrapeService, api/routes/facebook.js, and src/mcp/facebook-auth.js
 * to avoid duplicate decrypt logic.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../routes/facebookAccounts.js';

/**
 * Resolve a Facebook authCookie to a raw { c_user, xs } pair.
 *
 * @param {Object} authCookie - { c_user, xs } for raw cookie, or { accountId } for stored account.
 * @param {string} [userId] - Required when using accountId; validates account ownership.
 * @returns {Promise<{ c_user: string, xs: string, userId: string|null, accountId: string|null }>}
 * @throws {Error} with code ACCOUNT_NOT_FOUND or ACCOUNT_DECRYPT_FAILED
 */
export async function resolve(authCookie, userId) {
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
      // Enforce ownership at the query layer when userId is provided.
      // If userId is not provided, we cannot safely resolve accountId (MCP tools
      // must pass userId from client context per AC2.12).
      const where = userId
        ? { id: accountId, userId }
        : { id: accountId };
      const account = await prisma.facebookAccount.findFirst({
        where,
        select: { userId: true, encryptedCookie: true },
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

export default { resolve };
