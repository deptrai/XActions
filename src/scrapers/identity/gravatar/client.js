// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GravatarClient — HTTP client for the public Gravatar v3 Profiles API.
 *
 * Direct fetch, Tier-0: no browser, no proxy, zero-auth. Resolves an email
 * address to its public Gravatar profile (display name, avatar, linked
 * accounts) via `GET /v3/profiles/{sha256(email)}`. The lookup key is the
 * lowercase hex SHA-256 of the trimmed, lowercased email — the same hash
 * Gravatar's avatar-URL scheme uses.
 *
 * Story 41.1 — GitHub + Gravatar OSINT adapters (Epic 41).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';
import { AbstractApiClient } from '../../../core/base-client.js';
import { PlatformError, RateLimitError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const GRAVATAR_BASE_URL = 'https://api.gravatar.com';

export class GravatarClient extends AbstractApiClient {
  /** @type {string} */
  name = 'gravatar';

  /** @type {string} */
  platform = 'gravatar';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = GRAVATAR_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const baseUrl = (options.baseUrl || GRAVATAR_BASE_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'gravatar',
      client: options.client || 'undici',
      requiresAuth: false,
      requiresProxy: false,
    });

    this.baseUrl = baseUrl;
    this.requiresProxy = false;
    this.options = options;
  }

  /**
   * Compute the Gravatar profile lookup hash for an email: SHA-256 hex of the
   * trimmed + lowercased address (Gravatar's documented normalization).
   * @param {string} email
   * @returns {string} lowercase hex sha256
   */
  static hashEmail(email) {
    return createHash('sha256').update(String(email || '').trim().toLowerCase(), 'utf8').digest('hex');
  }

  /**
   * Default headers — JSON only.
   * @returns {Record<string, string>}
   */
  getDefaultHeaders() {
    return {
      'Accept': 'application/json',
      'User-Agent': this.options?.userAgent || 'xactions-osint/1.0',
    };
  }

  /**
   * GET a public Gravatar profile by email address.
   * @param {string} email
   * @returns {Promise<Record<string, any> | null>} raw profile object, or null on 404.
   */
  async getProfileByEmail(email) {
    const addr = String(email || '').trim();
    if (!addr || !addr.includes('@')) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: '❌ gravatar profile requires a valid email address',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'gravatar',
      });
    }

    const hash = GravatarClient.hashEmail(addr);
    const url = `${this.baseUrl}/v3/profiles/${hash}`;
    let resp;
    try {
      resp = /** @type {Record<string, any>} */ (
        await this.request('GET', url, { headers: this.getDefaultHeaders(), skipResponseValidation: true })
      );
    } catch (err) {
      // AbstractApiClient.handleError throws PlatformError on any non-2xx/3xx
      // status — including 404. No public Gravatar profile for an email is a
      // graceful empty result, not an error, so translate 404 → null.
      const e = /** @type {any} */ (err);
      if (e?.statusCode === 404 || e?.status === 404) return null;
      throw err;
    }

    const status = resp?.status ?? 0;
    if (status === 404) return null; // no public profile for this email — graceful empty
    if (status === 429 || status === 403) {
      const retryAfter = Number(resp?.headers?.['retry-after'] || resp?.headers?.['Retry-After'] || 0);
      throw new RateLimitError({
        code: 'XACT_4291',
        message: `⏳ Gravatar upstream rate limit (HTTP ${status})`,
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: Math.max(1, retryAfter) * 1000 || 60_000,
        platform: 'gravatar',
        details: resp?.data,
      });
    }
    if (status < 200 || status >= 300) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5002',
        message: `❌ Gravatar API returned HTTP ${status}`,
        statusCode: status || 502,
        platform: 'gravatar',
        details: resp?.data,
      });
    }

    return /** @type {Record<string, any>} */ (resp?.data ?? resp);
  }
}

export default GravatarClient;
