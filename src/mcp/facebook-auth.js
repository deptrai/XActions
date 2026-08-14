// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook auth resolution for MCP tools.
 *
 * Thin wrapper that delegates to the shared FacebookAuthResolver (Story 7.4, AD-7.7).
 * Kept as a separate module so src/mcp/ does not need to know the service-layer import
 * path — MCP tools import { resolveMcpFacebookAuth } from here.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { resolve } from '../../api/services/facebookAuth.js';

/**
 * Resolve a Facebook authCookie to a raw { c_user, xs } pair.
 * Delegates to FacebookAuthResolver (api/services/facebookAuth.js).
 *
 * @param {Object} authCookie
 * @returns {Promise<{ c_user: string, xs: string, userId: string|null, accountId: string|null }>}
 * @throws {Error} if the cookie cannot be resolved
 */
export async function resolveMcpFacebookAuth(authCookie) {
  return resolve(authCookie);
}
