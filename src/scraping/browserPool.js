// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Browser Page Pool (Epic 53 / AD-24)
 *
 * One shared browser process serves N concurrent scrape jobs via per-job
 * pages/contexts — replaces launch-per-job (~300–500MB/job → ~9MB).
 *
 * - Isolated `browserContext` per job by default (incognito-equivalent —
 *   cookie/storage do NOT leak cross-job; spike-verified `isoLeak=false`).
 * - Backend-aware context ceiling (AD-24 Rule 3): chrome ~5 contexts/browser
 *   (spike knee @ N=8 on context-create serialization), obscura ~3
 *   (nav/render is the bottleneck — sharding across processes is 53.4).
 * - Opt-in only: `XACTIONS_BROWSER_POOL_SIZE` (0/undefined = caller stays on
 *   launch-per-job; this module is never imported into default paths).
 * - Teardown honors AD-23 via `closeStealthBrowser` (obscura→disconnect,
 *   chrome→close). `release()` closes the job's page+context only — the
 *   shared browser stays alive.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { launchStealthBrowser, createStealthPage, closeStealthBrowser } from './stealthBrowser.js';

/**
 * @typedef {object} BrowserPoolOptions
 * @property {number} [size] - max concurrent slots (default env `XACTIONS_BROWSER_POOL_SIZE`, then 4).
 * @property {number} [contextsPerBrowser] - isolated-context ceiling per browser before spawning another (default 5 chrome / 3 obscura).
 * @property {number} [acquireTimeoutMs] - max wait for a slot; 0 = forever.
 * @property {string} [backend] - 'chrome' | 'obscura'.
 * @property {string} [fallbackBackend] - default 'none' inside a pool.
 * @property {string} [wsEndpoint] - obscura CDP endpoint.
 * @property {any} [proxy] - proxy spec passed through to launch/page.
 * @property {boolean} [headless] - default true.
 * @property {boolean} [requiresAuth] - post-auth guard (AD-23).
 * @property {boolean} [isolated] - internal; subclasses set false.
 * @property {any} [telemetryContext] - optional TelemetryContext.
 * @property {string} [userDataDir] - browser profile dir (chrome only).
 * @property {string} [userAgent] - fixed UA for pooled pages.
 * @property {any} [fingerprint] - explicit fingerprint (overrides browser's).
 * @property {any} [fingerprintManager] - FingerprintManager instance.
 * @property {string} [accountId] - account for fingerprint resolution.
 * @property {string} [platform] - platform key for fingerprint resolution.
 */

// ============================================================================
// Errors
// ============================================================================

/** Thrown to waiters/new acquires when the pool is draining. */
export class PoolDrainingError extends Error {
  constructor(message = 'BrowserPool is draining — no new acquires accepted') {
    super(message);
    this.name = 'PoolDrainingError';
  }
}

/** Thrown when `acquireTimeoutMs` elapses while queued for a slot. */
export class PoolAcquireTimeoutError extends Error {
  /** @param {number} timeoutMs */
  constructor(timeoutMs) {
    super(`BrowserPool acquire timed out after ${timeoutMs}ms waiting for a slot`);
    this.name = 'PoolAcquireTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// BrowserPool
// ============================================================================

/**
 * Per-backend browser pool. Unit of work = one browser context (isolated) or
 * one page on the shared default context (SharedContextPool subclass).
 *
 * @param {BrowserPoolOptions} [options]
 */
export class BrowserPool {
  /** @param {BrowserPoolOptions} [options] */
  constructor(options = {}) {
    const _sz = Number(options.size ?? process.env.XACTIONS_BROWSER_POOL_SIZE ?? 4);
    this._size = Number.isFinite(_sz) && _sz >= 0 ? _sz : 4;
    this._backend = options.backend || process.env.XACTIONS_BROWSER_BACKEND || 'chrome';
    this._contextsPerBrowser = Number(
      options.contextsPerBrowser ?? (this._backend === 'obscura' ? 3 : 5)
    );
    this._acquireTimeoutMs = Number(options.acquireTimeoutMs ?? 0) || 0;
    this._isolated = options.isolated !== false;

    // Launch options forwarded verbatim to launchStealthBrowser on each spawn.
    this._launchOptions = {
      backend: this._backend,
      fallbackBackend: options.fallbackBackend === undefined ? 'none' : options.fallbackBackend,
      wsEndpoint: options.wsEndpoint,
      proxy: options.proxy,
      headless: options.headless !== false,
      requiresAuth: options.requiresAuth === true,
      telemetryContext: options.telemetryContext,
      userDataDir: options.userDataDir,
      fingerprintManager: options.fingerprintManager,
      accountId: options.accountId,
      platform: options.platform,
    };
    // Page options forwarded to createStealthPage per acquire.
    this._pageOptions = {
      proxy: options.proxy,
      userAgent: options.userAgent,
      fingerprint: options.fingerprint,
      fingerprintManager: options.fingerprintManager,
      accountId: options.accountId,
      platform: options.platform,
    };

    /** @type {Array<{browser: any, contexts: Set<any>}>} */
    this._browsers = [];
    this._active = 0;
    /** @type {Array<{resolve: Function, reject: Function, timer: any}>} */
    this._queue = [];
    this._draining = false;
    this._drainPromise = null;
    /** @type {Function|null} */ this._onIdle = null;
    /** page → {context, browser, backend} — WeakMap: an un-released page can be GC'd without leaking the lease. */
    this._leases = new WeakMap();
    // Serialize browser spawning — two concurrent acquires must not both spawn.
    /** @type {Promise<any>} */
    this._spawnLock = Promise.resolve(null);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Acquire a page for one job.
   * @returns {Promise<{page: any, context: any, backend: string, waitMs: number, pageMs: number}>}
   *   `context` is the isolated BrowserContext (null for SharedContextPool).
   *   `waitMs` = time queued; `pageMs` = context+page creation — feed
   *   `poolWaitMs` telemetry dim (53.6).
   */
  async acquire() {
    const t0 = Date.now();
    if (this._draining) throw new PoolDrainingError();

    // _waitForSlot grants the slot atomically (increments _active inside the
    // same synchronous check) — two concurrent acquires cannot oversubscribe.
    await this._waitForSlot();
    const waitMs = Date.now() - t0;

    let context = null;
    try {
      const tPage = Date.now();
      const obtained = await this._obtainContext();
      const { browser } = obtained;
      context = obtained.context;
      // createStealthPage accepts a BrowserContext transparently
      // (`ctxOrBrowser._native || ctxOrBrowser` → context, which owns newPage()).
      // Fingerprint must be passed explicitly — a context can't see
      // `browser.__fingerprint` (Story 27.1 stability).
      const fingerprint = this._pageOptions.fingerprint || browser.__fingerprint || null;
      // Propagate backend tag onto the context so createStealthPage can apply
      // backend-specific page patches (e.g. Obscura networkidle0 goto hook).
      if (context && browser.__backend) {
        context.__backend = browser.__backend;
      }
      const page = await createStealthPage(context || browser, {
        ...this._pageOptions,
        fingerprint,
      });
      const pageMs = Date.now() - tPage;
      const backend = browser.__backend || this._backend;
      this._leases.set(page, { context, browser, backend });
      return { page, context, backend, waitMs, pageMs };
    } catch (err) {
      // Context/page creation failed after the slot was granted — free the
      // slot, clean up any orphaned context, wake the next waiter.
      if (context) {
        try { await context.close(); } catch { /* best-effort */ }
        const entry = this._browsers.find((e) => e.contexts.has(context));
        if (entry) entry.contexts.delete(context);
      }
      this._active--;
      this._wakeNext();
      if (this._active === 0 && this._onIdle) {
        const fn = this._onIdle;
        this._onIdle = null;
        fn();
      }
      throw err;
    }
  }

  /**
   * Release a page acquired from this pool. Closes the page and its isolated
   * context — never touches the shared browser. Always frees the slot even
   * if close throws.
   * @param {any} page — the page returned by `acquire()`.
   */
  async release(page) {
    const lease = this._leases.get(page);
    if (!lease) return; // not ours / double-release — no-op
    this._leases.delete(page);
    try { await page.close(); } catch { /* page may already be gone */ }
    if (lease.context) {
      try { await lease.context.close(); } catch { /* teardown best-effort */ }
      const entry = this._browsers.find((e) => e.contexts.has(lease.context));
      if (entry) entry.contexts.delete(lease.context);
    }
    this._active--;
    this._wakeNext();
    if (this._active === 0 && this._onIdle) {
      const fn = this._onIdle;
      this._onIdle = null;
      fn();
    }
  }

  /**
   * Drain: reject queued waiters, refuse new acquires, wait for in-flight
   * releases, then tear down every browser per AD-23. Idempotent — repeated
   * calls return the same promise.
   */
  drain() {
    if (this._drainPromise) return this._drainPromise;
    this._draining = true;

    // Reject everyone still queued — they never got a slot.
    const waiters = this._queue.splice(0);
    for (const w of waiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(new PoolDrainingError());
    }

    this._drainPromise = (async () => {
      if (this._active > 0) {
        await new Promise((resolve) => { this._onIdle = resolve; });
      }
      for (const entry of this._browsers.splice(0)) {
        try { await closeStealthBrowser(entry.browser); } catch { /* best-effort */ }
      }
    })();
    return this._drainPromise;
  }

  /**
   * @returns {{size: number, active: number, queued: number, browsers: number, draining: boolean}}
   */
  stats() {
    return {
      size: this._size,
      active: this._active,
      queued: this._queue.length,
      browsers: this._browsers.length,
      draining: this._draining,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Block until a slot frees (or drain/timeout). Grants the slot atomically:
   * the `_active++` happens inside the same synchronous check for the
   * immediate path, or inside `_wakeNext` for a queued waiter (slot transfer).
   */
  _waitForSlot() {
    // Reject immediately when draining — no new slots while shutting down.
    if (this._draining) return Promise.reject(new PoolDrainingError());
    // `!this._queue.length` guard: never let a newcomer jump ahead of waiters.
    if (this._active < this._size && this._queue.length === 0) {
      this._active++;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = /** @type {{resolve: Function, reject: Function, timer: any}} */ ({ resolve, reject, timer: null });
      if (this._acquireTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const i = this._queue.indexOf(waiter);
          if (i !== -1) this._queue.splice(i, 1);
          reject(new PoolAcquireTimeoutError(this._acquireTimeoutMs));
        }, this._acquireTimeoutMs);
      }
      this._queue.push(waiter);
    });
  }

  _wakeNext() {
    // Loop (not recursion) to reject all waiters safely during drain.
    while (true) {
      const next = this._queue.shift();
      if (!next) return;
      if (next.timer) clearTimeout(next.timer);
      if (this._draining) {
        next.reject(new PoolDrainingError());
        continue; // drain all queued waiters
      }
      this._active++; // slot transfer: release() freed one, waiter takes it
      next.resolve();
      return;
    }
  }

  /**
   * Pick (or lazily spawn) a browser with context headroom, then create the
   * job's context on it. Returns `{browser, context}` — context is null for
   * shared mode (subclass).
   * @private
   */
  async _obtainContext() {
    if (!this._isolated) {
      // SharedContextPool: one browser, pages on the default context.
      // Route through _spawnLock to serialize concurrent launches.
      const entry = await this._spawnSharedBrowser();
      return { browser: entry.browser, context: null };
    }

    // Find a browser below its context ceiling (contexts.size + pending
    // reservations so concurrent acquirers don't overshoot the ceiling).
    let entry = this._browsers.find(
      (e) => (e.contexts.size + (e.pending || 0)) < this._contextsPerBrowser
    );
    if (!entry) {
      entry = await this._spawnBrowser();
    }

    // Reserve a pending slot before the async createBrowserContext call so
    // concurrent acquirers see the occupied slot immediately.
    entry.pending = (entry.pending || 0) + 1;
    try {
      const context = typeof entry.browser.createBrowserContext === 'function'
        ? await entry.browser.createBrowserContext()
        : null;
      if (!context) {
        throw new Error(
          `BrowserPool: browser for backend '${this._backend}' does not support isolated contexts (createBrowserContext unavailable or returned null)`
        );
      }
      entry.contexts.add(context);
      return { browser: entry.browser, context };
    } finally {
      entry.pending--;
    }
  }

  /**
   * Serialize spawns: concurrent acquires must not double-launch.
   * Re-checks for a browser with headroom *inside* the lock — an earlier
   * waiter may have already spawned one.
   */
  _spawnBrowser() {
    const run = this._spawnLock.then(() => {
      if (this._draining) throw new PoolDrainingError();
      const existing = this._browsers.find(
        (e) => (e.contexts.size + (e.pending || 0)) < this._contextsPerBrowser
      );
      if (existing) return existing;
      return this._ensureBrowser(this._browsers.length);
    });
    this._spawnLock = run.catch(() => {});
    return run;
  }

  /** SharedContextPool path: serialize _ensureBrowser(0) through the lock. */
  _spawnSharedBrowser() {
    const run = this._spawnLock.then(() => {
      if (this._draining) throw new PoolDrainingError();
      return this._ensureBrowser(0);
    });
    this._spawnLock = run.catch(() => {});
    return run;
  }

  /**
   * Return existing entry at index or launch a new browser into the pool.
   * @param {number} index
   * @private
   */
  async _ensureBrowser(index) {
    if (this._browsers[index]) return this._browsers[index];
    let browser;
    try {
      browser = await launchStealthBrowser(this._launchOptions);
    } catch (err) {
      const e = /** @type {any} */ (err);
      const wrapped = new Error(`BrowserPool: launch failed for backend '${this._backend}': ${e?.message || e}`);
      wrapped.cause = e;
      wrapped.name = e?.name || 'Error';
      // Preserve structured error fields so callers can still instanceof-check.
      if (e && typeof e === 'object') {
        /** @type {any} */ (wrapped).type = e.type;
        /** @type {any} */ (wrapped).suggestedAction = e.suggestedAction;
        if (e.constructor && e.constructor !== Error) {
          Object.setPrototypeOf(wrapped, Object.getPrototypeOf(e));
        }
      }
      throw wrapped;
    }
    // A drain() may have fired while we were awaiting launch — don't orphan
    // a browser process the pool will never track.
    if (this._draining) {
      try { await closeStealthBrowser(browser); } catch { /* best-effort */ }
      throw new PoolDrainingError();
    }
    const entry = { browser, contexts: new Set(), pending: 0 };
    this._browsers.push(entry);
    return entry;
  }
}

// ============================================================================
// SharedContextPool — explicit opt-in for anonymous public scraping only
// ============================================================================

/**
 * Same pool mechanics but every job gets a page on the browser's DEFAULT
 * context — cookies/storage ARE shared. Use ONLY for anonymous public
 * scraping (AD-24 Rule 2); anything account-tied must use BrowserPool.
 */
export class SharedContextPool extends BrowserPool {
  constructor(options = {}) {
    super({ ...options, isolated: false });
  }
  // release() inherited — parent's `if (lease.context)` guard handles
  // context === null correctly (no per-job context to close).
}

// by nichxbt
