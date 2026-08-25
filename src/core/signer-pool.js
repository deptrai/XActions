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
import pLimit from 'p-limit';

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
   * Clamps to capacity, discards empty tokens, and resets pointer to 0.
   * @param {string[]} tokens
   */
  refill(tokens) {
    if (!Array.isArray(tokens)) {
      this.#tokens = [];
    } else {
      this.#tokens = tokens
        .filter((t) => typeof t === 'string' && t.trim().length > 0)
        .slice(0, this.#capacity);
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

  /** @type {string | Function | null} */
  #warmupScript = null;

  /** @type {any[]} */
  #warmupArgs = [];

  /** @type {number} */
  #pendingSpawns = 0;

  /** @type {boolean} */
  #isClosed = false;

  /** @type {number} */
  #nextId = 1;

  /** @type {Set<Promise<unknown>>} */
  #inFlight = new Set();

  /** @type {boolean} */
  #closeBrowser = true;

  /** @type {import('p-limit').LimitFunction} */
  #evaluateLimiter;

  /**
   * @param {Object} [options]
   * @param {number} [options.minSize=4]
   * @param {number} [options.maxSize=8]
   * @param {number} [options.defaultTimeoutMs=3000]
   * @param {number} [options.warmupTimeoutMs=8000]
   * @param {any} [options.browser]
   * @param {any} [options.adapter]
   * @param {boolean} [options.closeBrowser=true]
   */
  constructor(options = {}) {
    const min = Number(options.minSize);
    const max = Number(options.maxSize);
    this.#minSize = Number.isInteger(min) && min > 0 ? min : 4;
    this.#maxSize = Number.isInteger(max) && max >= this.#minSize ? max : Math.max(8, this.#minSize);
    this.#defaultTimeoutMs = options.defaultTimeoutMs === undefined ? 3000 : Number(options.defaultTimeoutMs);
    this.#warmupTimeoutMs = options.warmupTimeoutMs === undefined ? 8000 : Number(options.warmupTimeoutMs);
    this.browser = options.browser || null;
    this.adapter = options.adapter || null;
    this.#closeBrowser = options.closeBrowser !== false;
    this.#evaluateLimiter = pLimit(this.#maxSize);
  }

  /**
   * Create and register a new worker page.
   * @param {boolean} [skipWarmup=false]
   * @returns {Promise<WorkerPageRecord>}
   */
  async #spawnPage(skipWarmup = false) {
    const canSpawn =
      (this.adapter && this.browser) ||
      (this.browser && typeof this.browser.newPage === 'function');
    if (!canSpawn) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '❌ Browser instance with newPage() is required to spawn signer worker page',
        suggestedAction: SuggestedActions.RELOGIN,
      });
    }

    this.#pendingSpawns++;
    try {
      const page = this.adapter
        ? await this.adapter.newPage(this.browser)
        : await this.browser.newPage();
      const record = {
        id: `worker_page_${this.#nextId++}`,
        page,
        load: 0,
        state: /** @type {'idle' | 'busy' | 'dead'} */ ('idle'),
      };
      this.#pages.push(record);

      if (!skipWarmup && this.#warmupScript) {
        await this.#executeOnPage(record, this.#warmupScript, this.#warmupArgs, {
          timeoutMs: this.#warmupTimeoutMs,
          warmup: true,
        }).catch((err) => {
          console.warn(`⚠️ Warmup failed for page ${record.id}: ${err.message}`);
        });
      }

      return record;
    } finally {
      this.#pendingSpawns = Math.max(0, this.#pendingSpawns - 1);
    }
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
        message: '❌ Cannot init closed SignerWorkerPagePool',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    if (options.warmupScript) {
      this.#warmupScript = options.warmupScript;
      this.#warmupArgs = options.warmupArgs || [];
    }

    // Spawn up to minSize pages
    const aliveCount = this.#pages.filter((p) => p.state !== 'dead').length;
    const needed = Math.max(0, this.#minSize - aliveCount);
    const spawnPromises = [];
    for (let i = 0; i < needed; i++) {
      spawnPromises.push(this.#spawnPage(true));
    }
    await Promise.all(spawnPromises);

    // Warmup initial batch of pages
    if (this.#warmupScript) {
      const warmupPromises = this.#pages.map((p) =>
        this.#executeOnPage(p, this.#warmupScript, this.#warmupArgs, {
          timeoutMs: this.#warmupTimeoutMs,
          warmup: true,
        }).catch((err) => {
          console.warn(`⚠️ Warmup failed for page ${p.id}: ${err.message}`);
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
        message: '❌ SignerWorkerPagePool is closed',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    // Clean dead pages
    this.#pages = this.#pages.filter((p) => p.state !== 'dead');
    const alivePages = this.#pages;
    const currentTotal = alivePages.length + this.#pendingSpawns;

    // If all existing alive pages are busy and we are below maxSize, spawn a new page
    if ((alivePages.length === 0 || alivePages.every((p) => p.load > 0)) && currentTotal < this.#maxSize) {
      try {
        const newWorker = await this.#spawnPage(false);
        newWorker.load++;
        newWorker.state = 'busy';
        return newWorker;
      } catch (err) {
        if (alivePages.length === 0) throw err;
      }
    }

    if (alivePages.length === 0) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '❌ All worker pages are dead or exceeded maxSize',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    // Least-Connections sort
    alivePages.sort((a, b) => a.load - b.load);
    const chosen = alivePages[0];
    chosen.load++;
    chosen.state = 'busy';
    return chosen;
  }

  /**
   * Execute evaluation on a specific page with timeout and error tracking.
   * @param {WorkerPageRecord} worker
   * @param {string | Function | null | undefined} script
   * @param {any[]} args
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.warmup]
   * @returns {Promise<any>}
   */
  async #executeOnPage(worker, script, args, options = {}) {
    const timeoutMs = options.timeoutMs || (options.warmup ? this.#warmupTimeoutMs : this.#defaultTimeoutMs);
    let timeoutTimer = null;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error(`❌ Execution timed out after ${timeoutMs}ms on ${worker.id}`));
        }, timeoutMs);
      });
      // Suppress unhandled rejection if execPromise wins the race
      timeoutPromise.catch(() => {});

      const execPromise = (async () => {
        const page = worker.page;
        if (!script) {
          throw new Error(`❌ Script must be provided to evaluate on ${worker.id}`);
        }
        if (typeof page.evaluate === 'function') {
          return await page.evaluate(script, ...args);
        } else if (page._native && typeof page._native.evaluate === 'function') {
          return await page._native.evaluate(script, ...args);
        }
        throw new Error(`❌ Page ${worker.id} has no evaluate() method`);
      })();

      // Suppress unhandled rejection if timeoutPromise wins the race
      execPromise.catch(() => {});

      const result = await Promise.race([execPromise, timeoutPromise]);
      return result;
    } catch (err) {
      // Mark page dead on failure or timeout and release resource
      worker.state = 'dead';
      try {
        if (typeof worker.page.close === 'function') {
          await worker.page.close().catch(() => {});
        } else if (worker.page._native && typeof worker.page._native.close === 'function') {
          await worker.page._native.close().catch(() => {});
        }
      } catch {}
      this.#pages = this.#pages.filter((p) => p !== worker);
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
    if (this.#isClosed) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '❌ SignerWorkerPagePool is closed',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }
    return this.#evaluateLimiter(() => this.#doEvaluate(script, args, options));
  }

  /**
   * Internal evaluate with retry, concurrency limit, and in-flight tracking.
   * @param {string | Function} script
   * @param {any[]} args
   * @param {Object} options
   * @returns {Promise<any>}
   */
  async #doEvaluate(script, args, options) {
    if (this.#isClosed) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: '❌ SignerWorkerPagePool is closed',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }
    const evaluationPromise = this.#evaluateInternal(script, args, options);
    this.#inFlight.add(evaluationPromise);
    try {
      return await evaluationPromise;
    } finally {
      this.#inFlight.delete(evaluationPromise);
    }
  }

  /**
   * Retry circuit breaker for worker page evaluation.
   * @param {string | Function} script
   * @param {any[]} args
   * @param {Object} options
   * @returns {Promise<any>}
   */
  async #evaluateInternal(script, args, options) {
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
        if (this.#pages.length < this.#minSize && (this.#pages.length + this.#pendingSpawns) < this.#maxSize) {
          try {
            await this.#spawnPage(false);
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
      message: `❌ Evaluation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      cause: lastError,
    });
  }

  /**
   * Close all worker pages, drain in-flight work, and release pool resources.
   * @param {Object} [options]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.closeBrowser]
   * @returns {Promise<void>}
   */
  async close(options = {}) {
    if (this.#isClosed) return;
    this.#isClosed = true;

    const closeBrowser = options.closeBrowser !== undefined ? options.closeBrowser : this.#closeBrowser;

    if (this.#inFlight.size > 0) {
      const timeoutMs = options.timeoutMs ?? 3000 + this.#maxSize * this.#defaultTimeoutMs;
      try {
        await Promise.race([
          Promise.all([...this.#inFlight]),
          new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error('⚠️ SignerWorkerPagePool in-flight evaluations did not drain before close')), timeoutMs);
            if (t && typeof t.unref === 'function') t.unref();
          }),
        ]);
      } catch (err) {
        console.warn(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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

    if (closeBrowser && this.adapter && this.browser) {
      try {
        await this.adapter.closeBrowser(this.browser);
      } catch {}
    }
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
