// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/** @typedef {import('./types.js').Raw} Raw */
/** @typedef {import('./types.js').RateLimitInfo} RateLimitInfo */
/** @typedef {import('./types.js').TwitterHttpClientOptions} TwitterHttpClientOptions */
/** @typedef {import('./types.js').RequestOptions} RequestOptions */
/** @typedef {import('./types.js').GraphqlOptions} GraphqlOptions */
/**
 * Twitter HTTP Client Core
 *
 * Foundation layer for all HTTP-based Twitter scraper operations.
 * Handles request construction, headers, cookie management, rate-limit
 * detection, retry with exponential back-off, and proxy support.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import {
  BEARER_TOKEN,
  GRAPHQL_BASE,
  REST_BASE,
  DEFAULT_FEATURES,
  USER_AGENTS,
  buildGraphQLUrl,
} from './endpoints.js';
import {
  TwitterApiError,
  RateLimitError,
  AuthError,
  NotFoundError,
  NetworkError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string[]} agents
 */
function pickUserAgent(agents) {
  return agents[Math.floor(Math.random() * agents.length)];
}

// ---------------------------------------------------------------------------
// Rate Limit Strategies
// ---------------------------------------------------------------------------

export class WaitingRateLimitStrategy {
  constructor({ sleepFn = sleep } = {}) {
    this._sleep = sleepFn;
  }

  /**
   * @param {RateLimitInfo} info
   */
  async onRateLimit({ resetAt }) {
    const waitMs = Math.max((resetAt || Date.now() + 60_000) - Date.now(), 1000);
    await this._sleep(waitMs);
  }
}

export class ErrorRateLimitStrategy {
  /**
   * @param {RateLimitInfo} info
   */
  async onRateLimit({ resetAt, endpoint }) {
    throw new RateLimitError(
      `Rate limited on ${endpoint}, resets at ${new Date(resetAt || Date.now())}`,
      { resetAt, endpoint }
    );
  }
}

// ---------------------------------------------------------------------------
// TwitterHttpClient
// ---------------------------------------------------------------------------

export class TwitterHttpClient {
  /**
   * @param {TwitterHttpClientOptions} [options]
   */
  constructor(options = {}) {
    /** @type {Record<string, string>} */
    this._cookies = {};
    this._proxy = options.proxy || null;
    this._maxRetries = options.maxRetries ?? 3;
    this._fetch = options.fetch || globalThis.fetch;
    this._userAgents = USER_AGENTS;

    this._userAgents = USER_AGENTS;
    if (options.userAgent && options.userAgent !== 'rotate') {
      this._userAgents = [options.userAgent];
    }

    // Rate-limit strategy
    if (options.rateLimitStrategy === 'wait') {
      this._rateLimitStrategy = new WaitingRateLimitStrategy();
    } else if (
      options.rateLimitStrategy &&
      typeof options.rateLimitStrategy === 'object' &&
      typeof options.rateLimitStrategy.onRateLimit === 'function'
    ) {
      this._rateLimitStrategy = options.rateLimitStrategy;
    } else {
      this._rateLimitStrategy = new ErrorRateLimitStrategy();
    }

    this._debug = options.debug || false;

    if (options.cookies) {
      this.setCookies(options.cookies);
    }
  }

  // ---- Cookie management --------------------------------------------------

  /**
   * Parse and store cookies from a browser-exported cookie string.
   * @param {string} cookieString - `auth_token=xxx; ct0=yyy; ...`
   */
  setCookies(cookieString) {
    if (!cookieString) return;
    const pairs = cookieString.split(';').map((p) => p.trim()).filter(Boolean);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      this._cookies[name] = value;
    }
  }

  getCsrfToken() {
    return this._cookies.ct0 || '';
  }

  isAuthenticated() {
    return Boolean(this._cookies.auth_token);
  }

  /**
   * @param {string} proxyUrl
   */
  setProxy(proxyUrl) {
    this._proxy = proxyUrl;
  }

  // ---- Header construction ------------------------------------------------

  /**
   * Build request headers.
   * @param {boolean} [authenticated=true]
   * @returns {Record<string, string>}
   */
  _buildHeaders(authenticated = true) {
    const headers = /** @type {Record<string, string>} */ ({
      authorization: `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'user-agent': pickUserAgent(this._userAgents),
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    });

    if (authenticated && this.isAuthenticated()) {
      headers['x-csrf-token'] = this.getCsrfToken();
      headers['x-twitter-auth-type'] = 'OAuth2Session';
      // Rebuild cookie string
      headers.cookie = Object.entries(this._cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }

    return headers;
  }

  // ---- Core request -------------------------------------------------------

  /**
   * Send an HTTP request with retry logic.
   *
   * @param {string} url
   * @param {RequestOptions} [options]
   * @returns {Promise<Raw>} Parsed JSON
   */
  async request(url, options = {}) {
    const method = options.method || 'GET';
    const authenticated = options.authenticated !== false;
    const headers = { ...this._buildHeaders(authenticated), ...options.headers };
    const body =
      options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body;

    /** @type {Error|undefined} */
    let lastError;
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      const startTime = Date.now();
      try {
        const res = await this._fetch(url, { method, headers, body });
        const elapsed = Date.now() - startTime;
        if (this._debug) {
          console.log(`[TwitterHttpClient] ${method} ${url} → ${res.status} (${elapsed}ms)`);
        }

        // Rate-limit detection from headers
        const remaining = parseInt(res.headers?.get?.('x-rate-limit-remaining') ?? '', 10);
        const resetTs = parseInt(res.headers?.get?.('x-rate-limit-reset') ?? '', 10) * 1000;

        if (res.status === 429) {
          /** @type {RateLimitInfo} */
          const rlErr = { resetAt: resetTs || Date.now() + 60_000, endpoint: url, retryCount: attempt };
          await this._rateLimitStrategy.onRateLimit(rlErr);
          continue; // retry after strategy handles it
        }

        if (res.status === 401 || res.status === 403) {
          throw new AuthError(`Authentication failed (${res.status})`, { status: res.status, endpoint: url });
        }
        if (res.status === 404) {
          throw new NotFoundError('Resource not found', { status: 404, endpoint: url });
        }

        const json = /** @type {Raw} */ (await res.json?.() ?? {});

        if (res.status >= 400) {
          throw new TwitterApiError(`HTTP ${res.status}`, { status: res.status, endpoint: url, data: json });
        }

        return json;
      } catch (err) {
        const elapsed = Date.now() - startTime;
        const error = /** @type {Error} */ (err);
        if (this._debug) {
          console.log(`[TwitterHttpClient] ${method} ${url} → ERROR (${elapsed}ms): ${error.message}`);
        }
        lastError = error;
        // Don't retry auth / not-found / explicit API errors
        if (
          error instanceof AuthError ||
          error instanceof NotFoundError ||
          (error instanceof TwitterApiError && !(error instanceof RateLimitError))
        ) {
          throw error;
        }
        // Network-level retry
        if (attempt < this._maxRetries) {
          const jitter = Math.random() * 500;
          await sleep(2 ** attempt * 1000 + jitter);
        }
      }
    }
    if (lastError instanceof RateLimitError || lastError instanceof TwitterApiError) throw lastError;
    throw new NetworkError(lastError?.message || 'Request failed after retries', { endpoint: url });
  }

  // ---- GraphQL helpers ----------------------------------------------------

  /**
   * Execute a GraphQL query (GET) or mutation (POST).
   *
   * @param {string} queryId
   * @param {string} operationName
   * @param {Record<string, unknown>} variables
   * @param {GraphqlOptions} [options]
   * @returns {Promise<Raw>}
   */
  async graphql(queryId, operationName, variables, options = {}) {
    const features = options.features || DEFAULT_FEATURES;
    const isMutation = options.mutation === true;

    if (isMutation) {
      const url = `${GRAPHQL_BASE}/${queryId}/${operationName}`;
      // Mutations don't paginate - return raw JSON
      return this.request(url, {
        method: 'POST',
        body: { variables, features, queryId },
      });
    }

    const url = buildGraphQLUrl(queryId, operationName, variables, features);
    const json = /** @type {Raw} */ (await this.request(url));

    // Extract bottom cursor for pagination (queries only)
    const cursor = this._extractCursor(json);
    return { data: json, cursor };
  }

  /**
   * Auto-paginating async generator over a GraphQL query.
   *
   * @param {string} queryId
   * @param {string} operationName
   * @param {Record<string, unknown>} variables
   * @param {GraphqlOptions} [options]
   * @yields {Raw}
   */
  async *graphqlPaginate(queryId, operationName, variables, options = {}) {
    const limit = options.limit ?? Infinity;
    let cursor = null;
    let fetched = 0;

    while (fetched < limit) {
      const vars = cursor ? { ...variables, cursor } : { ...variables };
      const result = await this.graphql(queryId, operationName, vars, options);

      /** @type {Raw} */ (yield result);
      fetched += 1;

      if (options.onProgress) {
        options.onProgress({ fetched, limit: limit === Infinity ? null : limit });
      }

      cursor = result.cursor;
      if (!cursor) break;
    }
  }

  // ---- Cursor extraction --------------------------------------------------

  /**
   * Extract the "bottom" cursor from a Twitter timeline GraphQL response.
   * Twitter nests cursors in timeline instruction entries with entryId
   * starting with "cursor-bottom".
   *
   * @param {Raw} json
   * @returns {string|null}
   * @private
   */
  _extractCursor(json) {
    try {
      // Walk common timeline response shapes
      const instructions = this._findInstructions(json);
      if (!instructions) return null;

      for (const instruction of instructions) {
        const entries = instruction.entries || instruction.moduleItems || [];
        for (const entry of entries) {
          const id = /** @type {string} */ (entry.entryId || entry.entry_id) || '';
          if (id.startsWith('cursor-bottom')) {
            return (
              entry.content?.value ||
              entry.content?.itemContent?.value ||
              entry.content?.cursorType === 'Bottom' && entry.content?.value ||
              null
            );
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Recursively search the response for a timeline instructions array.
   * @param {Raw} obj
   * @returns {Raw[]|null}
   * @private
   */
  _findInstructions(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj.instructions)) return obj.instructions;
    for (const key of Object.keys(obj)) {
      const result = this._findInstructions(/** @type {Raw} */ (obj[key]));
      if (result) return result;
    }
    return null;
  }

  // ---- REST helper --------------------------------------------------------

  /**
   * Execute a REST API call (typically POST with form data).
   *
   * @param {string} path - e.g. `/1.1/friendships/create.json`
   * @param {RequestOptions} [options]
   * @returns {Promise<Raw>}
   */
  async rest(path, options = {}) {
    const url = `${REST_BASE}${path}`;
    const method = options.method || 'POST';
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
    };

    let body;
    if (options.body && typeof options.body === 'object') {
      body = new URLSearchParams(/** @type {Record<string, string>} */ (options.body)).toString();
    } else {
      body = options.body;
    }

    return this.request(url, { method, headers, body });
  }
}
