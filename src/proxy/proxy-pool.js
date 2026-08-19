// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyIpPool — centralized proxy management with quarantine, validation,
 * and two allocation strategies: sticky (per-account) and round-robin (no-auth).
 * @author nich (@nichxbt)
 * @license MIT
 */

import { normalizeProxy, getProxyAgent } from './providers.js';

export class ProxyIpPool {
  /** @type {any[]} */
  #proxies = [];

  /** @type {Map<string, number>} */
  #quarantined = new Map();

  /** @type {Map<string, any>} */
  #stickyMap = new Map();

  /** @type {number} */
  #roundRobinIndex = 0;

  /** @type {Set<string>} */
  #antiLeakFlags = new Set([
    'remote-dns',
    'disable-non-proxied-udp',
  ]);

  /**
   * @param {Object} [options]
   * @param {any[]} [options.proxies]
   * @param {boolean} [options.validateOnAdd]
   */
  constructor(options = {}) {
    this.validateOnAdd = options.validateOnAdd !== false;
    this.#proxies = (options.proxies || []).map((p) => this.#normalize(p));
  }

  /**
   * @param {any} proxy
   * @returns {any}
   */
  #normalize(proxy) {
    return normalizeProxy(proxy);
  }

  /** @returns {any[]} */
  get healthyProxies() {
    const now = Date.now();
    return this.#proxies.filter((p) => !this.#isQuarantined(p, now));
  }

  /** @returns {number} */
  get healthyCount() {
    return this.healthyProxies.length;
  }

  /** @returns {number} */
  get totalCount() {
    return this.#proxies.length;
  }

  /** @returns {string[]} */
  get antiLeakFlags() {
    return Array.from(this.#antiLeakFlags);
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
   * @param {any} proxy
   * @returns {string}
   */
  #key(proxy) {
    if (!proxy) return '';
    try {
      const normalized = this.#normalize(proxy);
      const authKey = normalized.username || normalized.password ? `${normalized.username || ''}:${normalized.password || ''}@` : '';
      return `${normalized.scheme}://${authKey}${normalized.host}:${normalized.port}`;
    } catch {
      return typeof proxy === 'string' ? proxy : JSON.stringify(proxy);
    }
  }

  /**
   * @param {any} proxy
   */
  add(proxy) {
    this.#proxies.push(this.#normalize(proxy));
  }

  /**
   * Get the next healthy proxy using round-robin rotation.
   * @returns {any | null}
   */
  getNext() {
    const healthy = this.healthyProxies;
    if (healthy.length === 0) return null;

    const proxy = healthy[this.#roundRobinIndex % healthy.length];
    this.#roundRobinIndex = (this.#roundRobinIndex + 1) % healthy.length;
    return proxy;
  }

  /**
   * Get a deterministic sticky proxy for an account ID.
   * @param {string} accountId
   * @returns {any | null}
   */
  getStickyProxy(accountId) {
    const healthy = this.healthyProxies;
    if (healthy.length === 0) return null;

    const boundKey = this.#stickyMap.get(accountId);
    if (boundKey) {
      const existing = healthy.find((p) => this.#key(p) === boundKey);
      if (existing) return existing;
      this.#stickyMap.delete(accountId);
    }

    const index = this.#hashAccount(accountId) % healthy.length;
    const selected = healthy[index];
    this.#stickyMap.set(accountId, this.#key(selected));
    return selected;
  }

  /**
   * @param {string} accountId
   * @returns {number}
   */
  #hashAccount(accountId) {
    const str = typeof accountId === 'string' ? accountId : String(accountId || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /**
   * @param {any} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs = 5 * 60 * 1000) {
    const key = this.#key(proxy);
    this.#quarantined.set(key, Date.now() + durationMs);
    // Remove any sticky bindings using this proxy
    for (const [accountId, assigned] of this.#stickyMap) {
      if (this.#key(assigned) === key) {
        this.#stickyMap.delete(accountId);
      }
    }
  }

  /**
   * @returns {boolean}
   */
  isAllQuarantined() {
    const now = Date.now();
    return this.#proxies.length > 0 && this.#proxies.every((p) => this.#isQuarantined(p, now));
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
    const normalized = typeof proxy === 'string' ? normalizeProxy(proxy) : proxy;
    const result = { server: normalized.server || `${normalized.scheme || 'http'}://${normalized.host}:${normalized.port}` };
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
   * @param {any} proxy
   * @returns {string[]}
   */
  getBrowserArgs(proxy) {
    const flags = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if (!proxy) return flags;
    try {
      const normalized = typeof proxy === 'string' ? normalizeProxy(proxy) : (proxy.server ? proxy : normalizeProxy(proxy));
      if (normalized?.server) {
        flags.push(`--proxy-server=${normalized.server}`);
      }
    } catch {
      if (typeof proxy === 'string' && proxy.trim()) {
        flags.push(`--proxy-server=${proxy.trim()}`);
      } else if (proxy?.server) {
        flags.push(`--proxy-server=${proxy.server}`);
      }
    }
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
