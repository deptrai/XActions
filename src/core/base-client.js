// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract with resilient
 * 429/403 auto-quarantine, exponential backoff with full jitter, account rotation,
 * and standby backoff request pipeline.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import {
  PlatformError,
  RateLimitError,
  BotChallengeError,
  AuthSessionExpiredError,
  ProxyDeadError,
  ErrorTypes,
  SuggestedActions,
} from './error-envelope.js';
import { globalProxyPool } from '../proxy/proxy-pool.js';
import { PureCryptoSignerRegistry } from './signer-pool.js';
import { globalSessionHealthOrchestrator } from './session-health-orchestrator.js';
import { globalProxyBudgetGovernor } from './proxy-budget-governor.js';
import { globalChallengeSignatureDetector } from './challenge-signature-detector.js';
import { globalJevChallengeDiagnoser, extractSnippet } from './jev-challenge-diagnoser.js';

/**
 * Normalize the `pureSigners` option into a `PureCryptoSignerRegistry`.
 * Accepts an existing registry, a plain `algorithm → fn` object map, or a
 * `Map` of the same shape. Returns null when nothing usable is supplied.
 * @param {import('./signer-pool.js').PureCryptoSignerRegistry | Record<string, Function> | Map<string, Function> | null | undefined} input
 * @returns {import('./signer-pool.js').PureCryptoSignerRegistry | null}
 */
function normalizePureSigners(input) {
  if (!input) return null;
  if (input instanceof PureCryptoSignerRegistry) return input;

  const registry = new PureCryptoSignerRegistry();
  const entries =
    input instanceof Map
      ? [...input.entries()]
      : typeof input === 'object'
        ? Object.entries(input)
        : [];
  for (const [algorithm, fn] of entries) {
    if (typeof fn === 'function') {
      registry.register(algorithm, fn);
    } else {
      console.warn(`⚠️ pureSigners: skipping non-function entry for algorithm "${algorithm}"`);
    }
  }
  return registry.size > 0 ? registry : null;
}

/** @typedef {import('./types.js').AccountRecord} AccountRecord */

/**
 * @typedef {{ accountId?: string, requiresResidential?: boolean, headers?: Record<string, unknown>, body?: unknown,
 *   pool?: ('realtime' | 'bulk'), consumerId?: ('nowing' | 'chainlens' | 'internal' | string),
 *   session?: Record<string, unknown>, telemetryContext?: import('./telemetry-context.js').TelemetryContext,
 *   isCanary?: boolean, skipResponseValidation?: boolean, raw?: boolean, requiresAuth?: boolean,
 *   timeout?: number, disableProxy?: boolean, [key: string]: unknown }} RequestOptions
 */

/**
 * @typedef {Object} ProxyProviderLike
 * @property {() => boolean} isAllQuarantined
 * @property {(proxy: any, options?: Record<string, unknown>) => unknown} getProxyAgent
 * @property {(proxy: string | Record<string, unknown>, durationMs?: number) => void} quarantine
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string, requiresResidential?: boolean, options?: { pool?: ('realtime' | 'bulk') }) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getNext]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
 * @property {(proxy: unknown, client?: string) => unknown} [createProxyAgent]
 */

const STANDBY_BACKOFF_MS = 30 * 1000;
const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;

/**
 * Classify transport errors caused by a dead or failing proxy tunnel.
 * Shared by platform clients so proxy-failure handling stays uniform:
 * quarantine the resolved proxy, then retry the request direct.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isProxyConnectionError(err) {
  if (!err) return false;
  const signatures = [
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_PROXY_CERTIFICATE_INVALID',
    'ERR_SOCKS_CONNECTION_FAILED',
    'ERR_NO_SUPPORTED_PROXIES',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    '466 Limit Reached',
  ];
  // request() wraps transport failures as { status: 503, error } → the
  // surfaced PlatformError keeps the original error under details.error.
  const candidates = [err, /** @type {{ details?: { error?: unknown } }} */ (err)?.details?.error];
  return candidates.some((e) => {
    // undici wraps socket failures as TypeError('fetch failed') with the real
    // errno on .cause.code — walk the cause chain (bounded) for each candidate.
    let cur = e;
    let depth = 0;
    while (cur && depth++ < 5) {
      const msg = String(/** @type {{ message?: unknown }} */ (cur).message || cur);
      const code = String(/** @type {{ code?: unknown }} */ (cur).code || '');
      if (signatures.some((sig) => msg.includes(sig) || code.includes(sig))) return true;
      cur = /** @type {{ cause?: unknown }} */ (cur).cause;
    }
    return false;
  });
}

export class AbstractApiClient {
  /** @type {string} */
  name = 'base';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = true;

  /**
   * HTTP-first by default: AbstractApiClient subclasses are lightweight direct
   * HTTP clients. Puppeteer/CDP-backed browser signers override this to `true`
   * (Story 37.1 fix — `engineUsed` telemetry reads this field; without a
   * declared default the check `requiresBrowser === false` saw `undefined`
   * and mislabeled HTTP-first platforms as 'browser').
   * @type {boolean}
   */
  requiresBrowser = false;

  /** @type {'undici' | 'got'} */
  client = 'undici';

  /** @type {Function | null} */
  httpClient = null;

  /** @type {import('./telemetry-context.js').TelemetryContext | null} */
  telemetryContext = null;

  /** @type {boolean} */
  isCanary = false;

  /** @type {import('./platform-validator.js').AbstractPlatformResponseValidator | null} */
  responseValidator = null;

  /**
   * Last 2xx response body as bounded plain text (≤500 chars) — stashed per
   * request so the Jev second-opinion hooks (suspicious-2xx in request() and
   * the 0-records check in AbstractCrawler.start()) have evidence to judge.
   * Best-effort attribution: overwritten on every successful response.
   * @type {string | null}
   */
  lastResponseSnippet = null;

  /**
   * Dedupe cache for the Jev second opinion — when the client-level hook
   * diagnoses a snippet without escalating, the crawler-level 0-records hook
   * reuses this result on identical evidence instead of a second decide call.
   * @type {{ snippet: string, diag: object } | null}
   */
  _lastJevDiag = null;

  /** @type {Record<string, string>} */
  cookies = {};

  /** @type {import('./signer-pool.js').PreSignedTokenRing | null} */
  tokenRing = null;

  /** @type {import('./signer-pool.js').SignerWorkerPagePool | null} */
  signerPool = null;

  /** @type {import('./signer-pool.js').PureCryptoSignerRegistry | null} */
  pureSigners = null;

  /** @type {ProxyProviderLike | null} */
  proxyPool = null;

  /** @type {ProxyProviderLike | null} */
  proxyProvider = null;

  /** @type {number} */
  maxProxyRetries = 3;

  /** @type {number} */
  maxAccountRotations = 1;

  /** @type {number} */
  backoffBaseMs = 1000;

  /** @type {number} */
  backoffMultiplier = 2;

  /** @type {number} */
  maxBackoffMs = 30000;

  /** @type {number} */
  rateLimitHibernationMs = DEFAULT_QUARANTINE_MS;

  /** @type {number} */
  standbyBackoffMs = STANDBY_BACKOFF_MS;

  /**
   * @param {object} [options]
   * @param {import('./session-manager.js').SessionManager} [options.sessionManager]
   * @param {ProxyProviderLike} [options.proxyPool]
   * @param {ProxyProviderLike} [options.proxyProvider]
   * @param {import('./account-pool.js').AccountPool} [options.accountPool]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {import('./platform-validator.js').AbstractPlatformResponseValidator} [options.responseValidator]
   * @param {import('./signer-pool.js').PreSignedTokenRing} [options.tokenRing]
   * @param {import('./signer-pool.js').SignerWorkerPagePool} [options.signerPool]
   * @param {import('./signer-pool.js').PureCryptoSignerRegistry | Record<string, Function>} [options.pureSigners] - Tier 0 pure-algorithm signers (registry or plain algorithm→fn map)
   * @param {string} [options.platform]
   * @param {'undici' | 'got'} [options.client]
   * @param {Function} [options.httpClient]
   * @param {boolean} [options.requiresAuth]
   * @param {number} [options.maxProxyRetries]
   * @param {number} [options.maxAccountRotations]
   * @param {number} [options.backoffBaseMs]
   * @param {number} [options.backoffMultiplier]
   * @param {number} [options.maxBackoffMs]
   * @param {number} [options.rateLimitHibernationMs]
   * @param {number} [options.standbyBackoffMs]
   * @param {number} [options.timeout]
   * @param {boolean} [options.requiresProxy]
   * @param {boolean} [options.requiresBrowser] - True for Puppeteer/CDP-backed browser signers; HTTP-first clients leave the default false.
   * @param {import('./telemetry-context.js').TelemetryContext} [options.telemetryContext]
   * @param {boolean} [options.isCanary]
   * @param {import('./session-health-orchestrator.js').SessionHealthOrchestrator} [options.healthOrchestrator]
   * @param {import('./challenge-signature-detector.js').ChallengeSignatureDetector} [options.challengeDetector]
   * @param {import('./proxy-budget-governor.js').ProxyBudgetGovernor} [options.proxyBudgetGovernor]
   */
  constructor(options = {}) {
    if (new.target === AbstractApiClient) {
      throw new TypeError('AbstractApiClient is abstract; extend it.');
    }
    this.sessionManager = options.sessionManager;
    this.proxyPool = /** @type {ProxyProviderLike | null} */ (options.proxyPool !== undefined ? options.proxyPool : globalProxyPool);
    this.proxyProvider = options.proxyProvider || null;
    this._hasExplicitProxy = options.proxyProvider !== undefined || options.proxyPool !== undefined;
    this._requiresProxyExplicit = options.requiresProxy !== undefined;
    this.accountPool = options.accountPool;
    this.governor = options.governor;
    this.responseValidator = options.responseValidator || null;
    this.tokenRing = options.tokenRing || null;
    this.signerPool = options.signerPool || null;
    this.pureSigners = normalizePureSigners(options.pureSigners);
    this.telemetryContext = options.telemetryContext || null;
    this.isCanary = Boolean(options.isCanary);
    this.healthOrchestrator = options.healthOrchestrator !== undefined ? options.healthOrchestrator : globalSessionHealthOrchestrator;
    this.challengeDetector = options.challengeDetector !== undefined ? options.challengeDetector : globalChallengeSignatureDetector;
    this.proxyBudgetGovernor = options.proxyBudgetGovernor !== undefined ? options.proxyBudgetGovernor : globalProxyBudgetGovernor;

    if (options.platform !== undefined) this.platform = options.platform;
    if (options.client !== undefined) this.client = options.client;
    if (options.httpClient !== undefined) this.httpClient = options.httpClient;
    if (options.requiresAuth !== undefined) this.requiresAuth = options.requiresAuth;
    if (options.maxProxyRetries !== undefined) this.maxProxyRetries = options.maxProxyRetries;
    if (options.maxAccountRotations !== undefined) this.maxAccountRotations = options.maxAccountRotations;
    if (options.backoffBaseMs !== undefined) this.backoffBaseMs = options.backoffBaseMs;
    if (options.backoffMultiplier !== undefined) this.backoffMultiplier = options.backoffMultiplier;
    if (options.maxBackoffMs !== undefined) this.maxBackoffMs = options.maxBackoffMs;
    if (options.rateLimitHibernationMs !== undefined) this.rateLimitHibernationMs = options.rateLimitHibernationMs;
    if (options.standbyBackoffMs !== undefined) this.standbyBackoffMs = options.standbyBackoffMs;
    this.timeout = options.timeout ?? 30000;
    this.requiresProxy = options.requiresProxy ?? false;
    if (options.requiresBrowser !== undefined) this.requiresBrowser = options.requiresBrowser;
  }

  /**
   * Parse Retry-After HTTP header in seconds or HTTP-date into milliseconds.
   * @param {string | number} [headerValue]
   * @returns {number}
   */
  #parseRetryAfter(headerValue) {
    if (!headerValue) return 0;
    const num = Number(headerValue);
    if (!Number.isNaN(num) && num > 0) {
      if (num > 1000000000) {
        const diff = num * 1000 - Date.now();
        return diff > 0 ? diff : 0;
      }
      return num * 1000;
    }
    const dateMs = Date.parse(String(headerValue));
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      return diff > 0 ? diff : 0;
    }
    return 0;
  }

  /**
   * Async sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve proxy from proxyProvider or proxyPool.
   * Throws PROXY_EXHAUSTED if no proxy is available.
   *
   * Backward compatible: when `options.pool` is omitted the legacy whole-pool
   * sticky/round-robin behavior is preserved. When a dual-pool partition is
   * requested ('realtime' | 'bulk'), the pool is selected through
   * ProxyIpPool.getProxy({ pool, ... }) (AD-20).
   *
   * @param {string | AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential=false]
   * @param {boolean} [requiresAuth] - Effective auth mode for this specific request/action; defaults to instance requiresAuth.
   * @param {Object} [options]
   * @param {('realtime' | 'bulk')} [options.pool] - Dual-pool partition (AD-20).
   * @param {string} [options.consumerId] - Consumer identity for observability (AD-20).
   * @returns {string | Record<string, unknown> | null}
   */
  resolveProxy(accountId, requiresResidential = false, requiresAuth = this.requiresAuth, options = {}) {
    const safeOptions = options || {};
    // Story 40.1: tier option takes precedence over requiresResidential boolean
    const tier = safeOptions.tier || (requiresResidential ? 'residential' : null);
    const rawAccountId = typeof accountId === 'string' ? accountId : accountId?.accountId;
    const pool = typeof safeOptions.pool === 'string' ? safeOptions.pool : null;
    let proxy = null;

    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      const opts = /** @type {Record<string, unknown>} */ ({ accountId: rawAccountId, requiresResidential, tier: tier || undefined, pool: pool || undefined, consumerId: safeOptions.consumerId });
      const safeRecord = /** @type {Record<string, unknown>} */ (safeOptions);
      // Forward geo/session targeting hints (country/isp/sessionId/...) to
      // provider-class pools (DynamicTunnelProvider) that honour them (AC-5).
      for (const key of ['country', 'city', 'state', 'region', 'isp', 'asn', 'sessionId', 'sessionduration', 'lifetime', 'period', 'sid']) {
        if (safeRecord[key] !== undefined) opts[key] = safeRecord[key];
      }
      proxy = this.proxyProvider.getProxy(opts);
    } else if (this.proxyPool && (this._hasExplicitProxy || this.requiresProxy || requiresResidential)) {
      if (requiresAuth && rawAccountId && typeof this.proxyPool.getStickyProxy === 'function') {
        proxy = this.proxyPool.getStickyProxy(rawAccountId, requiresResidential, { ...(pool ? { pool } : {}), ...(tier ? { tier } : {}) });
      } else if (pool && typeof this.proxyPool.getProxy === 'function') {
        proxy = this.proxyPool.getProxy({
          pool,
          requiresResidential,
          tier: tier || undefined,
          yieldFromBulk: pool === 'realtime',
        });
      } else if (typeof this.proxyPool.getNext === 'function') {
        proxy = this.proxyPool.getNext(requiresResidential, tier);
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        proxy = this.proxyPool.getRotatingProxy(requiresResidential);
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        proxy = this.proxyPool.getRoundRobinProxy(requiresResidential);
      }
    }

    if (!proxy) {
      if (requiresAuth && rawAccountId && this.accountPool) {
        this.accountPool.markUnavailable(rawAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
      }
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy pool exhausted: no healthy proxy available',
        statusCode: 503,
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: this.standbyBackoffMs,
        accountId: rawAccountId || null,
        platform: this.platform,
      });
    }

    return /** @type {string | Record<string, unknown> | null} */ (proxy);
  }

  /**
   * Shared env proxy fallback (OQ-1): PROXY_URL may hold a comma-separated
   * list — first entry wins. Clients call this when no provider/pool can
   * serve a proxy so env-configured proxies still apply (AC-1/AC-2).
   * @returns {string | null}
   */
  resolveEnvProxy() {
    const raw = process.env.PROXY_URL;
    if (!raw) return null;
    const first = String(raw).split(',').map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  }

  /**
   * Quarantine a proxy that produced a connection failure. Best-effort —
   * providers that do not own the proxy may reject it; that is fine.
   * @param {string | Record<string, unknown> | null | undefined} proxy
   * @param {number} [durationMs] - defaults to the provider's own 5-minute quarantine
   */
  quarantineProxy(proxy, durationMs) {
    if (!proxy) return;
    // Rotating proxy gateways (e.g. SocksNode) rotate IP per connection.
    // Quarantining the gateway on a single transient node failure exhausts the pool.
    const host = typeof proxy === 'string' ? proxy : (proxy.host || proxy.hostname || '');
    if (host.includes('socksnode.com')) return;
    const provider = this.proxyProvider || this.proxyPool;
    if (provider && typeof provider.quarantine === 'function') {
      try {
        provider.quarantine(proxy, durationMs);
      } catch {
        // Quarantine is best-effort — never fail the request pipeline over it.
      }
    }
  }

  /**
   * @param {Object} session
   * @returns {Promise<void>}
   */
  async init(session) {
    throw new Error('Method not implemented: init(session)');
  }

  /**
   * Default HTTP transport factory for got-scraping or undici.fetch().
   * @returns {Promise<Function>}
   */
  async #getDefaultHttpClient() {
    if (this.client === 'curl') {
      const { createCurlTransport } = await import('./curl-transport.js');
      return createCurlTransport(this.platform);
    }
    if (this.client === 'got') {
      const { gotScraping } = await import('got-scraping');
      return async (/** @type {Record<string, any>} */ reqOpts) => {
        const { method, url, headers, body, json, proxy, timeout, raw } = reqOpts;
        if (!/^https?:\/\//i.test(url)) {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: 'Absolute URL is required for default HTTP client',
            statusCode: 400,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: this.platform,
          });
        }
        /** @type {Record<string, any>} */
        const options = {
          method,
          url,
          headers: headers || {},
          timeout: { request: timeout === undefined ? 30000 : timeout },
          throwHttpErrors: false,
          http2: false,
        };
        if (raw) {
          options.responseType = 'buffer';
          options.resolveBodyOnly = false;
        }
        if (json !== undefined) {
          options.json = json;
        } else if (body !== undefined) {
          options.body = this.#normalizeRequestBody(body, headers);
        }
        if (proxy) {
          const { getProxyAgent } = await import('../proxy/index.js');
          const proxyUrl = getProxyAgent(proxy, { client: 'got' });
          if (typeof proxyUrl === 'string') options.proxyUrl = proxyUrl;
        }
        const resp = await gotScraping(options);
        if (raw) {
          return {
            status: resp.statusCode,
            headers: resp.headers,
            data: undefined,
            body: resp.body,
          };
        }
        let data = resp.body;
        if (typeof resp.body === 'string') {
          try {
            data = JSON.parse(resp.body);
          } catch {}
        }
        return {
          status: resp.statusCode,
          headers: resp.headers,
          data,
        };
      };
    }

    // Default: undici
    const { fetch: undiciFetch } = await import('undici');
    return async (/** @type {Record<string, any>} */ reqOpts) => {
      const { method, url, headers, body, json, agent, timeout, raw } = reqOpts;
      if (!/^https?:\/\//i.test(url)) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'Absolute URL is required for default HTTP client',
          statusCode: 400,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: this.platform,
        });
      }
      /** @type {Record<string, any>} */
      const fetchOpts = {
        method,
        headers: { ...(headers || {}) },
        signal: AbortSignal.timeout(timeout === undefined ? 30000 : timeout),
      };
      if (agent) {
        fetchOpts.dispatcher = agent;
      }
      if (json !== undefined) {
        if (!this.#hasHeader(headers, 'content-type')) {
          fetchOpts.headers['content-type'] = 'application/json';
        }
        fetchOpts.body = JSON.stringify(json);
      } else if (body !== undefined) {
        const normalized = this.#normalizeRequestBody(body, headers);
        if (normalized !== body) {
          if (!this.#hasHeader(headers, 'content-type')) {
            fetchOpts.headers['content-type'] = 'application/json';
          }
        }
        fetchOpts.body = normalized;
      }
      const resp = await undiciFetch(url, fetchOpts);
      if (raw) {
        return {
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          data: undefined,
          body: resp.body,
        };
      }
      let data;
      const text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        data,
      };
    };
  }

  /**
   * Execute request with tiered signing (PreSignedTokenRing, SignerWorkerPagePool, or custom sign()).
   *
   * @param {string} method
   * @param {string} url
   * @param {Object} [payload={}]
   * @param {string} [payload.signType='token'] - 'token' | 'page' | 'pure_algorithm' | 'custom'
   * @param {string} [payload.algorithm] - Tier 0 pure-algorithm name (e.g. 'x-request-fingerprint'); auto-detected when registered and signType is not 'token'/'page'
   * @param {'header' | 'query' | 'cookie'} [payload.location='header']
   * @param {string} [payload.name='authorization']
   * @param {string} [payload.prefix='']
   * @param {string | Function} [payload.script]
   * @param {any[]} [payload.args]
   * @param {number} [payload.timeoutMs]
   * @param {boolean} [payload.warmup]
   * @param {RequestOptions} [options={}]
   * @returns {Promise<unknown>}
   */
  async requestWithSign(method, url, payload = {}, options = {}) {
    /** @type {Record<string, any> | null} */
    let signResult = null;
    const signType = payload.signType || 'token';

    // ── Tier 0: pure-algorithm crypto signer (zero-browser) ─────────────
    // Runs before Tier 1 (token ring) and Tier 2 (page pool). Triggered when
    //   - signType === 'pure_algorithm', OR
    //   - payload.algorithm matches a registered signer AND the caller did NOT
    //     explicitly set signType to 'token' or 'page' (auto-detect). Note:
    //     `payload.signType` is inspected BEFORE the 'token' default applies so
    //     an omitted signType still auto-detects.
    // A pure signer returns a SignResult object, a raw signature string, or
    // null/undefined to signal "not applicable" → fall through to lower tiers.
    const algorithm = typeof payload.algorithm === 'string' ? payload.algorithm : null;
    const requestedSignType = payload.signType; // undefined when caller omitted it
    const wantsPure =
      this.pureSigners !== null &&
      algorithm !== null &&
      (signType === 'pure_algorithm' ||
        (requestedSignType !== 'token' && requestedSignType !== 'page' && this.pureSigners.has(algorithm)));

    if (wantsPure && this.pureSigners && algorithm) {
      const pureFn = this.pureSigners.get(algorithm);
      if (pureFn) {
        try {
          const res = pureFn({ ...payload, method, url });
          if (res !== null && res !== undefined) {
            signResult = typeof res === 'object' ? res : { signature: res };
          }
          // res === null/undefined → not applicable → fall through to Tier 2.
        } catch (err) {
          // Signer threw → wrap intent, then fall back to Tier 2 (AD-14).
          console.warn(
            `⚠️ Pure-algorithm signer "${algorithm}" threw: ${err instanceof Error ? err.message : String(err)} — falling back to Tier 2`
          );
        }
      }
      // No registered signer / null result / threw → fall back to lower tiers.
    }

    // When the caller asked for pure_algorithm but it could not resolve, let the
    // request degrade gracefully to a page sign (if a script was supplied) or to
    // the subclass sign() hook — never hard-fail on an unresolvable pure signer.
    const effectiveSignType = signType === 'pure_algorithm' ? (payload.script ? 'page' : 'custom') : signType;

    if (!signResult && effectiveSignType === 'token' && this.tokenRing) {
      if (this.tokenRing.isEmpty) {
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_5000',
          message: 'Token ring is empty; no pre-signed token available',
          statusCode: 500,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: this.platform,
        });
      }
      const token = this.tokenRing.next();
      if (token) {
        const location = payload.location || 'header';
        const name = payload.name || 'authorization';
        const prefix = payload.prefix || '';
        const value = `${prefix}${token}`;

        signResult = {};
        if (location === 'header') {
          signResult.headers = { [name]: value };
        } else if (location === 'query') {
          signResult.query = { [name]: value };
        } else if (location === 'cookie') {
          signResult.cookies = { [name]: value };
        } else {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: `Unsupported sign location: "${location}"`,
            statusCode: 400,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: this.platform,
          });
        }
      }
    } else if (!signResult && effectiveSignType === 'page' && this.signerPool && payload.script) {
      const res = await this.signerPool.evaluate(payload.script, payload.args || [], {
        timeoutMs: payload.timeoutMs,
        warmup: payload.warmup,
      });
      signResult = typeof res === 'object' && res !== null ? res : { signature: res };
    } else if (!signResult && typeof this.sign === 'function' && this.sign !== AbstractApiClient.prototype.sign) {
      signResult = /** @type {Record<string, any>} */ (await this.sign(payload));
    }

    const mergedOptions = { ...options };
    let resolvedUrl = url;

    if (signResult) {
      if (signResult.headers) {
        mergedOptions.headers = { ...mergedOptions.headers, ...signResult.headers };
      }
      if (signResult.query) {
        const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
        const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
        for (const [k, v] of Object.entries(signResult.query)) {
          parsedUrl.searchParams.set(k, String(v));
        }
        resolvedUrl = isAbsolute
          ? parsedUrl.toString()
          : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      }
      if (signResult.cookies) {
        for (const [k, v] of Object.entries(signResult.cookies)) {
          this.cookies[k] = String(v);
        }
        this.updateCookies(this.cookies);
      }
      if (signResult.signature && !signResult.headers && !signResult.query && !signResult.cookies) {
        const location = payload.location || 'header';
        const name = payload.name || 'x-client-transaction-id';
        if (location === 'header') {
          mergedOptions.headers = { ...mergedOptions.headers, [name]: String(signResult.signature) };
        } else if (location === 'query') {
          const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
          const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
          parsedUrl.searchParams.set(name, String(signResult.signature));
          resolvedUrl = isAbsolute
            ? parsedUrl.toString()
            : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        } else if (location === 'cookie') {
          // Raw-string signature into a cookie slot — mirror signResult.cookies.
          this.cookies[name] = String(signResult.signature);
          this.updateCookies(this.cookies);
        }
      }
    }

    if (Object.keys(this.cookies).length > 0) {
      const existingHeaders = /** @type {Record<string, string>} */ ({ ...(mergedOptions.headers || {}) });
      let hasCookieHeader = false;
      const cleanedHeaders = /** @type {Record<string, string>} */ ({});
      for (const [key, value] of Object.entries(existingHeaders)) {
        if (key.toLowerCase() === 'cookie') {
          hasCookieHeader = true;
        }
        cleanedHeaders[key] = value;
      }
      if (!hasCookieHeader) {
        const cookieHeader = Object.entries(this.cookies)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('; ');
        cleanedHeaders.cookie = cookieHeader;
      }
      mergedOptions.headers = cleanedHeaders;
    }

    return this.request(method, resolvedUrl, mergedOptions);
  }

  /**
   * Execute request through resilient interceptor pipeline (429/403 auto-quarantine,
   * exponential replay with jitter, account rotation, standby backoff).
   *
   * @param {string} method
   * @param {string} url
   * @param {RequestOptions} [options]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const opts = options || {};
    /** @type {import('./telemetry-context.js').TelemetryContext | null | undefined} */
    const telemetry = /** @type {import('./telemetry-context.js').TelemetryContext | null} */ (opts.session?.telemetry || opts.telemetryContext || this.telemetryContext);
    const isCanary = Boolean(
      opts.session?.isCanary ||
      opts.isCanary ||
      telemetry?.source === 'canary' ||
      this.isCanary
    );
    let currentAccountId = opts.accountId;
    let concreteAccountId =
      currentAccountId && currentAccountId !== 'guest' && currentAccountId !== 'default'
        ? currentAccountId
        : null;
    const effectiveRequiresAuth =
      typeof opts.requiresAuth === 'boolean' ? opts.requiresAuth : this.requiresAuth;
    const skipResponseValidation = opts.skipResponseValidation === true;
    const isRaw = opts.raw === true;

    // AD-20 multi-consumer identity & dual-pool routing:
    // on-demand consumers (nowing/chainlens) route to the realtime partition,
    // internal/background traffic to bulk. Explicit opts.pool always wins.
    const consumerId =
      typeof opts.consumerId === 'string' && opts.consumerId.trim()
        ? opts.consumerId.trim().toLowerCase()
        : null;
    const pool =
      opts.pool === 'realtime' || opts.pool === 'bulk'
        ? opts.pool
        : consumerId
          ? (consumerId === 'internal' ? 'bulk' : 'realtime')
          : null;

    if (effectiveRequiresAuth && !concreteAccountId && !this.accountPool) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: `No account or account pool configured for authenticated ${this.platform} request`,
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: this.platform,
      });
    }

    // AD-20 consumer quota gate — checked before the per-account governor gate.
    // Metered consumers only (internal is unmetered). We record only after
    // all pre-flight gates (auth, proxy availability, account hibernation) have
    // passed, so quota is not consumed by requests that never leave the client.
    if (!isCanary && consumerId && consumerId !== 'internal' && this.governor && typeof this.governor.canConsumerRequest === 'function') {
      if (!this.governor.canConsumerRequest(consumerId)) {
        const retryAfterSeconds =
          typeof this.governor.getConsumerRetryAfterSeconds === 'function'
            ? this.governor.getConsumerRetryAfterSeconds(consumerId)
            : 60;
        throw new RateLimitError({
          code: 'XACT_4291',
          message: `Consumer quota exceeded for ${consumerId}`,
          statusCode: 429,
          suggestedAction: SuggestedActions.REDUCE_RATE,
          retryAfterMs: Math.max(1, retryAfterSeconds) * 1000,
          platform: this.platform,
          details: { consumerId, pool },
        });
      }
    }

    // Check governor before request for auth-required platforms or opt-in accountId
    if (!isCanary && concreteAccountId && this.governor) {
      if (typeof this.governor.canAccountRequest === 'function') {
        const canRequest = this.governor.canAccountRequest(concreteAccountId, this.platform);
        if (!canRequest) {
          throw new PlatformError({
            type: ErrorTypes.HIBERNATION,
            code: 'XACT_4291',
            message: `Account "${concreteAccountId}" is hibernating or exceeded velocity limit`,
            statusCode: 429,
            suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
            accountId: concreteAccountId,
            platform: this.platform,
          });
        }
      }
    }

    const provider = this.proxyProvider || this.proxyPool;

    if (this.requiresProxy && !provider) {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy is required for platform requests and no proxy pool is configured',
        statusCode: 503,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        accountId: concreteAccountId,
        platform: this.platform,
      });
    }

    let accountRotationCount = 0;
    let escalatedTier = null; // Story 40.1: track proxy tier escalation (datacenter → residential → mobile_4g)

    while (accountRotationCount <= this.maxAccountRotations) {
      for (let attempt = 0; attempt < this.maxProxyRetries; attempt++) {
        // Story 42.4 — stale-evidence guard: every attempt starts clean so a
        // snippet/diagnosis from a previous attempt can never be attributed
        // to this attempt's response (or mistaken for evidence by the
        // crawler-level 0-records hook).
        this.lastResponseSnippet = null;
        this._lastJevDiag = null;

        const shouldUseProxy = !opts.disableProxy && (this.requiresProxy || opts.requiresResidential || (this._hasExplicitProxy && !this._requiresProxyExplicit));

        // Check if pool is completely quarantined before attempting proxy request
        if (shouldUseProxy && provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
          if (concreteAccountId && this.accountPool) {
            this.accountPool.markUnavailable(concreteAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
          }
          throw new PlatformError({
            type: ErrorTypes.PROXY_EXHAUSTED,
            code: 'XACT_5030',
            message: 'Proxy pool exhausted: all proxies quarantined in standby',
            statusCode: 503,
            suggestedAction: SuggestedActions.WAIT,
            retryAfterMs: this.standbyBackoffMs,
            accountId: concreteAccountId,
            platform: this.platform,
          });
        }

        // Story 40.1: use escalated tier if set (from previous 403 challenge)
        const effectiveTier = escalatedTier || (opts.requiresResidential ? 'residential' : null);
        const proxy = shouldUseProxy
          ? this.resolveProxy(concreteAccountId, opts.requiresResidential, effectiveRequiresAuth, { pool: pool || undefined, consumerId: consumerId || undefined, tier: effectiveTier || undefined })
          : null;

        // AD-20: record the consumer request only after we know a healthy proxy
        // exists and all pre-flight gates have passed.
        if (!isCanary && consumerId && consumerId !== 'internal' && proxy && this.governor && typeof this.governor.recordConsumerRequest === 'function') {
          this.governor.recordConsumerRequest(consumerId);
        }

        let agent = null;
        if (proxy && provider && typeof provider.getProxyAgent === 'function') {
          agent = provider.getProxyAgent(proxy, { client: this.client });
        } else if (proxy && provider && typeof provider.createProxyAgent === 'function') {
          agent = provider.createProxyAgent(proxy, this.client);
        }

        let transport = this.httpClient;
        if (typeof transport !== 'function') {
          transport = await this.#getDefaultHttpClient();
        }

        const recordTelemetryAttempt = (/** @type {Record<string, unknown>} */ res, /** @type {number} */ reqStart, /** @type {number} */ attemptNum, isQuarantined = false) => {
          const latencyMs = Math.max(0, Date.now() - reqStart);
          if (concreteAccountId && this.healthOrchestrator && typeof this.healthOrchestrator.recordLatency === 'function') {
            try { this.healthOrchestrator.recordLatency(this.platform || 'default', concreteAccountId, latencyMs); } catch {}
          }
          if (!telemetry || typeof telemetry.recordRequest !== 'function') return;
          const headers = /** @type {Record<string, unknown>} */ (res?.headers || {});
          let proxyBytes = Number(headers['content-length'] || headers['Content-Length'] || 0);
          if (!proxyBytes) {
            const rawPayload = res?.rawBody ?? res?.body ?? res?.data;
            if (rawPayload) {
              if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawPayload)) {
                proxyBytes = rawPayload.length;
              } else if (typeof rawPayload === 'string') {
                proxyBytes = typeof Buffer !== 'undefined' ? Buffer.byteLength(rawPayload) : rawPayload.length;
              } else if (typeof rawPayload === 'object' && rawPayload !== null && typeof /** @type {Record<string, unknown>} */ (rawPayload).byteLength === 'number') {
                proxyBytes = /** @type {Record<string, unknown>} */ (rawPayload).byteLength;
              }
            }
          }

          const statusCode = res?.status !== undefined ? Number(res.status) : 0;

          let isFalse200 = false;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              if (typeof this.responseValidator?.isFalse200 === 'function') {
                isFalse200 = Boolean(this.responseValidator.isFalse200(res));
              } else if (typeof this.responseValidator?.validateResponse === 'function') {
                isFalse200 = Boolean(this.responseValidator.validateResponse(res)?.isFalse200);
              }
            } catch {
              isFalse200 = false;
            }
          }

          let isCheckpoint = false;
          try {
            const isLoginWall =
              typeof this.responseValidator?.isLoginWall === 'function' &&
              Boolean(this.responseValidator.isLoginWall(res));
            const isBotChallenge =
              typeof this.responseValidator?.isBotChallenge === 'function' &&
              Boolean(this.responseValidator.isBotChallenge(res));
            let fromValidate = false;
            if (typeof this.responseValidator?.validateResponse === 'function') {
              fromValidate = Boolean(this.responseValidator.validateResponse(res)?.isCheckpoint);
            }
            isCheckpoint = isLoginWall || isBotChallenge || fromValidate;
          } catch {
            isCheckpoint = false;
          }

          try {
            telemetry.recordRequest({
              latencyMs,
              httpStatus: statusCode,
              proxyBytes,
              retries: attemptNum,
              isFalse200,
              isCheckpoint,
              proxyQuarantined: Boolean(isQuarantined),
              ts: reqStart,
            });
          } catch {
            // Guard telemetry recording from crashing request execution
          }
        };

        const requestStart = Date.now();
        const requestTimeout = opts.timeout ?? this.timeout ?? 30000;
        let response;
        /** @type {Record<string, unknown>} */
        const transportOpts = {
          ...opts,
          timeout: requestTimeout,
          method,
          url,
          proxy,
          accountId: currentAccountId,
        };
        if (agent) {
          transportOpts.agent = agent;
        }
        try {
          response = await transport(transportOpts);
        } catch (err) {
          if (err instanceof PlatformError && !err.isRetryable) {
            recordTelemetryAttempt({ status: err.statusCode || 0, error: err }, requestStart, attempt, false);
            throw err;
          }
          const errObj = /** @type {Record<string, unknown>} */ (err);
          response = {
            status: errObj?.statusCode || (errObj?.name === 'TimeoutError' ? 408 : 503),
            headers: {},
            error: err,
          };
          // Tunnel-level failure — the proxy is dead, not the target.
          // Quarantine it; when the platform allows direct egress, retry once
          // direct inside this same attempt (requiresProxy:true keeps the
          // 503 → ProxyDeadError path below, so the proxy stays required).
          if (proxy && isProxyConnectionError(err)) {
            this.quarantineProxy(proxy);
            if (concreteAccountId && this.healthOrchestrator && typeof this.healthOrchestrator.recordProxyHealth === 'function') {
              try { this.healthOrchestrator.recordProxyHealth(this.platform || 'default', concreteAccountId, false); } catch {}
            }
            if (!this.requiresProxy) {
              const directOpts = /** @type {Record<string, any>} */ ({ ...transportOpts, proxy: null });
              delete directOpts.agent;
              try {
                response = await transport(directOpts);
              } catch (retryErr) {
                const rErrObj = /** @type {Record<string, unknown>} */ (retryErr);
                response = {
                  status: rErrObj?.statusCode || (rErrObj?.name === 'TimeoutError' ? 408 : 503),
                  headers: {},
                  error: retryErr,
                };
              }
            }
          }
        }

        const status = response?.status ?? 500;

        let isQuarantined = false;
        if (status === 429 || status === 403) {
          if (proxy && provider && typeof provider.quarantine === 'function') {
            provider.quarantine(proxy, this.rateLimitHibernationMs);
            isQuarantined = true;
          }
        }

        recordTelemetryAttempt(response, requestStart, attempt, isQuarantined);

        // Story 27.3 — early challenge *signal* on ANY status code.
        // We do NOT throw here — the existing 403/429 path handles retry,
        // proxy quarantine, and eventual BotChallengeError. This block just
        // records the detection to governor/orchestrator/pool so the
        // "hibernate + retry different account" flow kicks in even when
        // the challenge page came back with 200 (false-200) or 4xx.
        let lastChallengeResult = null;
        try {
          const detector = this.challengeDetector || globalChallengeSignatureDetector;
          if (detector && typeof detector.detectFromResponse === 'function' && response) {
            lastChallengeResult = detector.detectFromResponse(response, { platform: this.platform });
          }
        } catch { lastChallengeResult = null; }

        if (lastChallengeResult && lastChallengeResult.detected) {
          const hibernationMs = lastChallengeResult.suggestedHibernationMs || this.rateLimitHibernationMs;
          if (concreteAccountId && this.accountPool) {
            try { this.accountPool.markUnavailable(concreteAccountId, 'bot_challenge', hibernationMs, this.platform); } catch {}
            if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
              try { this.governor.recordBotChallenge(concreteAccountId, this.platform, hibernationMs); } catch {}
            }
            if (this.healthOrchestrator && typeof this.healthOrchestrator.recordBotChallenge === 'function') {
              try { this.healthOrchestrator.recordBotChallenge(this.platform || 'default', concreteAccountId); } catch {}
            }
          }
          // Note: we do NOT throw here on 4xx/5xx — the existing status-code
          // branch below already handles 403 (quarantine proxy + retry +
          // eventual BotChallengeError via line ~1281). For 2xx, the
          // responseValidator.isBotChallenge check inside the success branch
          // re-uses lastChallengeResult so the throw happens there.
        }

        // Success condition (2xx / 3xx)
        if (status >= 200 && status < 400) {
          // Story 42.4 — stash a bounded text snippet of the last 2xx body so
          // the Jev second-opinion hooks (the suspicious-2xx check below and
          // the 0-records check in AbstractCrawler.start()) have evidence.
          // Only response.data is evidence — NEVER the response envelope:
          // headers/set-cookie must not travel to api.typesafe.ai. A Buffer
          // response.body is an acceptable fallback for transports that don't
          // populate .data. Skipped entirely for raw callers and when the
          // diagnoser is disabled.
          this.lastResponseSnippet = null;
          if (!isRaw && globalJevChallengeDiagnoser.enabled) {
            try {
              const evidence =
                response?.data ||
                (typeof Buffer !== 'undefined' && Buffer.isBuffer(response?.body) ? response.body : null);
              const snippet = extractSnippet(evidence);
              this.lastResponseSnippet = snippet || null;
            } catch {
              this.lastResponseSnippet = null;
            }
          }

          // Story 27.3 — False-200 bot challenge check (runs before isRaw, and even when responseValidator is null)
          let challengeResult = lastChallengeResult;
          if (!challengeResult) {
            try {
              const detector = this.challengeDetector || globalChallengeSignatureDetector;
              if (detector && typeof detector.detectFromResponse === 'function') {
                challengeResult = detector.detectFromResponse(response, { platform: this.platform });
              }
            } catch { challengeResult = null; }
          }

          const isValidatorChallenge =
            typeof this.responseValidator?.isBotChallenge === 'function' &&
            Boolean(this.responseValidator.isBotChallenge(response));

          if ((challengeResult && challengeResult.detected) || isValidatorChallenge) {
            const hibernationMs = challengeResult?.suggestedHibernationMs || this.rateLimitHibernationMs;
            const challengeType = challengeResult?.type || 'unknown';
            const challengeSig = challengeResult?.signature || 'validator_fallback';
            // Only record if early check did not already record it (avoids double penalty)
            if (!lastChallengeResult?.detected && concreteAccountId && this.accountPool) {
              try { this.accountPool.markUnavailable(concreteAccountId, 'bot_challenge', hibernationMs, this.platform); } catch {}
              if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
                try { this.governor.recordBotChallenge(concreteAccountId, this.platform, hibernationMs); } catch {}
              }
              if (this.healthOrchestrator && typeof this.healthOrchestrator.recordBotChallenge === 'function') {
                try { this.healthOrchestrator.recordBotChallenge(this.platform || 'default', concreteAccountId); } catch {}
              }
            }
            // Story 42.4 — drop the evidence before throwing: a handler that
            // swallows this error must not let the crawler 0-records hook
            // re-diagnose an already-punished response.
            this.lastResponseSnippet = null;
            this._lastJevDiag = null;
            throw new BotChallengeError({
              code: 'XACT_4030',
              message: `Bot challenge detected on upstream platform (${challengeType})`,
              statusCode: 403,
              suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
              accountId: concreteAccountId,
              platform: this.platform,
              details: {
                challengeType,
                challengeSignature: challengeSig,
                confidence: challengeResult?.confidence ?? null,
                suggestedHibernationMs: hibernationMs,
                response: response?.data || response,
              },
            });
          }

          // Story 42.4 — Jev semantic second opinion. Both the static signature
          // detector and validator.isBotChallenge missed, but the response may
          // still be a soft-block — recompute the validator false-200/checkpoint
          // flags (same calls as the telemetry closure above, which is out of
          // scope here). Jev is consulted ONLY on this rare suspicious branch,
          // never on the hot path; it can only escalate, never suppress checks.
          //
          // Each predicate gets its own try: a throwing validateResponse must
          // merge onto already-proven flags, never veto them (G3). Dedicated
          // downstream paths keep ownership — validator.isRateLimit belongs to
          // the RateLimitError path and an authed login wall belongs to the
          // XACT_4010 AuthSessionExpiredError path; Jev must not preempt (G4).
          let isSuspicious200 = false;
          let dedicatedPathOwns = false;
          {
            const validator = this.responseValidator;
            if (validator) {
              let isFalse200 = false;
              try {
                if (typeof validator.isFalse200 === 'function') {
                  isFalse200 = Boolean(validator.isFalse200(response));
                }
              } catch { /* predicate failure never vetoes other flags */ }
              let isLoginWall = false;
              try {
                if (typeof validator.isLoginWall === 'function') {
                  isLoginWall = Boolean(validator.isLoginWall(response));
                }
              } catch { /* predicate failure never vetoes other flags */ }
              let isCheckpoint = isLoginWall;
              try {
                if (typeof validator.validateResponse === 'function') {
                  const diag = validator.validateResponse(response);
                  if (!isFalse200) isFalse200 = Boolean(diag?.isFalse200);
                  if (!isCheckpoint) isCheckpoint = Boolean(diag?.isCheckpoint);
                }
              } catch { /* throwing validateResponse never vetoes proven flags */ }
              let isRateLimited = false;
              try {
                if (typeof validator.isRateLimit === 'function') {
                  isRateLimited = Boolean(validator.isRateLimit(response));
                }
              } catch { /* predicate failure never vetoes other flags */ }
              isSuspicious200 = isFalse200 || isCheckpoint;
              dedicatedPathOwns = isRateLimited || (isLoginWall && effectiveRequiresAuth);
            }
          }

          if (isSuspicious200 && !dedicatedPathOwns) {
            let jevDiag = null;
            try {
              jevDiag = await globalJevChallengeDiagnoser.diagnose({
                snippet: this.lastResponseSnippet,
                platform: this.platform,
                accountId: concreteAccountId,
              });
            } catch {
              jevDiag = null;
            }

            if (jevDiag?.escalate) {
              // ~20min — mirrors AdaptiveRateGovernor.recordBotChallenge default.
              const hibernationMs = 20 * 60 * 1000;
              // A challenge page arriving through a proxy implicates the proxy
              // too — same quarantine the 403 path applies (~line 997).
              if (proxy) this.quarantineProxy(proxy, hibernationMs);
              if (concreteAccountId && this.accountPool) {
                try { this.accountPool.markUnavailable(concreteAccountId, 'bot_challenge', hibernationMs, this.platform); } catch {}
                if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
                  try { this.governor.recordBotChallenge(concreteAccountId, this.platform, hibernationMs); } catch {}
                }
                if (this.healthOrchestrator && typeof this.healthOrchestrator.recordBotChallenge === 'function') {
                  try { this.healthOrchestrator.recordBotChallenge(this.platform || 'default', concreteAccountId); } catch {}
                }
              }
              // Drop the evidence before throwing — a handler that swallows
              // this error must not let the crawler hook re-diagnose it.
              this.lastResponseSnippet = null;
              this._lastJevDiag = null;
              throw new BotChallengeError({
                code: 'XACT_4030',
                message: `Bot challenge diagnosed by Jev on upstream platform (${jevDiag.verdict || 'unknown'})`,
                statusCode: 403,
                suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                accountId: concreteAccountId,
                platform: this.platform,
                details: {
                  challengeType: jevDiag.verdict,
                  challengeSignature: 'jev_semantic',
                  confidence: jevDiag.confidence,
                  suggestedHibernationMs: hibernationMs,
                  response: response?.data || response,
                },
              });
            }

            // Dedupe (G2): remember a non-escalating diagnosis so the
            // crawler-level 0-records hook reuses it on identical evidence
            // instead of paying for a second decide() call.
            this._lastJevDiag = jevDiag && this.lastResponseSnippet
              ? { snippet: this.lastResponseSnippet, diag: jevDiag }
              : null;
          }

          if (isRaw) {
            if (!isCanary) {
              const trackingKey = concreteAccountId || 'noauth';
              if (this.accountPool) {
                this.accountPool.recordRequest(trackingKey, this.platform);
              }
              if (
                this.governor &&
                typeof this.governor.recordRequest === 'function' &&
                (!this.accountPool || this.accountPool.governor !== this.governor)
              ) {
                this.governor.recordRequest(trackingKey, this.platform);
              }
            }
            return response;
          }

          if (this.responseValidator) {
            if (this.responseValidator.isRateLimit(response)) {
              const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
              const retryAfterMs = this.#parseRetryAfter(retryAfterHeader) || this.backoffBaseMs;
              if (concreteAccountId && this.accountPool) {
                this.accountPool.markUnavailable(concreteAccountId, 'rate_limit', this.rateLimitHibernationMs, this.platform);
                if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                  this.governor.recordRateLimit(concreteAccountId, this.platform, this.rateLimitHibernationMs);
                }
                if (this.healthOrchestrator && typeof this.healthOrchestrator.recordRateLimit === 'function') {
                  try { this.healthOrchestrator.recordRateLimit(this.platform || 'default', concreteAccountId); } catch {}
                }
              }
              throw new RateLimitError({
                code: 'XACT_4290',
                message: 'Rate limit payload detected from upstream platform',
                statusCode: 429,
                suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                retryAfterMs,
                accountId: concreteAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }

            if (typeof this.responseValidator.isLoginWall === 'function' && this.responseValidator.isLoginWall(response)) {
              if (effectiveRequiresAuth) {
                throw new AuthSessionExpiredError({
                  code: 'XACT_4010',
                  message: 'Authentication expired on upstream platform (login wall)',
                  statusCode: 401,
                  suggestedAction: SuggestedActions.RELOGIN,
                  accountId: concreteAccountId,
                  platform: this.platform,
                });
              }

              if (!skipResponseValidation && !this.responseValidator.isValidPayload(response)) {
                throw new PlatformError({
                  type: ErrorTypes.INVALID_ARGS,
                  code: 'XACT_4001',
                  message: 'Response payload is invalid or corrupted',
                  statusCode: 400,
                  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
                  accountId: currentAccountId,
                  platform: this.platform,
                  details: response?.data || response,
                });
              }
            } else if (!skipResponseValidation && !this.responseValidator.isValidPayload(response)) {
              if (concreteAccountId && this.healthOrchestrator && typeof this.healthOrchestrator.recordPayload === 'function') {
                try { this.healthOrchestrator.recordPayload(this.platform || 'default', concreteAccountId, false); } catch {}
              }
              throw new PlatformError({
                type: ErrorTypes.INVALID_ARGS,
                code: 'XACT_4001',
                message: 'Response payload is invalid or corrupted',
                statusCode: 400,
                suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
                accountId: currentAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }
          }

          if (!isCanary) {
            const trackingKey = concreteAccountId || 'noauth';
            if (this.accountPool) {
              this.accountPool.recordRequest(trackingKey, this.platform);
            }
            if (
              this.governor &&
              typeof this.governor.recordRequest === 'function' &&
              (!this.accountPool || this.accountPool.governor !== this.governor)
            ) {
              this.governor.recordRequest(trackingKey, this.platform);
            }
          }
          if (concreteAccountId && this.healthOrchestrator) {
            if (typeof this.healthOrchestrator.recordPayload === 'function') {
              try { this.healthOrchestrator.recordPayload(this.platform || 'default', concreteAccountId, true); } catch {}
            }
            if (typeof this.healthOrchestrator.recordSuccess === 'function') {
              try { this.healthOrchestrator.recordSuccess(this.platform || 'default', concreteAccountId); } catch {}
            }
          }
          return response;
        }

        // Handle 429 (Rate Limit) or 403 (Bot Challenge)
        if (status === 429 || status === 403) {
          if (!isQuarantined && proxy && provider && typeof provider.quarantine === 'function') {
            provider.quarantine(proxy, this.rateLimitHibernationMs);
          }

          // Pool exhaustion only applies when this request intended to use a
          // proxy — a direct request must keep its real 429/403 error type.
          // (isAllQuarantined is vacuous-true on an empty pool; the default
          // env-seeded pool is empty when no proxy env is configured.)
          if (shouldUseProxy && provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
            if (concreteAccountId && this.accountPool) {
              this.accountPool.markUnavailable(concreteAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
            }
            throw new PlatformError({
              type: ErrorTypes.PROXY_EXHAUSTED,
              code: 'XACT_5030',
              message: 'Proxy pool exhausted: all proxies quarantined in standby',
              statusCode: 503,
              suggestedAction: SuggestedActions.WAIT,
              retryAfterMs: this.standbyBackoffMs,
              accountId: concreteAccountId,
              platform: this.platform,
            });
          }

          const baseDelay = this.backoffBaseMs * Math.pow(this.backoffMultiplier, attempt);
          const jitter = Math.random() * baseDelay;
          const exponentialDelay = baseDelay + jitter;
          const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
          const parsedRetryAfterMs = this.#parseRetryAfter(retryAfterHeader);
          const chosenDelay = Math.min(this.maxBackoffMs, Math.max(exponentialDelay, parsedRetryAfterMs));

          // Story 40.1: Cost-aware proxy escalation on challenge
          // If we haven't already escalated and this is a 403 (bot challenge),
          // try escalating to residential tier before retrying
          if (status === 403 && !escalatedTier && this.proxyBudgetGovernor) {
            const nextTier = 'residential';
            try {
              const budgetCheck = await this.proxyBudgetGovernor.canAfford(nextTier);
              if (budgetCheck.allowed) {
                escalatedTier = nextTier;
                // Consume budget for the escalation attempt
                await this.proxyBudgetGovernor.consume(nextTier);
                // Re-resolve proxy with escalated tier for next attempt
                // Note: proxy variable is const, so we need to re-resolve on next iteration
                // For now, mark that we should escalate on next attempt
              }
            } catch {
              // Budget check failed — continue with normal retry
            }
          }

          const isLastProxyAttempt = attempt === this.maxProxyRetries - 1;

          if (isLastProxyAttempt) {
            if (concreteAccountId && this.accountPool) {
              const isChl = Boolean(lastChallengeResult?.detected || status === 403);
              const reason = isChl ? 'bot_challenge' : 'rate_limit';
              const hibMs = lastChallengeResult?.suggestedHibernationMs || this.rateLimitHibernationMs;
              this.accountPool.markUnavailable(concreteAccountId, reason, hibMs, this.platform);
              if (isChl) {
                if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
                  this.governor.recordBotChallenge(concreteAccountId, this.platform, hibMs);
                }
              } else {
                if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                  this.governor.recordRateLimit(concreteAccountId, this.platform, this.rateLimitHibernationMs);
                }
              }

              const nextAccount = this.accountPool.getNextAvailable(this.platform);
              if (nextAccount && nextAccount !== currentAccountId) {
                currentAccountId = nextAccount;
                concreteAccountId =
                  currentAccountId && currentAccountId !== 'guest' && currentAccountId !== 'default'
                    ? currentAccountId
                    : null;
                break; // Break inner proxy loop to start with new rotated account
              }
            }

            const errorClass = status === 429 ? RateLimitError : BotChallengeError;
            const challengeDetails = (status === 403 && lastChallengeResult?.detected)
              ? {
                  challengeType: lastChallengeResult.type,
                  challengeSignature: lastChallengeResult.signature,
                  confidence: lastChallengeResult.confidence,
                  suggestedHibernationMs: lastChallengeResult.suggestedHibernationMs,
                  response: response?.data || response,
                }
              : (response?.data || response);
            throw new errorClass({
              code: status === 429 ? 'XACT_4290' : 'XACT_4030',
              message: status === 429 ? 'Rate limit exceeded on upstream platform' : `Bot challenge detected on upstream platform (${lastChallengeResult?.type || 'unknown'})`,
              suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
              retryAfterMs: chosenDelay,
              accountId: concreteAccountId,
              platform: this.platform,
              details: challengeDetails,
            });
          }

          await this.#sleep(chosenDelay);
        } else {
          // Other status codes (401, 5xx, etc.)
          if (concreteAccountId && this.healthOrchestrator && typeof this.healthOrchestrator.recordError === 'function') {
            try { this.healthOrchestrator.recordError(this.platform || 'default', concreteAccountId); } catch {}
          }
          this.handleError(response, this.platform);
        }
      }

      accountRotationCount++;
    }

    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: 'Request pipeline exhausted all retry and account rotation attempts',
      statusCode: 500,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      accountId: concreteAccountId,
      platform: this.platform,
    });
  }

  /**
   * @param {Object} payload
   * @returns {Promise<any>}
   */
  async sign(payload) {
    throw new Error('Method not implemented: sign()');
  }

  /**
   * Check whether a case-insensitive header name is already present.
   * @param {Record<string, unknown>} [headers]
   * @param {string} [name]
   * @returns {boolean}
   */
  #hasHeader(headers = {}, name = '') {
    if (!headers || typeof headers !== 'object') return false;
    const lowerName = name.toLowerCase();
    return Object.keys(headers).some((k) => k.toLowerCase() === lowerName);
  }

  /**
   * Stringify a plain object body when the caller has set a JSON content-type.
   * Leaves strings, Buffers, and streams untouched.
   * @param {any} body
   * @param {Record<string, unknown>} [headers]
   * @returns {any}
   */
  #normalizeRequestBody(body, headers) {
    if (body === undefined || body === null) return body;
    if (typeof body !== 'object') return body;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body.pipe === 'function') return body;
    if (typeof body[Symbol.toStringTag] === 'string') return body;
    const contentType = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    if (String(contentType).toLowerCase().includes('json')) {
      return JSON.stringify(body);
    }
    return body;
  }

  /**
   * @param {Record<string, unknown>} [cookies={}]
   * @returns {void}
   */
  updateCookies(cookies = {}) {
    if (cookies && typeof cookies === 'object') {
      for (const [key, value] of Object.entries(cookies)) {
        this.cookies[key] = value === undefined || value === null ? '' : String(value);
      }
    }
  }

  /**
   * Comprehensive error classification for non-2xx/3xx/429/403 responses.
   * @param {any} response
   * @param {string} platform
   * @returns {never}
   */
  handleError(response, platform) {
    const status = response?.status ?? 500;

    if (status === 401) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: 'Authentication expired on upstream platform',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform,
        details: response?.data || response,
      });
    }

    if (status === 403) {
      throw new BotChallengeError({
        code: 'XACT_4030',
        message: 'Bot challenge detected on upstream platform',
        statusCode: 403,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        platform,
        details: response?.data || response,
      });
    }

    if (status === 429) {
      const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
      const retryAfterMs = this.#parseRetryAfter(retryAfterHeader);
      throw new RateLimitError({
        code: 'XACT_4290',
        message: 'Rate limit exceeded on upstream platform',
        statusCode: 429,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        retryAfterMs,
        platform,
        details: response?.data || response,
      });
    }

    if (status >= 500) {
      throw new ProxyDeadError({
        code: 'XACT_5030',
        message: `Upstream platform returned server error ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.WAIT,
        platform,
        details: response?.data || response,
      });
    }

    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: `Request failed with status ${status}`,
      statusCode: status,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform,
      details: response?.data || response,
    });
  }
}
