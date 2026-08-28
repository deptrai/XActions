// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsClient — HTTP-based GraphQL client for Meta Threads.
 * Extends AbstractApiClient with got-scraping, dynamic LSD token extraction,
 * and structured error handling.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { ThreadsPlatformResponseValidator } from './validator.js';

const THREADS_DEFAULT_APP_ID = '238260118697367';
const THREADS_DEFAULT_ASBD_ID = '359341';
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class ThreadsClient extends AbstractApiClient {
  /** @type {string} */
  name = 'threads';

  /** @type {string} */
  platform = 'threads';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {string} */
  baseUrl = 'https://www.threads.net';

  /** @type {string} */
  graphqlEndpoint;

  /** @type {Map<string, { tokens: Record<string, string>, expiresAt: number }>} */
  #tokenCache = new Map();

  /** @type {Map<string, Promise<Record<string, string>>>} */
  #pendingTokenFetches = new Map();

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {string} [deps.graphqlEndpoint]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {number} [deps.timeout]
   */
  constructor(deps = {}) {
    super(/** @type {any} */ ({
      ...deps,
      platform: 'threads',
      client: (/** @type {any} */ (deps)).client || 'got',
      responseValidator: (/** @type {any} */ (deps)).responseValidator || new ThreadsPlatformResponseValidator(),
    }));

    if (deps.baseUrl) {
      this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    }
    this.graphqlEndpoint = deps.graphqlEndpoint || `${this.baseUrl}/api/graphql`;
    this.timeout = deps.timeout ?? 120000;
  }

  /**
   * Generate cache key for LSD tokens.
   * @param {string} accountId
   * @param {string} proxyKey
   * @returns {string}
   */
  #cacheKey(accountId, proxyKey) {
    return `${accountId}::${proxyKey}`;
  }

  /**
   * Extract LSD / CSRF security tokens from Threads landing page HTML with in-flight deduplication.
   * @param {string} [accountId='threads-guest']
   * @param {string} [proxyKey='default']
   * @returns {Promise<Record<string, string>>}
   */
  async ensureLsd(accountId = 'threads-guest', proxyKey = 'default') {
    const key = this.#cacheKey(accountId, proxyKey);
    const cached = this.#tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tokens;
    }

    if (this.#pendingTokenFetches.has(key)) {
      return /** @type {Promise<Record<string, string>>} */ (this.#pendingTokenFetches.get(key));
    }

    const fetchPromise = this.#fetchTokens(accountId, proxyKey)
      .then((tokens) => {
        this.#tokenCache.set(key, {
          tokens,
          expiresAt: Date.now() + TOKEN_TTL_MS,
        });
        return tokens;
      })
      .finally(() => {
        this.#pendingTokenFetches.delete(key);
      });

    this.#pendingTokenFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal worker to fetch tokens from home/profile page HTML.
   * @param {string} accountId
   * @param {string} [proxyKey='default']
   * @returns {Promise<Record<string, string>>}
   */
  async #fetchTokens(accountId, proxyKey = 'default') {
    const resp = /** @type {any} */ (await this.request('GET', `${this.baseUrl}/`, {
      accountId,
      proxyKey,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    const lsdMatch =
      html.match(/name="lsd"\s+value="([^"]+)"/) ||
      html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
      html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
      html.match(/window\.__LSD__\s*=\s*"([^"]+)"/);
    const lsd = lsdMatch ? lsdMatch[1] : '';

    const dtsgMatch =
      html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
      html.match(/d\.token\s*=\s*"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    if (!lsd) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Failed to extract Threads LSD token from landing page',
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
        platform: 'threads',
      });
    }

    return {
      lsd,
      csrftoken: '',
      dtsg,
    };
  }

  /**
   * Build x-www-form-urlencoded body for GraphQL request.
   * @param {string} docId
   * @param {Record<string, unknown>} variables
   * @param {Record<string, string>} tokens
   * @returns {string}
   */
  buildGraphQlBody(docId, variables, tokens) {
    const params = new URLSearchParams();
    params.set('doc_id', docId);
    params.set('lsd', tokens.lsd || '');
    params.set('variables', JSON.stringify(variables || {}));
    return params.toString();
  }

  /**
   * Dispatch a GraphQL request against Threads GraphQL endpoint.
   * @param {string} docId
   * @param {Record<string, unknown>} variables
   * @param {Object} [options]
   * @param {string} [options.accountId='threads-guest']
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<any>}
   */
  async requestGraphQl(docId, variables, options = {}) {
    if (!docId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing doc_id for Threads GraphQL request',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const accountId = options.accountId || 'threads-guest';
    const tokens = await this.ensureLsd(accountId);
    const body = this.buildGraphQlBody(docId, variables, tokens);

    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-ig-app-id': THREADS_DEFAULT_APP_ID,
      'x-asbd-id': THREADS_DEFAULT_ASBD_ID,
      'x-fb-lsd': tokens.lsd || '',
      ...(options.headers || {}),
    };

    const resp = /** @type {any} */ (await this.request('POST', this.graphqlEndpoint, {
      accountId,
      headers,
      body,
    }));

    let parsedData = resp?.data;
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch {}
    }

    if (!parsedData && typeof resp === 'object') {
      parsedData = resp;
    }

    if (parsedData?.errors || parsedData?.data?.errors) {
      const errList = parsedData?.errors || parsedData?.data?.errors;
      const firstErr = Array.isArray(errList) && errList.length > 0 ? errList[0] : null;
      const errMsg = firstErr?.message || 'GraphQL Error';

      if (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('does not exist')) {
        throw new PlatformError({
          code: 'XACT_4041',
          type: ErrorTypes.INTERNAL,
          message: `Threads entity not found: ${errMsg}`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }

      if (errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('too many requests')) {
        throw new PlatformError({
          code: 'XACT_4290',
          type: ErrorTypes.RATE_LIMIT,
          message: `Threads rate limit: ${errMsg}`,
          statusCode: 429,
          suggestedAction: SuggestedActions.REDUCE_RATE,
          platform: 'threads',
        });
      }
    }

    return parsedData;
  }

  /**
   * Clear cached tokens.
   */
  clearTokenCache() {
    this.#tokenCache.clear();
    this.#pendingTokenFetches.clear();
  }
}
