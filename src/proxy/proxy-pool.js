// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyIpPool — centralized proxy management with quarantine, validation,
 * and two allocation strategies: sticky (per-account) and round-robin (no-auth).
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { formatProxyUrl, getProxyAgent, normalizeProxy } from './providers.js';

const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;

export class ProxyIpPool {
  /** @type {any[]} */
  #proxies = [];

  /** @type {Map<string, number>} */
  #quarantined = new Map();

  /** @type {Map<string, string>} */
  #stickyMap = new Map();

  /** @type {number} */
  #roundRobinIndex = 0;

  /**
   * @param {Object} [options]
   * @param {any[]} [options.proxies]
   * @param {boolean} [options.validateOnAdd]
   */
  constructor(options = {}) {
    this.validateOnAdd = options.validateOnAdd !== false;
    this.#proxies = (options.proxies || []).map((p) => this.validateOnAdd ? this.#normalize(p) : p);
  }

  /**
   * @param {any} proxy
   * @returns {import('./providers.js').NormalizedProxy}
   */
  #normalize(proxy) {
    return normalizeProxy(proxy);
  }

  /** @returns {any[]} */
  get healthyProxies() {
    const now = Date.now();
    return this.#proxies
      .map((p) => this.#normalize(p))
      .filter((p) => !this.#isQuarantined(p, now));
  }

  /** @returns {number} */
  get healthyCount() {
    const now = Date.now();
    return this.#proxies.reduce((count, p) => {
      const normalized = this.#normalize(p);
      return this.#isQuarantined(normalized, now) ? count : count + 1;
    }, 0);
  }

  /** @returns {number} */
  get totalCount() {
    return this.#proxies.length;
  }

  /** @returns {string[]} */
  get antiLeakFlags() {
    return ['remote-dns', 'disable-non-proxied-udp'];
  }

  /**
   * @param {any} proxy
   * @param {number} [now]
   * @returns {boolean}
   */
  #isQuarantined(proxy, now = Date.now()) {
    const key = this.#key(proxy);
    const until = this.#quarantined.get(key);
    if (!until) return false;
    if (now >= until) {
      this.#quarantined.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Build a canonical key for a proxy using URL-encoded credentials and bracketed IPv6.
   * @param {any} proxy
   * @returns {string}
   */
  #key(proxy) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required for key operation',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const normalized = this.#normalize(proxy);
    return formatProxyUrl(normalized);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  #hasKey(key) {
    return this.#proxies.some((p) => this.#key(p) === key);
  }

  /**
   * @param {string} key
   * @param {number} [now]
   * @returns {any | null}
   */
  #findHealthyByKey(key, now = Date.now()) {
    for (const p of this.#proxies) {
      const normalized = this.#normalize(p);
      if (this.#key(normalized) === key && !this.#isQuarantined(normalized, now)) {
        return normalized;
      }
    }
    return null;
  }

  /**
   * @param {any} proxy
   */
  add(proxy) {
    this.#proxies.push(this.validateOnAdd ? this.#normalize(proxy) : proxy);
  }

  /**
   * Get the next healthy proxy using round-robin rotation against the total pool.
   * @returns {any | null}
   */
  getNext() {
    const total = this.#proxies.length;
    if (total === 0) return null;

    const now = Date.now();
    for (let i = 0; i < total; i++) {
      const idx = (this.#roundRobinIndex + i) % total;
      const p = this.#proxies[idx];
      const normalized = this.#normalize(p);
      if (this.#isQuarantined(normalized, now)) continue;

      this.#roundRobinIndex = (idx + 1) % total;
      return { ...normalized };
    }
    return null;
  }

  /**
   * Alias for getNext() to satisfy round-robin proxy contract.
   * @returns {any | null}
   */
  getRoundRobinProxy() {
    return this.getNext();
  }

  /**
   * Alias for getNext() to satisfy rotating proxy contract.
   * @returns {any | null}
   */
  getRotatingProxy() {
    return this.getNext();
  }

  /**
   * Get a deterministic sticky proxy for an account ID.
   * @param {string} accountId
   * @returns {any | null}
   */
  getStickyProxy(accountId) {
    const total = this.#proxies.length;
    if (total === 0) return null;

    const accountKey = String(accountId || '');
    const boundKey = this.#stickyMap.get(accountKey);
    if (boundKey) {
      const existing = this.#findHealthyByKey(boundKey);
      if (existing) return { ...existing };
      this.#stickyMap.delete(accountKey);
    }

    const now = Date.now();
    const startIndex = this.#hashAccount(accountKey) % total;
    for (let i = 0; i < total; i++) {
      const idx = (startIndex + i) % total;
      const p = this.#proxies[idx];
      const normalized = this.#normalize(p);
      if (this.#isQuarantined(normalized, now)) continue;

      this.#stickyMap.set(accountKey, this.#key(normalized));
      return { ...normalized };
    }
    return null;
  }

  /**
   * @param {string} accountId
   * @returns {number}
   */
  #hashAccount(accountId) {
    const str = String(accountId || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }

  /**
   * Mark a proxy as unavailable for a duration and break any sticky bindings.
   * @param {any} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs = DEFAULT_QUARANTINE_MS) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to quarantine',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if (durationMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Quarantine duration must be positive',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const key = this.#key(proxy);
    if (!this.#hasKey(key)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is not a member of the pool',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.#quarantined.set(key, Date.now() + durationMs);

    // Remove any sticky bindings using this proxy.
    for (const [accountId, assigned] of this.#stickyMap) {
      if (assigned === key) {
        this.#stickyMap.delete(accountId);
      }
    }
  }

  /**
   * @returns {boolean}
   */
  isAllQuarantined() {
    const now = Date.now();
    if (this.#proxies.length === 0) return true;
    return this.#proxies.every((p) => this.#isQuarantined(p, now));
  }

  /**
   * @returns {void}
   */
  pruneExpiredQuarantines() {
    const now = Date.now();
    for (const [key, until] of this.#quarantined) {
      if (now >= until) this.#quarantined.delete(key);
    }
  }

  /**
   * Convert normalized proxy to Playwright proxy configuration object.
   * @param {any} proxy
   * @returns {{ server: string, username?: string, password?: string } | null}
   */
  static toPlaywrightProxy(proxy) {
    if (!proxy) return null;
    const normalized = typeof proxy === 'string' ? normalizeProxy(proxy) : normalizeProxy(proxy);
    const result = /** @type {{ server: string, username?: string, password?: string }} */ ({ server: normalized.server });
    if (normalized.username !== undefined) result.username = normalized.username;
    if (normalized.password !== undefined) result.password = normalized.password;
    return result;
  }

  /**
   * @param {any} proxy
   * @returns {{ server: string, username?: string, password?: string } | null}
   */
  toPlaywrightProxy(proxy) {
    return ProxyIpPool.toPlaywrightProxy(proxy);
  }

  /**
   * Return Chromium launch flags for the proxy, including anti-leak settings.
   *
   * Throws on invalid proxy input and never falls back to a raw, unvalidated string.
   *
   * @param {any} proxy
   * @returns {string[]}
   */
  getBrowserArgs(proxy) {
    const flags = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if (!proxy) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to build browser args',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const normalized = this.#normalize(proxy);
    flags.push(`--proxy-server=${normalized.server}`);

    const proxyHost = normalized.host.includes(':') && !normalized.host.startsWith('[')
      ? `[${normalized.host}]`
      : normalized.host;
    flags.push(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxyHost}`);

    return flags;
  }

  /**
   * Factory for creating client-specific proxy agent without direct connection fallback.
   * @param {any} proxy
   * @param {Object} [options]
   * @param {'undici' | 'got'} [options.client='undici']
   * @returns {any}
   */
  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

  /**
   * @param {any} proxy
   * @param {Object} [options]
   * @param {'undici' | 'got'} [options.client='undici']
   * @returns {any}
   */
  static getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }
}

export const globalProxyPool = new ProxyIpPool();
