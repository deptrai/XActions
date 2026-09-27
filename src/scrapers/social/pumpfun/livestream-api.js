// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LivestreamApiClient — HTTP client for pump.fun authenticated livestream & profile APIs.
 * Handles calls to livestream-api.pump.fun and profile-api.pump.fun.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PumpFunAuth } from './auth.js';
import { PlatformError, ErrorTypes, SuggestedActions, AuthSessionExpiredError } from '../../../core/error-envelope.js';

export class LivestreamApiClient {
  /**
   * @param {PumpFunAuth} auth
   * @param {object} [deps]
   * @param {Function} [deps.fetchFn] - injected fetch for testing
   */
  constructor(auth, deps = {}) {
    this.auth = auth;
    this.fetchFn = deps.fetchFn || globalThis.fetch;
    this.livestreamBase = 'https://livestream-api.pump.fun';
    this.profileBase = 'https://profile-api.pump.fun';
    this.frontendBase = 'https://frontend-api-v3.pump.fun';
  }

  /**
   * Get auth headers if session available, empty object otherwise.
   * Public pump.fun endpoints (clips, following, users) work without auth.
   * @returns {Object}
   */
  #safeAuthHeaders() {
    try {
      return this.auth.getAuthHeaders();
    } catch {
      return {};
    }
  }

  /**
   * Internal fetch wrapper with auth headers and error handling.
   * @param {string} url
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  async #apiRequest(url, options = {}) {
    const headers = {
      'accept': 'application/json',
      // Chrome UA — Cloudflare blocks default Node fetch UA (error 1015)
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      ...(options.headers || {}),
      // Auth headers are optional — public endpoints work without them
      ...(options.noAuth ? {} : this.#safeAuthHeaders()),
    };

    try {
      let res = await this.fetchFn(url, { ...options, headers });
      // Cloudflare TLS-fingerprint block (403 or 429/error-1015) → retry via curl
      if (res.status === 403 || res.status === 429) {
        const text = await res.text().catch(() => '');
        if (res.status === 403 || text.includes('1015')) {
          const { createCurlTransport } = await import('../../../core/curl-transport.js');
          const transport = createCurlTransport('pumpfun');
          const curlRes = await transport({ url, method: 'GET', headers, timeout: 15000 });
          res = { status: curlRes.status, ok: curlRes.status >= 200 && curlRes.status < 300, json: async () => curlRes.data, text: async () => (typeof curlRes.data === 'string' ? curlRes.data : JSON.stringify(curlRes.data)) };
        } else {
          // Non-1015 429 — re-wrap as Response-like for error handling below
          res = { status: res.status, ok: false, json: async () => ({}), text: async () => text };
        }
      }
      if (res.status === 401) {
        throw new PlatformError({
          type: ErrorTypes.AUTH_REQUIRED,
          code: 'XACT_4010',
          message: `pump.fun API returned 401 Unauthorized for ${url}. Session may be invalid or expired.`,
          statusCode: 401,
          platform: 'pumpfun',
        });
      }
      if (!res.ok) {
        const text = await res.text();
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_5000',
          message: `pump.fun API error ${res.status} on ${url}: ${text.slice(0, 100)}`,
          statusCode: res.status,
          platform: 'pumpfun',
        });
      }
      return await res.json();
    } catch (err) {
      if (err instanceof PlatformError || err instanceof AuthSessionExpiredError) throw err;
      throw new PlatformError({
        type: ErrorTypes.NETWORK,
        code: 'XACT_5001',
        message: `pump.fun API network error on ${url}: ${err.message}`,
        statusCode: 0,
        platform: 'pumpfun',
      });
    }
  }

  /**
   * Fetch officially verified KOL list on pump.fun.
   * @returns {Promise<Array>}
   */
  async getKols() {
    return this.#apiRequest(`${this.livestreamBase}/kols`);
  }

  /**
   * Fetch authenticated user's own profile from frontend-api-v3.
   * @returns {Promise<Record<string, unknown>>}
   */
  async getMyProfile() {
    return this.#apiRequest(`${this.frontendBase}/users/me`);
  }

  /**
   * Fetch authenticated user's following list.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getFollowing(userId) {
    return this.#apiRequest(`${this.frontendBase}/following/${encodeURIComponent(userId)}`);
  }

  /**
   * Fetch livestream clips / HLS metadata for a coin or streamer.
   * @param {string} mintOrWallet - mint or creator address
   * @returns {Promise<Array>}
   */
  async getLivestreamClips(mintOrWallet) {
    // Observed endpoints for clips (varies by coin/live or user history)
    return this.#apiRequest(`${this.livestreamBase}/clips/${encodeURIComponent(mintOrWallet)}`);
  }

  /**
   * Post a reply to a mint's comment section.
   * Requires valid authenticated session.
   * @param {string} mint
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.replyToId]
   * @param {string} [opts.mediaUrl]
   * @returns {Promise<Record<string, unknown>>}
   */
  async postMintReply(mint, text, opts = {}) {
    const payload = { mint, text, ...opts };
    return this.#apiRequest(`${this.frontendBase}/replies`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }
}

export default LivestreamApiClient;
