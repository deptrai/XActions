// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokClient — High-throughput HTTP client for TikTok Web API.
 * Extends AbstractApiClient with got-scraping, sticky proxy routing, and a
 * browser-as-signer bridge for the live `a_bogus` / `X-Gnarly` anti-bot token.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TikTokPlatformResponseValidator } from './validator.js';
import { TikTokBrowserBridge } from './signer-bridge.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { PreSignedTokenRing } from '../../../core/signer-pool.js';

/**
 * @typedef {Object} TikTokRequestOptions
 * @property {string} [accountId]
 * @property {string | Record<string, string>} [cookies]
 * @property {Record<string, string>} [headers]
 * @property {boolean} [skipResponseValidation]
 * @property {number} [timeout]
 * @property {boolean} [requiresResidential]
 */

/**
 * Default TikTok Web constants derived from live traffic capture.
 * @type {Record<string, any>}
 */
const DEFAULT_DEVICE_CONTEXT = Object.freeze({
  aid: '1988',
  app_name: 'tiktok_web',
  app_language: 'en',
  browser_language: 'en-US',
  browser_name: 'Mozilla',
  browser_online: 'true',
  browser_platform: 'MacIntel',
  browser_version: '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  channel: 'tiktok_web',
  cookie_enabled: 'true',
  data_collection_enabled: 'false',
  device_platform: 'web_pc',
  device_type: 'web_h265',
  focus_state: 'true',
  is_fullscreen: 'false',
  is_page_visible: 'true',
  isNonPersonalized: 'false',
  language: 'en',
  os: 'mac',
  priority_region: '',
  region: 'VN',
  referer: '',
  screen_height: '720',
  screen_width: '1280',
  tz_name: 'Asia/Saigon',
  user_is_login: 'false',
  video_encoding: 'dash',
  webcast_language: 'en',
});

/**
 * Default set of client AB versions observed in live capture.
 * These are best-effort and may be rotated by TikTok.
 * @type {readonly string[]}
 */
const DEFAULT_CLIENT_AB_VERSIONS = Object.freeze([
  '76963944', '70508271', '73720541', '75843653', '76424653', '76464659',
  '76567909', '76669176', '76688761', '76691486', '76742975', '76752409',
  '76767996', '76773448', '76800459', '76818546', '76824282', '76834308',
  '76850673', '76857360', '76862040', '76921258', '76933422', '70405643',
  '71057832', '71200802', '73171280', '73208420', '74008524', '74276218',
  '74413136', '74844724', '75330961',
]);

/**
 * Build a base TikTok Web API URL path.
 * @param {string} path
 * @returns {string}
 */
function buildBaseUrl(path) {
  return `https://www.tiktok.com${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Encode a cookie record to a header string, masking sensitive token values in logs.
 * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
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
 * Parse a `ttwid` or `msToken` out of a raw cookie header.
 * @param {string} cookieHeader
 * @returns {{ ttwid: string, msToken: string }}
 */
function parseTikTokCookies(cookieHeader) {
  const ttwidMatch = cookieHeader.match(/(?:^|;\s*)ttwid=([^;]+)/);
  const msTokenMatch = cookieHeader.match(/(?:^|;\s*)msToken=([^;]+)/);
  return {
    ttwid: ttwidMatch ? decodeURIComponent(ttwidMatch[1]) : '',
    msToken: msTokenMatch ? decodeURIComponent(msTokenMatch[1]) : '',
  };
}

export class TikTokClient extends AbstractApiClient {
  /** @type {string} */
  name = 'tiktok';

  /** @type {string} */
  platform = 'tiktok';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {'got'} */
  client = 'got';

  /** @type {string} */
  baseUrl = 'https://www.tiktok.com';

  /** @type {Record<string, any>} */
  deviceContext = { ...DEFAULT_DEVICE_CONTEXT };

  /** @type {string[]} */
  clientAbVersions = [...DEFAULT_CLIENT_AB_VERSIONS];

  /** @type {TikTokBrowserBridge | null} */
  signerBridge = null;

  /** @type {PreSignedTokenRing} */
  guestTokenRing;

  /** @type {string | null} */
  deviceId = null;

  /** @type {TikTokBrowserBridge | null} */
  #ownedBridge = null;

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {Record<string, any>} [deps.deviceContext]
   * @param {readonly string[]} [deps.clientAbVersions]
   * @param {import('../../../core/base-client.js').ProxyProviderLike} [deps.proxyPool]
   * @param {import('../../../core/base-client.js').ProxyProviderLike} [deps.proxyProvider]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {import('../../../core/signer-pool.js').PreSignedTokenRing} [deps.tokenRing]
   * @param {import('../../../core/signer-pool.js').PreSignedTokenRing} [deps.guestTokenRing]
   * @param {import('../../../core/signer-pool.js').SignerWorkerPagePool} [deps.signerPool]
   * @param {TikTokBrowserBridge} [deps.signerBridge]
   * @param {string} [deps.adapterName]
   * @param {boolean} [deps.headless]
   * @param {string} [deps.proxy]
   * @param {number} [deps.timeout]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   */
  constructor(deps = {}) {
    const baseUrl = (deps.baseUrl || 'https://www.tiktok.com').replace(/\/+$/, '');

    super(/** @type {any} */ ({
      ...deps,
      platform: 'tiktok',
      client: 'got',
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : true,
      requiresProxy: deps.requiresProxy !== false,
      responseValidator: deps.responseValidator || new TikTokPlatformResponseValidator(),
    }));

    this.baseUrl = baseUrl;
    this.deviceContext = {
      ...DEFAULT_DEVICE_CONTEXT,
      ...(deps.deviceContext || {}),
    };
    this.clientAbVersions = /** @type {string[]} */ (deps.clientAbVersions ? [...deps.clientAbVersions] : [...DEFAULT_CLIENT_AB_VERSIONS]);
    this.timeout = deps.timeout ?? 60000;

    this.guestTokenRing = deps.guestTokenRing || new PreSignedTokenRing({ capacity: 50 });
    this.signerBridge = deps.signerBridge || null;
    this.proxy = deps.proxy || null;
    this.adapterName = deps.adapterName || process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright';
    this.headless = deps.headless !== false;

    // Eagerly create an owned bridge if none is injected but Playwright signing is enabled.
    if (!this.signerBridge && process.env.TIKTOK_BROWSER_SIGN !== 'false') {
      this.#ownedBridge = this.#createBridge();
      this.signerBridge = this.#ownedBridge;
    }
  }

  /**
   * @returns {TikTokBrowserBridge}
   */
  #createBridge() {
    return new TikTokBrowserBridge({
      baseUrl: this.baseUrl,
      proxy: this.proxy,
      proxyPool: this.proxyPool ?? null,
      proxyProvider: this.proxyProvider ?? null,
      adapterName: this.adapterName,
      headless: this.headless,
    });
  }

  /**
   * @returns {TikTokBrowserBridge}
   */
  #getLazyBridge() {
    if (!this.#ownedBridge) {
      this.#ownedBridge = this.#createBridge();
    }
    return this.#ownedBridge;
  }

  /**
   * Initialise a guest session: open a TikTok page and capture cookies/session tokens.
   * @param {Object} [session]
   * @param {string} [session.accountId='tiktok-guest']
   * @param {string | Record<string, string>} [session.cookies]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    const accountId = session.accountId || 'tiktok-guest';
    const rawCookies = buildCookieHeader(session.cookies || '');
    const { ttwid, msToken } = parseTikTokCookies(rawCookies);

    // If the caller supplied cookies, seed the token ring with the msToken.
    if (msToken) {
      this.guestTokenRing.refill([msToken]);
      this.cookies = {
        ...this.cookies,
        ttwid,
        msToken,
      };
      this.updateCookies(this.cookies);
      return;
    }

    // Otherwise, open the browser bridge and capture fresh cookies.
    if (this.signerBridge || process.env.TIKTOK_BROWSER_SIGN !== 'false') {
      const bridge = this.signerBridge || this.#getLazyBridge();
      const tokens = await bridge.extractSession(accountId, rawCookies);
      if (tokens.msToken) {
        this.guestTokenRing.refill([tokens.msToken]);
      }
      if (tokens.ttwid || tokens.msToken) {
        this.cookies = {
          ...this.cookies,
          ...(tokens.ttwid ? { ttwid: tokens.ttwid } : {}),
          ...(tokens.msToken ? { msToken: tokens.msToken } : {}),
        };
        this.updateCookies(this.cookies);
      }
      if (tokens.deviceId) {
        this.deviceId = tokens.deviceId;
      }
    }
  }

  /**
   * Sign a TikTok request by passing it through the browser-as-signer bridge.
   * The bridge navigates to the target URL and captures the final signed query
   * parameters (`a_bogus`, `msToken`, `X-Gnarly`) attached by TikTok's runtime.
   *
   * @param {Object} payload
   * @param {string} payload.url
   * @param {Record<string, any>} [payload.params]
   * @returns {Promise<Record<string, any>>}
   */
  async sign(payload) {
    const { url, params = {} } = payload || {};
    if (!url || typeof url !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'TikTokClient.sign() requires a URL string',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    // Prefer an injected or owned browser bridge when available.
    if (this.signerBridge) {
      const signed = await this.signerBridge.signUrl(url, {
        userAgent: this.deviceContext.browser_version,
        cookies: this.cookies,
      });
      return {
        query: {
          ...signed.query,
          ...params,
        },
        cookies: signed.cookies,
      };
    }

    // Fallback: rely on the msToken ring and a stub anti-bot signature.
    // Red-phase: real TikTok API will reject this, surfacing the missing signer.
    const msToken = this.guestTokenRing?.next() || '';
    const stub = this.#stubSign(url);
    return {
      query: {
        ...stub.query,
        msToken,
        ...params,
      },
      cookies: { ...this.cookies },
    };
  }

  /**
   * Produce a red-phase stub signature for requests when the browser bridge is
   * unavailable. This intentionally fails against TikTok's real WAF, triggering
   * the validator and proxy rotation.
   * @param {string} url
   * @returns {Record<string, any>}
   */
  #stubSign(url) {
    const ts = Date.now();
    const nonce = Math.random().toString(36).slice(2, 10);
    return {
      query: {
        a_bogus: `DFsSwQVLQfAiv-${ts}-${nonce}`,
        'X-Bogus': '1',
        'X-Gnarly': `MH${Math.random().toString(36).slice(2, 16)}${nonce}`,
      },
    };
  }

  /**
   * Override request to inject TikTok-specific headers after signing.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions & TikTokRequestOptions} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const opts = /** @type {any} */ (options) || {};
    const headers = opts.headers || {};

    const mergedHeaders = {
      accept: '*/*',
      'accept-language': `${this.deviceContext.browser_language},en;q=0.9`,
      referer: `${this.baseUrl}/`,
      'user-agent': this.deviceContext.browser_version,
      ...headers,
    };

    const rawCookies = buildCookieHeader(opts.cookies || this.cookies);
    const tiktokCookies = parseTikTokCookies(rawCookies);
    if (tiktokCookies.ttwid || tiktokCookies.msToken) {
      const parts = [];
      if (tiktokCookies.ttwid) parts.push(`ttwid=${tiktokCookies.ttwid}`);
      if (tiktokCookies.msToken) parts.push(`msToken=${tiktokCookies.msToken}`);
      mergedHeaders.cookie = parts.join('; ');
    }

    // Do not demand a residential proxy if the client is running without a proxy pool
    // (e.g. local red-phase tests or direct invocation).
    const requestOpts = { ...opts, headers: mergedHeaders };
    if (this.requiresProxy === false) {
      requestOpts.requiresResidential = false;
    }

    return super.request(method, url, requestOpts);
  }

  /**
   * Sign and execute a TikTok API request.
   * @param {string} method
   * @param {string} endpointPath
   * @param {Record<string, any>} params
   * @param {import('../../../core/base-client.js').RequestOptions & TikTokRequestOptions} [options]
   * @returns {Promise<any>}
   */
  async requestTikTokApi(method, endpointPath, params = {}, options = {}) {
    const url = this.buildApiUrl(endpointPath, params);
    const signed = await this.sign({ url, params });

    // Merge any extra query params (e.g. caller overrides) and the signing output.
    const finalUrl = this.#mergeSignedQuery(url, signed.query);

    const resp = await this.request(method, finalUrl, {
      accountId: options.accountId || 'tiktok-guest',
      ...options,
    });

    // If the anti-bot token was rejected, the validator will throw inside request().
    // Surface the parsed payload for the caller.
    const payload = resp?.data ?? resp;
    return /** @type {Record<string, any>} */ (payload);
  }

  /**
   * Merge signed query parameters into a pre-built URL without duplicating keys.
   * @param {string} url
   * @param {Record<string, any>} signedQuery
   * @returns {string}
   */
  #mergeSignedQuery(url, signedQuery) {
    const parsed = new URL(url);
    for (const [k, v] of Object.entries(signedQuery)) {
      if (v === undefined || v === null) continue;
      parsed.searchParams.set(k, String(v));
    }
    return parsed.toString();
  }

  /**
   * Build the base query context for any TikTok Web API call.
   * @returns {Record<string, string>}
   */
  #buildBaseParams() {
    const now = Math.floor(Date.now() / 1000);
    const deviceId = this.deviceId || String(now) + String(Math.floor(Math.random() * 1e15));
    return {
      ...this.deviceContext,
      WebIdLastTime: String(now),
      device_id: deviceId,
      client_ab_versions: this.clientAbVersions.join(','),
    };
  }

  /**
   * Build a full TikTok API URL with all required device context but *without* signing.
   * @param {string} endpointPath
   * @param {Record<string, any>} params
   * @returns {string}
   */
  buildApiUrl(endpointPath, params = {}) {
    const base = this.#buildBaseParams();
    const merged = { ...base, ...params };
    const root = this.baseUrl.replace(/\/+$/, '');
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const parsed = new URL(`${root}${path}`);
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === null) continue;
      parsed.searchParams.set(k, String(v));
    }
    return parsed.toString();
  }

  /**
   * Build a URL for the search/general/full endpoint.
   * @param {Object} args
   * @param {string} args.query
   * @param {number} [args.count=12]
   * @param {string | number} [args.cursor=0]
   * @returns {string}
   */
  buildSearchUrl(args) {
    const { query, count = 12, cursor = 0 } = args;
    const webSearchCode = JSON.stringify({
      tiktok: {
        client_params_x: {
          search_engine: {
            ies_mt_user_live_video_card_use_libra: 1,
            mt_search_general_user_live_card: 1,
          },
        },
        search_server: {},
      },
    });
    return this.buildApiUrl('/api/search/general/full/', {
      keyword: query,
      count: this.#clamp(count, 1, 35),
      cursor: String(cursor),
      offset: String(cursor),
      from_page: 'search',
      is_non_personalized_search: '0',
      search_source: 'normal',
      web_search_code: webSearchCode,
    });
  }

  /**
   * Build a URL for the challenge (hashtag) detail endpoint.
   * @param {Object} args
   * @param {string} args.tag
   * @returns {string}
   */
  buildHashtagDetailUrl(args) {
    const { tag } = args;
    return this.buildApiUrl('/api/challenge/detail/', {
      challengeName: tag,
      from_page: 'hashtag',
    });
  }

  /**
   * Build a URL for the challenge (hashtag) item list endpoint.
   * @param {Object} args
   * @param {string} args.challengeId
   * @param {number} [args.count=30]
   * @param {string | number} [args.cursor=0]
   * @returns {string}
   */
  buildHashtagFeedUrl(args) {
    const { challengeId, count = 30, cursor = 0 } = args;
    return this.buildApiUrl('/api/challenge/item_list/', {
      challengeID: challengeId,
      count: this.#clamp(count, 1, 35),
      cursor: String(cursor),
      from_page: 'hashtag',
    });
  }

  /**
   * Build a URL for the item detail endpoint.
   * @param {Object} args
   * @param {string} args.videoId
   * @returns {string}
   */
  buildItemDetailUrl(args) {
    const { videoId } = args;
    return this.buildApiUrl('/api/item/detail/', {
      itemId: videoId,
      from_page: 'video',
    });
  }

  /**
   * Build a URL for the root comment list endpoint.
   * @param {Object} args
   * @param {string} args.videoId
   * @param {number} [args.count=20]
   * @param {string | number} [args.cursor=0]
   * @returns {string}
   */
  buildCommentListUrl(args) {
    const { videoId, count = 20, cursor = 0 } = args;
    return this.buildApiUrl('/api/comment/list/', {
      aweme_id: videoId,
      count: this.#clamp(count, 1, 50),
      cursor: String(cursor),
      from_page: 'video',
    });
  }

  /**
   * Build a URL for the comment reply list endpoint.
   * @param {Object} args
   * @param {string} args.videoId
   * @param {string} args.commentId
   * @param {number} [args.count=20]
   * @param {string | number} [args.cursor=0]
   * @returns {string}
   */
  buildCommentReplyUrl(args) {
    const { videoId, commentId, count = 20, cursor = 0 } = args;
    return this.buildApiUrl('/api/comment/list/reply/', {
      aweme_id: videoId,
      item_id: videoId,
      comment_id: commentId,
      count: this.#clamp(count, 1, 50),
      cursor: String(cursor),
      from_page: 'video',
    });
  }

  /**
   * Clamp a numeric value to [min, max].
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  #clamp(value, min, max) {
    const n = Number(value);
    const parsed = Number.isFinite(n) ? n : min;
    return Math.max(min, Math.min(parsed, max));
  }

  /**
   * Close any owned browser bridge.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#ownedBridge) {
      await this.#ownedBridge.close();
      this.#ownedBridge = null;
      this.signerBridge = null;
    }
  }
}
