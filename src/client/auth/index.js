// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Auth Module Index
 *
 * Barrel exports for the authentication system.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

export { CookieAuth } from './CookieAuth.js';
export { CookieJar } from './CookieJar.js';
export {
  parseSetCookieHeader,
  parseSetCookieHeaders,
  updateJarFromResponse,
  extractCsrfToken,
  extractUserId,
  extractAuthToken,
} from './CookieParser.js';
export { CredentialAuth } from './CredentialAuth.js';
export { GuestToken } from './GuestToken.js';
export { TokenManager } from './TokenManager.js';
export { SessionValidator } from './SessionValidator.js';
export {
  getDefaultCookiePath,
  saveCookiesToConfig,
  loadCookiesFromConfig,
  listSessions,
  deleteSession,
  getActiveSession,
} from './storage.js';
