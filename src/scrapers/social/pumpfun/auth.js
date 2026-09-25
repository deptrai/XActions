// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunAuth — handles authentication state and session management for pump.fun.
 * Provides headers (Bearer JWT, Cloudflare cookies) for restricted endpoints.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { globalSessionManager } from '../../../core/session-manager.js';
import { AuthSessionExpiredError, PlatformError, ErrorTypes } from '../../../core/error-envelope.js';

/**
 * PumpFunAuth — resolves and injects authenticated session data.
 */
export class PumpFunAuth {
  /** @param {string} accountId - unique account identifier (e.g., 'default') */
  constructor(accountId = 'default') {
    this.accountId = `pumpfun:${accountId}`;
  }

  /**
   * Load session from globalSessionManager.
   * @returns {Record<string, unknown> | null}
   */
  #getSession() {
    return globalSessionManager.get(this.accountId);
  }

  /**
   * Check if a valid authenticated session exists.
   * @returns {boolean}
   */
  hasSession() {
    const s = this.#getSession();
    return !!(s && s.jwt && s.cookies);
  }

  /**
   * Check if the JWT token is still valid (not expired).
   * @returns {boolean}
   */
  isValid() {
    const s = this.#getSession();
    if (!s || !s.jwt) return false;

    // Parse exp from JWT
    try {
      const parts = s.jwt.split('.');
      if (parts.length < 2) return false;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp && Date.now() >= payload.exp * 1000) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return HTTP headers to authenticate pump.fun requests.
   * @returns {Record<string, string>}
   */
  getAuthHeaders() {
    const s = this.#getSession();
    if (!s || !s.jwt) {
      throw new AuthSessionExpiredError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: `No valid pump.fun session found for account "${this.accountId}". Please extract session via PumpFunBrowserBridge.`,
        statusCode: 401,
        platform: 'pumpfun',
      });
    }

    if (!this.isValid()) {
      throw new AuthSessionExpiredError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: `Pump.fun session expired for account "${this.accountId}". Please re-authenticate via browser.`,
        statusCode: 401,
        platform: 'pumpfun',
      });
    }

    return {
      authorization: `Bearer ${s.jwt}`,
      cookie: s.cookies,
      'user-agent': s.userAgent || '',
    };
  }
}

export default PumpFunAuth;
