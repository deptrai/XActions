// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedditClient — Reddit REST API HTTP client for public read-only scraping.
 * Extends AbstractApiClient with OAuth2 client_credentials auth, public .json
 * endpoints, User-Agent injection, rate-limit header parsing, and proxy support.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { RedditPlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  RateLimitError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const DEFAULT_REDDIT_BASE_URL = 'https://www.reddit.com';
export const DEFAULT_REDDIT_API_URL = 'https://api.reddit.com';
export const DEFAULT_REDDIT_OAUTH_URL = 'https://www.reddit.com/api/v1/access_token';

/**
 * Build a descriptive Reddit User-Agent string.
 * Reddit requires a unique, descriptive UA per https://support.reddithelp.com/hc/en-us/articles/16160319875092.
 * @param {string} [username]
 * @returns {string}
 */
export function buildRedditUserAgent(username) {
  const app = 'xactions:reddit-scraper:v1.0.0';
  if (username && /^[a-zA-Z0-9_-]+$/.test(username)) {
    return `${app} by u/${username}`;
  }
  return `${app} (xactions)`;
}

export function createRedditClient(options = {}) {
  return new RedditClient(options);
}

export function createRedditCrawler(client, options = {}) {
  const resolvedClient = client instanceof RedditClient ? client : new RedditClient(client || options || {});
  const resolvedOptions = client instanceof RedditClient ? options : (options || {});
  return new RedditCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class RedditClient extends AbstractApiClient {
  /** @type {string} */
  name = 'reddit';

  /** @type {string} */
  platform = 'reddit';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {'undici' | 'got'} */
  client = 'undici';

  /** @type {string} */
  baseUrl;

  /** @type {string} */
  apiBaseUrl;

  /** @type {string} */
  oauthUrl;

  /** @type {string | null} */
  clientId = null;

  /** @type {string | null} */
  clientSecret = null;

  /** @type {string | null} */
  username = null;

  /** @type {string | null} */
  userAgent = null;

  /** @type {string | null} */
  accessToken = null;

  /** @type {number | null} */
  tokenExpiresAt = null;

  /** @type {number} */
  tokenBufferSeconds = 60;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base web URL (default: https://www.reddit.com)
   * @param {string} [options.apiBaseUrl] - API URL for auth calls (default: https://api.reddit.com)
   * @param {string} [options.oauthUrl] - OAuth token endpoint (default: https://www.reddit.com/api/v1/access_token)
   * @param {string} [options.clientId] - Reddit app client_id (script type)
   * @param {string} [options.clientSecret] - Reddit app client_secret
   * @param {string} [options.username] - Reddit username for User-Agent
   * @param {string} [options.userAgent] - Custom User-Agent override
   * @param {string} [options.accessToken] - Existing OAuth access token
   * @param {number} [options.tokenExpiresAt] - Existing token expiry epoch ms
   * @param {import('./validator.js').RedditPlatformResponseValidator} [options.responseValidator]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new RedditPlatformResponseValidator();

    super({
      ...options,
      platform: 'reddit',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.baseUrl = String(options.baseUrl || DEFAULT_REDDIT_BASE_URL).replace(/\/+$/, '');
    this.apiBaseUrl = String(options.apiBaseUrl || DEFAULT_REDDIT_API_URL).replace(/\/+$/, '');
    this.oauthUrl = String(options.oauthUrl || DEFAULT_REDDIT_OAUTH_URL).replace(/\/+$/, '');
    this.clientId = options.clientId || null;
    this.clientSecret = options.clientSecret || null;
    this.username = options.username || null;
    this.userAgent = options.userAgent || buildRedditUserAgent(this.username);
    this.accessToken = options.accessToken || null;
    this.tokenExpiresAt = options.tokenExpiresAt || null;
  }

  /**
   * Reddit does not use client-side payload signing (OAuth2 bearer / Basic auth only).
   * Conforms to AbstractApiClient sign contract.
   * @param {Record<string, any>} [payload]
   * @returns {Promise<Record<string, any>>}
   */
  async sign(payload = {}) {
    return {};
  }

  /**
   * Initialize session: if clientId/clientSecret are provided, obtain OAuth token.
   * @param {Object} [session={}]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    const clientId = session.clientId || this.clientId;
    const clientSecret = session.clientSecret || this.clientSecret;
    if (clientId && clientSecret) {
      await this.authenticate({ clientId, clientSecret });
    } else if (session.accessToken) {
      this.accessToken = session.accessToken;
      this.tokenExpiresAt = session.tokenExpiresAt || null;
    }
  }

  /**
   * Authenticate via OAuth2 client_credentials.
   * @param {Object} credentials
   * @param {string} credentials.clientId
   * @param {string} credentials.clientSecret
   * @returns {Promise<string>} access token
   */
  async authenticate({ clientId, clientSecret }) {
    if (!clientId || !clientSecret) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Reddit authentication requires clientId and clientSecret',
        statusCode: 400,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'reddit',
      });
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const body = 'grant_type=client_credentials';

    const res = await this.request('POST', this.oauthUrl, {
      headers: {
        'authorization': authHeader,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.userAgent,
      },
      body,
      requiresAuth: false,
      skipResponseValidation: true,
    });

    const data = res?.data || res;
    if (!data?.access_token) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: 'Failed to obtain Reddit OAuth token: invalid credentials or response',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'reddit',
        details: data,
      });
    }

    this.accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    this.tokenExpiresAt = Date.now() + (expiresIn - this.tokenBufferSeconds) * 1000;

    return this.accessToken;
  }

  /**
   * Ensure access token is valid; refresh if expired.
   * @returns {Promise<string | null>}
   */
  async ensureToken() {
    if (!this.accessToken) return null;
    if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt) {
      if (this.clientId && this.clientSecret) {
        return this.authenticate({ clientId: this.clientId, clientSecret: this.clientSecret });
      }
      this.accessToken = null;
      this.tokenExpiresAt = null;
      return null;
    }
    return this.accessToken;
  }

  /**
   * Execute a Reddit API request through the resilient AbstractApiClient pipeline.
   *
   * @param {string} path - API path (e.g. '/r/programming/new', '/user/spez/about')
   * @param {Record<string, string | number | boolean | undefined | null>} [params={}]
   * @param {Object} [options={}]
   * @param {'GET' | 'POST'} [options.method='GET']
   * @param {Record<string, any>} [options.headers]
   * @param {any} [options.body]
   * @param {any} [options.json]
   * @param {boolean} [options.requiresAuth]
   * @param {boolean} [options.skipResponseValidation]
   * @param {boolean} [options.useApiBaseUrl] - Use api.reddit.com instead of www.reddit.com
   * @returns {Promise<Record<string, any>>}
   */
  async apiRequest(path, params = {}, options = {}) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid API path: must be non-empty string',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    const method = (options.method || 'GET').toUpperCase();
    const useApiBase = options.useApiBaseUrl !== undefined ? options.useApiBaseUrl : Boolean(this.accessToken);
    const base = useApiBase ? this.apiBaseUrl : this.baseUrl;

    // Ensure .json suffix for public endpoints
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!useApiBase && !normalizedPath.endsWith('.json')) {
      normalizedPath = `${normalizedPath}.json`;
    }

    const queryParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        queryParams.set(k, String(v));
      }
    }

    const qs = queryParams.toString();
    const url = `${base}${normalizedPath}${qs ? '?' + qs : ''}`;

    const headers = {
      'user-agent': this.userAgent,
      'accept': 'application/json',
      ...(options.headers || {}),
    };

    const token = await this.ensureToken();
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const reqOpts = {
      ...options,
      headers,
      requiresAuth: options.requiresAuth !== undefined ? options.requiresAuth : this.requiresAuth,
    };

    if (method === 'POST' && (options.json !== undefined || options.body !== undefined)) {
      if (options.json !== undefined) reqOpts.json = options.json;
      if (options.body !== undefined) reqOpts.body = options.body;
    }

    const res = await this.request(method, url, reqOpts);
    return res?.data !== undefined ? res.data : res;
  }

  /**
   * Parse Reddit rate-limit headers from a response.
   * @param {Record<string, any>} headers
   * @returns {{ remaining: number | null, resetAt: number | null, used: number | null }}
   */
  #parseRateLimitHeaders(headers = {}) {
    const remaining = headers['x-ratelimit-remaining'] !== undefined ? Number(headers['x-ratelimit-remaining']) : null;
    const reset = headers['x-ratelimit-reset'] !== undefined ? Number(headers['x-ratelimit-reset']) : null;
    const used = headers['x-ratelimit-used'] !== undefined ? Number(headers['x-ratelimit-used']) : null;

    let resetAt = null;
    if (reset !== null && !Number.isNaN(reset)) {
      // Reddit sends epoch seconds
      resetAt = reset > 1000000000000 ? reset : reset * 1000;
    }

    return { remaining, resetAt, used };
  }

  /**
   * Override request to inject Reddit-specific rate-limit handling and auth.
   * @param {string} method
   * @param {string} url
   * @param {RequestOptions} [options]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const res = await super.request(method, url, options);

    // Parse rate-limit headers on success to drive proactive backoff
    if (res && typeof res === 'object' && res.headers) {
      const { remaining, resetAt } = this.#parseRateLimitHeaders(res.headers);
      if (remaining !== null && remaining <= 1 && resetAt !== null) {
        const waitMs = Math.max(0, resetAt - Date.now());
        if (waitMs > 0 && waitMs < 300000) { // cap at 5 minutes
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    return res;
  }
}
