// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyIpPool — centralized proxy management with quarantine, validation,
 * and two allocation strategies: sticky (per-account) and round-robin (no-auth).
 * @author nich (@nichxbt)
 * @license MIT
 */

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
    this.#proxies = (options.proxies || []).map((p) => this.#normalize(p));
    this.validateOnAdd = options.validateOnAdd !== false;
  }

  /**
   * @param {any} proxy
   * @returns {any}
   */
  #normalize(proxy) {
    return proxy;
  }

  /** @returns {number} */
  get healthyCount() {
    const now = Date.now();
    return this.#proxies.filter((p) => !this.#isQuarantined(p, now)).length;
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
    return typeof proxy === 'string' ? proxy : JSON.stringify(proxy);
  }

  /**
   * @param {any} proxy
   */
  add(proxy) {
    this.#proxies.push(this.#normalize(proxy));
  }

  /**
   * Get a proxy for no-auth platforms (round-robin over healthy proxies).
   * @returns {any | null}
   */
  getNext() {
    const now = Date.now();
    const healthy = this.#proxies.filter((p) => !this.#isQuarantined(p, now));
    if (!healthy.length) return null;
    const proxy = healthy[this.#roundRobinIndex % healthy.length];
    this.#roundRobinIndex = (this.#roundRobinIndex + 1) % healthy.length;
    return proxy;
  }

  /**
   * Get a sticky proxy for an authenticated account.
   * Returns the same proxy for the same account unless it is quarantined.
   * @param {string} accountId
   * @returns {any | null}
   */
  getStickyProxy(accountId) {
    const now = Date.now();
    const existing = this.#stickyMap.get(accountId);
    if (existing && !this.#isQuarantined(existing, now)) {
      return existing;
    }
    const healthy = this.#proxies.filter((p) => !this.#isQuarantined(p, now));
    if (!healthy.length) return null;
    // Use account hash to pick deterministically, fallback to round-robin
    const index = this.#hashAccount(accountId) % healthy.length;
    const proxy = healthy[index];
    this.#stickyMap.set(accountId, proxy);
    return proxy;
  }

  /**
   * @param {string} accountId
   * @returns {number}
   */
  #hashAccount(accountId) {
    let hash = 0;
    for (let i = 0; i < accountId.length; i++) {
      hash = ((hash << 5) - hash) + accountId.charCodeAt(i);
      hash |= 0;
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
   * @param {any} proxy
   * @returns {any[]}
   */
  getBrowserArgs(proxy) {
    const flags = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if (proxy?.server) {
      flags.push(`--proxy-server=${proxy.server}`);
    }
    return flags;
  }
}

export const globalProxyPool = new ProxyIpPool();
