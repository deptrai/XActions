// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyIpPool — centralized proxy management stub.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class ProxyIpPool {
  /** @type {any[]} */
  #proxies = [];

  /** @type {Set<string>} */
  #quarantined = new Set();

  /**
   * @param {Object} [options]
   * @param {any[]} [options.proxies]
   */
  constructor(options = {}) {
    this.#proxies = options.proxies || [];
  }

  /** @returns {number} */
  get healthyCount() {
    return this.#proxies.length - this.#quarantined.size;
  }

  /** @returns {number} */
  get totalCount() {
    return this.#proxies.length;
  }

  /**
   * @param {any} proxy
   */
  add(proxy) {
    this.#proxies.push(proxy);
  }

  /**
   * @returns {any | null}
   */
  getNext() {
    for (const proxy of this.#proxies) {
      const key = JSON.stringify(proxy);
      if (!this.#quarantined.has(key)) return proxy;
    }
    return null;
  }

  /**
   * @param {any} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs = 5 * 60 * 1000) {
    const key = JSON.stringify(proxy);
    this.#quarantined.add(key);
    setTimeout(() => this.#quarantined.delete(key), durationMs);
  }
}

export const globalProxyPool = new ProxyIpPool();
