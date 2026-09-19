// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GitHubClient — HTTP client for the public GitHub REST API (zero-auth).
 *
 * Direct fetch, Tier-0: no browser, no proxy. Unauthenticated rate limit is
 * 60 req/hour per source IP; supplying `GITHUB_TOKEN` (or `options.token`)
 * raises it to 5000 req/hour. The limit is enforced through the shared
 * `DistributedTokenBucket` so concurrent OSINT fan-outs across processes/backends
 * observe one budget.
 *
 * Story 41.1 — GitHub + Gravatar OSINT adapters (Epic 41).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { RateLimitError, PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { globalDistributedTokenBucket } from '../../../core/distributed-token-bucket.js';

export const GITHUB_BASE_URL = 'https://api.github.com';

/** Bucket key — platform-wide (zero-auth, not per-account). */
const GITHUB_BUCKET_KEY = 'osint:github';

/** Unauthenticated rate limit: 60 requests / hour. */
const UNAUTH_CAPACITY = 60;
const UNAUTH_REFILL_PER_SEC = UNAUTH_CAPACITY / 3600;

/** Authenticated rate limit (GITHUB_TOKEN): 5000 requests / hour. */
const AUTH_CAPACITY = 5000;
const AUTH_REFILL_PER_SEC = AUTH_CAPACITY / 3600;

export class GitHubClient extends AbstractApiClient {
  /** @type {string} */
  name = 'github';

  /** @type {string} */
  platform = 'github';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = GITHUB_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const baseUrl = (options.baseUrl || GITHUB_BASE_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'github',
      client: options.client || 'undici',
      requiresAuth: false,
      requiresProxy: false,
    });

    this.baseUrl = baseUrl;
    this.requiresProxy = false;
    this.options = options;

    /**
     * Optional personal access token — raises the rate budget to 5000 req/h.
     * Resolution order: explicit option → GITHUB_TOKEN env.
     * @type {string | null}
     */
    this.token = options.token || process.env.GITHUB_TOKEN || null;

    /**
     * Injectable token bucket for tests; defaults to the shared global bucket.
     * @type {import('../../../core/distributed-token-bucket.js').DistributedTokenBucket}
     */
    this.tokenBucket = options.tokenBucket || globalDistributedTokenBucket;
  }

  /**
   * Rate budget for the current auth state.
   * @returns {{ capacity: number, refillRate: number }}
   */
  #budget() {
    return this.token
      ? { capacity: AUTH_CAPACITY, refillRate: AUTH_REFILL_PER_SEC }
      : { capacity: UNAUTH_CAPACITY, refillRate: UNAUTH_REFILL_PER_SEC };
  }

  /**
   * Default GitHub API headers.
   * @returns {Record<string, string>}
   */
  getDefaultHeaders() {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.options?.userAgent || 'xactions-osint/1.0',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  /**
   * Enforce the GitHub rate budget before a request leaves the client.
   * Throws RateLimitError (XACT_4291) when the bucket is empty so the caller
   * sees a real rate-limit signal with a concrete retry delay.
   * @returns {Promise<void>}
   */
  async #gateRateLimit() {
    const { capacity, refillRate } = this.#budget();
    const res = await this.tokenBucket.consume(GITHUB_BUCKET_KEY, 1, {
      capacity,
      refillRate,
      ttlSeconds: 7200,
    });
    if (!res.allowed) {
      throw new RateLimitError({
        code: 'XACT_4291',
        message: `⏳ GitHub rate limit reached (${capacity}/h) — retry in ${Math.ceil(res.retryAfterMs / 1000)}s`,
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: Math.max(1, res.retryAfterMs),
        platform: 'github',
      });
    }
  }

  /**
   * GET a single public user profile.
   * @param {string} username
   * @returns {Promise<Record<string, any> | null>} raw GitHub user object, or null on 404.
   */
  async getUser(username) {
    const login = String(username || '').trim().replace(/^@/, '');
    if (!login) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: '❌ github profile requires a non-empty username',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'github',
      });
    }

    await this.#gateRateLimit();

    const url = `${this.baseUrl}/users/${encodeURIComponent(login)}`;
    let resp;
    try {
      resp = /** @type {Record<string, any>} */ (
        await this.request('GET', url, { headers: this.getDefaultHeaders(), skipResponseValidation: true })
      );
    } catch (err) {
      // AbstractApiClient.handleError throws PlatformError on any non-2xx/3xx
      // status — including 404. A missing GitHub user is a graceful empty
      // result, not an error, so translate 404 → null.
      const e = /** @type {any} */ (err);
      if (e?.statusCode === 404 || e?.status === 404) return null;
      throw err;
    }

    const status = resp?.status ?? 0;
    if (status === 404) return null; // user not found — graceful empty result
    if (status === 429 || status === 403) {
      const retryAfter = Number(resp?.headers?.['retry-after'] || resp?.headers?.['Retry-After'] || 0);
      throw new RateLimitError({
        code: 'XACT_4291',
        message: `⏳ GitHub upstream rate limit (HTTP ${status})`,
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: Math.max(1, retryAfter) * 1000 || 60_000,
        platform: 'github',
        details: resp?.data,
      });
    }
    if (status < 200 || status >= 300) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5002',
        message: `❌ GitHub API returned HTTP ${status}`,
        statusCode: status || 502,
        platform: 'github',
        details: resp?.data,
      });
    }

    return /** @type {Record<string, any>} */ (resp?.data ?? resp);
  }
}

export default GitHubClient;
