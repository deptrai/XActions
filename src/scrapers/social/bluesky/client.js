// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BlueskyClient — AT Protocol / XRPC HTTP client for Bluesky.
 * Extends AbstractApiClient with XRPC request pipeline, optional session auth,
 * handle resolution, and integration with BlueskyPlatformResponseValidator.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { BlueskyPlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const DEFAULT_BLUESKY_SERVICE = 'https://public.api.bsky.app';

/**
 * Endpoints whose response schemas are utility-oriented or non-actor/non-feed
 * (e.g. { did: string } or { topics: [...] }), which are valid AT Protocol responses
 * but do not match BlueskyPlatformResponseValidator's strict actor/feed schema checks.
 */
const NON_STANDARD_XRPC_ENDPOINTS = new Set([
  'com.atproto.identity.resolveHandle',
  'com.atproto.server.createSession',
  'com.atproto.server.refreshSession',
  'app.bsky.unspecced.getTrendingTopics',
]);

/**
 * Extract and validate a clean Bluesky handle or DID.
 * Supports bsky URLs (any subdomain/path), @ prefixes, and raw handles or DIDs.
 * @param {string} input
 * @returns {string}
 */
export function resolveActor(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid handle: must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'bluesky',
    });
  }
  let clean = input.trim();

  // If it is a full URL, extract the handle from /profile/<handle>
  if (/^https?:\/\//i.test(clean)) {
    try {
      const parsed = new URL(clean);
      const profileMatch = parsed.pathname.match(/\/profile\/([^/?#]+)/i);
      if (profileMatch) {
        clean = decodeURIComponent(profileMatch[1]);
      }
    } catch {}
  }

  clean = clean.replace(/^@/, '');
  if (clean.startsWith('did:')) return clean;

  if (!/^[a-zA-Z0-9_.:-]+$/.test(clean)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Invalid Bluesky handle format: "${input}"`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'bluesky',
    });
  }
  return clean;
}

export class BlueskyClient extends AbstractApiClient {
  /** @type {string} */
  name = 'bluesky';

  /** @type {string} */
  platform = 'bluesky';

  /** @type {string} */
  baseUrl;

  /** @type {string | null} */
  identifier = null;

  /** @type {string | null} */
  password = null;

  /** @type {string | null} */
  accessJwt = null;

  /** @type {string | null} */
  refreshJwt = null;

  /** @type {string | null} */
  did = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base XRPC API endpoint (default: https://public.api.bsky.app)
   * @param {string} [options.service] - Alias for baseUrl
   * @param {string} [options.identifier] - Handle or email for auth
   * @param {string} [options.password] - App password for auth
   * @param {string} [options.accessJwt] - Existing JWT access token
   * @param {string} [options.refreshJwt] - Existing JWT refresh token
   * @param {import('./validator.js').BlueskyPlatformResponseValidator} [options.responseValidator]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new BlueskyPlatformResponseValidator();

    super({
      ...options,
      platform: 'bluesky',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    const rawService = options.baseUrl || options.service || DEFAULT_BLUESKY_SERVICE;
    this.baseUrl = String(rawService).replace(/\/+$/, '');
    this.identifier = options.identifier || null;
    this.password = options.password || null;
    this.accessJwt = options.accessJwt || null;
    this.refreshJwt = options.refreshJwt || null;
  }

  /**
   * AT Protocol does not use client-side payload signing (tokens and sessions are bearer headers).
   * Conforms to AbstractApiClient sign contract.
   * @param {Record<string, any>} [payload]
   * @returns {Promise<Record<string, any>>}
   */
  async sign(payload = {}) {
    return {};
  }

  /**
   * Initialize session if credentials exist.
   * @param {Object} [session={}]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    if (session.identifier && session.password) {
      await this.login({
        identifier: session.identifier,
        password: session.password,
      });
    } else if (session.accessJwt) {
      this.accessJwt = session.accessJwt;
      this.refreshJwt = session.refreshJwt || null;
      this.did = session.did || null;
    }
  }

  /**
   * Authenticate via com.atproto.server.createSession.
   * Stores accessJwt and refreshJwt for subsequent XRPC calls.
   *
   * @param {Object} credentials
   * @param {string} credentials.identifier - Handle or email
   * @param {string} credentials.password - App password
   * @returns {Promise<string>} accessJwt
   */
  async login({ identifier, password }) {
    if (!identifier || !password) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Bluesky login requires identifier and password',
        statusCode: 400,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'bluesky',
      });
    }

    this.identifier = identifier;
    this.password = password;

    const sessionData = await this.xrpc(
      'com.atproto.server.createSession',
      {},
      {
        method: 'POST',
        json: { identifier, password },
        requiresAuth: false,
        skipResponseValidation: true,
      }
    );

    if (!sessionData?.accessJwt) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: 'Failed to create Bluesky session: invalid credentials or response',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'bluesky',
      });
    }

    this.accessJwt = sessionData.accessJwt;
    this.refreshJwt = sessionData.refreshJwt || null;
    this.did = sessionData.did || null;

    return this.accessJwt;
  }

  /**
   * Refresh the active session using com.atproto.server.refreshSession.
   * @returns {Promise<string | null>}
   */
  async refreshSession() {
    if (!this.refreshJwt) return null;

    try {
      const refreshed = await this.xrpc(
        'com.atproto.server.refreshSession',
        {},
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.refreshJwt}`,
          },
          requiresAuth: false,
          skipResponseValidation: true,
        }
      );

      if (refreshed?.accessJwt) {
        this.accessJwt = refreshed.accessJwt;
        this.refreshJwt = refreshed.refreshJwt || this.refreshJwt;
        return this.accessJwt;
      }
    } catch {
      // If refresh fails, credentials will trigger a re-login on demand
    }

    return null;
  }

  /**
   * Resolve a Bluesky handle to a DID.
   * @param {string} handle
   * @returns {Promise<string>}
   */
  async resolveHandle(handle) {
    const clean = resolveActor(handle);
    if (clean.startsWith('did:')) return clean;

    const data = await this.xrpc('com.atproto.identity.resolveHandle', { handle: clean });
    const resolvedDid = /** @type {Record<string, any>} */ (data)?.did;
    if (typeof resolvedDid !== 'string' || !resolvedDid) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Failed to resolve handle: ${handle}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'bluesky',
      });
    }
    return resolvedDid;
  }

  /**
   * Execute an XRPC call through the resilient AbstractApiClient request pipeline.
   *
   * @param {string} nsid - AT Protocol method name (e.g. app.bsky.actor.getProfile)
   * @param {Record<string, string | number | boolean | undefined | null>} [params={}]
   * @param {Object} [options={}]
   * @param {'GET' | 'POST'} [options.method='GET']
   * @param {Record<string, any>} [options.headers]
   * @param {any} [options.body]
   * @param {any} [options.json]
   * @param {boolean} [options.requiresAuth]
   * @param {boolean} [options.skipResponseValidation]
   * @returns {Promise<Record<string, any>>}
   */
  async xrpc(nsid, params = {}, options = {}) {
    if (typeof nsid !== 'string' || !nsid.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid XRPC NSID: must be non-empty string',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'bluesky',
      });
    }

    const method = (options.method || 'GET').toUpperCase();
    const queryParams = new URLSearchParams();

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        queryParams.set(k, String(v));
      }
    }

    const qs = queryParams.toString();
    const url = `${this.baseUrl}/xrpc/${nsid}${qs ? '?' + qs : ''}`;

    const headers = { ...(options.headers || {}) };
    const authJwt = this.accessJwt;
    if (authJwt && !headers['authorization'] && !headers['Authorization']) {
      headers['authorization'] = `Bearer ${authJwt}`;
    }

    const skipValidation =
      options.skipResponseValidation !== undefined
        ? options.skipResponseValidation
        : NON_STANDARD_XRPC_ENDPOINTS.has(nsid) || nsid.startsWith('app.bsky.unspecced.');

    const reqOpts = {
      ...options,
      headers,
      skipResponseValidation: skipValidation,
    };

    if (method === 'POST' && (options.json !== undefined || options.body !== undefined)) {
      if (options.json !== undefined) reqOpts.json = options.json;
      if (options.body !== undefined) reqOpts.body = options.body;
    }

    const res = /** @type {Record<string, any>} */ (await this.request(method, url, reqOpts));
    return res?.data !== undefined ? res.data : res;
  }
}
