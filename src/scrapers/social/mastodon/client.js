// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MastodonClient — REST API HTTP client for Mastodon (Federated instances).
 * Extends AbstractApiClient with proxy rotation, adaptive rate governor tracking,
 * exponential backoff, and MastodonPlatformResponseValidator integration.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { MastodonPlatformResponseValidator } from './validator.js';
import {
  DEFAULT_MASTODON_INSTANCE,
  normalizeInstanceUrl,
  resolveMastodonTarget,
  parseLinkHeader,
} from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export class MastodonClient extends AbstractApiClient {
  /** @type {string} */
  name = 'mastodon';

  /** @type {string} */
  platform = 'mastodon';

  /** @type {string} */
  baseUrl;

  /** @type {string | null} */
  accessToken = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base Mastodon instance URL (default: https://mastodon.social)
   * @param {string} [options.service] - Alias for baseUrl
   * @param {string} [options.instance] - Alias for baseUrl
   * @param {string} [options.accessToken] - Bearer token for authenticated calls
   * @param {import('./validator.js').MastodonPlatformResponseValidator} [options.responseValidator]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {import('../../../core/session-manager.js').SessionManager} [options.sessionManager]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new MastodonPlatformResponseValidator();

    super({
      ...options,
      platform: 'mastodon',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    const rawService = options.baseUrl || options.service || options.instance || DEFAULT_MASTODON_INSTANCE;
    this.baseUrl = normalizeInstanceUrl(rawService);
    this.accessToken = options.accessToken || null;
  }

  /**
   * Mastodon public REST API does not require client-side payload signing.
   * Conforms to AbstractApiClient sign contract.
   * @param {Record<string, any>} [payload]
   * @returns {Promise<Record<string, any>>}
   */
  async sign(payload = {}) {
    return {};
  }

  /**
   * Initialize session or tokens if passed.
   * @param {Object} [session={}]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    if (session.accessToken) {
      this.accessToken = String(session.accessToken).trim();
    }
  }

  /**
   * Helper to build full URL with query parameters.
   * @param {string} path - Endpoint path (e.g. /api/v1/accounts/lookup)
   * @param {Record<string, any>} [params={}]
   * @param {string} [instanceOverride]
   * @returns {string}
   */
  buildUrl(path, params = {}, instanceOverride) {
    const instance = instanceOverride ? normalizeInstanceUrl(instanceOverride) : this.baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }

    const qs = query.toString();
    return `${instance}${cleanPath}${qs ? '?' + qs : ''}`;
  }

  /**
   * Send a GET request through the AbstractApiClient pipeline.
   * @param {string} url
   * @param {Object} [options={}]
   * @returns {Promise<{ data: any, headers: Record<string, string>, linkMaxId: string | null }>}
   */
  async get(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = options.accessToken || this.accessToken;
    if (token && !headers['authorization'] && !headers['Authorization']) {
      headers['authorization'] = `Bearer ${token}`;
    }

    const reqOpts = {
      ...options,
      headers,
      raw: false,
    };

    const res = /** @type {Record<string, any>} */ (await this.request('GET', url, reqOpts));
    const data = res?.data !== undefined ? res.data : res;
    const resHeaders = res?.headers || {};
    const linkHeader = resHeaders['link'] || resHeaders['Link'] || null;
    const linkMaxId = parseLinkHeader(linkHeader);

    return {
      data,
      headers: resHeaders,
      linkMaxId,
    };
  }

  /**
   * Look up an account by username or WebFinger acct.
   * Endpoints:
   * 1. GET /api/v1/accounts/lookup?acct=:acct (Mastodon 3.4+)
   * 2. Fallback: GET /api/v1/accounts/search?q=:acct&resolve=true
   *
   * @param {string} usernameOrAcct
   * @param {string} [instance]
   * @returns {Promise<Record<string, any>>}
   */
  async lookupAccount(usernameOrAcct, instance) {
    const target = resolveMastodonTarget(usernameOrAcct, instance || this.baseUrl);
    const url = this.buildUrl('/api/v1/accounts/lookup', { acct: target.username }, target.instance);

    try {
      const res = await this.get(url);
      if (res.data && typeof res.data === 'object' && res.data.id) {
        return res.data;
      }
    } catch (err) {
      // If 404 or unsupported endpoint, try search fallback
      if (err instanceof PlatformError && err.statusCode !== 404) {
        throw err;
      }
    }

    // Fallback: search accounts
    const searchUrl = this.buildUrl(
      '/api/v1/accounts/search',
      { q: target.username, limit: 5, resolve: true },
      target.instance
    );
    const searchRes = await this.get(searchUrl);
    const accounts = Array.isArray(searchRes.data) ? searchRes.data : [];

    const matched = accounts.find((a) => {
      const matchAcct = String(a.acct || '').toLowerCase();
      const matchUser = String(a.username || '').toLowerCase();
      const targetUser = target.username.toLowerCase();
      return matchAcct === targetUser || matchUser === targetUser || matchAcct.startsWith(`${targetUser}@`);
    });

    if (matched) return matched;

    throw new PlatformError({
      type: ErrorTypes.NOT_FOUND,
      code: 'XACT_4001',
      message: `User not found on ${target.instance}: ${usernameOrAcct}`,
      statusCode: 404,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'mastodon',
    });
  }

  /**
   * Get account detail by numerical/string ID.
   * Endpoint: GET /api/v1/accounts/:id
   * @param {string | number} accountId
   * @param {string} [instance]
   * @returns {Promise<Record<string, any>>}
   */
  async getAccount(accountId, instance) {
    const cleanId = String(accountId || '').trim();
    if (!cleanId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing account ID',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    const url = this.buildUrl(`/api/v1/accounts/${cleanId}`, {}, instance);
    const res = await this.get(url);
    return res.data;
  }

  /**
   * Get statuses (posts) for an account.
   * Endpoint: GET /api/v1/accounts/:id/statuses
   * @param {string | number} accountId
   * @param {Object} [options={}]
   * @param {number} [options.limit=20]
   * @param {string} [options.max_id]
   * @param {string} [options.since_id]
   * @param {string} [options.min_id]
   * @param {boolean} [options.exclude_replies=false]
   * @param {boolean} [options.exclude_reblogs=false]
   * @param {string} [options.instance]
   * @returns {Promise<{ statuses: Record<string, any>[], nextMaxId: string | null }>}
   */
  async getAccountStatuses(accountId, options = {}) {
    const cleanId = String(accountId || '').trim();
    const limit = Math.min(80, Math.max(1, Number(options.limit || 20)));

    const params = {
      limit,
      max_id: options.max_id || undefined,
      since_id: options.since_id || undefined,
      min_id: options.min_id || undefined,
      exclude_replies: options.exclude_replies ? true : undefined,
      exclude_reblogs: options.exclude_reblogs ? true : undefined,
    };

    const url = this.buildUrl(`/api/v1/accounts/${cleanId}/statuses`, params, options.instance);
    const res = await this.get(url);
    const statuses = Array.isArray(res.data) ? res.data : [];
    const lastId = statuses.length > 0 ? String(statuses[statuses.length - 1]?.id || '') : null;

    return {
      statuses,
      nextMaxId: res.linkMaxId || lastId,
    };
  }

  /**
   * Get followers for an account.
   * Endpoint: GET /api/v1/accounts/:id/followers
   * @param {string | number} accountId
   * @param {Object} [options={}]
   * @param {number} [options.limit=40]
   * @param {string} [options.max_id]
   * @param {string} [options.since_id]
   * @param {string} [options.instance]
   * @returns {Promise<{ accounts: Record<string, any>[], nextMaxId: string | null }>}
   */
  async getAccountFollowers(accountId, options = {}) {
    const cleanId = String(accountId || '').trim();
    const limit = Math.min(80, Math.max(1, Number(options.limit || 40)));

    const params = {
      limit,
      max_id: options.max_id || undefined,
      since_id: options.since_id || undefined,
    };

    const url = this.buildUrl(`/api/v1/accounts/${cleanId}/followers`, params, options.instance);
    const res = await this.get(url);
    const accounts = Array.isArray(res.data) ? res.data : [];
    const lastId = accounts.length > 0 ? String(accounts[accounts.length - 1]?.id || '') : null;

    return {
      accounts,
      nextMaxId: res.linkMaxId || lastId,
    };
  }

  /**
   * Get accounts followed by an account.
   * Endpoint: GET /api/v1/accounts/:id/following
   * @param {string | number} accountId
   * @param {Object} [options={}]
   * @param {number} [options.limit=40]
   * @param {string} [options.max_id]
   * @param {string} [options.since_id]
   * @param {string} [options.instance]
   * @returns {Promise<{ accounts: Record<string, any>[], nextMaxId: string | null }>}
   */
  async getAccountFollowing(accountId, options = {}) {
    const cleanId = String(accountId || '').trim();
    const limit = Math.min(80, Math.max(1, Number(options.limit || 40)));

    const params = {
      limit,
      max_id: options.max_id || undefined,
      since_id: options.since_id || undefined,
    };

    const url = this.buildUrl(`/api/v1/accounts/${cleanId}/following`, params, options.instance);
    const res = await this.get(url);
    const accounts = Array.isArray(res.data) ? res.data : [];
    const lastId = accounts.length > 0 ? String(accounts[accounts.length - 1]?.id || '') : null;

    return {
      accounts,
      nextMaxId: res.linkMaxId || lastId,
    };
  }

  /**
   * Search content on Mastodon.
   * Endpoint: GET /api/v2/search
   * @param {Object} options
   * @param {string} options.query - Search query
   * @param {'accounts' | 'statuses' | 'hashtags'} [options.type] - Search type filter
   * @param {number} [options.limit=20]
   * @param {string} [options.max_id]
   * @param {boolean} [options.resolve=true]
   * @param {string} [options.instance]
   * @returns {Promise<{ accounts: Record<string, any>[], statuses: Record<string, any>[], hashtags: Record<string, any>[] }>}
   */
  async search(options = {}) {
    const query = options.query || options.q;
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing search query',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    const limit = Math.min(40, Math.max(1, Number(options.limit || 20)));
    const params = {
      q: query.trim(),
      type: options.type || undefined,
      limit,
      max_id: options.max_id || undefined,
      resolve: options.resolve !== false ? true : undefined,
    };

    const url = this.buildUrl('/api/v2/search', params, options.instance);
    const res = await this.get(url);
    const data = res.data && typeof res.data === 'object' ? res.data : {};

    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      statuses: Array.isArray(data.statuses) ? data.statuses : [],
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    };
  }

  /**
   * Get posts tagged with a specific hashtag.
   * Endpoint: GET /api/v1/timelines/tag/:tag
   * @param {string} tag - Hashtag name without '#'
   * @param {Object} [options={}]
   * @param {number} [options.limit=20]
   * @param {string} [options.max_id]
   * @param {string} [options.instance]
   * @returns {Promise<{ statuses: Record<string, any>[], nextMaxId: string | null }>}
   */
  async getHashtagTimeline(tag, options = {}) {
    const cleanTag = String(tag || '').replace(/^#/, '').trim();
    if (!cleanTag) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing hashtag argument',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    const limit = Math.min(40, Math.max(1, Number(options.limit || 20)));
    const params = {
      limit,
      max_id: options.max_id || undefined,
    };

    const url = this.buildUrl(`/api/v1/timelines/tag/${encodeURIComponent(cleanTag)}`, params, options.instance);
    const res = await this.get(url);
    const statuses = Array.isArray(res.data) ? res.data : [];
    const lastId = statuses.length > 0 ? String(statuses[statuses.length - 1]?.id || '') : null;

    return {
      statuses,
      nextMaxId: res.linkMaxId || lastId,
    };
  }

  /**
   * Get trending statuses.
   * Endpoint: GET /api/v1/trends/statuses
   * @param {Object} [options={}]
   * @param {number} [options.limit=20]
   * @param {string} [options.instance]
   * @returns {Promise<Record<string, any>[]>}
   */
  async getTrendingStatuses(options = {}) {
    const limit = Math.min(40, Math.max(1, Number(options.limit || 20)));
    const params = { limit };

    const url = this.buildUrl('/api/v1/trends/statuses', params, options.instance);

    try {
      const res = await this.get(url);
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      // Instances that have disabled public trending return 404 or 403.
      // Fallback graceful to empty array per spec.
      if (err instanceof PlatformError && (err.statusCode === 404 || err.statusCode === 403)) {
        return [];
      }
      throw err;
    }
  }
}
