// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tiered Hybrid Signer Engine — token ring + worker page pool.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class PreSignedTokenRing {
  /** @type {string[]} */
  #tokens = [];

  /** @type {number} */
  #capacity = 50;

  /** @type {number} */
  #index = 0;

  /**
   * @param {Object} [options]
   * @param {number} [options.capacity]
   */
  constructor(options = {}) {
    this.#capacity = options.capacity || 50;
  }

  /**
   * @param {string[]} tokens
   */
  refill(tokens) {
    this.#tokens = tokens.slice(0, this.#capacity);
    this.#index = 0;
  }

  /** @returns {string | null} */
  next() {
    if (!this.#tokens.length) return null;
    const token = this.#tokens[this.#index % this.#tokens.length];
    this.#index = (this.#index + 1) % this.#tokens.length;
    return token;
  }

  /** @returns {number} */
  get size() {
    return this.#tokens.length;
  }
}

export class SignerWorkerPagePool {
  /** @type {any[]} */
  #pages = [];

  /** @type {number} */
  #minSize = 4;

  /** @type {number} */
  #maxSize = 8;

  /** @type {number} */
  #defaultTimeoutMs = 3000;

  /** @type {number} */
  #warmupTimeoutMs = 8000;

  /**
   * @param {Object} [options]
   * @param {number} [options.minSize]
   * @param {number} [options.maxSize]
   * @param {any} [options.browser]
   */
  constructor(options = {}) {
    this.#minSize = options.minSize || 4;
    this.#maxSize = options.maxSize || 8;
    this.browser = options.browser;
  }

  /** @returns {Promise<void>} */
  async init() {
    throw new Error('Method not implemented: SignerWorkerPagePool.init()');
  }

  /**
   * @param {string} script
   * @param {any[]} [args]
   * @returns {Promise<any>}
   */
  async evaluate(script, args) {
    throw new Error('Method not implemented: SignerWorkerPagePool.evaluate()');
  }

  /** @returns {Promise<void>} */
  async close() {
    throw new Error('Method not implemented: SignerWorkerPagePool.close()');
  }
}
