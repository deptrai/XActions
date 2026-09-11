// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * InstagramClient — hybrid scraper client for Instagram public data.
 * Transports: 'puppeteer' (stealth browser, default), 'http' (thin GraphQL/web
 * JSON fetch), 'instagrapi' (optional Python private-API bridge).
 * Session persists to SessionManager (in-memory) + optional SocialAccount store
 * (AES-256-GCM encryptedCookie). Sticky US-residential proxy per account.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { AbstractApiClient } from '../../../core/base-client.js';
import { InstagramPlatformResponseValidator } from './validator.js';
import { asRecord } from './normalizer.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';
import { globalSessionManager } from '../../../core/session-manager.js';
import {
  PlatformError,
  RateLimitError,
  BotChallengeError,
  AuthSessionExpiredError,
  ProxyDeadError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

const DEFAULT_BASE_URL = 'https://www.instagram.com';
const DEFAULT_GRAPHQL_BASE = 'https://www.instagram.com/graphql/query';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const MAX_CHALLENGE_RETRIES = 3;

/** @typedef {'puppeteer' | 'instagrapi' | 'http'} InstagramTransport */

/** @returns {boolean} whether the optional instagrapi bridge binary is configured. */
function instagrapiAvailable() {
  return Boolean(process.env.INSTAGRAPI_BIN || process.env.INSTAGRAPI_URL);
}

export class InstagramClient extends AbstractApiClient {
  /** @type {string} */ name = 'instagram';
  /** @type {string} */ platform = 'instagram';
  /** @type {string} */ category = 'social';
  /** @type {InstagramTransport} */ transport = 'puppeteer';
  /** @type {number} */ delayMin = 2000;
  /** @type {number} */ delayMax = 5000;
  /** @type {number} */ #lastRequestAt = 0;
  /** @type {import('../../adapters/base.js').BaseAdapter | null} */ #adapter = null;
  /** @type {import('../../adapters/base.js').AdapterBrowser | null} */ #browser = null;
  /** @type {import('../../adapters/base.js').AdapterPage | null} */ #page = null;
  /** @type {import('../../../core/session-manager.js').SessionManager} */ #sessionManager;
  /** @type {object | null} */ #socialStore;
  /** @type {Record<string, unknown> | null} */ #credentials = null;
  /** @type {number} */ #challengeCount = 0;

  /**
   * @param {Object} [options]
   * @param {InstagramTransport | string} [options.transport]
   * @param {number} [options.delayMin]
   * @param {number} [options.delayMax]
   * @param {import('../../../core/session-manager.js').SessionManager} [options.sessionManager]
   * @param {object} [options.socialStore] - optional SocialAccount persistence writer ({upsertSession}).
   * @param {object} [options.bridge] - injected browser/instagrapi bridge override.
   * @param {boolean} [options.requiresAuth=true]
   * @param {boolean} [options.requiresProxy=true]
   * @param {boolean} [options.requiresResidential=true]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new InstagramPlatformResponseValidator();
    /** @type {Record<string, unknown>} */
    const superOptions = { ...options };
    const userProxyPool = superOptions.proxyPool;
    delete superOptions.proxyPool;
    delete superOptions.socialStore;
    delete superOptions.sessionManager;
    delete superOptions.bridge;

    super({
      ...superOptions,
      platform: 'instagram',
      responseValidator,
      requiresAuth: options.requiresAuth ?? true,
      requiresProxy: options.requiresProxy ?? true,
    });

    if (userProxyPool) {
      this.proxyPool = /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (userProxyPool));
    }

    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.graphQlBase = String(options.graphQlBase || process.env.INSTAGRAM_GRAPHQL_BASE || DEFAULT_GRAPHQL_BASE).replace(/\/+$/, '');
    this.userAgent = options.userAgent || process.env.INSTAGRAM_USER_AGENT || DEFAULT_USER_AGENT;
    this.delayMin = typeof options.delayMin === 'number' ? options.delayMin : 2000;
    this.delayMax = typeof options.delayMax === 'number' ? options.delayMax : 5000;
    this.requiresResidential = options.requiresResidential !== false;
    this.#sessionManager = options.sessionManager || globalSessionManager;
    this.#socialStore = options.socialStore || null;
    this.bridge = options.bridge || null;

    const rawTransport = String(options.transport || process.env.INSTAGRAM_TRANSPORT || 'puppeteer').toLowerCase().trim();
    this.transport = /** @type {InstagramTransport} */ (
      rawTransport === 'puppeteer' || rawTransport === 'instagrapi' || rawTransport === 'http' ? rawTransport : 'puppeteer'
    );

    if (options.credentials) this.#credentials = asRecord(options.credentials);
  }

  /**
   * No client-side request signing for the public web / GraphQL surface.
   * @param {Object} [payload]
   * @returns {Promise<Object>}
   */
  async sign(payload = {}) {
    return {};
  }

  /**
   * Build an absolute Instagram URL from a path + query params (mirrors MediumClient.buildUrl).
   * @param {string} path
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  buildUrl(path, params = {}) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001',
        message: 'Invalid Instagram URL path: must be non-empty string', statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram',
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
        type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001',
        message: `Invalid Instagram URL: base "${this.baseUrl}" + path "${path}"`, statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram',
      });
    }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        const str = typeof value === 'string' ? value : (typeof value === 'number' || typeof value === 'boolean' ? String(value) : '');
        if (str) url.searchParams.set(key, str);
      }
    }
    return url.toString();
  }

  /**
   * Sticky US-residential proxy per account (AC-4).
   * @param {string | import('../../../core/types.js').AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential]
   * @param {boolean} [requiresAuth]
   * @param {Record<string, unknown>} [options]
   * @returns {string | Record<string, unknown> | null}
   */
  resolveProxy(accountId, requiresResidential = true, requiresAuth = this.requiresAuth, options = {}) {
    const safeOptions = asRecord(options);
    const env = process.env.PROXY_URL;
    // Advisory geo hints kept in options for pools that honour them.
    /** @type {Record<string, unknown>} */
    const merged = { ...safeOptions };
    merged.country = typeof safeOptions.country === 'string' ? safeOptions.country : 'us';
    merged.isp = typeof safeOptions.isp === 'string' ? safeOptions.isp : 'residential';
    if (accountId && !merged.sessionId) merged.sessionId = String(accountId);

    // An explicit provider always wins — it reads accountId + requiresResidential and
    // returns the sticky proxy for the account.
    if (this.proxyProvider) {
      return super.resolveProxy(accountId, requiresResidential, requiresAuth, merged);
    }

    // The auto-assigned globalProxyPool only counts when it has a healthy proxy that
    // satisfies the residential requirement. Probe with getNext() which honours the
    // residential flag; a non-residential-only pool returns null and we fall back to
    // PROXY_URL env. Only when nothing exists do we surface the typed ProxyDeadError.
    let poolCanServe = false;
    if (this.proxyPool) {
      try {
        const probe = typeof this.proxyPool.getNext === 'function'
          ? this.proxyPool.getNext(requiresResidential)
          : null;
        poolCanServe = probe != null;
      } catch { poolCanServe = false; }
    }
    if (!poolCanServe && env) return env;
    return super.resolveProxy(accountId, requiresResidential, requiresAuth, merged);
  }

  /**
   * Apply inter-request gaussian throttle + session cookie header.
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
    const existing = asRecord(opts.headers);
    const lower = new Set(Object.keys(existing).map((k) => k.toLowerCase()));
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [k, v] of Object.entries(existing)) headers[k] = typeof v === 'string' ? v : String(v);
    if (!lower.has('user-agent')) headers['user-agent'] = this.userAgent;
    if (!lower.has('x-ig-app-id')) headers['x-ig-app-id'] = '936619743392459';
    const cookieHeader = this.#cookieHeader();
    if (cookieHeader && !lower.has('cookie')) headers['cookie'] = cookieHeader;

    /** @type {Record<string, unknown>} */
    const reqOpts = { ...opts, headers: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (headers)) };
    if ((this.requiresProxy || this._hasExplicitProxy) && this.requiresResidential !== undefined) {
      reqOpts.requiresResidential = this.requiresResidential;
    }

    try {
      const res = await super.request(method, url, /** @type {import('../../../core/base-client.js').RequestOptions} */ (/** @type {unknown} */ (reqOpts)));
      this.#lastRequestAt = Date.now();
      this.#challengeCount = 0;
      return res;
    } catch (err) {
      this.#lastRequestAt = Date.now();
      throw this.#mapTransportError(err);
    }
  }

  /**
   * Serialize the cookie jar into a Cookie header.
   * @returns {string}
   */
  #cookieHeader() {
    const c = this.cookies ? asRecord(this.cookies) : (this.#credentials ? asRecord(this.#credentials.cookies) : null);
    if (!c) return '';
    return Object.entries(c)
      .filter(([, v]) => v != null && String(v) !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Map a raw transport error to a typed PlatformError, enforcing the ≤3 challenge retry policy (AC-9).
   * @param {unknown} err
   * @returns {Error}
   */
  #mapTransportError(err) {
    // Enforce the ≤3-challenge-retry policy (AC-9) even when the base client already
    // produced a BotChallengeError — count it so a persistent challenge escalates to
    // rotate_proxy instead of retrying forever.
    if (err instanceof BotChallengeError) {
      this.#challengeCount += 1;
      console.warn(`⚠️ [INSTAGRAM] Bot challenge (attempt ${this.#challengeCount}/${MAX_CHALLENGE_RETRIES})`);
      if (this.#challengeCount >= MAX_CHALLENGE_RETRIES) {
        return new BotChallengeError({
          message: 'Instagram challenge/checkpoint persists after 3 attempts — rotating proxy',
          suggestedAction: SuggestedActions.ROTATE_PROXY,
          platform: 'instagram',
          details: { attempts: this.#challengeCount },
        });
      }
      return err;
    }
    if (err instanceof PlatformError) return err;
    const rec = asRecord(err);
    const status = Number(rec.statusCode ?? rec.status ?? 0);
    const body = String(rec.body ?? rec.message ?? '');
    const probe = { status, body, message: body };

    if (this.responseValidator?.isBotChallenge?.(probe)) {
      this.#challengeCount += 1;
      console.warn(`⚠️ [INSTAGRAM] Bot challenge detected (attempt ${this.#challengeCount}/${MAX_CHALLENGE_RETRIES})`);
      if (this.#challengeCount >= MAX_CHALLENGE_RETRIES) {
        return new BotChallengeError({
          message: 'Instagram challenge/checkpoint persists after 3 attempts — rotating proxy',
          suggestedAction: SuggestedActions.ROTATE_PROXY,
          platform: 'instagram',
          details: { attempts: this.#challengeCount },
        });
      }
      return new BotChallengeError({
        message: 'Instagram challenge_required — pause and retry',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'instagram',
        isRetryable: true,
      });
    }
    if (this.responseValidator?.isRateLimit?.(probe) || status === 429) {
      console.warn('⚠️ [INSTAGRAM] Rate limit (429 / feedback_required)');
      return new RateLimitError({
        message: 'Instagram rate limit hit',
        suggestedAction: SuggestedActions.RATE_LIMIT_BACKOFF,
        platform: 'instagram',
      });
    }
    if (this.responseValidator?.isLoginWall?.(probe) || status === 401) {
      return new AuthSessionExpiredError({
        message: 'Instagram login required / session expired',
        platform: 'instagram',
      });
    }
    if (status === 404) {
      return new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: 'Instagram resource not found',
        statusCode: 404,
        suggestedAction: SuggestedActions.VERIFY_URL,
        platform: 'instagram',
      });
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /**
   * Ensure a session exists: restore from SessionManager → SocialAccount → credentials.
   * @param {string} [accountId]
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<import('../../../core/types.js').LoginResult | null>}
   */
  async ensureSession(accountId, session = {}) {
    const key = accountId || asString(session.accountId) || 'default';
    const cached = this.#sessionManager.get(key);
    if (cached) {
      this.cookies = asRecord(cached.cookies);
      return cached;
    }
    // Try injected SocialAccount store (encrypted persistence).
    if (this.#socialStore && typeof this.#socialStore.getSession === 'function') {
      const stored = await this.#socialStore.getSession(key).catch(() => null);
      if (stored) {
        this.cookies = asRecord(stored.cookies);
        this.#sessionManager.set(key, stored);
        return stored;
      }
    }
    // Fall back to provided credentials/cookies.
    const cred = this.#credentials || session;
    if (cred && (cred.sessionid || (cred.username && cred.password))) {
      const login = await this.login({ accountId: key, ...asRecord(cred) });
      return login;
    }
    return null;
  }

  /**
   * Login via cookie (`sessionid`/`ds_user_id`/`csrftoken`) or username/password.
   * Persists into SessionManager + optional SocialAccount writer (AC-3).
   * @param {Record<string, unknown>} credentials
   * @returns {Promise<import('../../../core/types.js').LoginResult>}
   */
  async login(credentials = {}) {
    const cred = asRecord(credentials);
    const accountId = asString(cred.accountId) || asString(cred.username) || `ig-${crypto.randomUUID()}`;

    /** @type {Record<string, unknown>} */
    let cookies = {};
    if (cred.sessionid || cred.cookies) {
      cookies = { ...asRecord(cred.cookies), ...(cred.sessionid ? { sessionid: cred.sessionid } : {}) };
      if (cred.ds_user_id) cookies.ds_user_id = cred.ds_user_id;
      if (cred.csrftoken) cookies.csrftoken = cred.csrftoken;
    } else if (cred.username && cred.password) {
      // Puppeteer transport performs the real browser login flow.
      cookies = await this.#browserLogin(asString(cred.username), asString(cred.password));
    } else {
      throw new AuthSessionExpiredError({
        message: 'Instagram login requires sessionid cookie or username+password',
        platform: 'instagram',
      });
    }

    this.cookies = cookies;
    /** @type {import('../../../core/types.js').LoginResult} */
    const result = {
      accountId,
      cookies,
      tokens: {},
      details: { platform: 'instagram', transport: this.transport },
    };
    await this.saveSession(accountId, result);
    return result;
  }

  /**
   * Persist a session to SessionManager (always) + SocialAccount (when a store writer is injected).
   * @param {string} accountId
   * @param {import('../../../core/types.js').LoginResult | Record<string, unknown>} session
   * @returns {Promise<void>}
   */
  async saveSession(accountId, session) {
    const resolved = session || { accountId, cookies: this.cookies || {}, tokens: {} };
    this.#sessionManager.set(accountId, /** @type {import('../../../core/types.js').LoginResult} */ (resolved));
    if (this.#socialStore && typeof this.#socialStore.upsertSession === 'function') {
      // resolveProxy throws ProxyDeadError when no residential proxy is healthy —
      // that must not fail session persistence, so capture it best-effort.
      let proxy = process.env.PROXY_URL || null;
      try {
        proxy = this.resolveProxy(accountId, this.requiresResidential, this.requiresAuth);
      } catch { proxy = process.env.PROXY_URL || null; }
      await this.#socialStore.upsertSession(accountId, {
        platform: 'instagram',
        cookies: resolved.cookies ?? this.cookies ?? {},
        proxy,
        metadata: { savedAt: new Date().toISOString(), transport: this.transport },
      }).catch((err) => console.warn(`⚠️ [INSTAGRAM] SocialAccount session persist failed: ${err?.message || err}`));
    }
  }

  /**
   * Restore a session: SessionManager first, then SocialAccount store. No re-login on hit.
   * @param {string} accountId
   * @returns {Promise<import('../../../core/types.js').LoginResult | null>}
   */
  async loadSession(accountId) {
    const cached = this.#sessionManager.get(accountId);
    if (cached) {
      this.cookies = asRecord(cached.cookies);
      return cached;
    }
    if (this.#socialStore && typeof this.#socialStore.getSession === 'function') {
      const stored = await this.#socialStore.getSession(accountId).catch(() => null);
      if (stored) {
        this.cookies = asRecord(stored.cookies);
        this.#sessionManager.set(accountId, stored);
        return stored;
      }
    }
    return null;
  }

  /**
   * Lazy-launch the stealth Puppeteer browser (only when transport==='puppeteer').
   * @param {string | null} [accountId]
   * @returns {Promise<import('../../adapters/base.js').AdapterPage>}
   */
  async #getPage(accountId = null) {
    if (this.transport === 'instagrapi' && !instagrapiAvailable()) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5010',
        message: 'instagrapi bridge not configured (set INSTAGRAPI_BIN or INSTAGRAPI_URL)',
        statusCode: 501,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
        platform: 'instagram',
      });
    }
    if (!this.#adapter) {
      const { PuppeteerAdapter } = await import('../../adapters/puppeteer.js');
      this.#adapter = new PuppeteerAdapter();
    }
    if (!this.#browser) {
      const proxy = this.resolveProxy(accountId, this.requiresResidential, this.requiresAuth);
      this.#browser = await this.#adapter.launch({ proxy });
    }
    // Reuse a single page (avoids leaking a tab per call).
    if (!this.#page) {
      this.#page = await this.#adapter.newPage(this.#browser, { userAgent: this.userAgent });
    }
    // Apply session cookies so requests are authenticated.
    const jar = this.cookies ? asRecord(this.cookies) : {};
    for (const [name, value] of Object.entries(jar)) {
      if (value == null || value === '') continue;
      await this.#adapter.setCookie(this.#page, { name, value: String(value), domain: '.instagram.com', path: '/' });
    }
    return this.#page;
  }

  /**
   * Real browser credential login — navigates to login page and submits the form.
   * Returns the harvested cookie jar.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Record<string, unknown>>}
   */
  async #browserLogin(username, password) {
    const page = await this.#getPage(username);
    await this.#adapter.goto(page, `${this.baseUrl}/accounts/login/`, { waitUntil: 'domcontentloaded' });
    // React controlled inputs ignore `el.value=` — use the native setter + dispatch
    // input/change so React's onChange fires, then submit.
    await this.#adapter.evaluate(page, (u, p) => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.querySelector('input[name="username"]'), u);
      setVal(document.querySelector('input[name="password"]'), p);
    }, username, password);
    await this.#adapter.evaluate(page, () => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    // Harvest cookies written by the login flow.
    const jar = await this.#adapter.evaluate(page, () =>
      Object.fromEntries(document.cookie.split('; ').map((c) => c.split('=')))
    );
    return asRecord(jar);
  }

  /**
   * Extract the embedded JSON (`window._sharedData` / `__additionalDataLoaded` / `graphql`)
   * from an Instagram HTML page rather than fragile DOM selectors.
   * @param {string} html
   * @returns {Record<string, unknown>}
   */
  #extractSharedData(html) {
    const text = String(html || '');
    // Parse `window._sharedData = {...};`
    const shared = text.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});<\/script>/);
    if (shared) { try { return asRecord(JSON.parse(shared[1])); } catch { /* fallthrough */ } }
    // Parse any `<script type="application/json" ...>{...}</script>` containing "graphql".
    const jsonBlocks = text.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonBlocks) {
      try {
        const parsed = asRecord(JSON.parse(m[1]));
        if (parsed.graphql || parsed.data || parsed.user || parsed.items) return parsed;
      } catch { /* try next block */ }
    }
    return {};
  }

  /**
   * Public web scrape of a profile page — pulls user + recent media from embedded JSON.
   * @param {string} username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getUserProfile(username, options = {}) {
    const user = String(username || '').replace(/^@/, '').trim();
    if (!user) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001',
        message: 'username is required', statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram',
      });
    }
    if (this.transport === 'instagrapi') return this.#instagrapiCall('user', { username: user, ...options });
    if (this.transport === 'http') return this.#httpUserProfile(user, options);

    const page = await this.#getPage(options.accountId || null);
    await this.#adapter.goto(page, `${this.baseUrl}/${encodeURIComponent(user)}/`, { waitUntil: 'domcontentloaded' });
    const html = await this.#adapter.getContent(page);
    const data = this.#extractSharedData(html);
    const entry = asRecord(asRecord(asRecord(data.entry_data).ProfilePage)[0] ?? data);
    const profile = asRecord(entry.user ?? asRecord(entry.graphql).user ?? asRecord(asRecord(entry.data).user));
    if (!Object.keys(profile).length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND, code: 'XACT_4040',
        message: `Instagram user "${user}" not found or profile payload empty`, statusCode: 404,
        suggestedAction: SuggestedActions.VERIFY_URL, platform: 'instagram',
      });
    }
    return { user: profile, raw: data };
  }

  /**
   * Thin `http` path — public `?__a=1&__d=dis` profile endpoint (best-effort).
   * @param {string} username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async #httpUserProfile(username, options = {}) {
    const url = this.buildUrl(`/${encodeURIComponent(username)}/`, { __a: '1', __d: 'dis' });
    const res = asRecord(await this.request('GET', url, { requiresAuth: false, skipResponseValidation: true }));
    const payload = asRecord(res.data ?? res);
    const user = asRecord(payload.user ?? asRecord(payload.graphql).user ?? asRecord(asRecord(payload.data).user));
    return { user, raw: payload };
  }

  /**
   * Recent media for a user — from the same embedded profile payload.
   * @param {string} username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getUserMedia(username, options = {}) {
    // When the caller already has the profile payload, pass `raw`/`user` to skip a
    // redundant fetch (getUserProfile already loaded the page once).
    let user = asRecord(options.__user);
    let raw = asRecord(options.__raw);
    if (!Object.keys(user).length) {
      const res = await this.getUserProfile(username, options);
      user = asRecord(res.user);
      raw = asRecord(res.raw);
    }
    const edgeMedia = asRecord(user.edge_owner_to_timeline_media ?? asRecord(asRecord(raw).graphql).edge_owner_to_timeline_media);
    const edges = Array.isArray(edgeMedia.edges) ? edgeMedia.edges : [];
    const items = edges.map((e) => asRecord(e).node ?? e);
    const pageInfo = asRecord(edgeMedia.page_info);
    return {
      items,
      pageInfo: { end_cursor: pageInfo.end_cursor ?? null, has_next_page: pageInfo.has_next_page === true },
      user,
    };
  }

  /**
   * Hashtag feed — `/explore/tags/<tag>/` embedded JSON or `?__a=1`.
   * @param {string} tag
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getHashtagFeed(tag, options = {}) {
    const clean = String(tag || '').replace(/^#/, '').trim();
    if (!clean) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001',
        message: 'tag is required', statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram',
      });
    }
    if (this.transport === 'instagrapi') return this.#instagrapiCall('hashtag', { tag: clean, ...options });
    if (this.transport === 'http') return this.#httpHashtag(clean, options);

    const page = await this.#getPage(options.accountId || null);
    await this.#adapter.goto(page, `${this.baseUrl}/explore/tags/${encodeURIComponent(clean)}/`, { waitUntil: 'domcontentloaded' });
    const html = await this.#adapter.getContent(page);
    const data = this.#extractSharedData(html);
    const tagNode = asRecord(asRecord(asRecord(data.entry_data).TagPage)[0]?.tag ?? asRecord(asRecord(data.graphql).hashtag));
    const media = asRecord(tagNode.edge_hashtag_to_media);
    const items = (Array.isArray(media.edges) ? media.edges : []).map((e) => asRecord(e).node ?? e);
    const pageInfo = asRecord(media.page_info);
    return { items, pageInfo: { end_cursor: pageInfo.end_cursor ?? null, has_next_page: pageInfo.has_next_page === true } };
  }

  /**
   * @param {string} tag
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async #httpHashtag(tag, options = {}) {
    const url = this.buildUrl(`/explore/tags/${encodeURIComponent(tag)}/`, { __a: '1', __d: 'dis' });
    const res = asRecord(await this.request('GET', url, { requiresAuth: false, skipResponseValidation: true }));
    const payload = asRecord(res.data ?? res);
    const tagNode = asRecord(payload.hashtag ?? asRecord(asRecord(payload.graphql).hashtag));
    const media = asRecord(tagNode.edge_hashtag_to_media);
    const items = (Array.isArray(media.edges) ? media.edges : []).map((e) => asRecord(e).node ?? e);
    const pageInfo = asRecord(media.page_info);
    return { items, pageInfo: { end_cursor: pageInfo.end_cursor ?? null, has_next_page: pageInfo.has_next_page === true } };
  }

  /**
   * Single post by shortcode or full URL.
   * @param {string} shortcodeOrUrl
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getPost(shortcodeOrUrl, options = {}) {
    const code = this.#resolveShortcode(shortcodeOrUrl);
    if (!code) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001',
        message: 'shortcode or url is required', statusCode: 400,
        suggestedAction: SuggestedActions.VERIFY_URL, platform: 'instagram',
      });
    }
    if (this.transport === 'instagrapi') return this.#instagrapiCall('post', { shortcode: code, ...options });
    if (this.transport === 'http') return this.#httpPost(code, options);

    const page = await this.#getPage(options.accountId || null);
    await this.#adapter.goto(page, `${this.baseUrl}/p/${encodeURIComponent(code)}/`, { waitUntil: 'domcontentloaded' });
    const html = await this.#adapter.getContent(page);
    const data = this.#extractSharedData(html);
    const postPage = asRecord(asRecord(asRecord(data.entry_data).PostPage)[0] ?? data);
    const media = asRecord(asRecord(postPage.graphql).shortcode_media ?? postPage.media ?? postPage);
    return { media, raw: data };
  }

  /**
   * @param {string} code
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async #httpPost(code, options = {}) {
    const url = this.buildUrl(`/p/${encodeURIComponent(code)}/`, { __a: '1', __d: 'dis' });
    const res = asRecord(await this.request('GET', url, { requiresAuth: false, skipResponseValidation: true }));
    const payload = asRecord(res.data ?? res);
    const media = asRecord(payload.media ?? asRecord(payload.graphql).shortcode_media ?? payload);
    return { media, raw: payload };
  }

  /**
   * Comments for a post (embedded edges).
   * @param {string} shortcode
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getComments(shortcode, options = {}) {
    const { media } = await this.getPost(shortcode, options);
    const edge = asRecord(media.edge_media_to_comment ?? media.comments);
    const items = (Array.isArray(edge.edges) ? edge.edges : []).map((e) => asRecord(e).node ?? e);
    const pageInfo = asRecord(edge.page_info);
    return { items, pageInfo: { end_cursor: pageInfo.end_cursor ?? null, has_next_page: pageInfo.has_next_page === true } };
  }

  /**
   * Resolve a shortcode from a `/p/<code>/` URL or bare code.
   * @param {string} input
   * @returns {string}
   */
  #resolveShortcode(input) {
    // Strip query/hash + trailing slashes so `?igsh=`/`/p/CODE/?x` resolve cleanly.
    const s = String(input || '').trim().split(/[?#]/)[0].replace(/\/+$/, '');
    const m = s.match(/instagram\.com\/(?:p|reel|reels|tv|share)\/([\w-]+)/i);
    if (m) return m[1];
    return /^[\w-]+$/.test(s) ? s : '';
  }

  /**
   * instagrapi subprocess bridge (JSON over stdio). Throws NOT_IMPLEMENTED when absent.
   * @param {string} action
   * @param {Record<string, unknown>} args
   * @returns {Promise<Record<string, unknown>>}
   */
  async #instagrapiCall(action, args) {
    if (!instagrapiAvailable()) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL, code: 'XACT_5010',
        message: 'instagrapi bridge not configured', statusCode: 501,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT, platform: 'instagram',
      });
    }
    const { execFile } = await import('node:child_process');
    const bin = process.env.INSTAGRAPI_BIN || 'python3';
    const scriptArgs = [process.env.INSTAGRAPI_SCRIPT || 'src/scrapers/social/instagram/bridge.py', action, JSON.stringify(args)];
    return new Promise((resolve, reject) => {
      execFile(bin, scriptArgs, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(this.#mapTransportError(err));
        try { resolve(asRecord(JSON.parse(String(stdout)))); }
        catch (e) { reject(e); }
      });
    });
  }

  /**
   * Close the browser bridge if it was launched.
   * @returns {Promise<void>}
   */
  async close() {
    // Adapter API is closePage / closeBrowser (not close) — matches Medium/Reddit bridges.
    if (this.#page && this.#adapter && typeof this.#adapter.closePage === 'function') {
      await this.#adapter.closePage(this.#page).catch(() => {});
    }
    if (this.#browser && this.#adapter && typeof this.#adapter.closeBrowser === 'function') {
      await this.#adapter.closeBrowser(this.#browser).catch(() => {});
    }
    this.#page = null;
    this.#browser = null;
  }
}

/** Helper to satisfy asString need. */
function asString(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

/**
 * @param {InstagramClient | Record<string, unknown>} [clientOrOptions]
 * @param {Record<string, unknown>} [options]
 * @returns {InstagramClient}
 */
export function createInstagramClient(clientOrOptions = {}, options = {}) {
  return clientOrOptions instanceof InstagramClient
    ? clientOrOptions
    : new InstagramClient({ ...clientOrOptions, ...options });
}
