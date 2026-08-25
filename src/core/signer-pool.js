// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tiered Hybrid Signer Engine — token ring + worker page pool.
 *
 * Provides O(1) synchronous pre-signed token retrieval for lightweight session tokens,
 * and an adaptive pool of background worker pages (4–8 pages) for dynamic JavaScript signing
 * algorithms (e.g. x-client-transaction-id, a_bogus) with circuit-breaking and least-connections routing.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

/**
 * Pre-Signed Token Ring for O(1) synchronous token allocation.
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
   * @param {number} [options.capacity=50]
   */
  constructor(options = {}) {
    const cap = Number(options.capacity);
    this.#capacity = Number.isInteger(cap) && cap > 0 ? cap : 50;
  }

  /**
   * Refill the ring with an array of pre-signed tokens.
   * Clamps to capacity and resets the pointer to 0.
   * @param {string[]} tokens
   */
  refill(tokens) {
    if (!Array.isArray(tokens)) {
      this.#tokens = [];
    } else {
      this.#tokens = tokens.slice(0, this.#capacity);
    }
    this.#index = 0;
  }

  /**
   * Get the next token in O(1) round-robin order.
   * @returns {string | null}
   */
  next() {
    if (this.#tokens.length === 0) return null;
    const token = this.#tokens[this.#index % this.#tokens.length];
    this.#index = (this.#index + 1) % this.#tokens.length;
    return token;
  }

  /** @returns {number} Current number of tokens in the ring */
  get size() {
    return this.#tokens.length;
  }

  /** @returns {number} Maximum capacity of the ring */
  get capacity() {
    return this.#capacity;
  }

  /** @returns {boolean} True if ring has no tokens */
  get isEmpty() {
    return this.#tokens.length === 0;
  }
}

/**
 * @typedef {Object} WorkerPageRecord
 * @property {string} id
 * @property {any} page - Adapter Page or Native Page
 * @property {number} load - Number of active/pending operations
 * @property {'idle' | 'busy' | 'dead'} state - Worker status
 */

/**
 * Signer Worker Page Pool for parallel dynamic script evaluations.
 */
export class SignerWorkerPagePool {
  /** @type {WorkerPageRecord[]} */
  #pages = [];

  /** @type {number} */
  #minSize = 4;

  /** @type {number} */
  #maxSize = 8;

  /** @type {number} */
  #defaultTimeoutMs = 3000;

  /** @type {number} */
  #warmupTimeoutMs = 8000;

  /** @type {boolean} */
  #isClosed = false;

  /** @type {number} */
  #nextId = 1;

  /**
   * @param {Object} [options]
   * @param {number} [options.minSize=4]
   * @param {number} [options.maxSize=8]
   * @param {number} [options.defaultTimeoutMs=3000]
   * @param {number} [options.warmupTimeoutMs=8000]
   * @param {any} [options.browser]
   */
  constructor(options = {}) {
    const min = Number(options.minSize);
    const max = Number(options.maxSize);
    this.#minSize = Number.isInteger(min) && min > 0 ? min : 4;
    this.#maxSize = Number.isInteger(max) && max >= this.#minSize ? max : Math.max(8, this.#minSize);
    this.#defaultTimeoutMs = Number(options.defaultTimeoutMs) || 3000;
    this.#warmupTimeoutMs = Number(options.warmupTimeoutMs) || 8000;
    this.browser = options.browser || null;
  }

  /**
   * Create and register a new worker page.
   * @returns {Promise<WorkerPageRecord>}
   */
  async #spawnPage() {
    if (!this.browser || typeof this.browser.newPage !== 'function') {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '[SIGNER ERROR] Browser instance with newPage() is required to spawn signer worker page',
        suggestedAction: SuggestedActions.RELOGIN,
      });
    }

    const page = await this.browser.newPage();
    const record = {
      id: `worker_page_${this.#nextId++}`,
      page,
      load: 0,
      state: /** @type {'idle' | 'busy' | 'dead'} */ ('idle'),
    };
    this.#pages.push(record);
    return record;
  }

  /**
   * Initialize worker pages up to minSize.
   * @param {Object} [options]
   * @param {string | Function} [options.warmupScript]
   * @param {any[]} [options.warmupArgs]
   * @returns {Promise<void>}
   */
  async init(options = {}) {
    if (this.#isClosed) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '[SIGNER ERROR] Cannot init closed SignerWorkerPagePool',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    // Spawn up to minSize pages
    const aliveCount = this.#pages.filter((p) => p.state !== 'dead').length;
    const needed = Math.max(0, this.#minSize - aliveCount);
    const spawnPromises = [];
    for (let i = 0; i < needed; i++) {
      spawnPromises.push(this.#spawnPage());
    }
    await Promise.all(spawnPromises);

    // Warmup pages if warmup script is provided
    if (options.warmupScript) {
      const warmupPromises = this.#pages.map((p) =>
        this.#executeOnPage(p, options.warmupScript, options.warmupArgs || [], {
          timeoutMs: this.#warmupTimeoutMs,
          warmup: true,
        }).catch((err) => {
          console.warn(`[SIGNER WARNING] Warmup failed for page ${p.id}: ${err.message}`);
        })
      );
      await Promise.all(warmupPromises);
    }
  }

  /**
   * Select a healthy worker page using Least-Connections routing.
   * @returns {Promise<WorkerPageRecord>}
   */
  async #getLeastLoadedPage() {
    if (this.#isClosed) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '[SIGNER ERROR] SignerWorkerPagePool is closed',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    // Filter alive pages
    const alivePages = this.#pages.filter((p) => p.state !== 'dead');

    // If no idle pages and we can scale up to maxSize, spawn a new page
    if ((alivePages.length === 0 || alivePages.every((p) => p.load > 0)) && this.#pages.length < this.#maxSize) {
      try {
        return await this.#spawnPage();
      } catch (err) {
        if (alivePages.length === 0) throw err;
      }
    }

    if (alivePages.length === 0) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '[SIGNER ERROR] All worker pages are dead or exceeded maxSize',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    // Least-Connections sort
    alivePages.sort((a, b) => a.load - b.load);
    return alivePages[0];
  }

  /**
   * Execute evaluation on a specific page with timeout and error tracking.
   * @param {WorkerPageRecord} worker
   * @param {string | Function | undefined} script
   * @param {any[]} args
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.warmup]
   * @returns {Promise<any>}
   */
  async #executeOnPage(worker, script, args, options = {}) {
    const timeoutMs = options.timeoutMs || (options.warmup ? this.#warmupTimeoutMs : this.#defaultTimeoutMs);
    worker.load++;
    worker.state = 'busy';

    let timeoutTimer = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error(`[SIGNER TIMEOUT] Execution timed out after ${timeoutMs}ms on ${worker.id}`));
        }, timeoutMs);
      });

      const execPromise = (async () => {
        const page = worker.page;
        if (typeof page.evaluate === 'function') {
          return await page.evaluate(script, ...args);
        } else if (page._native && typeof page._native.evaluate === 'function') {
          return await page._native.evaluate(script, ...args);
        }
        throw new Error(`[SIGNER ERROR] Page ${worker.id} has no evaluate() method`);
      })();

      const result = await Promise.race([execPromise, timeoutPromise]);
      return result;
    } catch (err) {
      // Mark page dead on failure or timeout
      worker.state = 'dead';
      try {
        if (typeof worker.page.close === 'function') {
          await worker.page.close().catch(() => {});
        } else if (worker.page._native && typeof worker.page._native.close === 'function') {
          await worker.page._native.close().catch(() => {});
        }
      } catch {}
      throw err;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      worker.load = Math.max(0, worker.load - 1);
      if (worker.state !== 'dead') {
        worker.state = worker.load === 0 ? 'idle' : 'busy';
      }
    }
  }

  /**
   * Evaluate a script on a worker page with retry circuit breaker.
   * @param {string | Function} script
   * @param {any[]} [args=[]]
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.warmup=false]
   * @returns {Promise<any>}
   */
  async evaluate(script, args = [], options = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      let worker;
      try {
        worker = await this.#getLeastLoadedPage();
      } catch (err) {
        lastError = err;
        break;
      }

      try {
        return await this.#executeOnPage(worker, script, args, options);
      } catch (err) {
        lastError = err;
        // Attempt to spawn replacement if below maxSize
        if (this.#pages.filter((p) => p.state !== 'dead').length < this.#minSize && this.#pages.length < this.#maxSize) {
          try {
            await this.#spawnPage();
          } catch {}
        }
      }
    }

    if (lastError instanceof PlatformError) {
      throw lastError;
    }

    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: `[SIGNER ERROR] Evaluation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      cause: lastError,
    });
  }

  /**
   * Close all worker pages and release pool resources.
   * @returns {Promise<void>}
   */
  async close() {
    this.#isClosed = true;
    const closePromises = this.#pages.map(async (worker) => {
      worker.state = 'dead';
      try {
        if (typeof worker.page.close === 'function') {
          await worker.page.close();
        } else if (worker.page._native && typeof worker.page._native.close === 'function') {
          await worker.page._native.close();
        }
      } catch {}
    });

    await Promise.all(closePromises);
    this.#pages = [];
  }

  /** @returns {number} Total pages count in the pool */
  get size() {
    return this.#pages.length;
  }

  /** @returns {number} Number of alive worker pages */
  get activeCount() {
    return this.#pages.filter((p) => p.state !== 'dead').length;
  }

  /** @returns {number} Number of idle worker pages */
  get idleCount() {
    return this.#pages.filter((p) => p.state === 'idle').length;
  }

  /** @returns {number} Minimum size */
  get minSize() {
    return this.#minSize;
  }

  /** @returns {number} Maximum size */
  get maxSize() {
    return this.#maxSize;
  }
}
