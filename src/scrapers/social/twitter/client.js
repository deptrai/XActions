// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterClient — High-throughput HTTP client for Twitter/X Web GraphQL & REST API.
 * Extends AbstractApiClient with tiered signing, proxy rotation, resilient 429/403 backoff,
 * and GraphQL URL construction.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TwitterPlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';
import {
  BEARER_TOKEN,
  DEFAULT_FEATURES,
} from '../../twitter/http/endpoints.js';

/**
 * Format a raw cookie object or string into a Cookie header value.
 * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
 * @returns {string}
 */
export function buildCookieHeader(cookies) {
  if (typeof cookies === 'string') return cookies;
  if (Array.isArray(cookies)) {
    return cookies
      .filter((c) => c && typeof c === 'object' && c.name && c.value !== undefined)
      .map((c) => `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`)
      .join('; ');
  }
  if (cookies && typeof cookies === 'object') {
    return Object.entries(cookies)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === undefined || v === null ? '' : String(v))}`)
      .join('; ');
  }
  return '';
}

/**
 * Extract ct0 (CSRF token) and auth_token from cookies.
 * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
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
  requiresAuth = true;

  /** @type {string} */
  baseUrl = 'https://x.com';

  /** @type {string} */
  bearerToken = decodeURIComponent(BEARER_TOKEN);

  /**
   * @param {Record<string, any>} [options]
   */
  constructor(options = {}) {
    super(/** @type {any} */ ({
      ...options,
      platform: 'twitter',
      responseValidator: options.responseValidator || new TwitterPlatformResponseValidator(),
    }));

    if (options.baseUrl) {
      this.baseUrl = String(options.baseUrl).replace(/\/+$/, '');
    }
    if (options.bearerToken) {
      this.bearerToken = String(options.bearerToken);
    }
    if (options.cookies) {
      this.cookies = typeof options.cookies === 'string'
        ? { cookie: options.cookies }
        : options.cookies;
    }
  }

  /**
   * Initialize session if needed.
   * @param {any} [session]
   * @returns {Promise<void>}
   */
  async init(session) {
    if (session?.cookies) {
      this.cookies = typeof session.cookies === 'string'
        ? { cookie: session.cookies }
        : session.cookies;
    }
  }

  /**
   * Send a Twitter GraphQL request.
   *
   * @param {string} queryId
   * @param {string} operationName
   * @param {Record<string, unknown>} [variables={}]
   * @param {Record<string, boolean>} [features=DEFAULT_FEATURES]
   * @param {Record<string, unknown>} [fieldToggles]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async requestGraphQl(
    queryId,
    operationName,
    variables = {},
    features = DEFAULT_FEATURES,
    fieldToggles,
    options = {}
  ) {
    const params = new URLSearchParams();
    params.set('variables', JSON.stringify(variables));
    params.set('features', JSON.stringify(features));
    if (fieldToggles) {
      params.set('fieldToggles', JSON.stringify(fieldToggles));
    }

    const endpointPath = `/i/api/graphql/${queryId}/${operationName}?${params.toString()}`;
    const url = `${this.baseUrl}${endpointPath}`;

    const rawCookies = options.cookies || options.session?.cookies || this.cookies;
    const cookieHeader = buildCookieHeader(rawCookies);
    const { ct0 } = parseTwitterCookies(cookieHeader);

    const isNamedAccount = Boolean(options.accountId && options.accountId !== 'guest' && options.accountId !== 'default');
    const requiresAuth = options.requiresAuth !== undefined
      ? Boolean(options.requiresAuth)
      : (Boolean(cookieHeader) || this.requiresAuth);

    /** @type {Record<string, string>} */
    const headers = {
      authorization: `Bearer ${this.bearerToken}`,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      ...(options.headers || {}),
    };

    if (cookieHeader && (requiresAuth || isNamedAccount || ct0)) {
      headers.cookie = cookieHeader;
      if (ct0) {
        headers['x-csrf-token'] = ct0;
      }
      headers['x-twitter-auth-type'] = 'OAuth2Session';
    } else if (options.guestToken) {
      headers['x-guest-token'] = options.guestToken;
    }

    // Tiered signing: obtain x-client-transaction-id if tokenRing or signerPool is configured
    if (this.tokenRing && typeof this.tokenRing.next === 'function') {
      const signToken = this.tokenRing.next();
      if (signToken) {
        headers['x-client-transaction-id'] = String(signToken);
      }
    }

    const requestOptions = {
      method: 'GET',
      headers,
      accountId: options.accountId,
      requiresResidential: options.requiresResidential,
      requiresAuth,
      timeout: options.timeout || this.timeout,
    };

    const response = /** @type {any} */ (await this.request('GET', url, requestOptions));
    let data = response?.data !== undefined ? response.data : response;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // keep string
      }
    }
    return data;
  }
}
