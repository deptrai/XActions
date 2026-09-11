// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MediumClient — RSS-first HTTP client for Medium public content.
 * Extends AbstractApiClient with RSS, `?format=json`, optional GraphQL,
 * and Puppeteer stealth fallback.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { MediumPlatformResponseValidator } from './validator.js';
import {
  asRecord,
  extractPostId,
  stripTrackingParams,
  namespacedMediumId,
} from './normalizer.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';
import { XMLParser } from 'fast-xml-parser';

export const DEFAULT_MEDIUM_BASE_URL = 'https://medium.com';
export const DEFAULT_MEDIUM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const XSSI_PREFIX = '])}while(1);</x>';

/**
 * @typedef {'rss' | 'http' | 'graphql' | 'puppeteer'} MediumTransport
 */

/**
 * @param {Object} [options={}]
 * @returns {MediumClient}
 */
export function createMediumClient(options = {}) {
  return new MediumClient(options);
}

export class MediumClient extends AbstractApiClient {
  /** @type {string} */
  name = 'medium';

  /** @type {string} */
  platform = 'medium';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresResidential = true;

  /** @type {'undici' | 'got'} */
  client = 'undici';

  // requiresProxy comes from AbstractApiClient (options.requiresProxy ?? false).
  // Declaring it here would re-initialize it to false AFTER super() runs,
  // silently discarding an explicit requiresProxy:true option.

  /** @type {string} */
  baseUrl;

  /** @type {string} */
  userAgent;

  /** @type {MediumTransport} */
  transport = 'rss';

  /** @type {number} */
  delayMin = 1000;

  /** @type {number} */
  delayMax = 3000;

  /** @type {import('./bridge.js').MediumBrowserBridge | null} */
  bridge = null;

  /** @type {number} */
  #lastRequestAt = 0;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl]
   * @param {string} [options.userAgent]
   * @param {MediumTransport | string} [options.transport]
   * @param {number} [options.delayMin]
   * @param {number} [options.delayMax]
   * @param {import('./bridge.js').MediumBrowserBridge} [options.bridge]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {import('../../../core/session-manager.js').SessionManager} [options.sessionManager]
   * @param {import('./validator.js').MediumPlatformResponseValidator} [options.responseValidator]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {boolean} [options.requiresResidential=true]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new MediumPlatformResponseValidator();

    // Proxy pool has a concrete implementation type (ProxyIpPool) that is
    // structurally narrower than the base class's ProxyProviderLike, so we
    // remove it from the super() argument and assign it with a safe cast.
    /** @type {Record<string, unknown>} */
    const superOptions = { ...options };
    const userProxyPool = superOptions.proxyPool;
    delete superOptions.proxyPool;

    super({
      ...superOptions,
      platform: 'medium',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      // requiresProxy forwarded only when the caller set it — see base-client
      // _requiresProxyExplicit semantics (explicit false = user opted out).
      ...(options.requiresProxy !== undefined ? { requiresProxy: options.requiresProxy } : {}),
    });

    if (userProxyPool) {
      this.proxyPool = /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (userProxyPool));
      this._hasExplicitProxy = true;
    }

    this.baseUrl = String(options.baseUrl || DEFAULT_MEDIUM_BASE_URL).replace(/\/+$/, '');
    this.userAgent = options.userAgent || process.env.MEDIUM_USER_AGENT || DEFAULT_MEDIUM_USER_AGENT;
    this.delayMin = typeof options.delayMin === 'number' ? options.delayMin : 1000;
    this.delayMax = typeof options.delayMax === 'number' ? options.delayMax : 3000;
    this.requiresResidential = options.requiresResidential !== false;
    this.bridge = options.bridge || null;

    const rawTransport = String(options.transport || process.env.MEDIUM_TRANSPORT || 'rss').toLowerCase().trim();
    this.transport = /** @type {MediumTransport} */ (rawTransport === 'rss' || rawTransport === 'http' || rawTransport === 'graphql' || rawTransport === 'puppeteer'
      ? rawTransport
      : 'rss');
  }

  /**
   * Public Medium endpoints do not require client-side signing.
   * @param {Object} [payload]
   * @returns {Promise<Object>}
   */
  async sign(payload = {}) {
    return {};
  }

  /**
   * Initialize session; no-op for public Medium endpoints unless a future
   * auth cookie is provided.
   * @param {Object} [session]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    // Public endpoints need no session; keep hook for future auth cookies.
    if (session && typeof session === 'object') {
      const s = asRecord(session);
      if (typeof s.cookie === 'string' || typeof s.cookies === 'string') {
        this.cookies = { ...this.cookies };
      }
    }
  }

  /**
   * Build a full Medium URL with query parameters and strip trailing slashes.
   * @param {string} path
   * @param {Record<string, unknown>} [params={}]
   * @returns {string}
   */
  buildUrl(path, params = {}) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid Medium URL path: must be non-empty string',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const isAbsolute = /^https?:\/\//i.test(path);
    const base = isAbsolute ? undefined : this.baseUrl;
    /** @type {URL} */
    let url;
    try {
      url = new URL(path, base);
    } catch {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid Medium URL: unable to build URL from base "${this.baseUrl}" and path "${path}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        const str = typeof value === 'string' ? value : (typeof value === 'number' || typeof value === 'boolean' ? String(value) : '');
        if (str) url.searchParams.set(key, str);
      }
    }

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  }

  /**
   * Resolve a feed URL for the requested action and parameters.
   * @param {Object} params
   * @param {'user' | 'publication' | 'tag'} params.action
   * @param {string} [params.username]
   * @param {string} [params.slug]
   * @param {string} [params.tag]
   * @param {string} [params.publicationTag]
   * @param {string} [params.domain]
   * @returns {string}
   */
  #resolveFeedUrl(params) {
    const { action, username, slug, tag, publicationTag, domain } = params || {};

    if (action === 'user' && typeof username === 'string' && username.trim()) {
      return this.buildUrl(`/feed/@${encodeURIComponent(username.trim())}`);
    }

    if (action === 'publication' && typeof slug === 'string' && slug.trim()) {
      if (typeof domain === 'string' && domain.trim()) {
        const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        return `https://${cleanDomain}/feed`;
      }
      if (typeof publicationTag === 'string' && publicationTag.trim()) {
        return this.buildUrl(`/feed/${encodeURIComponent(slug.trim())}/tagged/${encodeURIComponent(publicationTag.trim())}`);
      }
      return this.buildUrl(`/feed/${encodeURIComponent(slug.trim())}`);
    }

    if (action === 'tag' && typeof tag === 'string' && tag.trim()) {
      return this.buildUrl(`/feed/tag/${encodeURIComponent(tag.trim())}`);
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid Medium feed parameters: missing username, slug, or tag',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Apply inter-request throttle and realistic User-Agent.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions} [options={}]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const now = Date.now();
    if (this.delayMax > 0 && this.#lastRequestAt > 0 && now - this.#lastRequestAt < this.delayMin) {
      await gaussianDelay(this.delayMin, this.delayMax);
    }

    const opts = asRecord(options);
    const existingHeaders = asRecord(opts.headers);
    const lowerKeys = new Set(Object.keys(existingHeaders).map((k) => k.toLowerCase()));

    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, value] of Object.entries(existingHeaders)) {
      headers[key] = typeof value === 'string' ? value : String(value);
    }
    if (!lowerKeys.has('user-agent')) {
      headers['user-agent'] = this.userAgent;
    }

    /** @type {Record<string, unknown>} */
    const reqOpts = { ...opts, headers: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (headers)) };
    if ((this.requiresProxy || this._hasExplicitProxy) && this.requiresResidential !== undefined) {
      reqOpts.requiresResidential = this.requiresResidential;
    }

    // Dead-proxy quarantine + direct fallback live in the base request
    // pipeline (transport catch in base-client — AC-4, lifted in epic-35 retro).
    try {
      return await super.request(method, url, /** @type {import('../../../core/base-client.js').RequestOptions} */ (/** @type {unknown} */ (reqOpts)));
    } finally {
      this.#lastRequestAt = Date.now();
    }
  }

  /**
   * Resolve proxy defaults for Medium (US / residential when available).
   * @param {string | import('../../../core/types.js').AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential=false]
   * @param {boolean} [requiresAuth]
   * @param {Record<string, unknown>} [options]
   * @returns {string | Record<string, unknown> | null}
   */
  resolveProxy(accountId, requiresResidential = false, requiresAuth = this.requiresAuth, options = {}) {
    const safeOptions = asRecord(options);
    const hasProvider = Boolean(this.proxyProvider || this.proxyPool);

    if (!hasProvider) {
      // No provider and no pool: PROXY_URL env is the documented fallback (AC-2 / OQ-1).
      const env = this.resolveEnvProxy();
      if (env) {
        return env;
      }
      return super.resolveProxy(accountId, requiresResidential, requiresAuth, safeOptions);
    }

    /** @type {Record<string, unknown>} */
    const mergedOptions = { ...safeOptions };
    const currentCountry = typeof safeOptions.country === 'string' ? safeOptions.country : null;
    const currentIsp = typeof safeOptions.isp === 'string' ? safeOptions.isp : null;
    mergedOptions.country = currentCountry || 'us';
    mergedOptions.isp = currentIsp || 'residential';
    if (accountId && !mergedOptions.sessionId) mergedOptions.sessionId = String(accountId);

    // The env-seeded globalProxyPool only counts when it can actually serve;
    // otherwise fall back to PROXY_URL before surfacing exhaustion (AC-2).
    if (!this.proxyProvider && this.proxyPool) {
      let poolCanServe = false;
      try {
        const probe = typeof this.proxyPool.getNext === 'function'
          ? this.proxyPool.getNext(requiresResidential)
          : null;
        poolCanServe = probe != null;
      } catch { poolCanServe = false; }
      const env = this.resolveEnvProxy();
      if (!poolCanServe && env) {
        return env;
      }
    }

    return super.resolveProxy(accountId, requiresResidential, requiresAuth, /** @type {Object} */ (/** @type {unknown} */ (mergedOptions)));
  }

  /**
   * Fetch and parse an RSS/Atom feed.
   * @param {string} url
   * @returns {Promise<Record<string, unknown>>}
   */
  async getRssFeed(url) {
    const res = /** @type {Record<string, unknown>} */ (await this.request('GET', url, {
      skipResponseValidation: true,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9',
      },
    }));

    const raw = res && typeof res === 'object' ? res : {};
    const rawData = typeof raw.data === 'string' ? raw.data : (raw.data ? String(raw.data) : '');
    if (!rawData) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Empty RSS body from Medium',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
      textNodeName: '#text',
      preserveOrder: false,
    });

    return asRecord(parser.parse(rawData));
  }

  /**
   * Strip the Medium XSSI prefix and parse a `?format=json` response.
   * @param {string} text
   * @returns {Record<string, unknown>}
   */
  #parseJsonPage(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Empty JSON body from Medium',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const stripped = text.trim().startsWith(XSSI_PREFIX) ? text.trim().slice(XSSI_PREFIX.length) : text;
    try {
      return /** @type {Record<string, unknown>} */ (JSON.parse(stripped));
    } catch (err) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Failed to parse Medium JSON payload',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
        cause: err,
      });
    }
  }

  /**
   * Fetch a `?format=json` page and return the parsed payload.
   * @param {string} url
   * @param {Object} [options={}]
   * @param {number} [options.limit]
   * @param {string} [options.to]
   * @param {number} [options.page]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getJsonPage(url, options = {}) {
    const params = /** @type {Record<string, unknown>} */ ({});
    params.format = 'json';
    if (options.limit) params.limit = Number(options.limit);
    if (options.to) params.to = String(options.to);
    if (options.page) params.page = Number(options.page);

    const finalUrl = this.buildUrl(url, params);
    const res = /** @type {Record<string, unknown>} */ (await this.request('GET', finalUrl, {
      skipResponseValidation: true,
      headers: {
        Accept: 'application/json',
      },
    }));

    if (res && typeof res === 'object') {
      if (typeof res.data === 'string') {
        return this.#parseJsonPage(res.data);
      }
      if (res.data && typeof res.data === 'object') {
        return asRecord(res.data);
      }
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Unexpected Medium JSON response format',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Post a GraphQL operation to `/_/graphql`.
   * @param {Record<string, unknown> | Record<string, unknown>[]} query
   * @param {Record<string, unknown>} [variables]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getGraphql(query, variables = {}) {
    const url = this.buildUrl('/_/graphql');
    const payload = Array.isArray(query)
      ? query
      : [{
          operationName: typeof query.operationName === 'string' ? query.operationName : 'MediumQuery',
          variables: { ...asRecord(query.variables), ...variables },
          query: typeof query.query === 'string' ? query.query : '',
        }];

    const res = /** @type {Record<string, unknown>} */ (await this.request('POST', url, {
      skipResponseValidation: true,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      json: payload,
    }));

    if (res && typeof res === 'object' && res.data && typeof res.data === 'object') {
      return asRecord(res.data);
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Unexpected Medium GraphQL response format',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Extract <item> elements from a parsed RSS/Atom feed.
   * @param {Record<string, unknown>} parsed
   * @returns {Record<string, unknown>[]}
   */
  #extractRssItems(parsed) {
    if (!parsed || typeof parsed !== 'object') return [];

    const rss = asRecord(parsed.rss);
    const channel = asRecord(rss.channel);
    const rawItems = channel.item;
    if (Array.isArray(rawItems)) return rawItems.map((item) => asRecord(item));
    if (rawItems && typeof rawItems === 'object') return [asRecord(rawItems)];

    const feed = asRecord(parsed.feed);
    const rawEntries = feed.entry;
    if (Array.isArray(rawEntries)) return rawEntries.map((entry) => asRecord(entry));
    if (rawEntries && typeof rawEntries === 'object') return [asRecord(rawEntries)];

    return [];
  }

  /**
   * Extract Medium post values from a `?format=json` payload.
   * Sorts by published timestamp descending.
   * @param {Record<string, unknown>} payload
   * @returns {Record<string, unknown>[]}
   */
  #extractJsonPosts(payload) {
    const record = asRecord(payload);
    const payloadObj = asRecord(record.payload);
    const references = asRecord(payloadObj.references);
    const postMap = asRecord(references.Post);

    const posts = Object.values(postMap).map((value) => asRecord(value));
    posts.sort((a, b) => {
      const aTime = Number(a.firstPublishedAt) || Number(a.latestPublishedAt) || 0;
      const bTime = Number(b.firstPublishedAt) || Number(b.latestPublishedAt) || 0;
      return bTime - aTime;
    });
    return posts;
  }

  /**
   * Build paging info from a `?format=json` payload.
   * @param {Record<string, unknown>} payload
   * @returns {{ next: Record<string, unknown> | null }}
   */
  #extractPaging(payload) {
    const record = asRecord(payload);
    const payloadObj = asRecord(record.payload);
    const paging = asRecord(payloadObj.paging);
    if (paging.next && typeof paging.next === 'object') {
      return { next: asRecord(paging.next) };
    }
    return { next: null };
  }

  /**
   * Build a result object for feed actions.
   * @param {Record<string, unknown>[]} items
   * @param {Record<string, unknown> | null} paging
   * @returns {{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }}
   */
  #feedResult(items, paging = null) {
    return { items, paging: { next: paging } };
  }

  /**
   * Fetch a user's public feed.
   * @param {string} username
   * @param {Object} [options={}]
   * @param {number} [options.limit]
   * @param {string} [options.transport]
   * @param {string} [options.to]
   * @param {number} [options.page]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getUserFeed(username, options = {}) {
    const user = String(username).replace(/^@/, '').trim();
    const transport = this.#resolveTransport(options.transport);
    const limit = this.#clampLimit(options.limit);

    if (transport === 'puppeteer') {
      return this.#puppeteerUserFeed(user, options);
    }
    if (transport === 'graphql') {
      return this.#graphqlUserFeed(user, options);
    }
    if (transport === 'http') {
      return this.#jsonUserFeed(user, { ...options, limit });
    }

    try {
      const feedUrl = this.#resolveFeedUrl({ action: 'user', username: user });
      const parsed = await this.getRssFeed(feedUrl);
      const items = this.#extractRssItems(parsed);
      if (items.length > 0) {
        return this.#feedResult(items, null);
      }
    } catch (err) {
      this.#warnFallback('user', 'rss', err);
    }

    return this.#jsonUserFeed(user, { ...options, limit });
  }

  /**
   * @param {string} user
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #jsonUserFeed(user, options) {
    const url = this.buildUrl(`/@${encodeURIComponent(user)}`);
    const payload = await this.getJsonPage(url, options);
    const items = this.#extractJsonPosts(payload);
    const paging = this.#extractPaging(payload);
    return this.#feedResult(items, paging.next);
  }

  /**
   * @param {string} user
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #graphqlUserFeed(user, options) {
    const postFields = 'id title mediumUrl canonicalUrl url creator { id name } clapCount firstPublishedAt latestPublishedAt isLocked visibility';
    return this.#graphqlPostsForTarget({
      operationName: 'ViewerQuery',
      query: `query ViewerQuery($username: ID!) { user(username: $username) { name username posts { ${postFields} } } }`,
      variables: { username: user },
      resultPath: ['user', 'posts'],
    });
  }

  /**
   * @param {string} user
   * @param {Record<string, unknown>} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #puppeteerUserFeed(user, options) {
    const bridge = await this.#ensureBrowserBridge();
    if (bridge) {
      return bridge.getUserFeed(user, options);
    }
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5002',
      message: 'Puppeteer fallback for Medium user feed is not available',
      statusCode: 502,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Fetch a publication's public feed.
   * @param {string} slug
   * @param {Object} [options={}]
   * @param {string} [options.tag]
   * @param {number} [options.limit]
   * @param {string} [options.transport]
   * @param {string} [options.domain]
   * @param {string} [options.to]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getPublicationFeed(slug, options = {}) {
    const cleanSlug = String(slug).trim();
    const transport = this.#resolveTransport(options.transport);
    const limit = this.#clampLimit(options.limit);

    if (transport === 'puppeteer') {
      return this.#puppeteerPublicationFeed(cleanSlug, options);
    }
    if (transport === 'graphql') {
      return this.#graphqlPublicationFeed(cleanSlug, options);
    }
    if (transport === 'http') {
      return this.#jsonPublicationFeed(cleanSlug, { ...options, limit });
    }

    if (options.tag) {
      try {
        const feedUrl = this.#resolveFeedUrl({ action: 'publication', slug: cleanSlug, publicationTag: String(options.tag) });
        const parsed = await this.getRssFeed(feedUrl);
        const items = this.#extractRssItems(parsed);
        if (items.length > 0) {
          return this.#feedResult(items, null);
        }
      } catch (err) {
        this.#warnFallback('publication', 'rss', err);
      }
      return this.getTagFeed(String(options.tag), { ...options, limit });
    }

    try {
      const feedUrl = this.#resolveFeedUrl({ action: 'publication', slug: cleanSlug, domain: options.domain });
      const parsed = await this.getRssFeed(feedUrl);
      const items = this.#extractRssItems(parsed);
      if (items.length > 0) {
        return this.#feedResult(items, null);
      }
    } catch (err) {
      this.#warnFallback('publication', 'rss', err);
    }

    return this.#jsonPublicationFeed(cleanSlug, { ...options, limit });
  }

  /**
   * @param {string} slug
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #jsonPublicationFeed(slug, options) {
    const url = this.buildUrl(`/${encodeURIComponent(slug)}`);
    const payload = await this.getJsonPage(url, options);
    const items = this.#extractJsonPosts(payload);
    const paging = this.#extractPaging(payload);
    return this.#feedResult(items, paging.next);
  }

  /**
   * @param {string} slug
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #graphqlPublicationFeed(slug, options) {
    const postFields = 'id title mediumUrl canonicalUrl url creator { id name } clapCount firstPublishedAt latestPublishedAt isLocked visibility';
    return this.#graphqlPostsForTarget({
      operationName: 'CollectionLatestQuery',
      query: `query CollectionLatestQuery($slug: ID!) { collection(slug: $slug) { name slug posts { ${postFields} } } }`,
      variables: { slug },
      resultPath: ['collection', 'posts'],
    });
  }

  /**
   * @param {string} slug
   * @param {Record<string, unknown>} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #puppeteerPublicationFeed(slug, options) {
    const bridge = await this.#ensureBrowserBridge();
    if (bridge) {
      return bridge.getPublicationFeed(slug, options);
    }
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5002',
      message: 'Puppeteer fallback for Medium publication feed is not available',
      statusCode: 502,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Fetch a tag feed.
   * @param {string} tag
   * @param {Object} [options={}]
   * @param {number} [options.limit]
   * @param {string} [options.transport]
   * @param {string} [options.to]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getTagFeed(tag, options = {}) {
    const cleanTag = String(tag).replace(/^#/, '').trim();
    const transport = this.#resolveTransport(options.transport);

    if (transport === 'puppeteer') {
      return this.#puppeteerTagFeed(cleanTag, options);
    }
    if (transport === 'graphql') {
      return this.#graphqlTagFeed(cleanTag, options);
    }
    if (transport === 'http') {
      return this.#jsonTagFeed(cleanTag, options);
    }

    try {
      const feedUrl = this.#resolveFeedUrl({ action: 'tag', tag: cleanTag });
      const parsed = await this.getRssFeed(feedUrl);
      const items = this.#extractRssItems(parsed);
      if (items.length > 0) {
        return this.#feedResult(items, null);
      }
    } catch (err) {
      this.#warnFallback('tag', 'rss', err);
    }

    try {
      const jsonResult = await this.#jsonTagFeed(cleanTag, options);
      if (jsonResult.items.length > 0) {
        return jsonResult;
      }
    } catch (err) {
      this.#warnFallback('tag', 'json', err);
    }

    return this.#puppeteerTagFeed(cleanTag, options);
  }

  /**
   * @param {string} tag
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #graphqlTagFeed(tag, options) {
    const postFields = 'id title mediumUrl canonicalUrl url creator { id name } clapCount firstPublishedAt latestPublishedAt isLocked visibility';
    return this.#graphqlPostsForTarget({
      operationName: 'TopicLatestStorieQuery',
      query: `query TopicLatestStorieQuery($tag: ID!) { topic(tag: $tag) { name posts { ${postFields} } } }`,
      variables: { tag },
      resultPath: ['topic', 'posts'],
    });
  }

  /**
   * @param {string} tag
   * @param {Record<string, unknown>} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #puppeteerTagFeed(tag, options) {
    const bridge = await this.#ensureBrowserBridge();
    if (bridge) {
      return bridge.getTagFeed(tag, options);
    }
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5002',
      message: 'Puppeteer fallback for Medium tag feed is not available',
      statusCode: 502,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * @param {string} tag
   * @param {Object} options
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #jsonTagFeed(tag, options) {
    const url = this.buildUrl(`/tag/${encodeURIComponent(tag)}`);
    const payload = await this.getJsonPage(url, options);
    const items = this.#extractJsonPosts(payload);
    const paging = this.#extractPaging(payload);
    return this.#feedResult(items, paging.next);
  }

  /**
   * Fetch a single Medium post by id or URL.
   * @param {string} postIdOrUrl
   * @param {Object} [options={}]
   * @param {string} [options.url]
   * @param {string} [options.transport]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getPost(postIdOrUrl, options = {}) {
    const opts = asRecord(options);
    let resolvedId = String(postIdOrUrl).trim();
    if (resolvedId.startsWith('medium:')) {
      resolvedId = resolvedId.slice(7).trim();
    }

    let targetUrl;
    if (resolvedId.startsWith('http') || resolvedId.includes('medium.com/')) {
      targetUrl = resolvedId;
      resolvedId = extractPostId(resolvedId) || resolvedId;
    } else if (typeof opts.url === 'string' && opts.url.trim()) {
      targetUrl = opts.url.trim();
      resolvedId = extractPostId(targetUrl) || resolvedId;
    }

    if (!resolvedId && !targetUrl) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: postId or url',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const transport = this.#resolveTransport(typeof opts.transport === 'string' ? opts.transport : undefined);

    if (transport === 'puppeteer') {
      return this.#puppeteerPost(targetUrl || resolvedId, resolvedId, opts);
    }
    if (transport === 'graphql') {
      return this.#graphqlPost(resolvedId, targetUrl, opts);
    }

    return this.#jsonPost(resolvedId, targetUrl, opts);
  }

  /**
   * @param {string} postId
   * @param {string | undefined} targetUrl
   * @param {Record<string, unknown>} opts
   * @returns {Promise<Record<string, unknown>>}
   */
  async #jsonPost(postId, targetUrl, opts) {
    let url;
    if (typeof targetUrl === 'string' && targetUrl.trim()) {
      url = this.buildUrl(targetUrl, { format: 'json' });
    } else if (postId && /^[a-f0-9]{12}$/i.test(postId)) {
      url = this.buildUrl(`/p/${postId}`, { format: 'json' });
    } else {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid Medium post id or URL',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const res = await this.#fetchJsonWithRedirect(url, opts);
    const root = asRecord(res);
    const payload = asRecord(root.payload || root);
    const references = asRecord(payload.references);
    const value = asRecord(payload.value);

    if (value.id) {
      if (!value.creator && value.creatorId) {
        const userMap = asRecord(references.User);
        const directRef = asRecord(references[String(value.creatorId)]);
        const userRef = userMap[String(value.creatorId)] || directRef;
        if (userRef) value.creator = { id: String(value.creatorId), ...asRecord(userRef) };
      }
      return this.#enrichPostValue(value, String(value.id));
    }

    const posts = asRecord(references.Post);
    if (posts && Object.keys(posts).length > 0) {
      const first = asRecord(Object.values(posts)[0]);
      if (!first.creator && first.creatorId) {
        const userMap = asRecord(references.User);
        const directRef = asRecord(references[String(first.creatorId)]);
        const userRef = userMap[String(first.creatorId)] || directRef;
        if (userRef) first.creator = { id: String(first.creatorId), ...asRecord(userRef) };
      }
      return this.#enrichPostValue(first, String(first.id || postId));
    }

    throw new PlatformError({
      type: ErrorTypes.NOT_FOUND,
      code: 'XACT_4040',
      message: 'Medium post not found',
      statusCode: 404,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * @param {string} url
   * @param {Record<string, unknown>} [opts]
   * @returns {Promise<Record<string, unknown>>}
   */
  async #fetchJsonWithRedirect(url, opts = {}) {
    const params = asRecord({});
    params.format = 'json';
    if (opts.page) params.page = Number(opts.page);
    if (opts.to) params.to = String(opts.to);
    const finalUrl = this.buildUrl(url, params);

    const res = asRecord(await this.request('GET', finalUrl, {
      skipResponseValidation: true,
      headers: {
        Accept: 'application/json',
      },
    }));

    // If the underlying transport returns a 3xx manually, follow the Location.
    const status = Number(res.status) || 200;
    const headers = asRecord(res.headers);
    if (status >= 301 && status <= 399 && typeof headers.location === 'string' && headers.location) {
      const location = stripTrackingParams(headers.location);
      const nextUrl = this.buildUrl(location, { format: 'json' });
      return this.#fetchJsonWithRedirect(nextUrl, opts);
    }

    if (res.data && typeof res.data === 'object') {
      return asRecord(res.data);
    }
    if (typeof res.data === 'string') {
      return this.#parseJsonPage(res.data);
    }
    if (typeof res.body === 'string') {
      return this.#parseJsonPage(res.body);
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Unexpected Medium JSON response format',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * @param {Record<string, unknown>} value
   * @param {string} postId
   * @returns {Record<string, unknown>}
   */
  #enrichPostValue(value, postId) {
    if (!value.id) value.id = postId;
    value.__mediumPostId = postId;
    value.__namespacedId = namespacedMediumId(postId);
    return value;
  }

  /**
   * @param {string} postId
   * @param {string | undefined} targetUrl
   * @param {Record<string, unknown>} opts
   * @returns {Promise<Record<string, unknown>>}
   */
  async #graphqlPost(postId, targetUrl, opts) {
    const postFields = 'id title mediumUrl canonicalUrl url creator { id name } clapCount firstPublishedAt latestPublishedAt isLocked visibility content { subtitle bodyModel { paragraphs { name text metadata { imageId } } } }';
    const result = await this.getGraphql({
      operationName: 'PostDetailQuery',
      query: `query PostDetailQuery($postId: ID!) { postResult(postId: $postId) { ${postFields} } }`,
      variables: { postId },
    });
    const data = asRecord(result.data);
    const postResult = asRecord(data.postResult);
    if (postResult && Object.keys(postResult).length > 0) {
      return this.#enrichPostValue(postResult, String(postResult.id || postId));
    }
    throw new PlatformError({
      type: ErrorTypes.NOT_FOUND,
      code: 'XACT_4040',
      message: 'Medium post not found via GraphQL',
      statusCode: 404,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * @param {string} target
   * @param {string} postId
   * @param {Record<string, unknown>} opts
   * @returns {Promise<Record<string, unknown>>}
   */
  async #puppeteerPost(target, postId, opts) {
    const bridge = await this.#ensureBrowserBridge();
    if (bridge) {
      return bridge.getPost(target, { ...opts, postId });
    }
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5002',
      message: 'Puppeteer fallback for Medium post is not available',
      statusCode: 502,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  /**
   * Execute a GraphQL query and extract a list of posts from a nested path.
   * @param {Object} params
   * @param {string} params.operationName
   * @param {string} params.query
   * @param {Record<string, unknown>} params.variables
   * @param {string[]} params.resultPath
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #graphqlPostsForTarget(params) {
    const result = await this.getGraphql({
      operationName: params.operationName,
      query: params.query,
      variables: params.variables,
    });

    let current = asRecord(result.data);
    for (const key of params.resultPath) {
      if (current && typeof current === 'object') {
        current = asRecord(current[key]);
      } else {
        current = {};
      }
    }

    const items = Array.isArray(current) ? current.map((item) => asRecord(item)) : [];
    return this.#feedResult(items, null);
  }

  /**
   * @param {string | undefined} transport
   * @returns {MediumTransport}
   */
  #resolveTransport(transport) {
    const raw = typeof transport === 'string' ? transport.trim().toLowerCase() : '';
    if (raw === 'http' || raw === 'graphql' || raw === 'puppeteer' || raw === 'rss') {
      return /** @type {MediumTransport} */ (raw);
    }
    return this.transport;
  }

  /**
   * Clamp and sanitize a limit argument.
   * @param {unknown} value
   * @returns {number}
   */
  #clampLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return 10;
    return Math.min(100, Math.max(1, Math.floor(parsed)));
  }

  /**
   * Log a non-fatal fallback for observability.
   * @param {string} action
   * @param {string} source
   * @param {unknown} err
   */
  #warnFallback(action, source, err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [MEDIUM CLIENT] ${action} ${source} fallback: ${message}`);
  }

  /**
   * Ensure a browser bridge is available for Puppeteer fallback.
   * Uses mutex to prevent duplicate launches.
   * @returns {Promise<import('./bridge.js').MediumBrowserBridge | null>}
   */
  async #ensureBrowserBridge() {
    if (this.bridge && this.bridge.isReady) return this.bridge;

    if (!this.bridge) {
      const { MediumBrowserBridge } = await import('./bridge.js');
      this.bridge = new MediumBrowserBridge({
        baseUrl: this.baseUrl,
        proxyProvider: /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (this.proxyProvider || this.proxyPool)),
        userAgent: this.userAgent,
        headless: process.env.MEDIUM_BRIDGE_HEADLESS !== 'false',
      });
    }

    try {
      await this.bridge.start();
      return this.bridge.isReady ? this.bridge : null;
    } catch (err) {
      console.warn(`⚠️ [MEDIUM CLIENT] Browser bridge failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Clean up any browser resources started by this client.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.bridge && typeof this.bridge.close === 'function') {
      try {
        await this.bridge.close();
      } catch {
        // safe ignore
      }
      this.bridge = null;
    }
  }
}
