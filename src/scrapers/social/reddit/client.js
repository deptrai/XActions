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
import { RedditBrowserBridge } from './bridge.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  RateLimitError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';
import { XMLParser } from 'fast-xml-parser';

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
  return 'xactions/1.0';
}

export function createRedditClient(options = {}) {
  return new RedditClient(options);
}

export class RedditClient extends AbstractApiClient {
  /** @type {string} */
  name = 'reddit';

  /** @type {string} */
  platform = 'reddit';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresResidential = true;

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

  /** @type {'http' | 'puppeteer' | 'rss'} */
  transport = 'http';

  /** @type {import('./bridge.js').RedditBrowserBridge | null} */
  browserBridge = null;

  /** @type {string | Record<string, unknown> | null} */
  proxy = null;

  /** @type {Promise<void> | null} */
  #bridgePromise = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base web URL (default: https://www.reddit.com)
   * @param {string} [options.apiBaseUrl] - API URL for auth calls (default: https://api.reddit.com)
   * @param {string} [options.oauthUrl] - OAuth token endpoint (default: https://www.reddit.com/api/v1/access_token)
   * @param {string} [options.clientId] - Reddit app client_id (script type)
   * @param {string} [options.clientSecret] - Reddit app client_secret
   * @param {string} [options.username] - Reddit username for User-Agent
   * @param {string} [options.redditUsername] - Alias for username
   * @param {string} [options.userAgent] - Custom User-Agent override
   * @param {string} [options.accessToken] - Existing OAuth access token
   * @param {number} [options.tokenExpiresAt] - Existing token expiry epoch ms
   * @param {string} [options.defaultProxyCountry='us'] - Default proxy country
   * @param {string} [options.proxyType='residential'] - Default proxy ISP/type
   * @param {boolean} [options.requiresResidential=true] - Require residential proxies
   * @param {import('./validator.js').RedditPlatformResponseValidator} [options.responseValidator]
   * @param {string | Record<string, unknown>} [options.proxy] - Optional proxy URL or config
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {string} [options.transport='http']
   * @param {import('./bridge.js').RedditBrowserBridge} [options.browserBridge]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new RedditPlatformResponseValidator();

    // Proxy pool has a concrete implementation type (ProxyIpPool) that is
    // structurally narrower than the base class's ProxyProviderLike, so we
    // remove it from the super() argument and assign it with a safe cast.
    /** @type {Record<string, unknown>} */
    const superOptions = { ...options };
    const userProxyPool = superOptions.proxyPool;
    delete superOptions.proxyPool;
    super({
      ...superOptions,
      platform: 'reddit',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });
    if (userProxyPool) {
      this.proxyPool = /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (userProxyPool));
    }
    this.defaultProxyCountry = options.defaultProxyCountry || 'us';
    this.proxyType = options.proxyType || 'residential';
    this.requiresResidential = options.requiresResidential ?? true;
    this.proxy = options.proxy || null;

    this.baseUrl = String(options.baseUrl || DEFAULT_REDDIT_BASE_URL).replace(/\/+$/, '');
    this.apiBaseUrl = String(options.apiBaseUrl || DEFAULT_REDDIT_API_URL).replace(/\/+$/, '');
    this.oauthUrl = String(options.oauthUrl || DEFAULT_REDDIT_OAUTH_URL).replace(/\/+$/, '');
    this.clientId = options.clientId || null;
    this.clientSecret = options.clientSecret || null;
    this.username = options.username || options.redditUsername || null;
    this.userAgent = options.userAgent || buildRedditUserAgent(this.username ?? undefined);
    this.accessToken = options.accessToken || null;
    this.tokenExpiresAt = options.tokenExpiresAt || null;

    const rawTransport = String(options.transport || process.env.REDDIT_TRANSPORT || 'http').toLowerCase().trim();
    this.transport = (rawTransport === 'http' || rawTransport === 'puppeteer' || rawTransport === 'rss')
      ? rawTransport
      : 'http';
    this.browserBridge = options.browserBridge || null;
  }

  /**
   * Reddit does not use client-side payload signing (OAuth2 bearer / Basic auth only).
   * Conforms to AbstractApiClient sign contract.
   * @param {Object} [payload]
   * @returns {Promise<Record<string, unknown>>}
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
    const s = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (session));
    const clientId = (typeof s.clientId === 'string' ? s.clientId : null) || this.clientId;
    const clientSecret = (typeof s.clientSecret === 'string' ? s.clientSecret : null) || this.clientSecret;
    if (clientId && clientSecret) {
      await this.authenticate({ clientId, clientSecret });
    } else if (typeof s.accessToken === 'string') {
      this.accessToken = s.accessToken;
      this.tokenExpiresAt = typeof s.tokenExpiresAt === 'number' ? s.tokenExpiresAt : null;
    }
  }

  /**
   * Authenticate via OAuth2 client_credentials.
   * @param {Object} credentials
   * @param {string} credentials.clientId
   * @param {string} credentials.clientSecret
   * @returns {Promise<string | null>} access token
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

    const rawRes = await this.request('POST', this.oauthUrl, {
      headers: {
        'authorization': authHeader,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.userAgent,
      },
      body,
      requiresAuth: false,
      skipResponseValidation: true,
    });
    const res = /** @type {Record<string, unknown>} */ (rawRes);
    const data = res && typeof res === 'object' ? (res.data ?? res) : res;

    if (!data || typeof data !== 'object' || !('access_token' in data) || typeof data.access_token !== 'string') {
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
    const rawExpiresIn = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (data)).expires_in;
    const expiresIn = typeof rawExpiresIn === 'number' ? rawExpiresIn : 3600;
    const effectiveBuffer = Math.min(this.tokenBufferSeconds, expiresIn);
    this.tokenExpiresAt = Date.now() + Math.max(0, (expiresIn - effectiveBuffer)) * 1000;

    return this.accessToken;
  }

  /**
   * Ensure access token is valid; refresh if expired.
   * @returns {Promise<string | null>}
   */
  async ensureToken() {
    if (!this.accessToken) {
      // Auto-authenticate when constructed with credentials but init() was not called.
      if (this.clientId && this.clientSecret) {
        return this.authenticate({ clientId: this.clientId, clientSecret: this.clientSecret });
      }
      return null;
    }
    if (this.tokenExpiresAt != null && Date.now() >= this.tokenExpiresAt) {
      if (this.clientId && this.clientSecret) {
        return this.authenticate({ clientId: this.clientId, clientSecret: this.clientSecret });
      }
      this.accessToken = null;
      this.tokenExpiresAt = null;
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: 'Reddit OAuth token has expired and no credentials are configured to refresh it',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'reddit',
      });
    }
    return this.accessToken;
  }

  /**
   * Execute a Reddit API request through the resilient AbstractApiClient pipeline.
   *
   * @param {string} path - API path (e.g. '/r/programming/new', '/user/spez/about')
   * @param {Record<string, unknown>} [params={}]
   * @param {Object} [options={}]
   * @param {'GET' | 'POST'} [options.method='GET']
   * @param {Record<string, string>} [options.headers]
   * @param {unknown} [options.body]
   * @param {unknown} [options.json]
   * @param {boolean} [options.requiresAuth]
   * @param {boolean} [options.skipResponseValidation]
   * @param {boolean} [options.useApiBaseUrl] - Use api.reddit.com instead of www.reddit.com
   * @returns {Promise<Record<string, unknown>>}
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
    const token = await this.ensureToken();
    const useApiBase = options.useApiBaseUrl !== undefined ? options.useApiBaseUrl : Boolean(token);
    const base = useApiBase ? this.apiBaseUrl : this.baseUrl;

    // Ensure .json suffix for public endpoints; guard against paths that already
    // contain query strings or unescaped segments.
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const [pathPart, searchPart] = normalizedPath.split('?');
    const safePath = useApiBase || pathPart.endsWith('.json') ? pathPart : `${pathPart}.json`;
    normalizedPath = searchPart ? `${safePath}?${searchPart}` : safePath;

    let url;
    try {
      url = new URL(normalizedPath, base);
    } catch {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid API URL: unable to build URL from base "${base}" and path "${normalizedPath}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    const queryParams = new URLSearchParams(url.search);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        const value = typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
        queryParams.set(k, value);
      }
    }
    url.search = queryParams.toString();

    /** @type {Record<string, string>} */
    const headers = {
      'user-agent': this.userAgent ?? 'xactions/1.0',
      'accept': 'application/json',
      ...(options.headers || {}),
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
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

    // Puppeteer stealth bridge: inject real browser cookies before issuing request.
    if (this.transport === 'puppeteer' && !token) {
      try {
        await this.#ensureBrowserBridge();
        if (this.browserBridge?.isReady) {
          const cookieHeader = this.browserBridge.cookieHeader;
          if (cookieHeader) {
            /** @type {Record<string, string>} */
            const cleanedHeaders = { ...reqOpts.headers };
            for (const key of Object.keys(cleanedHeaders)) {
              if (key.toLowerCase() === 'cookie') {
                delete cleanedHeaders[key];
              }
            }
            cleanedHeaders.cookie = cookieHeader;
            reqOpts.headers = cleanedHeaders;
          }
        }
      } catch (bridgeErr) {
        // Log but do not fail — HTTP path may still work.
        console.warn(`⚠️ [RedditBrowserBridge] failed to inject cookies: ${bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr)}`);
      }
    }

    // RSS-only transport: skip HTTP .json and go straight to RSS fallback for subreddit listings.
    if (this.transport === 'rss' && !token) {
      if (this.#looksLikeSubredditListing(normalizedPath)) {
        const rss = await this.#rssFallback(normalizedPath, params, options);
        if (rss) return rss;
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_5002',
          message: `Failed to fetch or parse Reddit RSS feed for ${normalizedPath}`,
          statusCode: 502,
          platform: 'reddit',
        });
      }
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `RSS transport only supports subreddit listings, but requested path was: ${normalizedPath}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    try {
      const rawRes = await this.request(method, url.href, reqOpts);
      const res = /** @type {Record<string, unknown>} */ (rawRes);
      if (res && typeof res === 'object' && res.data && typeof res.data === 'object') {
        return /** @type {Record<string, unknown>} */ (res.data);
      }
      return res;
    } catch (err) {
      const isPlatformError = err instanceof PlatformError;
      if (isPlatformError && this.browserBridge && typeof this.browserBridge.clearCookies === 'function') {
        if (err.statusCode === 403 || err.name === 'BotChallengeError') {
          this.browserBridge.clearCookies();
        }
      }

      const details = isPlatformError && err.details ? err.details : {};

      // 404 responses and private/NSFW login walls should be surfaced as NOT_FOUND
      // rather than generic internal errors or bot challenges.
      if (isPlatformError && err.statusCode === 404) {
        throw new PlatformError({
          type: ErrorTypes.NOT_FOUND,
          code: 'XACT_4040',
          message: 'Reddit resource not found',
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'reddit',
          details,
        });
      }

      const looksLikeLoginWall = isPlatformError && (err.statusCode === 403 || err.name === 'BotChallengeError')
        ? (this.responseValidator?.isLoginWall(details) ?? false)
        : false;
      if (looksLikeLoginWall) {
        throw new PlatformError({
          type: ErrorTypes.NOT_FOUND,
          code: 'XACT_4040',
          message: 'Subreddit, user, or post is private, NSFW, or unavailable',
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'reddit',
          details,
        });
      }

      // When public .json endpoints are blocked by a bot challenge (403), attempt
      // RSS fallback for subreddit listings. This allows scraping real public
      // subreddits without an OAuth app or residential proxy.
      const isBotBlock = isPlatformError && (err.statusCode === 403 || err.name === 'BotChallengeError');
      if (!useApiBase && !token && isBotBlock && this.#looksLikeSubredditListing(normalizedPath)) {
        const rss = await this.#rssFallback(normalizedPath, params, options);
        if (rss) return rss;
      }

      throw err;
    }
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  #looksLikeSubredditListing(path) {
    // Match /r/{sub}/{sort} or /r/{sub}/{sort}.json, tolerating query strings
    // and missing sort (e.g. /r/programming?limit=25 or /r/programming.json).
    const clean = String(path || '').split('?')[0].split('#')[0];
    if (/^\/r\/[^/]+\/?$/.test(clean)) return true;
    return /^\/r\/[^/]+\/(new|hot|top|rising|controversial|gilded|wiki|about)(\.json)?\/?$/.test(clean);
  }

  /**
   * @param {string} path
   * @param {Record<string, unknown>} params
   * @param {Object} options
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async #rssFallback(path, params = {}, options = {}) {
    const rssPath = path.replace(/\.json$/, '.rss');
    const queryParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        queryParams.set(k, String(v));
      }
    }
    const qs = queryParams.toString();
    const url = `${this.baseUrl}${rssPath}${qs ? '?' + qs : ''}`;

    try {
      const rawRes = await this.request('GET', url, {
        ...options,
        headers: {
          'user-agent': this.userAgent ?? 'xactions/1.0',
          'accept': 'application/atom+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        requiresAuth: false,
        skipResponseValidation: true,
      });
      const res = /** @type {Record<string, unknown>} */ (rawRes);

      const body = res && typeof res === 'object' && typeof res.data === 'string' ? res.data : (typeof rawRes === 'string' ? rawRes : '');
      if (!body || (!body.includes('<feed') && !body.includes('<rss'))) {
        return null;
      }

      return this.#parseRssSubreddit(body, path);
    } catch {
      return null;
    }
  }

  /**
   * Parse a Reddit subreddit Atom feed into a Listing-shaped response.
   * @param {string} body
   * @param {string} path
   * @returns {Record<string, unknown>}
   */
  #parseRssSubreddit(body, path) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
    });
    const parsed = /** @type {Record<string, unknown>} */ (parser.parse(body) || {});
    const feed = /** @type {Record<string, unknown>} */ (parsed.feed || {});

    const match = path.match(/^\/r\/([^/]+)\/(new|hot|top|rising)/);
    const subreddit = match ? match[1] : '';

    const rawEntries = feed.entry;
    const entries = Array.isArray(rawEntries) ? rawEntries : (rawEntries ? [rawEntries] : []);
    const children = entries.map((rawEntry) => {
      const entry = /** @type {Record<string, unknown>} */ (rawEntry);
      const id = typeof entry.id === 'string' ? entry.id : '';
      const title = typeof entry.title === 'string' ? entry.title : '';
      const linkRecord = typeof entry.link === 'object' && entry.link !== null
        ? /** @type {Record<string, unknown>} */ (entry.link)
        : null;
      const linkHref = typeof entry.link === 'string' ? entry.link : (linkRecord && typeof linkRecord['@_href'] === 'string' ? linkRecord['@_href'] : '');
      const published = typeof entry.published === 'string' ? entry.published : (typeof entry.updated === 'string' ? entry.updated : '');
      const updated = typeof entry.updated === 'string' ? entry.updated : published;
      const contentRecord = typeof entry.content === 'object' && entry.content !== null
        ? /** @type {Record<string, unknown>} */ (entry.content)
        : null;
      const contentHtml = typeof entry.content === 'string' ? entry.content : (contentRecord && typeof contentRecord['#text'] === 'string' ? contentRecord['#text'] : '');
      const authorRecord = typeof entry.author === 'object' && entry.author !== null
        ? /** @type {Record<string, unknown>} */ (entry.author)
        : null;
      const authorName = authorRecord && typeof authorRecord.name === 'string'
        ? authorRecord.name.replace(/^\/?u\//, '')
        : '';

      // Reddit Atom entries use `id` as the canonical comments thread URL
      // and `link` either as the target external URL or the same comments URL.
      const commentsUrl = this.#extractCommentsUrl({ id, link: linkHref, contentHtml, subreddit });
      const targetUrl = this.#looksLikeRedditThread(linkHref, subreddit) ? '' : linkHref;
      const commentsMatch = commentsUrl.match(/\/comments\/([a-zA-Z0-9_-]+)\//i);
      const postId = commentsMatch ? commentsMatch[1] : id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);

      return {
        kind: 't3',
        data: {
          name: `t3_${postId}`,
          id: postId,
          subreddit,
          author: authorName,
          title,
          selftext: this.#extractSelftextFromHtml(contentHtml),
          score: 0,
          num_comments: this.#extractCommentCountFromHtml(contentHtml),
          created_utc: this.#parseRssTimestamp(published),
          updated_utc: this.#parseRssTimestamp(updated),
          permalink: this.#toPermalink(commentsUrl),
          url: targetUrl || commentsUrl,
          is_self: !targetUrl,
          is_video: false,
          over_18: false,
          preview: null,
        },
      };
    });

    return {
      kind: 'Listing',
      data: {
        children,
        after: null,
      },
    };
  }

  /**
   * Parse an RSS/Atom date string into a Unix timestamp (seconds).
   * Returns 0 for missing or unparseable values so downstream normalizers
   * don't receive NaN.
   *
   * @param {string} value
   * @returns {number}
   */
  #parseRssTimestamp(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts) || Number.isNaN(ts)) return 0;
    return Math.floor(ts / 1000);
  }

  /**
   * @param {Object} sources
   * @param {string} sources.id
   * @param {string} sources.link
   * @param {string} sources.contentHtml
   * @param {string} sources.subreddit
   * @returns {string}
   */
  #extractCommentsUrl({ id, link, contentHtml, subreddit }) {
    if (this.#looksLikeRedditThread(id, subreddit)) return id;
    if (this.#looksLikeRedditThread(link, subreddit)) return link;

    const hrefMatch = (contentHtml || '').match(/href="(https?:\/\/[^"]+\/r\/[^"]+\/comments\/[^"]+)"/i);
    if (hrefMatch) return hrefMatch[1];

    return link;
  }

  /**
   * @param {string} url
   * @param {string} subreddit
   * @returns {boolean}
   */
  #looksLikeRedditThread(url, subreddit) {
    return /^https?:\/\/[^/]+\/r\//i.test(url) && (subreddit ? url.includes(`/r/${subreddit}/comments/`) : /\/comments\/[^/]+/i.test(url));
  }

  /**
   * @param {string} url
   * @returns {string}
   */
  #toPermalink(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.endsWith('/') ? urlObj.pathname : `${urlObj.pathname}/`;
    } catch {
      return url.startsWith('/') ? url : `/r/`;
    }
  }

  /**
   * @param {string} html
   * @returns {string}
   */
  #extractSelftextFromHtml(html) {
    if (!html) return '';
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#32;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Remove the boilerplate "submitted by /u/... [link] [comments]" suffix.
    return text.replace(/submitted by\s*\/u\/[^\s]+\s*\[link\]\s*\[comments\].*$/i, '').trim();
  }

  /**
   * @param {string} html
   * @returns {number}
   */
  #extractCommentCountFromHtml(html) {
    if (!html) return 0;
    const match = html.match(/\[comments\]\s*\((\d+)\s*comments?\)/i);
    if (match) return Number(match[1]);
    return 0;
  }

  /**
   * Ensure the Puppeteer browser bridge is started and has cookies.
   * Uses mutex `#bridgePromise` to prevent concurrent redundant launches.
   * @returns {Promise<void>}
   */
  async #ensureBrowserBridge() {
    if (this.transport !== 'puppeteer') return;
    if (this.browserBridge && this.browserBridge.isReady) return;
    if (this.#bridgePromise) return this.#bridgePromise;

    this.#bridgePromise = (async () => {
      try {
        if (!this.browserBridge) {
          this.browserBridge = new RedditBrowserBridge({
            baseUrl: this.baseUrl,
            proxy: this.proxy || undefined,
            proxyProvider: /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (this.proxyProvider || this.proxyPool)),
            // Do not pass this.userAgent (bot UA) so Stealth keeps its realistic Chrome UA
            headless: process.env.REDDIT_BRIDGE_HEADLESS !== 'false',
          });
        }
        await this.browserBridge.start();
      } finally {
        this.#bridgePromise = null;
      }
    })();

    return this.#bridgePromise;
  }

  /**
   * Close the browser bridge if it was started.
   * @returns {Promise<void>}
   */
  async closeBrowserBridge() {
    if (this.browserBridge) {
      await this.browserBridge.close();
      this.browserBridge = null;
    }
  }

  /**
   * Parse Reddit rate-limit headers from a response.
   * @param {Record<string, unknown>} headers
   * @returns {{ remaining: number | null, resetAt: number | null, used: number | null }}
   */
  #parseRateLimitHeaders(headers = {}) {
    const remaining = headers['x-ratelimit-remaining'] !== undefined ? Number(headers['x-ratelimit-remaining']) : null;
    const reset = headers['x-ratelimit-reset'] !== undefined ? Number(headers['x-ratelimit-reset']) : null;
    const used = headers['x-ratelimit-used'] !== undefined ? Number(headers['x-ratelimit-used']) : null;

    let resetAt = null;
    if (reset !== null && !Number.isNaN(reset)) {
      // Reddit's x-ratelimit-reset is a relative number of seconds until the
      // quota window resets (e.g. "600"), not an absolute epoch timestamp.
      // Defensively treat small values as relative and large values as absolute
      // so the parser also tolerates epoch-style headers if they ever appear.
      const isAbsoluteEpoch = reset > 1_000_000_000;
      resetAt = isAbsoluteEpoch ? reset * 1000 : Date.now() + reset * 1000;
    }

    return { remaining, resetAt, used };
  }

  /**
   * Override request to inject Reddit-specific rate-limit handling and auth.
   * @param {string} method
   * @param {string} url
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const isOAuth = url === this.oauthUrl;
    const token = isOAuth ? null : await this.ensureToken();
    /** @type {Record<string, string>} */
    const headers = {
      'user-agent': this.userAgent ?? 'xactions/1.0',
      'accept': 'application/json',
      ...(typeof options.headers === 'object' && options.headers !== null ? /** @type {Record<string, string>} */ (options.headers) : {}),
    };

    if (token) {
      const existingAuthKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
      if (existingAuthKey) {
        delete headers[existingAuthKey];
      }
      headers.authorization = `Bearer ${token}`;
    }

    /** @type {Record<string, unknown>} */
    const reqOpts = {
      ...options,
      headers,
    };
    // Reddit recommends residential / US proxies for production, but only force
    // residential selection when an explicit proxy pool/provider is configured.
    if ((this.requiresProxy || this._hasExplicitProxy) && this.requiresResidential !== undefined) {
      reqOpts.requiresResidential = this.requiresResidential;
    }

    const res = await super.request(method, url, /** @type {import('../../../core/base-client.js').RequestOptions} */ (/** @type {unknown} */ (reqOpts)));

    // Parse rate-limit headers on success to drive proactive backoff
    if (res && typeof res === 'object' && 'headers' in res && res.headers && typeof res.headers === 'object') {
      const { remaining, resetAt } = this.#parseRateLimitHeaders(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (res.headers)));
      if (remaining !== null && remaining <= 1 && resetAt !== null) {
        const waitMs = Math.max(0, resetAt - Date.now());
        if (waitMs > 0 && waitMs < 300000) { // only sleep if within 5-minute cap
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    return res;
  }

  /**
   * Enforce US / residential proxy targeting defaults for Reddit.
   * Reddit aggressively blocks non-residential / non-US datacenter IPs on
   * public .json endpoints, so we pass country and isp hints to the provider.
   *
   * @param {string | import('../../../core/types.js').AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential=false]
   * @param {boolean} [requiresAuth]
   * @param {Record<string, unknown>} [options]
   * @returns {string | Record<string, unknown> | null}
   */
  resolveProxy(accountId, requiresResidential = false, requiresAuth = this.requiresAuth, options = {}) {
    const safeOptions = /** @type {Record<string, unknown>} */ (options || {});
    /** @type {Record<string, unknown>} */
    const mergedOptions = {
      ...safeOptions,
      country: (typeof safeOptions.country === 'string' ? safeOptions.country : null) || this.defaultProxyCountry || 'us',
      isp: (typeof safeOptions.isp === 'string' ? safeOptions.isp : null) || this.proxyType || 'residential',
    };
    return super.resolveProxy(accountId, requiresResidential, requiresAuth, /** @type {Object} */ (/** @type {unknown} */ (mergedOptions)));
  }

  /**
   * Clean up any browser resources started by this client.
   * @returns {Promise<void>}
   */
  async close() {
    await this.closeBrowserBridge();
  }
}
