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

import { spawn } from 'child_process';
import { launchStealthBrowser, createStealthPage, closeStealthBrowser } from './stealthBrowser.js';

/**
 * @typedef {object} BrowserPoolOptions
 * @property {number} [size] - max concurrent slots (default env `XACTIONS_BROWSER_POOL_SIZE`, then 4).
 * @property {number} [contextsPerBrowser] - isolated-context ceiling per browser before spawning another (default 5 chrome / clamp [4,6]).
 * @property {number} [pagesPerProcess] - CDP page connections per obscura serve process (default 3, min 1).
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

/**
 * @typedef {object} PoolStats
 * @property {number} size
 * @property {number} active
 * @property {number} queued
 * @property {boolean} draining
 * @property {number} [browsers]
 * @property {number} [capacity]
 * @property {Array<{endpoint: string, pages: number, pending: number}>} [endpoints]
 */

/**
 * @typedef {object} PoolAcquire
 * @property {any} page
 * @property {any} context
 * @property {string} backend
 * @property {number} waitMs
 * @property {number} pageMs
 * @property {string} [endpoint]
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
    this._acquireTimeoutMs = Number(options.acquireTimeoutMs ?? 0) || 0;
    this._isolated = options.isolated !== false;
    /** @type {number} */
    this._pagesPerProcess = 3;
    /** @type {number} */
    this._contextsPerBrowser = 5;
    /** @type {number} */
    this._capacity = 0;
    /** @type {string[]} */
    this._endpoints = [];

    if (this._backend === 'obscura') {
      const pppRaw = options.pagesPerProcess ?? process.env.XACTIONS_BROWSER_PAGES_PER_PROCESS ?? 3;
      const pppNum = Number(pppRaw);
      this._pagesPerProcess = (Number.isFinite(pppNum) && pppNum >= 1) ? Math.floor(pppNum) : 3;

      // One parse path for every endpoint source (env list, env singular,
      // option): trim → new URL → ws:/wss: protocol → normalized .href.
      /** @param {unknown} raw @param {string} source */
      const normalizeEndpoint = (raw, source) => {
        const trimmed = String(raw ?? '').trim();
        if (!trimmed) {
          throw new Error(`BrowserPool: malformed obscura endpoint in ${source}: empty entry`);
        }
        let urlObj;
        try {
          urlObj = new URL(trimmed);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`BrowserPool: malformed obscura endpoint '${trimmed}': ${msg}`);
        }
        if (urlObj.protocol !== 'ws:' && urlObj.protocol !== 'wss:') {
          throw new Error(`BrowserPool: obscura endpoint '${trimmed}' must use ws:// or wss://`);
        }
        return urlObj.href;
      };

      const rawEndpoints = process.env.OBSCURA_WS_ENDPOINTS;
      let endpointsList = [];
      if (typeof rawEndpoints === 'string' && rawEndpoints.trim().length > 0) {
        const rawList = rawEndpoints.split(',');
        const seen = new Set();
        for (const rawEntry of rawList) {
          const normalized = normalizeEndpoint(rawEntry, 'OBSCURA_WS_ENDPOINTS');
          if (!seen.has(normalized)) {
            seen.add(normalized);
            endpointsList.push(normalized);
          }
        }
      } else {
        // Singular fallback — whitespace-only means unset (same contract as
        // the list env), then through the identical normalize path.
        const singleRaw = options.wsEndpoint ?? process.env.OBSCURA_WS_ENDPOINT;
        const single = typeof singleRaw === 'string' ? singleRaw.trim() : singleRaw;
        if (single) {
          endpointsList.push(normalizeEndpoint(single, 'OBSCURA_WS_ENDPOINT/wsEndpoint'));
        } else if (process.env.OBSCURA_BIN) {
          const basePort = Number(process.env.OBSCURA_PORT_BASE || 9222);
          const count = Math.max(1, Math.ceil(this._size / this._pagesPerProcess));
          this._children = [];
          for (let i = 0; i < count; i++) {
            const port = basePort + i;
            const endpoint = `ws://127.0.0.1:${port}`;
            endpointsList.push(endpoint);
            try {
              const child = spawn(process.env.OBSCURA_BIN, ['serve', '--port', String(port)], {
                stdio: 'ignore',
                detached: false,
              });
              // Missing/unexecutable binary surfaces asynchronously as an
              // 'error' event — without a listener it crashes the process.
              child.on('error', () => { /* dev best-effort — failure surfaces at connect */ });
              this._children.push(child);
            } catch {
              /* best-effort dev spawn */
            }
          }
        } else {
          endpointsList.push('ws://127.0.0.1:9222');
        }
      }

      this._endpoints = endpointsList;
      // SharedContextPool pins endpoints[0] — its live fleet is exactly one
      // process, so its ceiling is one pagesPerProcess, not the whole fleet.
      this._capacity = (this._isolated ? this._endpoints.length : 1) * this._pagesPerProcess;
      this._size = Math.min(this._size, this._capacity);

      /** @type {Array<{endpoint?: string, browser: any, contexts: Set<any>, pending: number}>} */
      this._browsers = this._endpoints.map((endpoint) => ({
        endpoint,
        browser: null,
        contexts: new Set(),
        pending: 0,
      }));
    } else {
      let cpb;
      if (options.contextsPerBrowser !== undefined) {
        cpb = Number(options.contextsPerBrowser);
      } else {
        const envCpb = Number(process.env.XACTIONS_BROWSER_CONTEXTS_PER_BROWSER ?? 5);
        cpb = (Number.isFinite(envCpb) && envCpb >= 1) ? Math.min(6, Math.max(4, Math.floor(envCpb))) : 5;
      }
      this._contextsPerBrowser = cpb;
      /** @type {Array<{endpoint?: string, browser: any, contexts: Set<any>, pending: number}>} */
      this._browsers = [];
    }

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

    this._active = 0;
    this._respawnCount = 0;
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
   * @returns {Promise<PoolAcquire>}
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

    /** @type {any} */
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
      /** @type {{page: any, context: any, backend: string, waitMs: number, pageMs: number, endpoint?: string}} */
      const result = { page, context, backend, waitMs, pageMs };
      if (this._backend === 'obscura') {
        result.endpoint = /** @type {any} */ (obtained).endpoint || browser.__endpoint;
      }
      return result;
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
      // Obscura entry slots carry fleet identity for stats().endpoints —
      // keep them post-drain; chrome entries are expendable spawn records.
      const entries = this._backend === 'obscura' ? this._browsers : this._browsers.splice(0);
      for (const entry of entries) {
        if (entry.browser) {
          try { await closeStealthBrowser(entry.browser); } catch { /* best-effort */ }
        }
      }
      if (this._children && this._children.length > 0) {
        for (const child of this._children.splice(0)) {
          try { child.kill('SIGTERM'); } catch { /* best-effort */ }
        }
      }
    })();
    return this._drainPromise;
  }

  /**
   * Pool health and occupancy stats.
   * @returns {PoolStats}
   */
  stats() {
    const base = {
      size: this._size,
      active: this._active,
      queued: this._queue.length,
      draining: this._draining,
      respawns: this._respawnCount,
    };
    if (this._backend === 'obscura') {
      return {
        ...base,
        capacity: this._capacity,
        endpoints: this._browsers.map((entry, i) => ({
          endpoint: entry.endpoint || '',
          // Shared mode has no per-job context — the pinned endpoint[0]
          // serves every active page.
          pages: this._isolated ? entry.contexts.size : (i === 0 ? this._active : 0),
          pending: entry.pending || 0,
        })),
      };
    }
    return {
      ...base,
      browsers: this._browsers.length,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Is this browser handle dead? `null` counts dead; `isConnected()` is only
   * consulted when the shape exists — fake browsers/mocks missing it are
   * never penalised.
   * @param {any} browser
   * @returns {boolean}
   * @private
   */
  _isBrowserDead(browser) {
    if (!browser) return true;
    if (typeof browser.isConnected === 'function') return !browser.isConnected();
    return false;
  }

  /**
   * Mark an entry's browser dead: null the handle, clear contexts/pending,
   * splice chrome entries (obscura keeps its endpoint slot for
   * `stats().endpoints` identity), count one respawn, warn once. Idempotent —
   * a second call is a no-op because `entry.browser` is already null. During
   * `drain()` it only clears the entry — no respawn accounting.
   * @param {{endpoint?: string, browser: any, contexts: Set<any>, pending: number}} entry
   * @param {string} [reason]
   * @private
   */
  _markBrowserDead(entry, reason = 'disconnected') {
    if (!entry || !entry.browser) return;
    entry.browser = null;
    if (entry.contexts) entry.contexts.clear();
    entry.pending = 0;
    if (this._backend === 'chrome') {
      const idx = this._browsers.indexOf(entry);
      if (idx !== -1) this._browsers.splice(idx, 1);
    }
    if (this._draining) return; // drain owns teardown — no respawn accounting
    this._respawnCount++;
    console.warn(
      `⚠️ [BrowserPool] dead browser (${this._backend}${entry.endpoint ? ` @ ${entry.endpoint}` : ''}): ${reason}`
    );
  }

  /**
   * Attach the crash-containment listener right after a launch/connect
   * succeeds, before the entry owns the handle. The stale-browser guard
   * (`entry.browser === browser`) keeps a late `disconnected` from a
   * superseded handle from killing the replacement.
   * @param {{endpoint?: string, browser: any, contexts: Set<any>, pending: number}} entry
   * @param {any} browser
   * @private
   */
  _attachDisconnectListener(entry, browser) {
    if (typeof browser.on !== 'function') return; // fakes without EE — skip
    browser.on('disconnected', () => {
      if (entry.browser === browser) {
        this._markBrowserDead(entry, 'disconnected');
      }
    });
  }

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
      if (this._backend === 'obscura') {
        const entry = this._browsers[0];
        if (!entry) {
          throw new Error('BrowserPool: no obscura endpoints configured');
        }
        if (entry.browser && this._isBrowserDead(entry.browser)) {
          this._markBrowserDead(entry, 'pre-acquire scan');
        }
        if (!entry.browser) {
          await this._ensureObscuraConnection(entry);
        }
        return { browser: entry.browser, context: null, endpoint: entry.endpoint };
      }
      // SharedContextPool: one browser, pages on the default context.
      // Route through _spawnLock to serialize concurrent launches.
      const entry = await this._spawnSharedBrowser();
      return { browser: entry.browser, context: null };
    }

    if (this._backend === 'obscura') {
      return this._obtainObscuraContext();
    }

    // Chrome path:
    // Find a browser below its context ceiling (contexts.size + pending
    // reservations so concurrent acquirers don't overshoot the ceiling).
    // Dead-entry handling is layered per Story 53.5: a pre-scan sweeps
    // isConnected()===false handles, and a createBrowserContext throw on a
    // dead browser marks it and retries the whole pick once — errors on a
    // live browser propagate untouched.
    let retried = false;
    while (true) {
      for (let i = this._browsers.length - 1; i >= 0; i--) {
        if (this._isBrowserDead(this._browsers[i].browser)) {
          this._markBrowserDead(this._browsers[i], 'pre-acquire scan');
        }
      }

      let entry = this._browsers.find(
        (e) => Boolean(e?.contexts && (e.contexts.size + (e.pending || 0)) < (this._contextsPerBrowser ?? 5))
      );
      if (!entry) {
        entry = await this._spawnBrowser();
      }
      if (!entry) {
        throw new Error(`BrowserPool: failed to obtain browser entry for backend '${this._backend}'`);
      }

      if (this._isBrowserDead(entry.browser)) {
        this._markBrowserDead(entry, 'dead entry selected');
        if (!retried) { retried = true; continue; }
        throw new Error(`BrowserPool: failed to obtain a live browser entry for backend '${this._backend}'`);
      }

      // Reserve a pending slot before the async createBrowserContext call so
      // concurrent acquirers see the occupied slot immediately.
      entry.pending = (entry.pending || 0) + 1;
      try {
        let context = null;
        try {
          context = typeof entry.browser.createBrowserContext === 'function'
            ? await entry.browser.createBrowserContext()
            : null;
        } catch (ctxErr) {
          if (this._isBrowserDead(entry.browser)) {
            this._markBrowserDead(entry, 'createBrowserContext threw on dead browser');
            if (!retried) { retried = true; continue; }
          }
          throw ctxErr;
        }
        if (!context) {
          if (this._isBrowserDead(entry.browser)) {
            this._markBrowserDead(entry, 'createBrowserContext null on dead browser');
            if (!retried) { retried = true; continue; }
          }
          throw new Error(
            `BrowserPool: browser for backend '${this._backend}' does not support isolated contexts (createBrowserContext unavailable or returned null)`
          );
        }
        entry.contexts.add(context);
        return { browser: entry.browser, context };
      } finally {
        // _markBrowserDead may have already reset pending to 0 — clamp so
        // the decrement can't push a kept entry negative.
        entry.pending = Math.max(0, entry.pending - 1);
      }
    }
  }

  /**
   * Select an obscura endpoint entry by highest headroom (first-fit),
   * lazily connecting if needed. Skips entries that fail to connect.
   * @private
   */
  async _obtainObscuraContext() {
    const failedThisAcquire = new Set();
    let lastError = null;

    while (true) {
      if (this._draining) throw new PoolDrainingError();

      let bestEntry = null;
      let maxHeadroom = 0;

      for (const entry of this._browsers) {
        if (!entry || !entry.contexts || failedThisAcquire.has(entry)) continue;
        if (this._isBrowserDead(entry.browser) && entry.browser) {
          // Connected-then-died: reclaim the slot so headroom is honest and
          // the lazy reconnect below gets a clean entry.
          this._markBrowserDead(entry, 'pre-acquire scan');
        }
        const headroom = this._pagesPerProcess - entry.contexts.size - (entry.pending || 0);
        if (headroom > maxHeadroom) {
          maxHeadroom = headroom;
          bestEntry = entry;
        }
      }

      if (!bestEntry) {
        // Only attribute the failure to a dead endpoint when EVERY entry
        // failed this acquire — otherwise the truth is "live fleet is full".
        if (lastError && failedThisAcquire.size === this._browsers.length) throw lastError;
        throw new Error(
          `BrowserPool: all live obscura endpoints are at capacity (${this._pagesPerProcess} pages/process)`
        );
      }

      bestEntry.pending = (bestEntry.pending || 0) + 1;
      try {
        if (!bestEntry.browser) {
          try {
            await this._ensureObscuraConnection(bestEntry);
          } catch (err) {
            failedThisAcquire.add(bestEntry);
            lastError = err;
            continue;
          }
        }

        let context = null;
        try {
          context = typeof bestEntry.browser.createBrowserContext === 'function'
            ? await bestEntry.browser.createBrowserContext()
            : null;
        } catch (ctxErr) {
          // Dead-browser throw: mark + retry the next endpoint (this entry
          // rejoins the pick next acquire via lazy reconnect). Alive-browser
          // throw keeps the historical wrapped-error propagation.
          if (this._isBrowserDead(bestEntry.browser)) {
            this._markBrowserDead(bestEntry, 'createBrowserContext threw on dead browser');
            failedThisAcquire.add(bestEntry);
            lastError = ctxErr;
            continue;
          }
          throw ctxErr;
        }
        if (!context) {
          if (this._isBrowserDead(bestEntry.browser)) {
            this._markBrowserDead(bestEntry, 'createBrowserContext null on dead browser');
            failedThisAcquire.add(bestEntry);
            lastError = new Error(
              `BrowserPool: isolated context creation failed on dead endpoint ${bestEntry.endpoint}`
            );
            continue;
          }
          throw new Error(
            `BrowserPool: browser for backend '${this._backend}' does not support isolated contexts (createBrowserContext unavailable or returned null)`
          );
        }
        bestEntry.contexts.add(context);
        return { browser: bestEntry.browser, context, endpoint: bestEntry.endpoint };
      } finally {
        // _markBrowserDead resets pending to 0 on kept obscura entries —
        // clamp so the decrement can't leave pending negative (-1 is truthy
        // and would inflate headroom by one page for the entry's lifetime).
        bestEntry.pending = Math.max(0, bestEntry.pending - 1);
      }
    }
  }

  /**
   * Lazily connect to an obscura endpoint through the spawn lock.
   * @param {{endpoint?: string, browser: any, contexts: Set<any>, pending: number}} entry
   * @private
   */
  _ensureObscuraConnection(entry) {
    const run = this._spawnLock.then(async () => {
      if (this._draining) throw new PoolDrainingError();
      if (entry.browser) return entry;

      let browser;
      try {
        browser = await launchStealthBrowser({
          ...this._launchOptions,
          wsEndpoint: entry.endpoint,
        });
      } catch (err) {
        const e = /** @type {any} */ (err);
        const wrapped = new Error(
          `BrowserPool: launch failed for backend '${this._backend}' (endpoint ${entry.endpoint}): ${e?.message || e}`
        );
        wrapped.cause = e;
        wrapped.name = e?.name || 'Error';
        if (e && typeof e === 'object') {
          /** @type {any} */ (wrapped).type = e.type;
          /** @type {any} */ (wrapped).suggestedAction = e.suggestedAction;
          if (e.constructor && e.constructor !== Error) {
            Object.setPrototypeOf(wrapped, Object.getPrototypeOf(e));
          }
        }
        throw wrapped;
      }

      if (this._draining) {
        try { await closeStealthBrowser(browser); } catch { /* best-effort */ }
        throw new PoolDrainingError();
      }

      /** @type {any} */ (browser).__endpoint = entry.endpoint;
      /** @type {any} */ (browser).__backend = 'obscura';
      this._attachDisconnectListener(entry, browser);
      entry.browser = browser;
      return entry;
    });

    this._spawnLock = run.catch(() => {});
    return run;
  }

  /**
   * Serialize spawns: concurrent acquires must not double-launch.
   * Re-checks for a browser with headroom *inside* the lock — an earlier
   * waiter may have already spawned one.
   */
  _spawnBrowser() {
    const run = this._spawnLock.then(() => {
      if (this._draining) throw new PoolDrainingError();
      for (let i = this._browsers.length - 1; i >= 0; i--) {
        if (this._isBrowserDead(this._browsers[i].browser)) {
          this._markBrowserDead(this._browsers[i], 'dead entry in spawn');
        }
      }
      const existing = this._browsers.find(
        (e) => Boolean(e?.contexts && (e.contexts.size + (e.pending || 0)) < (this._contextsPerBrowser ?? 5))
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
    if (this._browsers[index]) {
      if (this._isBrowserDead(this._browsers[index].browser)) {
        this._markBrowserDead(this._browsers[index], 'dead entry in _ensureBrowser');
      } else {
        return this._browsers[index];
      }
    }
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
    /** @type {{endpoint?: string, browser: any, contexts: Set<any>, pending: number}} */
    const entry = { browser: null, contexts: new Set(), pending: 0 };
    this._attachDisconnectListener(entry, browser);
    entry.browser = browser;
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
