Read '/Users/luisphan/.npm/_npx/2d6bcd63982e6f85/node_modules/bmad-method/src/bmm-skills/ship/bmad-code-review/review-prompts/edge-case-hunter.md' completely and follow it as your review instructions.

Review content:

diff --git a/src/core/base-client.js b/src/core/base-client.js
index c8bae16..7e09d92 100644
--- a/src/core/base-client.js
+++ b/src/core/base-client.js
@@ -59,9 +59,15 @@ export class AbstractApiClient {
   /** @type {import('./platform-validator.js').AbstractPlatformResponseValidator | null} */
   responseValidator = null;
 
-  /** @type {Object} */
+  /** @type {Record<string, string>} */
   cookies = {};
 
+  /** @type {import('./signer-pool.js').PreSignedTokenRing | null} */
+  tokenRing = null;
+
+  /** @type {import('./signer-pool.js').SignerWorkerPagePool | null} */
+  signerPool = null;
+
   /** @type {number} */
   maxProxyRetries = 3;
 
@@ -91,6 +97,8 @@ export class AbstractApiClient {
    * @param {import('./account-pool.js').AccountPool} [options.accountPool]
    * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
    * @param {import('./platform-validator.js').AbstractPlatformResponseValidator} [options.responseValidator]
+   * @param {import('./signer-pool.js').PreSignedTokenRing} [options.tokenRing]
+   * @param {import('./signer-pool.js').SignerWorkerPagePool} [options.signerPool]
    * @param {string} [options.platform]
    * @param {'undici' | 'got'} [options.client]
    * @param {Function} [options.httpClient]
@@ -113,6 +121,8 @@ export class AbstractApiClient {
     this.accountPool = options.accountPool;
     this.governor = options.governor;
     this.responseValidator = options.responseValidator || null;
+    this.tokenRing = options.tokenRing || null;
+    this.signerPool = options.signerPool || null;
 
     if (options.platform !== undefined) this.platform = options.platform;
     if (options.client !== undefined) this.client = options.client;
@@ -136,6 +146,10 @@ export class AbstractApiClient {
     if (!headerValue) return 0;
     const num = Number(headerValue);
     if (!Number.isNaN(num) && num > 0) {
+      if (num > 1000000000) {
+        const diff = num * 1000 - Date.now();
+        return diff > 0 ? diff : 0;
+      }
       return num * 1000;
     }
     const dateMs = Date.parse(String(headerValue));
@@ -160,7 +174,7 @@ export class AbstractApiClient {
    * Throws PROXY_EXHAUSTED if no proxy is available.
    * @param {string | AccountRecord | null} [accountId]
    * @param {boolean} [requiresResidential=false]
-   * @returns {string | Record<string, unknown>}
+   * @returns {string | Record<string, unknown> | null}
    */
   resolveProxy(accountId, requiresResidential = false) {
     const rawAccountId = typeof accountId === 'string' ? accountId : accountId?.accountId;
@@ -220,6 +234,184 @@ export class AbstractApiClient {
     throw new Error('Method not implemented: init(session)');
   }
 
+  /**
+   * Default HTTP transport factory for got-scraping or undici.fetch().
+   * @returns {Promise<Function>}
+   */
+  async #getDefaultHttpClient() {
+    if (this.client === 'got') {
+      const { gotScraping } = await import('got-scraping');
+      return async (/** @type {Record<string, any>} */ reqOpts) => {
+        const { method, url, headers, body, json, proxy, timeout } = reqOpts;
+        /** @type {Record<string, any>} */
+        const options = {
+          method,
+          url,
+          headers: headers || {},
+          timeout: timeout || 30000,
+          throwHttpErrors: false,
+        };
+        if (json !== undefined) options.json = json;
+        else if (body !== undefined) options.body = body;
+        if (proxy) {
+          const { getProxyAgent } = await import('../proxy/index.js');
+          const proxyUrl = getProxyAgent(proxy, { client: 'got' });
+          if (typeof proxyUrl === 'string') options.proxyUrl = proxyUrl;
+        }
+        const resp = await gotScraping(options);
+        let data = resp.body;
+        if (typeof resp.body === 'string') {
+          try {
+            data = JSON.parse(resp.body);
+          } catch {}
+        }
+        return {
+          status: resp.statusCode,
+          headers: resp.headers,
+          data,
+        };
+      };
+    }
+
+    // Default: undici
+    const { fetch: undiciFetch } = await import('undici');
+    return async (/** @type {Record<string, any>} */ reqOpts) => {
+      const { method, url, headers, body, json, agent, timeout } = reqOpts;
+      /** @type {Record<string, any>} */
+      const fetchOpts = {
+        method,
+        headers: { ...(headers || {}) },
+        signal: AbortSignal.timeout(timeout || 30000),
+      };
+      if (agent) {
+        fetchOpts.dispatcher = agent;
+      }
+      if (json !== undefined) {
+        fetchOpts.headers['content-type'] = 'application/json';
+        fetchOpts.body = JSON.stringify(json);
+      } else if (body !== undefined) {
+        fetchOpts.body = body;
+      }
+      const resp = await undiciFetch(url, fetchOpts);
+      let data;
+      const text = await resp.text();
+      try {
+        data = JSON.parse(text);
+      } catch {
+        data = text;
+      }
+      return {
+        status: resp.status,
+        headers: Object.fromEntries(resp.headers.entries()),
+        data,
+      };
+    };
+  }
+
+  /**
+   * Execute request with tiered signing (PreSignedTokenRing, SignerWorkerPagePool, or custom sign()).
+   *
+   * @param {string} method
+   * @param {string} url
+   * @param {Object} [payload={}]
+   * @param {string} [payload.signType='token'] - 'token' | 'page' | 'custom'
+   * @param {'header' | 'query' | 'cookie'} [payload.location='header']
+   * @param {string} [payload.name='authorization']
+   * @param {string} [payload.prefix='']
+   * @param {string | Function} [payload.script]
+   * @param {any[]} [payload.args]
+   * @param {number} [payload.timeoutMs]
+   * @param {boolean} [payload.warmup]
+   * @param {RequestOptions} [options={}]
+   * @returns {Promise<unknown>}
+   */
+  async requestWithSign(method, url, payload = {}, options = {}) {
+    /** @type {Record<string, any> | null} */
+    let signResult = null;
+    const signType = payload.signType || 'token';
+
+    if (signType === 'token' && this.tokenRing && !this.tokenRing.isEmpty) {
+      const token = this.tokenRing.next();
+      if (token) {
+        const location = payload.location || 'header';
+        const name = payload.name || 'authorization';
+        const prefix = payload.prefix || '';
+        const value = `${prefix}${token}`;
+
+        signResult = {};
+        if (location === 'header') {
+          signResult.headers = { [name]: value };
+        } else if (location === 'query') {
+          signResult.query = { [name]: value };
+        } else if (location === 'cookie') {
+          signResult.cookies = { [name]: value };
+        }
+      }
+    } else if (signType === 'page' && this.signerPool && payload.script) {
+      const res = await this.signerPool.evaluate(payload.script, payload.args || [], {
+        timeoutMs: payload.timeoutMs,
+        warmup: payload.warmup,
+      });
+      signResult = typeof res === 'object' && res !== null ? res : { signature: res };
+    } else if (typeof this.sign === 'function' && this.sign !== AbstractApiClient.prototype.sign) {
+      signResult = /** @type {Record<string, any>} */ (await this.sign(payload));
+    }
+
+    const mergedOptions = { ...options };
+    let resolvedUrl = url;
+
+    if (signResult) {
+      if (signResult.headers) {
+        mergedOptions.headers = { ...mergedOptions.headers, ...signResult.headers };
+      }
+      if (signResult.query) {
+        const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
+        const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
+        for (const [k, v] of Object.entries(signResult.query)) {
+          parsedUrl.searchParams.set(k, String(v));
+        }
+        resolvedUrl = isAbsolute
+          ? parsedUrl.toString()
+          : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
+      }
+      if (signResult.cookies) {
+        for (const [k, v] of Object.entries(signResult.cookies)) {
+          this.cookies[k] = String(v);
+        }
+        this.updateCookies(this.cookies);
+      }
+      if (signResult.signature && !signResult.headers && !signResult.query && !signResult.cookies) {
+        const location = payload.location || 'header';
+        const name = payload.name || 'x-client-transaction-id';
+        if (location === 'header') {
+          mergedOptions.headers = { ...mergedOptions.headers, [name]: String(signResult.signature) };
+        } else if (location === 'query') {
+          const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
+          const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
+          parsedUrl.searchParams.set(name, String(signResult.signature));
+          resolvedUrl = isAbsolute
+            ? parsedUrl.toString()
+            : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
+        }
+      }
+    }
+
+    if (Object.keys(this.cookies).length > 0) {
+      const cookieHeader = Object.entries(this.cookies)
+        .map(([k, v]) => `${k}=${v}`)
+        .join('; ');
+      const existingHeaders = { ...(mergedOptions.headers || {}) };
+      delete existingHeaders['Cookie'];
+      delete existingHeaders['cookie'];
+      mergedOptions.headers = {
+        ...existingHeaders,
+        cookie: cookieHeader,
+      };
+    }
+
+    return this.request(method, resolvedUrl, mergedOptions);
+  }
+
   /**
    * Execute request through resilient interceptor pipeline (429/403 auto-quarantine,
    * exponential replay with jitter, account rotation, standby backoff).
@@ -283,7 +475,9 @@ export class AbstractApiClient {
           });
         }
 
-        const proxy = this.resolveProxy(currentAccountId, opts.requiresResidential);
+        const proxy = provider || opts.requiresResidential
+          ? this.resolveProxy(currentAccountId, opts.requiresResidential)
+          : null;
 
         let agent = null;
         if (proxy && provider && typeof provider.getProxyAgent === 'function') {
@@ -292,19 +486,14 @@ export class AbstractApiClient {
           agent = provider.createProxyAgent(proxy, this.client);
         }
 
-        if (typeof this.httpClient !== 'function') {
-          throw new PlatformError({
-            type: ErrorTypes.INTERNAL,
-            code: 'XACT_5000',
-            message: 'httpClient transport is not configured on client',
-            statusCode: 500,
-            suggestedAction: SuggestedActions.CONTACT_SUPPORT,
-          });
+        let transport = this.httpClient;
+        if (typeof transport !== 'function') {
+          transport = await this.#getDefaultHttpClient();
         }
 
         let response;
         try {
-          response = await this.httpClient({
+          response = await transport({
             ...opts,
             method,
             url,
@@ -395,7 +584,7 @@ export class AbstractApiClient {
 
         // Handle 429 (Rate Limit) or 403 (Bot Challenge)
         if (status === 429 || status === 403) {
-          if (provider && typeof provider.quarantine === 'function') {
+          if (proxy && provider && typeof provider.quarantine === 'function') {
             provider.quarantine(proxy, this.rateLimitHibernationMs);
           }
 
@@ -480,11 +669,13 @@ export class AbstractApiClient {
   }
 
   /**
-   * @param {Object} cookies
+   * @param {Record<string, string>} [cookies={}]
    * @returns {void}
    */
-  updateCookies(cookies) {
-    this.cookies = { ...this.cookies, ...cookies };
+  updateCookies(cookies = {}) {
+    if (cookies && typeof cookies === 'object') {
+      Object.assign(this.cookies, cookies);
+    }
   }
 
   /**
diff --git a/src/core/signer-pool.js b/src/core/signer-pool.js
index fac40b5..f277d17 100644
--- a/src/core/signer-pool.js
+++ b/src/core/signer-pool.js
@@ -1,10 +1,20 @@
 // Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
 /**
  * Tiered Hybrid Signer Engine — token ring + worker page pool.
+ *
+ * Provides O(1) synchronous pre-signed token retrieval for lightweight session tokens,
+ * and an adaptive pool of background worker pages (4–8 pages) for dynamic JavaScript signing
+ * algorithms (e.g. x-client-transaction-id, a_bogus) with circuit-breaking and least-connections routing.
+ *
  * @author nich (@nichxbt)
- * @license MIT
+ * @license Apache-2.0
  */
 
+import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';
+
+/**
+ * Pre-Signed Token Ring for O(1) synchronous token allocation.
+ */
 export class PreSignedTokenRing {
   /** @type {string[]} */
   #tokens = [];
@@ -17,36 +27,69 @@ export class PreSignedTokenRing {
 
   /**
    * @param {Object} [options]
-   * @param {number} [options.capacity]
+   * @param {number} [options.capacity=50]
    */
   constructor(options = {}) {
-    this.#capacity = options.capacity || 50;
+    const cap = Number(options.capacity);
+    this.#capacity = Number.isInteger(cap) && cap > 0 ? cap : 50;
   }
 
   /**
+   * Refill the ring with an array of pre-signed tokens.
+   * Clamps to capacity, discards empty tokens, and resets pointer to 0.
    * @param {string[]} tokens
    */
   refill(tokens) {
-    this.#tokens = tokens.slice(0, this.#capacity);
+    if (!Array.isArray(tokens)) {
+      this.#tokens = [];
+    } else {
+      this.#tokens = tokens
+        .filter((t) => typeof t === 'string' && t.trim().length > 0)
+        .slice(0, this.#capacity);
+    }
     this.#index = 0;
   }
 
-  /** @returns {string | null} */
+  /**
+   * Get the next token in O(1) round-robin order.
+   * @returns {string | null}
+   */
   next() {
-    if (!this.#tokens.length) return null;
+    if (this.#tokens.length === 0) return null;
     const token = this.#tokens[this.#index % this.#tokens.length];
     this.#index = (this.#index + 1) % this.#tokens.length;
     return token;
   }
 
-  /** @returns {number} */
+  /** @returns {number} Current number of tokens in the ring */
   get size() {
     return this.#tokens.length;
   }
+
+  /** @returns {number} Maximum capacity of the ring */
+  get capacity() {
+    return this.#capacity;
+  }
+
+  /** @returns {boolean} True if ring has no tokens */
+  get isEmpty() {
+    return this.#tokens.length === 0;
+  }
 }
 
+/**
+ * @typedef {Object} WorkerPageRecord
+ * @property {string} id
+ * @property {any} page - Adapter Page or Native Page
+ * @property {number} load - Number of active/pending operations
+ * @property {'idle' | 'busy' | 'dead'} state - Worker status
+ */
+
+/**
+ * Signer Worker Page Pool for parallel dynamic script evaluations.
+ */
 export class SignerWorkerPagePool {
-  /** @type {any[]} */
+  /** @type {WorkerPageRecord[]} */
   #pages = [];
 
   /** @type {number} */
@@ -61,34 +104,323 @@ export class SignerWorkerPagePool {
   /** @type {number} */
   #warmupTimeoutMs = 8000;
 
+  /** @type {string | Function | null} */
+  #warmupScript = null;
+
+  /** @type {any[]} */
+  #warmupArgs = [];
+
+  /** @type {number} */
+  #pendingSpawns = 0;
+
+  /** @type {boolean} */
+  #isClosed = false;
+
+  /** @type {number} */
+  #nextId = 1;
+
   /**
    * @param {Object} [options]
-   * @param {number} [options.minSize]
-   * @param {number} [options.maxSize]
+   * @param {number} [options.minSize=4]
+   * @param {number} [options.maxSize=8]
+   * @param {number} [options.defaultTimeoutMs=3000]
+   * @param {number} [options.warmupTimeoutMs=8000]
    * @param {any} [options.browser]
    */
   constructor(options = {}) {
-    this.#minSize = options.minSize || 4;
-    this.#maxSize = options.maxSize || 8;
-    this.browser = options.browser;
+    const min = Number(options.minSize);
+    const max = Number(options.maxSize);
+    this.#minSize = Number.isInteger(min) && min > 0 ? min : 4;
+    this.#maxSize = Number.isInteger(max) && max >= this.#minSize ? max : Math.max(8, this.#minSize);
+    this.#defaultTimeoutMs = Number(options.defaultTimeoutMs) || 3000;
+    this.#warmupTimeoutMs = Number(options.warmupTimeoutMs) || 8000;
+    this.browser = options.browser || null;
+  }
+
+  /**
+   * Create and register a new worker page.
+   * @param {boolean} [skipWarmup=false]
+   * @returns {Promise<WorkerPageRecord>}
+   */
+  async #spawnPage(skipWarmup = false) {
+    if (!this.browser || typeof this.browser.newPage !== 'function') {
+      throw new PlatformError({
+        code: 'XACT_5000',
+        type: ErrorTypes.INTERNAL,
+        message: '[SIGNER ERROR] Browser instance with newPage() is required to spawn signer worker page',
+        suggestedAction: SuggestedActions.RELOGIN,
+      });
+    }
+
+    this.#pendingSpawns++;
+    try {
+      const page = await this.browser.newPage();
+      const record = {
+        id: `worker_page_${this.#nextId++}`,
+        page,
+        load: 0,
+        state: /** @type {'idle' | 'busy' | 'dead'} */ ('idle'),
+      };
+      this.#pages.push(record);
+
+      if (!skipWarmup && this.#warmupScript) {
+        await this.#executeOnPage(record, this.#warmupScript, this.#warmupArgs, {
+          timeoutMs: this.#warmupTimeoutMs,
+          warmup: true,
+        }).catch((err) => {
+          console.warn(`[SIGNER WARNING] Warmup failed for page ${record.id}: ${err.message}`);
+        });
+      }
+
+      return record;
+    } finally {
+      this.#pendingSpawns = Math.max(0, this.#pendingSpawns - 1);
+    }
   }
 
-  /** @returns {Promise<void>} */
-  async init() {
-    throw new Error('Method not implemented: SignerWorkerPagePool.init()');
+  /**
+   * Initialize worker pages up to minSize.
+   * @param {Object} [options]
+   * @param {string | Function} [options.warmupScript]
+   * @param {any[]} [options.warmupArgs]
+   * @returns {Promise<void>}
+   */
+  async init(options = {}) {
+    if (this.#isClosed) {
+      throw new PlatformError({
+        code: 'XACT_5000',
+        type: ErrorTypes.INTERNAL,
+        message: '[SIGNER ERROR] Cannot init closed SignerWorkerPagePool',
+        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
+      });
+    }
+
+    if (options.warmupScript) {
+      this.#warmupScript = options.warmupScript;
+      this.#warmupArgs = options.warmupArgs || [];
+    }
+
+    // Spawn up to minSize pages
+    const aliveCount = this.#pages.filter((p) => p.state !== 'dead').length;
+    const needed = Math.max(0, this.#minSize - aliveCount);
+    const spawnPromises = [];
+    for (let i = 0; i < needed; i++) {
+      spawnPromises.push(this.#spawnPage(true));
+    }
+    await Promise.all(spawnPromises);
+
+    // Warmup initial batch of pages
+    if (this.#warmupScript) {
+      const warmupPromises = this.#pages.map((p) =>
+        this.#executeOnPage(p, this.#warmupScript, this.#warmupArgs, {
+          timeoutMs: this.#warmupTimeoutMs,
+          warmup: true,
+        }).catch((err) => {
+          console.warn(`[SIGNER WARNING] Warmup failed for page ${p.id}: ${err.message}`);
+        })
+      );
+      await Promise.all(warmupPromises);
+    }
   }
 
   /**
-   * @param {string} script
-   * @param {any[]} [args]
+   * Select a healthy worker page using Least-Connections routing.
+   * @returns {Promise<WorkerPageRecord>}
+   */
+  async #getLeastLoadedPage() {
+    if (this.#isClosed) {
+      throw new PlatformError({
+        code: 'XACT_5000',
+        type: ErrorTypes.INTERNAL,
+        message: '[SIGNER ERROR] SignerWorkerPagePool is closed',
+        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
+      });
+    }
+
+    // Clean dead pages
+    this.#pages = this.#pages.filter((p) => p.state !== 'dead');
+    const alivePages = this.#pages;
+    const currentTotal = alivePages.length + this.#pendingSpawns;
+
+    // If all existing alive pages are busy and we are below maxSize, spawn a new page
+    if ((alivePages.length === 0 || alivePages.every((p) => p.load > 0)) && currentTotal < this.#maxSize) {
+      try {
+        const newWorker = await this.#spawnPage(false);
+        newWorker.load++;
+        newWorker.state = 'busy';
+        return newWorker;
+      } catch (err) {
+        if (alivePages.length === 0) throw err;
+      }
+    }
+
+    if (alivePages.length === 0) {
+      throw new PlatformError({
+        code: 'XACT_5000',
+        type: ErrorTypes.INTERNAL,
+        message: '[SIGNER ERROR] All worker pages are dead or exceeded maxSize',
+        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
+      });
+    }
+
+    // Least-Connections sort
+    alivePages.sort((a, b) => a.load - b.load);
+    const chosen = alivePages[0];
+    chosen.load++;
+    chosen.state = 'busy';
+    return chosen;
+  }
+
+  /**
+   * Execute evaluation on a specific page with timeout and error tracking.
+   * @param {WorkerPageRecord} worker
+   * @param {string | Function | null | undefined} script
+   * @param {any[]} args
+   * @param {Object} [options={}]
+   * @param {number} [options.timeoutMs]
+   * @param {boolean} [options.warmup]
    * @returns {Promise<any>}
    */
-  async evaluate(script, args) {
-    throw new Error('Method not implemented: SignerWorkerPagePool.evaluate()');
+  async #executeOnPage(worker, script, args, options = {}) {
+    const timeoutMs = options.timeoutMs || (options.warmup ? this.#warmupTimeoutMs : this.#defaultTimeoutMs);
+    let timeoutTimer = null;
+
+    try {
+      const timeoutPromise = new Promise((_, reject) => {
+        timeoutTimer = setTimeout(() => {
+          reject(new Error(`[SIGNER TIMEOUT] Execution timed out after ${timeoutMs}ms on ${worker.id}`));
+        }, timeoutMs);
+      });
+
+      const execPromise = (async () => {
+        const page = worker.page;
+        if (!script) {
+          throw new Error(`[SIGNER ERROR] Script must be provided to evaluate on ${worker.id}`);
+        }
+        if (typeof page.evaluate === 'function') {
+          return await page.evaluate(script, ...args);
+        } else if (page._native && typeof page._native.evaluate === 'function') {
+          return await page._native.evaluate(script, ...args);
+        }
+        throw new Error(`[SIGNER ERROR] Page ${worker.id} has no evaluate() method`);
+      })();
+
+      // Suppress unhandled rejection if timeoutPromise wins the race
+      execPromise.catch(() => {});
+
+      const result = await Promise.race([execPromise, timeoutPromise]);
+      return result;
+    } catch (err) {
+      // Mark page dead on failure or timeout and release resource
+      worker.state = 'dead';
+      try {
+        if (typeof worker.page.close === 'function') {
+          await worker.page.close().catch(() => {});
+        } else if (worker.page._native && typeof worker.page._native.close === 'function') {
+          await worker.page._native.close().catch(() => {});
+        }
+      } catch {}
+      this.#pages = this.#pages.filter((p) => p !== worker);
+      throw err;
+    } finally {
+      if (timeoutTimer) clearTimeout(timeoutTimer);
+      worker.load = Math.max(0, worker.load - 1);
+      if (worker.state !== 'dead') {
+        worker.state = worker.load === 0 ? 'idle' : 'busy';
+      }
+    }
   }
 
-  /** @returns {Promise<void>} */
+  /**
+   * Evaluate a script on a worker page with retry circuit breaker.
+   * @param {string | Function} script
+   * @param {any[]} [args=[]]
+   * @param {Object} [options={}]
+   * @param {number} [options.timeoutMs]
+   * @param {boolean} [options.warmup=false]
+   * @returns {Promise<any>}
+   */
+  async evaluate(script, args = [], options = {}) {
+    let lastError = null;
+
+    for (let attempt = 0; attempt < 2; attempt++) {
+      let worker;
+      try {
+        worker = await this.#getLeastLoadedPage();
+      } catch (err) {
+        lastError = err;
+        break;
+      }
+
+      try {
+        return await this.#executeOnPage(worker, script, args, options);
+      } catch (err) {
+        lastError = err;
+        // Attempt to spawn replacement if below maxSize
+        if (this.#pages.length < this.#minSize && (this.#pages.length + this.#pendingSpawns) < this.#maxSize) {
+          try {
+            await this.#spawnPage(false);
+          } catch {}
+        }
+      }
+    }
+
+    if (lastError instanceof PlatformError) {
+      throw lastError;
+    }
+
+    throw new PlatformError({
+      code: 'XACT_5000',
+      type: ErrorTypes.INTERNAL,
+      message: `[SIGNER ERROR] Evaluation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
+      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
+      cause: lastError,
+    });
+  }
+
+  /**
+   * Close all worker pages and release pool resources.
+   * @returns {Promise<void>}
+   */
   async close() {
-    throw new Error('Method not implemented: SignerWorkerPagePool.close()');
+    this.#isClosed = true;
+    const closePromises = this.#pages.map(async (worker) => {
+      worker.state = 'dead';
+      try {
+        if (typeof worker.page.close === 'function') {
+          await worker.page.close();
+        } else if (worker.page._native && typeof worker.page._native.close === 'function') {
+          await worker.page._native.close();
+        }
+      } catch {}
+    });
+
+    await Promise.all(closePromises);
+    this.#pages = [];
+  }
+
+  /** @returns {number} Total pages count in the pool */
+  get size() {
+    return this.#pages.length;
+  }
+
+  /** @returns {number} Number of alive worker pages */
+  get activeCount() {
+    return this.#pages.filter((p) => p.state !== 'dead').length;
+  }
+
+  /** @returns {number} Number of idle worker pages */
+  get idleCount() {
+    return this.#pages.filter((p) => p.state === 'idle').length;
+  }
+
+  /** @returns {number} Minimum size */
+  get minSize() {
+    return this.#minSize;
+  }
+
+  /** @returns {number} Maximum size */
+  get maxSize() {
+    return this.#maxSize;
   }
 }
diff --git a/tests/core/base-client-sign.test.js b/tests/core/base-client-sign.test.js
new file mode 100644
index 0000000..0a28dc6
--- /dev/null
+++ b/tests/core/base-client-sign.test.js
@@ -0,0 +1,175 @@
+// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
+import http from 'node:http';
+import { AbstractApiClient } from '../../src/core/base-client.js';
+import { PreSignedTokenRing, SignerWorkerPagePool } from '../../src/core/signer-pool.js';
+
+class TestApiClient extends AbstractApiClient {
+  constructor(options = {}) {
+    super({ platform: 'test-platform', requiresAuth: false, ...options });
+  }
+}
+
+describe('Story 13.1 — AbstractApiClient.requestWithSign Integration (AC-3, AC-4, AC-5, AC-6)', () => {
+  let server;
+  let serverUrl;
+  let receivedRequests = [];
+
+  beforeEach(async () => {
+    receivedRequests = [];
+    server = http.createServer((req, res) => {
+      let body = '';
+      req.on('data', chunk => (body += chunk));
+      req.on('end', () => {
+        receivedRequests.push({
+          method: req.method,
+          url: req.url,
+          headers: req.headers,
+          body,
+        });
+        res.writeHead(200, { 'Content-Type': 'application/json' });
+        res.end(JSON.stringify({ ok: true, url: req.url }));
+      });
+    });
+
+    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
+    const port = server.address().port;
+    serverUrl = `http://127.0.0.1:${port}`;
+  });
+
+  afterEach(async () => {
+    if (server) {
+      await new Promise(resolve => server.close(resolve));
+    }
+  });
+
+  it('[P0] should inject token from PreSignedTokenRing into headers when signType is token (AC-3)', async () => {
+    const ring = new PreSignedTokenRing();
+    ring.refill(['bearer_token_xyz']);
+
+    const client = new TestApiClient({ tokenRing: ring });
+
+    const res = await client.requestWithSign('GET', `${serverUrl}/api/test`, {
+      signType: 'token',
+      location: 'header',
+      name: 'authorization',
+      prefix: 'Bearer ',
+    });
+
+    expect(res.status).toBe(200);
+    expect(receivedRequests.length).toBe(1);
+    expect(receivedRequests[0].headers['authorization']).toBe('Bearer bearer_token_xyz');
+  });
+
+  it('[P0] should inject token from PreSignedTokenRing into query parameters (AC-3)', async () => {
+    const ring = new PreSignedTokenRing();
+    ring.refill(['token_query_123']);
+
+    const client = new TestApiClient({ tokenRing: ring });
+
+    const res = await client.requestWithSign('GET', `${serverUrl}/api/test`, {
+      signType: 'token',
+      location: 'query',
+      name: 'token',
+    });
+
+    expect(res.status).toBe(200);
+    expect(receivedRequests[0].url).toContain('token=token_query_123');
+  });
+
+  it('[P1] should inject token from PreSignedTokenRing into cookies and sync client.cookies (AC-6)', async () => {
+    const ring = new PreSignedTokenRing();
+    ring.refill(['cookie_dtsg_val']);
+
+    const client = new TestApiClient({ tokenRing: ring });
+
+    const res = await client.requestWithSign('POST', `${serverUrl}/api/test`, {
+      signType: 'token',
+      location: 'cookie',
+      name: 'fb_dtsg',
+    });
+
+    expect(res.status).toBe(200);
+    expect(client.cookies['fb_dtsg']).toBe('cookie_dtsg_val');
+    expect(receivedRequests[0].headers['cookie']).toContain('fb_dtsg=cookie_dtsg_val');
+  });
+
+  it('[P0] should dispatch to SignerWorkerPagePool when signType is page (AC-3)', async () => {
+    const mockPagePool = {
+      evaluate: vi.fn(async () => ({
+        headers: { 'x-client-transaction-id': 'signed_tx_999' },
+        query: { sig: 'dyn_sig_456' },
+      })),
+    };
+
+    const client = new TestApiClient({ signerPool: mockPagePool });
+
+    const res = await client.requestWithSign('POST', `${serverUrl}/api/graphql`, {
+      signType: 'page',
+      script: '() => ({ headers: { "x-client-transaction-id": "signed_tx_999" }, query: { sig: "dyn_sig_456" } })',
+      args: ['queryId_123'],
+    });
+
+    expect(res.status).toBe(200);
+    expect(mockPagePool.evaluate).toHaveBeenCalled();
+    expect(receivedRequests[0].headers['x-client-transaction-id']).toBe('signed_tx_999');
+    expect(receivedRequests[0].url).toContain('sig=dyn_sig_456');
+  });
+
+  it('[P1] should fallback to this.sign() when no ring or pool is configured (AC-3)', async () => {
+    class CustomSignClient extends TestApiClient {
+      async sign(payload) {
+        return {
+          headers: { 'x-custom-sig': 'custom_signature_abc' },
+        };
+      }
+    }
+
+    const client = new CustomSignClient();
+    const res = await client.requestWithSign('GET', `${serverUrl}/api/data`, {
+      signType: 'custom',
+    });
+
+    expect(res.status).toBe(200);
+    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
+  });
+
+  it('[P1] should handle relative URLs without throwing Invalid URL error', async () => {
+    const ring = new PreSignedTokenRing();
+    ring.refill(['tok_rel_123']);
+
+    // Mock httpClient to inspect resolved relative URL
+    const mockHttp = vi.fn(async ({ url, headers }) => {
+      return { status: 200, headers: {}, data: { url } };
+    });
+
+    const client = new TestApiClient({ tokenRing: ring, httpClient: mockHttp });
+    const res = await client.requestWithSign('GET', '/api/relative/endpoint', {
+      signType: 'token',
+      location: 'query',
+      name: 'auth_token',
+    });
+
+    expect(res.status).toBe(200);
+    expect(mockHttp).toHaveBeenCalledWith(expect.objectContaining({
+      url: '/api/relative/endpoint?auth_token=tok_rel_123',
+    }));
+  });
+
+  it('[P1] should map primitive signature string to header when signType is page', async () => {
+    const mockPool = {
+      evaluate: vi.fn(async () => 'raw_tx_string_999'),
+    };
+
+    const client = new TestApiClient({ signerPool: mockPool });
+    const res = await client.requestWithSign('POST', `${serverUrl}/api/tx`, {
+      signType: 'page',
+      script: '() => raw_tx',
+      location: 'header',
+      name: 'x-client-transaction-id',
+    });
+
+    expect(res.status).toBe(200);
+    expect(receivedRequests[0].headers['x-client-transaction-id']).toBe('raw_tx_string_999');
+  });
+});
diff --git a/tests/core/index.test.js b/tests/core/index.test.js
index b894388..69828fd 100644
--- a/tests/core/index.test.js
+++ b/tests/core/index.test.js
@@ -255,11 +255,9 @@ describe('Signer pool', () => {
     expect(ring.next()).toBeNull();
   });
 
-  it('SignerWorkerPagePool abstract methods throw', async () => {
+  it('SignerWorkerPagePool validates browser instance', async () => {
     const pool = new SignerWorkerPagePool({ browser: {} });
-    await expect(pool.init()).rejects.toThrow(/Method not implemented/i);
-    await expect(pool.evaluate('1+1')).rejects.toThrow(/Method not implemented/i);
-    await expect(pool.close()).rejects.toThrow(/Method not implemented/i);
+    await expect(pool.init()).rejects.toThrow(/Browser instance with newPage\(\) is required/i);
   });
 });
 
diff --git a/tests/core/signer-pool.test.js b/tests/core/signer-pool.test.js
new file mode 100644
index 0000000..4c040e4
--- /dev/null
+++ b/tests/core/signer-pool.test.js
@@ -0,0 +1,184 @@
+// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import { PreSignedTokenRing, SignerWorkerPagePool } from '../../src/core/signer-pool.js';
+import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';
+
+describe('Story 13.1 — Tiered Signer Architecture: PreSignedTokenRing (AC-1)', () => {
+  it('[P0] should allocate tokens synchronously in O(1) round-robin order', () => {
+    const ring = new PreSignedTokenRing({ capacity: 50 });
+    ring.refill(['tok_1', 'tok_2', 'tok_3']);
+
+    expect(ring.size).toBe(3);
+    expect(ring.isEmpty).toBe(false);
+
+    const start = performance.now();
+    expect(ring.next()).toBe('tok_1');
+    expect(ring.next()).toBe('tok_2');
+    expect(ring.next()).toBe('tok_3');
+    expect(ring.next()).toBe('tok_1'); // round-robin wrap
+    const elapsed = performance.now() - start;
+
+    expect(elapsed).toBeLessThan(10); // O(1) synchronous speed
+  });
+
+  it('[P1] should clamp refill tokens to capacity and reset index to 0', () => {
+    const ring = new PreSignedTokenRing({ capacity: 3 });
+    ring.refill(['t1', 't2', 't3', 't4', 't5']);
+
+    expect(ring.size).toBe(3);
+    expect(ring.capacity).toBe(3);
+    expect(ring.next()).toBe('t1');
+    expect(ring.next()).toBe('t2');
+
+    // Refill resets index
+    ring.refill(['new_1', 'new_2']);
+    expect(ring.size).toBe(2);
+    expect(ring.next()).toBe('new_1');
+  });
+
+  it('[P2] should handle empty ring gracefully', () => {
+    const ring = new PreSignedTokenRing({ capacity: 10 });
+    expect(ring.size).toBe(0);
+    expect(ring.isEmpty).toBe(true);
+    expect(ring.next()).toBeNull();
+  });
+});
+
+describe('Story 13.1 — SignerWorkerPagePool (AC-2)', () => {
+  let mockBrowser;
+  let mockPages;
+
+  beforeEach(() => {
+    mockPages = [];
+    mockBrowser = {
+      newPage: vi.fn(async () => {
+        const page = {
+          id: `page_${mockPages.length + 1}`,
+          evaluate: vi.fn(async (fn, ...args) => 'signed_result'),
+          close: vi.fn(async () => {}),
+        };
+        mockPages.push(page);
+        return page;
+      }),
+      close: vi.fn(async () => {}),
+    };
+  });
+
+  it('[P0] should initialize minSize background pages in idle state', async () => {
+    const pool = new SignerWorkerPagePool({
+      browser: mockBrowser,
+      minSize: 4,
+      maxSize: 8,
+    });
+
+    await pool.init();
+    expect(mockBrowser.newPage).toHaveBeenCalledTimes(4);
+    expect(pool.size).toBe(4);
+    expect(pool.activeCount).toBe(4);
+  });
+
+  it('[P0] should evaluate script on least-loaded worker page', async () => {
+    const pool = new SignerWorkerPagePool({
+      browser: mockBrowser,
+      minSize: 2,
+      maxSize: 4,
+    });
+
+    await pool.init();
+    const result = await pool.evaluate('() => "sig_123"', ['arg1']);
+
+    expect(result).toBe('signed_result');
+    expect(mockPages[0].evaluate).toHaveBeenCalled();
+  });
+
+  it('[P1] should handle evaluation timeout and retry on a healthy page', async () => {
+    const hangingPage = {
+      evaluate: vi.fn(() => new Promise((resolve) => {
+        const t = setTimeout(resolve, 500);
+        if (t && typeof t.unref === 'function') t.unref();
+      })),
+      close: vi.fn(async () => {}),
+    };
+    const healthyPage = {
+      evaluate: vi.fn(async () => 'recovered_signature'),
+      close: vi.fn(async () => {}),
+    };
+
+    let callCount = 0;
+    const customBrowser = {
+      newPage: vi.fn(async () => {
+        callCount++;
+        return callCount === 1 ? hangingPage : healthyPage;
+      }),
+      close: vi.fn(async () => {}),
+    };
+
+    const pool = new SignerWorkerPagePool({
+      browser: customBrowser,
+      minSize: 1,
+      maxSize: 4,
+      defaultTimeoutMs: 50, // fast timeout for test
+    });
+
+    await pool.init();
+    const result = await pool.evaluate('() => sig', [], { timeoutMs: 50 });
+    expect(result).toBe('recovered_signature');
+  });
+
+  it('[P1] should throw PlatformError XACT_5000 when all pages are dead and maxSize exceeded', async () => {
+    const deadPage = {
+      evaluate: vi.fn(async () => { throw new Error('Crash'); }),
+      close: vi.fn(async () => {}),
+    };
+
+    const brokenBrowser = {
+      newPage: vi.fn(async () => deadPage),
+      close: vi.fn(async () => {}),
+    };
+
+    const pool = new SignerWorkerPagePool({
+      browser: brokenBrowser,
+      minSize: 1,
+      maxSize: 1,
+      defaultTimeoutMs: 50,
+    });
+
+    await pool.init();
+
+    await expect(pool.evaluate('() => sig')).rejects.toThrow(PlatformError);
+  });
+
+  it('[P1] should handle burst concurrent evaluate requests without exceeding maxSize', async () => {
+    const pool = new SignerWorkerPagePool({
+      browser: mockBrowser,
+      minSize: 2,
+      maxSize: 4,
+    });
+
+    await pool.init();
+    const results = await Promise.all([
+      pool.evaluate('() => 1'),
+      pool.evaluate('() => 2'),
+      pool.evaluate('() => 3'),
+      pool.evaluate('() => 4'),
+    ]);
+
+    expect(results).toHaveLength(4);
+    expect(pool.size).toBeLessThanOrEqual(4);
+  });
+
+  it('[P2] should close all worker pages and browser on close()', async () => {
+    const pool = new SignerWorkerPagePool({
+      browser: mockBrowser,
+      minSize: 3,
+      maxSize: 6,
+    });
+
+    await pool.init();
+    await pool.close();
+
+    for (const p of mockPages) {
+      expect(p.close).toHaveBeenCalled();
+    }
+  });
+});
diff --git a/types/core.d.ts b/types/core.d.ts
index 5e5b5e7..0217885 100644
--- a/types/core.d.ts
+++ b/types/core.d.ts
@@ -46,9 +46,11 @@ export interface CommentItem {
 
 export interface LoginResult {
   accountId: string;
-  cookies: string;
+  cookies: string | Record<string, unknown>;
   tokens: Record<string, unknown>;
   expiresAt?: Date;
+  cdpUrl?: string;
+  details?: Record<string, unknown>;
 }
 
 export interface CrawlerCommand {
@@ -170,6 +172,7 @@ export class ProxyDeadError extends PlatformError {
 export abstract class AbstractCrawler {
   name: string;
   requiresAuth: boolean;
+  cdpUrl: string | null;
   governor: AdaptiveRateGovernor | null;
   accountPool: AccountPool | null;
   constructor(deps?: {
@@ -179,12 +182,15 @@ export abstract class AbstractCrawler {
     governor?: AdaptiveRateGovernor;
     accountPool?: AccountPool;
     requiresAuth?: boolean;
+    cdpUrl?: string;
   });
   registerAction(action: string, handler: Function, descriptor?: Partial<Omit<ActionDescriptor, 'action'>>): void;
   registerAction(descriptor: Partial<ActionDescriptor> & { action: string; handler: Function }): void;
   listActions(): ActionDescriptor[];
   validateItem(item: PostItem | CommentItem): void;
   start(command: CrawlerCommand): Promise<unknown>;
+  launchBrowserWithCdp(cdpUrl?: string, options?: Record<string, unknown>): Promise<unknown>;
+  delayWithJitter(min?: number, max?: number): Promise<number>;
   abstract init(): Promise<void>;
   abstract search(args: Record<string, unknown>): Promise<PostItem[]>;
   abstract getPostDetail(args: Record<string, unknown>): Promise<PostItem>;
@@ -192,6 +198,26 @@ export abstract class AbstractCrawler {
   abstract cleanup(): Promise<void>;
 }
 
+export interface SignPayload {
+  signType?: 'token' | 'page' | 'custom' | string;
+  location?: 'header' | 'query' | 'cookie';
+  name?: string;
+  prefix?: string;
+  script?: string | Function;
+  args?: unknown[];
+  timeoutMs?: number;
+  warmup?: boolean;
+  [key: string]: unknown;
+}
+
+export interface SignResult {
+  headers?: Record<string, string>;
+  query?: Record<string, unknown>;
+  cookies?: Record<string, string>;
+  signature?: unknown;
+  [key: string]: unknown;
+}
+
 export abstract class AbstractApiClient {
   name: string;
   platform: string;
@@ -199,6 +225,8 @@ export abstract class AbstractApiClient {
   httpClient: unknown;
   responseValidator: AbstractPlatformResponseValidator | null;
   cookies: Record<string, unknown>;
+  tokenRing: PreSignedTokenRing | null;
+  signerPool: SignerWorkerPagePool | null;
   maxProxyRetries: number;
   maxAccountRotations: number;
   backoffBaseMs: number;
@@ -213,6 +241,8 @@ export abstract class AbstractApiClient {
     accountPool?: AccountPool;
     governor?: AdaptiveRateGovernor;
     responseValidator?: AbstractPlatformResponseValidator;
+    tokenRing?: PreSignedTokenRing;
+    signerPool?: SignerWorkerPagePool;
     platform?: string;
     client?: 'undici' | 'got';
     httpClient?: Function;
@@ -228,8 +258,9 @@ export abstract class AbstractApiClient {
   resolveProxy(accountId?: string, requiresResidential?: boolean): unknown;
   init(session: Record<string, unknown>): Promise<void>;
   request(method: string, url: string, options?: Record<string, unknown>): Promise<unknown>;
-  sign(payload: Record<string, unknown>): Promise<unknown>;
-  updateCookies(cookies: Record<string, unknown>): void;
+  requestWithSign(method: string, url: string, payload?: SignPayload, options?: Record<string, unknown>): Promise<unknown>;
+  sign(payload: SignPayload): Promise<SignResult | unknown>;
+  updateCookies(cookies?: Record<string, unknown>): void;
   handleError(response: unknown, platform: string): never;
 }
 
@@ -339,11 +370,28 @@ export class PreSignedTokenRing {
   refill(tokens: string[]): void;
   next(): string | null;
   get size(): number;
+  get capacity(): number;
+  get isEmpty(): boolean;
 }
 
 export class SignerWorkerPagePool {
-  constructor(options?: { minSize?: number; maxSize?: number; browser?: unknown });
-  init(): Promise<void>;
-  evaluate(script: string, args?: unknown[]): Promise<unknown>;
+  constructor(options?: {
+    minSize?: number;
+    maxSize?: number;
+    defaultTimeoutMs?: number;
+    warmupTimeoutMs?: number;
+    browser?: unknown;
+  });
+  init(options?: { warmupScript?: string; warmupArgs?: unknown[] }): Promise<void>;
+  evaluate(
+    script: string | Function,
+    args?: unknown[],
+    options?: { timeoutMs?: number; warmup?: boolean }
+  ): Promise<unknown>;
   close(): Promise<void>;
+  get size(): number;
+  get activeCount(): number;
+  get idleCount(): number;
+  get minSize(): number;
+  get maxSize(): number;
 }


Do not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.
