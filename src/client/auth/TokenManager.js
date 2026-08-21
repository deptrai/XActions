// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Token Manager
 *
 * Coordinates bearer token, guest token, and CSRF token for Twitter API requests.
 * Twitter requires two tokens for unauthenticated (guest) access:
 *   1. Bearer token (hardcoded, public) — embedded in Twitter's web client JS
 *   2. Guest token (dynamic, per session) — obtained from activate.json endpoint
 *
 * For authenticated requests, a CSRF token (ct0 cookie) replaces the guest token.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { BEARER_TOKEN } from '../api/graphqlQueries.js';
import { randomUserAgent } from './userAgent.js';

/** @typedef {import('../api/parsers.js').Raw} Raw */

const ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json';

/** Guest tokens last approximately 3 hours */
const GUEST_TOKEN_MAX_AGE = 3 * 60 * 60 * 1000;

// ============================================================================
// TokenManager Class
// ============================================================================

/**
 * Manages authentication tokens for Twitter API requests.
 * Handles guest token lifecycle (activation, expiry, rotation) and
 * provides properly formatted HTTP headers for both guest and authenticated modes.
 */
export class TokenManager {
  /**
   * @param {typeof globalThis.fetch} [fetchFn] - Custom fetch implementation (defaults to globalThis.fetch)
   */
  constructor(fetchFn) {
    /** @type {string} The public Twitter bearer token */
    this.bearerToken = BEARER_TOKEN;
    /** @type {string|undefined} Current guest token */
    this.guestToken = undefined;
    /** @type {number|undefined} Timestamp when guest token expires */
    this.guestTokenExpiresAt = undefined;
    /** @type {string|null} CSRF token for authenticated requests (from ct0 cookie) */
    this.csrfToken = null;
    /**
     * Browser User-Agent sent on every request. X answers a UA-less request
     * to activate.json with a misleading HTTP 404, so this is required, not
     * cosmetic. Pinned for the lifetime of the manager so a single session
     * presents a consistent fingerprint.
     * @type {string}
     */
    this.userAgent = randomUserAgent();
    /** @private @type {typeof globalThis.fetch} */
    this._fetchFn = fetchFn || globalThis.fetch;
  }

  /**
   * Activate a new guest token from Twitter's activation endpoint.
   * POST https://api.x.com/1.1/guest/activate.json
   *
   * Guest tokens are rate-limited. If you get a 429, this method waits
   * and retries once before throwing.
   *
   * @returns {Promise<string>} The activated guest token
   * @throws {Error} If activation fails or is rate-limited
   */
  async activateGuestToken() {
    const response = await this._fetchFn(ACTIVATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'User-Agent': this.userAgent,
      },
    });

    // Handle rate limiting with one retry
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));

      const retryResponse = await this._fetchFn(ACTIVATE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          'User-Agent': this.userAgent,
        },
      });

      if (!retryResponse.ok) {
        const text = await retryResponse.text().catch(() => '');
        throw new Error(
          `Guest token activation rate limited: HTTP ${retryResponse.status} — ${text.slice(0, 200)}`,
        );
      }

      const retryData = /** @type {Raw} */ (await retryResponse.json());
      this.guestToken = /** @type {string} */ (retryData.guest_token);
      if (!this.guestToken) throw new Error('No guest_token in activation response');
      this.guestTokenExpiresAt = Date.now() + GUEST_TOKEN_MAX_AGE;
      return this.guestToken;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Guest token activation failed: HTTP ${response.status} — ${text.slice(0, 200)}`,
      );
    }

    const data = /** @type {Raw} */ (await response.json());
    this.guestToken = /** @type {string} */ (data.guest_token);
    if (!this.guestToken) throw new Error('No guest_token in activation response');
    this.guestTokenExpiresAt = Date.now() + GUEST_TOKEN_MAX_AGE;
    return this.guestToken;
  }

  /**
   * Get a valid guest token, activating a new one if the current token
   * is missing or expired.
   *
   * @returns {Promise<string>} A valid guest token
   */
  async getGuestToken() {
    if (this.isGuestTokenValid()) return /** @type {string} */ (this.guestToken);
    return this.activateGuestToken();
  }

  /**
   * Build the HTTP headers that Twitter expects for API requests.
   *
   * @param {boolean} [authenticated=false] - Whether this is an authenticated request
   * @returns {Record<string, string>} Headers object ready for fetch()
   */
  getHeaders(authenticated = false) {
    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${this.bearerToken}`,
      'User-Agent': this.userAgent,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'Content-Type': 'application/json',
    };

    if (authenticated && this.csrfToken) {
      headers['x-csrf-token'] = this.csrfToken;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
    } else if (this.guestToken) {
      headers['x-guest-token'] = this.guestToken;
    }

    return headers;
  }

  /**
   * Set the CSRF token (extracted from the ct0 cookie after login).
   *
   * @param {string|null|undefined} token - CSRF token value, or null/undefined to clear
   */
  setCsrfToken(token) {
    this.csrfToken = token ?? null;
  }

  /**
   * Alias for setCsrfToken used by session refresh.
   * @param {string} token
   */
  refreshCsrf(token) {
    this.setCsrfToken(token);
  }

  /**
   * Check if the current guest token exists and hasn't expired.
   *
   * @returns {boolean}
   */
  isGuestTokenValid() {
    return !!(
      this.guestToken &&
      this.guestTokenExpiresAt &&
      Date.now() < this.guestTokenExpiresAt
    );
  }

  /**
   * Invalidate the current guest token, forcing re-activation on next request.
   */
  invalidateGuestToken() {
    this.guestToken = undefined;
    this.guestTokenExpiresAt = undefined;
  }
}
