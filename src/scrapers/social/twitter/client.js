// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterClient — Hybrid HTTP client for Twitter/X GraphQL and REST APIs.
 * Extends AbstractApiClient with form-encoded GraphQL dispatch and REST helpers.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TwitterPlatformResponseValidator } from './validator.js';
import { BEARER_TOKEN, GRAPHQL, REST, REST_BASE, DEFAULT_FEATURES, DEFAULT_FIELD_TOGGLES } from '../../twitter/http/endpoints.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * Check whether a URL points to a loopback or local/private host.
 * Treats loopback 127/8, link-local IPv6, private IPv4 ranges, and
 * *.localhost / *.local hosts as local for testing.
 * @param {string} url
 * @returns {boolean}
 */
function isLocalUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '::1' || /^\[?::1\]?$/.test(host) || host === 'fe80::1') return true;
    if (/^127\./.test(host) || host === '0.0.0.0') return true;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (host.startsWith('fc00:') || host.startsWith('fd00:')) return true;
  } catch {}
  return false;
}

/**
 * Parse a cookie string into a record.
 * @param {string | Record<string, string> | Array<{name: string, value: string}>} cookies
 * @returns {Record<string, string>}
 */
export function parseCookies(cookies) {
  if (!cookies) return {};
  if (typeof cookies === 'string') {
    const record = /** @type {Record<string, string>} */ ({});
    for (const part of cookies.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) record[decodeURIComponent(k.trim())] = v.length ? decodeURIComponent(v.join('=').trim()) : '';
    }
    return record;
  }
  if (Array.isArray(cookies)) {
    return Object.fromEntries(
      cookies
        .filter((c) => c && c.name && c.value !== undefined)
        .map((c) => [c.name, String(c.value)])
    );
  }
  if (typeof cookies === 'object') {
    return Object.fromEntries(Object.entries(cookies).map(([k, v]) => [k, String(v)]));
  }
  return {};
}

/**
 * Build a cookie header string from a record or array.
 * @param {Record<string, string> | string | Array<{name: string, value: string}>} cookies
 * @returns {string}
 */
export function buildCookieHeader(cookies) {
  if (!cookies) return '';
  if (typeof cookies === 'string') return cookies;
  if (Array.isArray(cookies)) {
    return cookies
      .filter((c) => c && c.name && c.value !== undefined)
      .map((c) => `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`)
      .join('; ');
  }
  return Object.entries(cookies)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('; ');
}

/**
 * Extract csrf token and auth token from cookies.
 * @param {Record<string, string> | string | Array<{name: string, value: string}>} cookies
 * @returns {{ ct0: string, authToken: string }}
 */
export function parseTwitterCookies(cookies) {
  const header = buildCookieHeader(cookies);
  const ct0Match = header.match(/(?:^|;\s*)ct0=([^;]+)/);
  const authMatch = header.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return {
    ct0: ct0Match ? decodeURIComponent(ct0Match[1]) : '',
    authToken: authMatch ? decodeURIComponent(authMatch[1]) : '',
  };
}

/**
 * Extract csrf token from cookie record.
 * @param {Record<string, string>} cookies
 * @returns {string}
 */
function extractCsrfToken(cookies) {
  return cookies.ct0 || '';
}

/**
 * Extract and validate a clean Twitter screen_name / username.
 * @param {string} input
 * @returns {string}
 */
export function resolveUsername(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid username: must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'twitter',
    });
  }
  const clean = input.trim().replace(/^@/, '');
  const urlMatch = clean.match(/(?:https?:\/\/(?:x|twitter|mobile\.twitter)\.com\/)?([a-zA-Z0-9_]{1,30})/i);
  const result = urlMatch ? urlMatch[1] : clean;
  if (!/^[a-zA-Z0-9_]{1,30}$/.test(result)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Invalid Twitter username format: "${input}"`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'twitter',
    });
  }
  return result;
}

/**
 * Extract and validate a numeric tweet ID from string or URL.
 * @param {string} input
 * @returns {string}
 */
export function resolveTweetId(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid tweetId: must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'twitter',
    });
  }
  const trimmed = input.trim();
  if (/^\d{1,30}$/.test(trimmed)) {
    return trimmed;
  }
  const urlMatch = trimmed.match(/(?:status|statuses)\/(\d{1,30})/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  throw new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: `Invalid Twitter tweetId format: "${input}"`,
    statusCode: 400,
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    platform: 'twitter',
  });
}

export class TwitterClient extends AbstractApiClient {
  /** @type {string} */
  name = 'twitter';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {string} */
  baseUrl = 'https://x.com';

  /** @type {string} */
  bearerToken = BEARER_TOKEN;

  /** @type {string | null} */
  guestToken = null;

  /** @type {'got' | 'undici'} */
  client = 'got';

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {string} [deps.bearerToken]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {import('../../../core/signer-pool.js').PreSignedTokenRing} [deps.tokenRing]
   * @param {import('../../../core/signer-pool.js').SignerWorkerPagePool} [deps.signerPool]
   * @param {string} [deps.guestToken]
   * @param {number} [deps.timeout]
   * @param {'got' | 'undici'} [deps.client]
   * @param {string | Record<string, string>} [deps.cookies]
   */
  constructor(deps = {}) {
    const baseUrl = (deps.baseUrl || 'https://x.com').replace(/\/+$/, '');
    const requiresProxy = deps.requiresProxy !== undefined ? deps.requiresProxy : !isLocalUrl(baseUrl);

    super(/** @type {any} */ ({
      ...deps,
      platform: 'twitter',
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
      requiresProxy,
      responseValidator: deps.responseValidator || new TwitterPlatformResponseValidator(),
      client: deps.client || 'got',
    }));

    this.baseUrl = baseUrl;
    this.bearerToken = deps.bearerToken || BEARER_TOKEN;
    this.guestToken = deps.guestToken || null;
    this.timeout = deps.timeout ?? 30000;
  }

  /**
   * Initialize guest token or account session.
   * @param {Object} [session]
   * @param {string} [session.accountId]
   * @param {string | Record<string, string>} [session.cookies]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    if (session?.cookies) {
      this.updateCookies(parseCookies(session.cookies));
    } else if (this.guestToken) {
      this.updateCookies({ gt: this.guestToken });
    } else if (!this.requiresAuth) {
      await this.#ensureGuestToken();
    }
  }

  /**
   * Lazily acquire a guest token for unauthenticated requests.
   *
   * Twitter retired the `POST /1.1/guest/activate.json` endpoint for guest
   * token activation. As of 2026-09, `gt` is set via a `Set-Cookie` header
   * on any public x.com HTML page (e.g. `/nasa`). We fetch a lightweight
   * logged-out page and extract the token from cookies.
   *
   * @returns {Promise<string | null>}
   */
  async #ensureGuestToken() {
    if (this.guestToken) return this.guestToken;
    try {
      const { fetch: undiciFetch } = await import('undici');
      const res = await undiciFetch('https://x.com/nasa', {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
        redirect: 'manual',
      });

      const rawCookies =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : (res.headers.get('set-cookie') || '').split(',').map((c) => c.trim());

      for (const cookie of rawCookies) {
        const m = cookie.match(/^gt=([^;]+)/);
        if (m?.[1]) {
          this.guestToken = m[1];
          this.updateCookies({ gt: this.guestToken });
          break;
        }
      }
    } catch {
      // Guest token acquisition is best-effort; callers surface upstream errors otherwise.
    }
    return this.guestToken;
  }

  /**
   * Override request to inject Twitter headers and cookies.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions & { cookies?: string | Record<string, string> }} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const opts = /** @type {any} */ (options) || {};

    if (opts.cookies) {
      const parsed = parseCookies(opts.cookies);
      this.updateCookies(parsed);
    }

    const headers = { ...(opts.headers || {}) };
    if (!headers['authorization']) {
      headers['authorization'] = `Bearer ${this.bearerToken}`;
    }
    if (!headers['x-twitter-active-user']) headers['x-twitter-active-user'] = 'yes';
    if (!headers['x-twitter-client-language']) headers['x-twitter-client-language'] = 'en';

    const cookieRecord = { ...this.cookies };
    const isLocal = isLocalUrl(url);
    const effectiveAuth = opts.requiresAuth !== undefined ? opts.requiresAuth : this.requiresAuth;
    if (!effectiveAuth && !isLocal && !this.guestToken) {
      await this.#ensureGuestToken();
    }
    if (this.guestToken && !cookieRecord.gt) {
      cookieRecord.gt = this.guestToken;
    }

    const cookieHeader = buildCookieHeader(cookieRecord);
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
      const csrf = extractCsrfToken(cookieRecord);
      if (csrf && !headers['x-csrf-token']) headers['x-csrf-token'] = csrf;
    }
    if (this.guestToken && !headers['x-guest-token']) {
      headers['x-guest-token'] = this.guestToken;
    }

    return super.request(method, url, { ...opts, headers });
  }

  /**
   * Sign x-client-transaction-id with optional signer pool.
   * @param {Object} options
   * @returns {Promise<string | null>}
   */
  async #signTransactionId(options = {}) {
    if (this.tokenRing && typeof this.tokenRing.next === 'function') {
      const token = this.tokenRing.next();
      if (token) return token;
    }

    if (!this.signerPool || typeof this.signerPool.evaluate !== 'function') return null;
    let timer = null;
    try {
      return await Promise.race([
        this.signerPool.evaluate('xClientTransactionId', [options], { timeoutMs: 3000 }).then((result) => {
          if (typeof result === 'string') return result;
          if (result && typeof result === 'object') return result.signature || result.xClientTransactionId || null;
          return null;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('signer timeout')), 3000); }),
      ]);
    } catch {
      // Swallow signing failures for guest/no-auth requests.
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Build GraphQL form-encoded body.
   * @param {Record<string, unknown>} variables
   * @param {Record<string, boolean>} [features]
   * @param {Record<string, unknown>} [fieldToggles]
   * @returns {URLSearchParams}
   */
  #buildGraphQLBody(variables, features = DEFAULT_FEATURES, fieldToggles = DEFAULT_FIELD_TOGGLES) {
    const body = new URLSearchParams();
    body.set('variables', JSON.stringify(variables));
    body.set('features', JSON.stringify(features));
    body.set('fieldToggles', JSON.stringify(fieldToggles || DEFAULT_FIELD_TOGGLES));
    return body;
  }

  /**
   * Send a Twitter GraphQL request.
   * Supports both (queryId, op, vars, options) and (queryId, op, vars, features, fieldToggles, options).
   * @param {string} queryId
   * @param {string} operationName
   * @param {Record<string, unknown>} [variables={}]
   * @param {any} [featuresOrOptions]
   * @param {any} [fieldToggles]
   * @param {any} [options]
   * @returns {Promise<any>}
   */
  async requestGraphQl(queryId, operationName, variables = {}, featuresOrOptions, fieldToggles, options) {
    let actualFeatures = DEFAULT_FEATURES;
    let actualFieldToggles = DEFAULT_FIELD_TOGGLES;
    /** @type {Record<string, any>} */
    let actualOptions = {};

    if (featuresOrOptions && typeof featuresOrOptions === 'object') {
      if (
        'accountId' in featuresOrOptions ||
        'cookies' in featuresOrOptions ||
        'requiresAuth' in featuresOrOptions ||
        'headers' in featuresOrOptions ||
        'method' in featuresOrOptions ||
        'session' in featuresOrOptions
      ) {
        actualOptions = featuresOrOptions;
      } else {
        actualFeatures = featuresOrOptions;
        actualFieldToggles = fieldToggles || DEFAULT_FIELD_TOGGLES;
        actualOptions = options || {};
      }
    } else {
      actualOptions = options || {};
    }

    const isAuth = actualOptions.requiresAuth !== undefined ? actualOptions.requiresAuth : this.requiresAuth;
    const accountId = isAuth ? (actualOptions.accountId || null) : null;
    // Guest requests must use GET with query-string parameters; POST is rejected
    // by X/Twitter as of 2026-09. Auth/mutation requests still use POST.
    const method = actualOptions.method || (isAuth ? 'POST' : 'GET');

    const transactionId = isAuth ? await this.#signTransactionId({ url: `${this.baseUrl}/i/api/graphql/${queryId}/${operationName}`, method }) : null;

    const headers = /** @type {Record<string, string>} */ ({ 'content-type': 'application/x-www-form-urlencoded', ...(actualOptions.headers || {}) });
    if (transactionId) headers['x-client-transaction-id'] = transactionId;

    const relayAwareVariables = { ...variables };
    if (!isAuth && relayAwareVariables.__relay_internal__pv__appviewerisloggedinprovider === undefined) {
      relayAwareVariables.__relay_internal__pv__appviewerisloggedinprovider = false;
    }

    let url = `${this.baseUrl}/i/api/graphql/${queryId}/${operationName}`;
    let body = undefined;

    if (method === 'POST') {
      body = this.#buildGraphQLBody(relayAwareVariables, actualFeatures, actualFieldToggles).toString();
    } else {
      const params = new URLSearchParams();
      params.set('variables', JSON.stringify(relayAwareVariables));
      params.set('features', JSON.stringify(actualFeatures || DEFAULT_FEATURES));
      if (actualFieldToggles) {
        params.set('fieldToggles', JSON.stringify(actualFieldToggles));
      }
      url = `${url}?${params.toString()}`;
    }

    const resp = /** @type {any} */ (await this.request(method, url, {
      ...actualOptions,
      accountId: accountId || undefined,
      requiresAuth: isAuth,
      headers,
      body,
    }).catch(async (err) => {
      // Stale GraphQL query IDs return 404 — re-resolve from live bundles once.
      const is404 = err?.statusCode === 404 || err?.status === 404;
      if (!is404 || !/\/i\/api\/graphql\//.test(url)) throw err;
      const opMatch = url.match(/\/i\/api\/graphql\/[A-Za-z0-9_-]+\/([A-Za-z0-9_]+)/);
      if (!opMatch) throw err;
      const { resolveQueryId } = await import('../../twitter/http/query-id-resolver.js');
      const freshId = await resolveQueryId(opMatch[1], queryId);
      if (!freshId || freshId === queryId) throw err;
      const retryUrl = url.replace(/\/i\/api\/graphql\/[A-Za-z0-9_-]+\//, `/i/api/graphql/${freshId}/`);
      return this.request(method, retryUrl, {
        ...actualOptions,
        accountId: accountId || undefined,
        requiresAuth: isAuth,
        headers,
        body,
      });
    }));

    // Unwrap base-client envelope if present
    const payload = resp?.data ?? resp;
    return payload?.data ?? payload;
  }

  /**
   * Convenience wrapper for SearchTimeline.
   * @param {string} operationName
   * @param {Record<string, unknown>} variables
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async requestSearchTimeline(operationName, variables, options = {}) {
    const endpoint = GRAPHQL.SearchTimeline;
    return this.requestGraphQl(endpoint.queryId, operationName, variables, options);
  }

  /**
   * Send a Twitter REST API request.
   * @param {string} path
   * @param {import('../../../core/base-client.js').RequestOptions & { method?: string, query?: Record<string, unknown> }} [options]
   * @returns {Promise<any>}
   */
  async requestRest(path, options = {}) {
    const isAuth = options.requiresAuth !== undefined ? options.requiresAuth : this.requiresAuth;
    const accountId = isAuth ? (options.accountId || null) : null;

    const needsApiPrefix = !isLocalUrl(this.baseUrl) && /^\/(1\.1|2)\//.test(path);
    const fullPath = needsApiPrefix ? `/i/api${path}` : path;
    const url = new URL(`${this.baseUrl}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`, this.baseUrl);
    if (options.query && typeof options.query === 'object') {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      ...(options.headers || {}),
    };

    let body = options.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && typeof body.pipe !== 'function') {
      if (headers['content-type'] === 'application/json' || headers['Content-Type'] === 'application/json') {
        body = JSON.stringify(body);
      } else {
        body = new URLSearchParams(body).toString();
      }
    }

    const resp = /** @type {any} */ (await this.request(options.method || 'GET', url.toString(), {
      ...options,
      headers,
      body,
      accountId: accountId || undefined,
      requiresAuth: isAuth,
    }));

    const payload = resp?.data ?? resp;
    return payload?.data ?? payload;
  }

  /**
   * Convenience wrapper for trends/place.
   * @param {number} woeid
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async requestTrendsPlace(woeid, options = {}) {
    return this.requestRest(REST.trendsPlace, { ...options, query: { id: String(woeid) } });
  }

  /**
   * Convenience wrapper for UserMedia timeline.
   * @param {string} userId
   * @param {Object} [options]
   * @param {number} [options.count]
   * @param {string|null} [options.cursor]
   * @returns {Promise<any>}
   */
  async requestUserMedia(userId, options = {}) {
    const count = options.count ?? 20;
    const variables = {
      userId,
      count,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
      ...(options.cursor ? { cursor: options.cursor } : {}),
    };
    return this.requestGraphQl(GRAPHQL.UserMedia.queryId, 'UserMedia', variables, options);
  }

  /**
   * Convenience wrapper for single tweet lookup.
   * @param {string} tweetId
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async requestTweetByRestId(tweetId, options = {}) {
    const variables = {
      tweetId,
      includePromotedContent: false,
      withCommunity: false,
      withVoice: false,
    };
    return this.requestGraphQl(GRAPHQL.TweetResultByRestId.queryId, 'TweetResultByRestId', variables, options);
  }

  /**
   * Stream download a raw URL (e.g. video variant) through the resilient
   * proxy/account/retry pipeline. Returns a Node.js-style response with a
   * Web ReadableStream body. Caller is responsible for consuming the stream.
   *
   * @param {string} url
   * @param {Object} [options]
   * @param {string} [options.accountId]
   * @param {boolean} [options.requiresAuth]
   * @param {number} [options.timeout]
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<{ status: number, headers: Record<string, string>, body: ReadableStream | null }>}
   */
  async requestStream(url, options = {}) {
    const resp = /** @type {any} */ (await this.request('GET', url, {
      ...options,
      raw: true,
      skipResponseValidation: true,
      // Strip Twitter-specific auth headers for CDN requests; keep cookies if any.
      headers: { accept: '*/*', ...(options.headers || {}) },
    }));

    if (resp?.status < 200 || resp?.status >= 400) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `Download failed: HTTP ${resp?.status} for ${url}`,
        statusCode: resp?.status || 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
      });
    }

    let body = resp.body || null;
    if (body && !(typeof body.getReader === 'function')) {
      // got-scraping and similar transports may return a Buffer/string.
      // Wrap it in a Web ReadableStream so callers always use Readable.fromWeb.
      const chunk = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      body = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });
    }

    return {
      status: resp.status,
      headers: resp.headers || {},
      body,
    };
  }

  /**
   * Cleanup resources.
   * @returns {Promise<void>}
   */
  async close() {
    this.guestToken = null;
  }
}
