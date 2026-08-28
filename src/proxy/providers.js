// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Proxy normalization, URL parser utilities, StaticProxyProvider, and DynamicTunnelProvider for ProxyIpPool.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';
import { ProxyIpPool } from './proxy-pool.js';
import { createHash, randomBytes } from 'node:crypto';

export const SUPPORTED_PROXY_SCHEMES = ['http', 'https', 'socks5'];

/** @type {Record<string, number>} */
const DEFAULT_SCHEME_PORTS = {
  http: 80,
  https: 443,
  socks5: 1080,
};

const DEFAULT_SESSION_DURATION_MS = 600000;
const DEFAULT_STANDBY_BACKOFF_MS = 30000;
const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;
const MAX_ACCOUNT_SEEDS = 10000;

/**
 * Create a read-only Set for provider presets.
 * @param {Iterable<string>} values
 * @returns {Set<string>}
 */
function freezeSet(values) {
  const set = new Set(values);
  // Prevent accidental mutation while preserving iteration, has, size, etc.
  set.add = function () { throw new TypeError('PROVIDER_PRESETS is read-only'); };
  set.delete = function () { throw new TypeError('PROVIDER_PRESETS is read-only'); };
  set.clear = function () { throw new TypeError('PROVIDER_PRESETS is read-only'); };
  return Object.freeze(set);
}

export const PROVIDER_PRESETS = freezeSet([
  'brightdata', 'smartproxy', 'iproyal', 'kuaidaili', 'socksnode', 'custom'
]);

/** @type {Record<string, { max?: number, exact?: number, regex: RegExp }>} */
export const PROVIDER_SID_LIMITS = Object.freeze({
  brightdata: Object.freeze({ max: 64, regex: /^[a-zA-Z0-9]+$/ }),
  smartproxy: Object.freeze({ max: 32, regex: /^[a-zA-Z0-9_]+$/ }),
  iproyal: Object.freeze({ exact: 8, regex: /^[a-zA-Z0-9]{8}$/ }),
  kuaidaili: Object.freeze({ max: 6, regex: /^[a-zA-Z0-9]+$/ }),
  socksnode: Object.freeze({ max: 32, regex: /^[a-zA-Z0-9_-]+$/ }),
});

/**
 * @typedef {Object} NormalizedProxy
 * @property {string} scheme
 * @property {string} host
 * @property {number} port
 * @property {string} [username]
 * @property {string} [password]
 * @property {string} server - Canonical host:port with scheme (e.g., "http://1.2.3.4:8080").
 *                              IPv6 addresses are bracketed (e.g., "http://[2001:db8::1]:8080").
 */

/**
 * @typedef {Object} ProxyProviderContract
 * @property {string} name
 * @property {() => number} healthyCount
 * @property {() => number} totalCount
 * @property {() => boolean} isAllQuarantined
 * @property {(options?: Record<string, unknown>) => (NormalizedProxy | string | null)} getProxy
 * @property {(accountId: string) => (NormalizedProxy | string | null)} getStickyProxy
 * @property {() => (NormalizedProxy | string | null)} getNext
 * @property {(proxy?: string | NormalizedProxy, durationMs?: number) => void} quarantine
 * @property {(proxy: string | NormalizedProxy) => Record<string, unknown> | null} toPlaywrightProxy
 * @property {(proxy: string | NormalizedProxy, options?: Record<string, unknown>) => unknown} getProxyAgent
 * @property {(proxy: string | NormalizedProxy) => string[]} getBrowserArgs
 */

/**
 * @typedef {Object} ProxyRequestOptions
 * @property {string} [accountId]
 * @property {boolean} [requiresResidential]
 * @property {string} [country]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [region]
 * @property {string} [isp]
 * @property {string} [zip]
 * @property {string} [asn]
 * @property {string} [sessionId]
 * @property {string} [sid]
 * @property {number} [sessionduration]
 * @property {string} [lifetime]
 * @property {string | number} [period]
 * @property {boolean} [const]
 */

/**
 * @typedef {Object} ProxyRequest
 * @property {string} [country]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [region]
 * @property {string} [isp]
 * @property {string} [zip]
 * @property {string} [asn]
 * @property {string} [lifetime]
 * @property {string | number} [period]
 * @property {string} [sid]
 * @property {string} [sessionId]
 * @property {number} [sessionduration]
 * @property {boolean} [const]
 */

/**
 * @typedef {ProxyRequestOptions & { gatewayUrl: string, provider?: string, template?: string, kuaidailiMode?: 'normal' | 'pro', rotatePerRequest?: boolean, sessionDurationMs?: number, standbyBackoffMs?: number }} DynamicTunnelOptions
 */

/**
 * Wrap an IPv6 address in brackets unless it is already bracketed.
 * @param {string} host
 * @returns {string}
 */
function bracketHost(host) {
  if (typeof host !== 'string') return String(host);
  if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
    return `[${host}]`;
  }
  return host;
}

/**
 * Build the canonical scheme://[host]:port server string without credentials.
 * @param {string} scheme
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
function buildServer(scheme, host, port) {
  return `${scheme}://${bracketHost(host)}:${port}`;
}

/**
 * Coerce a port value to a finite number, falling back to the scheme default.
 * @param {unknown} value
 * @param {number} defaultPort
 * @returns {number}
 */
function parsePort(value, defaultPort) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : defaultPort;
  if (value === undefined || value === null || value === '') return defaultPort;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

/**
 * Parse a proxy URL string into normalized components.
 * @param {string} urlString
 * @returns {NormalizedProxy}
 */
export function parseProxyUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Proxy URL must be a non-empty string',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch (err) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Malformed proxy URL: "${urlString}"`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      cause: err,
    });
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (!SUPPORTED_PROXY_SCHEMES.includes(scheme)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Unsupported proxy scheme: "${scheme}". Supported: ${SUPPORTED_PROXY_SCHEMES.join(', ')}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  // Node's `URL.hostname` includes brackets for IPv6; store the raw address.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const defaultPort = DEFAULT_SCHEME_PORTS[scheme] ?? 80;
  const port = parsePort(parsed.port, defaultPort);

  let username;
  let password;
  try {
    username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  } catch {
    username = parsed.username || undefined;
  }
  try {
    password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  } catch {
    password = parsed.password || undefined;
  }

  // An empty username in the URL should not be treated as a credential.
  if (username === '') username = undefined;
  if (password === '') password = undefined;

  const server = buildServer(scheme, host, port);

  const result = /** @type {NormalizedProxy} */ ({
    scheme,
    host,
    port,
    server,
  });

  if (username !== undefined) result.username = username;
  if (password !== undefined) result.password = password;

  return result;
}

/**
 * Normalize a proxy input (string URL or object) to canonical structure.
 * @param {string | Record<string, unknown>} input
 * @returns {NormalizedProxy}
 */
export function normalizeProxy(input) {
  if (typeof input === 'string') {
    return parseProxyUrl(input);
  }

  if (typeof input === 'object' && input !== null) {
    const record = /** @type {Record<string, unknown>} */ (input);
    const scheme = String(record.scheme || 'http').toLowerCase();
    if (!SUPPORTED_PROXY_SCHEMES.includes(scheme)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Unsupported proxy scheme: "${scheme}". Supported: ${SUPPORTED_PROXY_SCHEMES.join(', ')}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (!record.host) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy host is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Strip surrounding brackets from an IPv6 host supplied as an object.
    const host = String(record.host).replace(/^\[|\]$/g, '');
    const defaultPort = DEFAULT_SCHEME_PORTS[scheme] ?? 80;
    const port = parsePort(record.port, defaultPort);
    const server = buildServer(scheme, host, port);

    const result = /** @type {NormalizedProxy} */ ({
      scheme,
      host,
      port,
      server,
    });

    if (record.username !== undefined && record.username !== '') result.username = String(record.username);
    if (record.password !== undefined) result.password = String(record.password);
    if (record.residential !== undefined) result.residential = Boolean(record.residential);

    return result;
  }

  throw new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: 'Proxy must be a URL string or an object',
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
  });
}

/**
 * Build the full proxy URL string including credentials if present.
 *
 * The auth segment is omitted entirely when the username is empty (even if a
 * password is present), preventing malformed URLs like `http://:pass@host`.
 *
 * @param {string | Record<string, unknown>} proxy
 * @returns {string}
 */
export function formatProxyUrl(proxy) {
  const norm = normalizeProxy(proxy);
  const hostStr = bracketHost(norm.host);

  if (!norm.username) {
    return `${norm.scheme}://${hostStr}:${norm.port}`;
  }

  const passPart = norm.password ? `:${encodeURIComponent(norm.password)}` : '';
  return `${norm.scheme}://${encodeURIComponent(norm.username)}${passPart}@${hostStr}:${norm.port}`;
}

/**
 * Factory for creating client-specific proxy agents without direct connection fallback.
 * @param {string | Record<string, unknown>} proxy
 * @param {{ client?: 'undici' | 'got' } & Record<string, unknown>} [options]
 * @returns {import('undici').ProxyAgent | import('undici').Socks5ProxyAgent | string}
 */
export function getProxyAgent(proxy, options = {}) {
  if (!proxy) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Proxy is required to create a proxy agent',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const normalized = normalizeProxy(proxy);
  const client = options?.client || 'undici';
  const proxyUrl = formatProxyUrl(normalized);

  if (client === 'got') {
    return proxyUrl;
  }

  if (client === 'undici') {
    if (normalized.scheme === 'socks5') {
      return new Socks5ProxyAgent(proxyUrl);
    }
    return new ProxyAgent(proxyUrl);
  }

  throw new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: `Unsupported client type for proxy agent: "${client}"`,
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
  });
}

/**
 * Static Proxy Provider implementation wrapping ProxyIpPool.
 */
export class StaticProxyProvider {
  name = 'static';

  /**
   * @param {{ pool?: ProxyIpPool, proxies?: Array<string | Record<string, unknown>>, validateOnAdd?: boolean } & Record<string, unknown>} [options]
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'StaticProxyProvider options must be an object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (options.pool instanceof ProxyIpPool) {
      this.pool = options.pool;
    } else if (Array.isArray(options.proxies)) {
      this.pool = new ProxyIpPool({
        proxies: options.proxies,
        validateOnAdd: options.validateOnAdd,
      });
    } else {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'StaticProxyProvider requires options.pool or options.proxies array',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
  }

  get healthyCount() {
    return this.pool.healthyCount;
  }

  get totalCount() {
    return this.pool.totalCount;
  }

  isAllQuarantined() {
    return this.pool.isAllQuarantined();
  }

  /**
   * @param {Partial<ProxyRequestOptions>} [options]
   * @returns {NormalizedProxy | string | null}
   */
  getProxy(options = {}) {
    const opts = options || {};
    const requiresResidential = Boolean(opts.requiresResidential);
    if (opts.accountId) {
      const accountId = /** @type {string} */ (opts.accountId);
      return this.pool.getStickyProxy(accountId, requiresResidential);
    }
    return this.pool.getNext(requiresResidential);
  }

  /**
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {NormalizedProxy | string | null}
   */
  getStickyProxy(accountId, requiresResidential = false) {
    return this.pool.getStickyProxy(accountId, requiresResidential);
  }

  /**
   * @param {boolean} [requiresResidential=false]
   * @returns {NormalizedProxy | string | null}
   */
  getNext(requiresResidential = false) {
    return this.pool.getNext(requiresResidential);
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs) {
    this.pool.quarantine(proxy, durationMs);
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @returns {Record<string, unknown> | null}
   */
  toPlaywrightProxy(proxy) {
    return this.pool.toPlaywrightProxy(proxy);
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @param {{ client?: 'undici' | 'got' } & Record<string, unknown>} [options]
   * @returns {unknown}
   */
  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @returns {string[]}
   */
  getBrowserArgs(proxy) {
    return this.pool.getBrowserArgs(proxy);
  }
}

/**
 * Target length for generated session IDs per provider.
 * @param {string} provider
 * @returns {number}
 */
function targetSessionLength(provider) {
  if (provider === 'iproyal') return 8;
  if (provider === 'kuaidaili') return 6;
  return 20;
}

/**
 * Check whether a user-supplied session ID meets the provider's rules.
 * @param {string} sid
 * @param {string} provider
 * @returns {boolean}
 */
function isValidSessionId(sid, provider) {
  const s = String(sid);
  const limits = PROVIDER_SID_LIMITS[provider];
  if (!limits) return true;
  if (!limits.regex.test(s)) return false;
  if (limits.exact && s.length !== limits.exact) return false;
  if (limits.max && s.length > limits.max) return false;
  return true;
}

/**
 * Encode a string as base-36 using a SHA-256 hash.
 * @param {string} input
 * @param {number} length
 * @returns {string}
 */
function hashBase36(input, length) {
  const digest = createHash('sha256').update(input).digest();
  let s = BigInt('0x' + digest.toString('hex')).toString(36).toLowerCase();
  if (s.length < length) s = s.padEnd(length, 'a');
  return s.slice(0, length);
}

/**
 * Generate a random base-36 string of the requested length.
 * @param {number} length
 * @returns {string}
 */
function randomBase36(length) {
  const bytes = randomBytes(32);
  let s = BigInt('0x' + bytes.toString('hex')).toString(36).toLowerCase();
  if (s.length < length) s = s.padEnd(length, 'a');
  return s.slice(0, length);
}

/**
 * Dynamic Tunnel Residential Proxy Provider with multi-provider presets and rotation.
 */
export class DynamicTunnelProvider {
  name = 'dynamic';

  #sessionSeeds = new Map();
  #activeSessions = new Map();
  #proxyToAccount = new Map();
  #quarantined = new Map();
  #globalSeed = 0;
  /** @type {string | null} */
  #globalSessionId = null;

  /**
   * @param {Partial<DynamicTunnelOptions>} [options]
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'DynamicTunnelProvider options must be an object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (!options.gatewayUrl || typeof options.gatewayUrl !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'DynamicTunnelProvider requires a non-empty gatewayUrl string',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.rawGateway = parseProxyUrl(options.gatewayUrl);

    const requestedProvider = options.provider;
    if (requestedProvider) {
      if (!PROVIDER_PRESETS.has(requestedProvider)) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: `Unknown provider preset: "${requestedProvider}". Supported: ${[...PROVIDER_PRESETS].join(', ')}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      this.provider = requestedProvider;
    } else {
      this.provider = this.#autoDetectProvider(this.rawGateway.host);
    }

    if (this.provider === 'custom') {
      if (!options.template || typeof options.template !== 'string') {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'Custom provider requires an explicit template string',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }
    this.template = options.template || '';

    this.kuaidailiMode = options.kuaidailiMode || 'normal';
    this.rotatePerRequest = options.rotatePerRequest !== false;

    const sessionDurationMs = options.sessionDurationMs;
    if (sessionDurationMs === undefined || sessionDurationMs === null) {
      this.sessionDurationMs = DEFAULT_SESSION_DURATION_MS;
    } else if (typeof sessionDurationMs !== 'number' || !Number.isFinite(sessionDurationMs) || sessionDurationMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'sessionDurationMs must be a positive finite number',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    } else {
      this.sessionDurationMs = sessionDurationMs;
    }

    const standbyBackoffMs = options.standbyBackoffMs;
    if (standbyBackoffMs === undefined || standbyBackoffMs === null) {
      this.standbyBackoffMs = DEFAULT_STANDBY_BACKOFF_MS;
    } else if (typeof standbyBackoffMs !== 'number' || !Number.isFinite(standbyBackoffMs) || standbyBackoffMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'standbyBackoffMs must be a positive finite number',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    } else {
      this.standbyBackoffMs = standbyBackoffMs;
    }

    this.defaultCountry = options.country;
    this.defaultCity = options.city;
    this.defaultState = options.state;
    this.defaultRegion = options.region;
    this.defaultIsp = options.isp;
    this.defaultZip = options.zip;
    this.defaultAsn = options.asn;
    this.defaultLifetime = options.lifetime;
    this.defaultPeriod = options.period;
    this.defaultSid = options.sid;
    this.defaultSessionduration = options.sessionduration;
    this.defaultConst = options.const;
  }

  /**
   * @param {string} host
   * @returns {string}
   */
  #autoDetectProvider(host) {
    const parts = (host || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return 'custom';

    const sld = parts[parts.length - 2];
    const tld = parts[parts.length - 1];

    if ((sld === 'superproxy' && tld === 'io') || (sld === 'luminati' && tld === 'io')) {
      return 'brightdata';
    }
    if (
      (sld === 'smartproxy' && (tld === 'com' || tld === 'io')) ||
      (sld === 'decodo' && tld === 'com')
    ) {
      return 'smartproxy';
    }
    if ((sld === 'iproyal' && tld === 'com') || (sld === 'royalproxy' && tld === 'io')) {
      return 'iproyal';
    }
    if ((sld === 'kdlapi' && tld === 'com') || (sld === 'kuaidaili' && tld === 'com')) {
      return 'kuaidaili';
    }
    // SocksNode public docs only list .com gateways; keep auto-detection conservative.
    // Other TLDs can still be used with explicit provider: 'socksnode'.
    if (sld === 'socksnode' && tld === 'com') {
      return 'socksnode';
    }

    return 'custom';
  }

  get #gatewayKey() {
    return formatProxyUrl(this.rawGateway);
  }

  get scheme() {
    return this.rawGateway.scheme;
  }

  get host() {
    return this.rawGateway.host;
  }

  get port() {
    return this.rawGateway.port;
  }

  /**
   * Raw gateway username. Contains targeting/session tokens after getProxy().
   * Do not log or serialize the provider object directly.
   */
  get username() {
    return this.rawGateway.username;
  }

  /**
   * Raw gateway password. Do not log or serialize the provider object directly.
   */
  get password() {
    return this.rawGateway.password;
  }

  /**
   * Redact sensitive fields when provider is serialized (e.g. JSON.stringify).
   * @returns {Record<string, unknown>}
   */
  toJSON() {
    return {
      name: this.name,
      provider: this.provider,
      scheme: this.scheme,
      host: this.host,
      port: this.port,
      healthyCount: this.healthyCount,
      totalCount: this.totalCount,
      isAllQuarantined: this.isAllQuarantined(),
    };
  }

  get totalCount() {
    this.pruneExpiredQuarantines();
    return Math.max(1, this.#activeSessions.size + 1);
  }

  get healthyCount() {
    this.pruneExpiredQuarantines();
    const total = this.totalCount;
    let quarantined = this.#quarantined.has(this.#gatewayKey) ? 1 : 0;
    for (const session of this.#activeSessions.values()) {
      if (this.#quarantined.has(session.url)) quarantined += 1;
    }
    return Math.max(0, total - quarantined);
  }

  isAllQuarantined() {
    return this.healthyCount === 0;
  }

  pruneExpiredQuarantines() {
    const now = Date.now();
    for (const [key, expiresAt] of this.#quarantined.entries()) {
      if (now >= expiresAt) {
        this.#quarantined.delete(key);
      }
    }
  }

  /**
   * @param {string} [accountId]
   */
  rotateSession(accountId) {
    if (accountId) {
      const current = this.#sessionSeeds.get(accountId) || 0;
      if (this.#sessionSeeds.size >= MAX_ACCOUNT_SEEDS) {
        const firstKey = this.#sessionSeeds.keys().next().value;
        if (firstKey) this.#sessionSeeds.delete(firstKey);
      }
      this.#sessionSeeds.set(accountId, current + 1);
      this.#activeSessions.delete(accountId);
    } else {
      this.#globalSeed++;
      this.#globalSessionId = null;
      this.#activeSessions.delete('__global__');
    }
  }

  /**
   * @param {string} [accountId]
   */
  clearAccount(accountId) {
    if (accountId) {
      this.#sessionSeeds.delete(accountId);
      const active = this.#activeSessions.get(accountId);
      if (active) {
        this.#proxyToAccount.delete(active.url);
        this.#activeSessions.delete(accountId);
      }
    }
  }

  reset() {
    this.#sessionSeeds.clear();
    this.#activeSessions.clear();
    this.#proxyToAccount.clear();
    this.#quarantined.clear();
    this.#globalSeed = 0;
    this.#globalSessionId = null;
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs = DEFAULT_QUARANTINE_MS) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to quarantine',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Quarantine duration must be a positive finite number',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.pruneExpiredQuarantines();

    const norm = normalizeProxy(proxy);
    const key = formatProxyUrl(norm);
    const until = Date.now() + durationMs;

    this.#quarantined.set(key, until);
  }

  /**
   * @param {string} rawUser
   * @returns {string}
   */
  #baseUsername(rawUser) {
    if (!rawUser) return '';
    if (
      rawUser.startsWith('user-') ||
      rawUser.startsWith('brd-') ||
      rawUser.startsWith('lum-')
    ) {
      return rawUser;
    }
    return `user-${rawUser}`;
  }

  /**
   * @param {Record<string, unknown>} options
   * @returns {ProxyRequest}
   */
  #resolveRequestOptions(options) {
    /** @param {unknown} v */
    const toLower = (v) => (v !== undefined && v !== null && v !== '' ? String(v).toLowerCase().trim() : '');
    /** @param {unknown} v */
    const toStr = (v) => (v !== undefined && v !== null && v !== '' ? String(v).trim() : '');

    const country = toLower(options.country ?? this.defaultCountry);
    const city = (options.city ?? this.defaultCity)
      ? String(options.city ?? this.defaultCity).toLowerCase().replace(/\s+/g, '').trim()
      : '';
    const state = toLower(options.state ?? this.defaultState);
    const region = toLower(options.region ?? this.defaultRegion);
    const isp = toLower(options.isp ?? this.defaultIsp);
    const zip = toStr(options.zip ?? this.defaultZip);
    const asn = toStr(options.asn ?? this.defaultAsn);
    const lifetime = toStr(options.lifetime ?? this.defaultLifetime);
    const period = /** @type {string | number | undefined} */ (options.period ?? this.defaultPeriod);
    const sid = toStr(options.sid ?? this.defaultSid);
    const sessionduration = /** @type {number | undefined} */ (options.sessionduration ?? this.defaultSessionduration);
    const const_ = /** @type {boolean | undefined} */ (options.const ?? this.defaultConst);

    let sessionDurationMin = 0;
    if (typeof sessionduration === 'number' && Number.isFinite(sessionduration) && sessionduration > 0) {
      sessionDurationMin = Math.floor(sessionduration);
    } else if (this.sessionDurationMs > 0) {
      sessionDurationMin = Math.max(1, Math.ceil(this.sessionDurationMs / 60000));
    }

    let sessionId = toStr(options.sessionId);
    if (!sessionId && sid) sessionId = sid;

    return {
      country,
      city,
      state,
      region,
      isp,
      zip,
      asn,
      lifetime,
      period,
      sid,
      sessionduration: sessionDurationMin,
      const: const_ === true,
      sessionId,
    };
  }

  /**
   * @param {ProxyRequest} req
   * @param {string | undefined} accountId
   * @returns {string}
   */
  #resolveSessionId(req, accountId) {
    if (this.provider === 'custom') {
      if (req.sessionId) return req.sessionId;
      return randomBase36(16);
    }

    const rawSid = /** @type {string | undefined} */ (this.provider === 'kuaidaili' && req.sid ? req.sid : req.sessionId);
    if (rawSid && isValidSessionId(rawSid, this.provider)) {
      return rawSid;
    }

    const length = targetSessionLength(this.provider);

    if (accountId) {
      const bucket = Math.floor(Date.now() / this.sessionDurationMs);
      const seed = this.#sessionSeeds.get(accountId) || 0;
      const input = `${accountId}:${bucket}:${seed}:${this.#globalSeed}:${this.provider}`;
      return hashBase36(input, length);
    }

    if (this.rotatePerRequest) {
      return randomBase36(length);
    }

    if (!this.#globalSessionId) {
      this.#globalSessionId = randomBase36(length);
    }
    return this.#globalSessionId;
  }

  /**
   * @param {ProxyRequest} req
   * @returns {{ username: string, password: string }}
   */
  #formatCredentials(req) {
    const rawUser = this.rawGateway.username || '';
    const rawPass = this.rawGateway.password || '';
    const preset = this.provider;

    if (preset === 'brightdata') {
      const baseUser = this.#baseUsername(rawUser);
      const parts = [baseUser];
      if (req.country) parts.push(`country-${req.country}`);
      if (req.state) parts.push(`state-${req.state}`);
      if (req.city) parts.push(`city-${req.city}`);
      if (req.zip) parts.push(`zip-${req.zip}`);
      if (req.asn) parts.push(`asn-${req.asn}`);
      if (req.sessionId) parts.push(`session-${req.sessionId}`);
      if (req.const) parts.push('const');
      return { username: parts.filter((p) => p !== '').join('-'), password: rawPass };
    }

    if (preset === 'smartproxy') {
      const baseUser = this.#baseUsername(rawUser);
      const parts = [baseUser];
      if (req.country) parts.push(`country-${req.country}`);
      if (req.city) parts.push(`city-${req.city}`);
      if (req.sessionId) parts.push(`session-${req.sessionId}`);
      if (typeof req.sessionduration === 'number' && req.sessionduration > 0) parts.push(`sessionduration-${req.sessionduration}`);
      return { username: parts.filter((p) => p !== '').join('_'), password: rawPass };
    }

    if (preset === 'iproyal') {
      const parts = [];
      if (req.country) parts.push(`country-${req.country}`);
      if (req.city) parts.push(`city-${req.city}`);
      if (req.state) parts.push(`state-${req.state}`);
      if (req.region) parts.push(`region-${req.region}`);
      if (req.isp) parts.push(`isp-${req.isp}`);
      if (req.sessionId) parts.push(`session-${req.sessionId}`);
      if (req.lifetime) parts.push(`lifetime-${req.lifetime}`);
      const password = parts.length > 0 ? `${rawPass}_${parts.join('_')}` : rawPass;
      return { username: rawUser, password };
    }

    if (preset === 'kuaidaili') {
      const sid = req.sid || req.sessionId;
      if (this.kuaidailiMode === 'pro') {
        const parts = [rawUser];
        if (req.period !== undefined && req.period !== null && req.period !== '') {
          parts.push(`period-${req.period}`);
        }
        if (sid) parts.push(`sid-${sid}`);
        if (req.city) parts.push(`city-${req.city}`);
        return { username: parts.filter((p) => p !== '').join('-'), password: rawPass };
      }
      // Normal tunnel: append :<sid> to password for a 30s IP lock.
      const password = sid ? `${rawPass}:${sid}` : rawPass;
      return { username: rawUser, password };
    }

    if (preset === 'socksnode') {
      const baseUser = this.#baseUsername(rawUser);
      const parts = [baseUser];
      if (req.country) parts.push(`country-${req.country}`);
      if (req.state) parts.push(`state-${req.state}`);
      if (req.city) parts.push(`city-${req.city}`);
      if (req.asn) parts.push(`asn-${req.asn}`);
      if (req.sessionId) parts.push(`session-${req.sessionId}`);
      if (req.lifetime) {
        parts.push(`lifetime-${req.lifetime}`);
      } else if (typeof req.sessionduration === 'number' && Number.isFinite(req.sessionduration) && req.sessionduration > 0) {
        // ProxyRequestOptions.sessionduration is minutes; spec AC-2 expects `-duration-{seconds}`.
        // Verify with SocksNode docs before relying on this token in production.
        parts.push(`duration-${Math.floor(req.sessionduration * 60)}`);
      }
      return { username: parts.filter((p) => p !== '').join('-'), password: rawPass };
    }

    if (preset === 'custom') {
      let username = this.template;
      const periodStr = req.period !== undefined && req.period !== null ? String(req.period) : '';
      const values = {
        username: rawUser,
        password: rawPass,
        country: req.country,
        city: req.city,
        state: req.state,
        region: req.region,
        isp: req.isp,
        sessionId: req.sessionId,
        sessionDuration: String(req.sessionduration),
        sessionduration: String(req.sessionduration),
        lifetime: req.lifetime,
        period: periodStr,
        sid: req.sid || req.sessionId,
        const: req.const ? 'const' : '',
      };
      for (const [key, value] of Object.entries(values)) {
        username = username.replaceAll(`{${key}}`, String(value ?? ''));
      }
      return { username, password: rawPass };
    }

    return { username: rawUser, password: rawPass };
  }

  /**
   * @param {Partial<ProxyRequestOptions>} [options]
   * @returns {NormalizedProxy}
   */
  getProxy(options = {}) {
    const opts = options || {};
    this.pruneExpiredQuarantines();

    if (this.isAllQuarantined()) {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'All dynamic proxy sessions are quarantined',
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: this.standbyBackoffMs,
      });
    }

    const accountId = opts.accountId;
    const activeKey = accountId || (this.rotatePerRequest ? null : '__global__');

    if (activeKey && this.#activeSessions.has(activeKey)) {
      const active = this.#activeSessions.get(activeKey);
      if (this.#quarantined.has(active.url)) {
        if (activeKey === '__global__') {
          this.#globalSeed++;
          this.#globalSessionId = null;
        } else {
          this.#sessionSeeds.set(activeKey, (this.#sessionSeeds.get(activeKey) || 0) + 1);
        }
      }
    }

    const req = this.#resolveRequestOptions(opts);
    const sessionId = this.#resolveSessionId(req, accountId);
    const { username, password } = this.#formatCredentials({ ...req, sessionId });

    const proxy = normalizeProxy({
      scheme: this.rawGateway.scheme,
      host: this.rawGateway.host,
      port: this.rawGateway.port,
      username,
      password,
    });
    const url = formatProxyUrl(proxy);

    // If the generated session is currently quarantined, rotate once and try again.
    if (this.#quarantined.has(url)) {
      if (accountId) {
        this.#sessionSeeds.set(accountId, (this.#sessionSeeds.get(accountId) || 0) + 1);
      } else if (!this.rotatePerRequest) {
        this.#globalSeed++;
        this.#globalSessionId = null;
      }
      const nextSessionId = this.#resolveSessionId(req, accountId);
      const nextCredentials = this.#formatCredentials({ ...req, sessionId: nextSessionId });
      const nextProxy = normalizeProxy({
        scheme: this.rawGateway.scheme,
        host: this.rawGateway.host,
        port: this.rawGateway.port,
        username: nextCredentials.username,
        password: nextCredentials.password,
      });
      const nextUrl = formatProxyUrl(nextProxy);
      if (this.#quarantined.has(nextUrl)) {
        throw new PlatformError({
          type: ErrorTypes.PROXY_EXHAUSTED,
          code: 'XACT_5030',
          message: 'Could not allocate a healthy dynamic proxy session',
          suggestedAction: SuggestedActions.WAIT,
          retryAfterMs: this.standbyBackoffMs,
        });
      }
      if (activeKey) {
        const old = this.#activeSessions.get(activeKey);
        if (old) this.#proxyToAccount.delete(old.url);
        this.#activeSessions.set(activeKey, { proxy: nextProxy, url: nextUrl });
        this.#proxyToAccount.set(nextUrl, activeKey);
      }
      return nextProxy;
    }

    if (activeKey) {
      const old = this.#activeSessions.get(activeKey);
      if (old) this.#proxyToAccount.delete(old.url);
      this.#activeSessions.set(activeKey, { proxy, url });
      this.#proxyToAccount.set(url, activeKey);
    }

    return proxy;
  }

  /**
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {NormalizedProxy | null}
   */
  getStickyProxy(accountId, requiresResidential = false) {
    return this.getProxy({ accountId, requiresResidential });
  }

  /**
   * @param {boolean} [requiresResidential=false]
   * @returns {NormalizedProxy | null}
   */
  getNext(requiresResidential = false) {
    return this.getProxy({ requiresResidential });
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @returns {Record<string, unknown> | null}
   */
  toPlaywrightProxy(proxy) {
    if (!proxy) return null;
    const norm = normalizeProxy(proxy);
    const result = /** @type {Record<string, unknown> & { server: string, username?: string, password?: string }} */ ({ server: norm.server });
    if (norm.username !== undefined) result.username = norm.username;
    if (norm.password !== undefined) result.password = norm.password;
    return result;
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @param {{ client?: 'undici' | 'got' } & Record<string, unknown>} [options]
   * @returns {unknown}
   */
  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

  /**
   * @param {string | Record<string, unknown>} proxy
   * @returns {string[]}
   */
  getBrowserArgs(proxy) {
    if (!proxy) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to generate browser args',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const norm = normalizeProxy(proxy);
    const proxyHost = norm.host.includes(':') && !norm.host.startsWith('[')
      ? `[${norm.host}]`
      : norm.host;
    return [
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      `--proxy-server=${norm.server}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxyHost}`,
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ];
  }
}

/**
 * Redact a provider configuration object before including it in an error message.
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
function redactConfig(config) {
  if (!config || typeof config !== 'object') return config;
  const copy = { ...config };
  if (copy.gatewayUrl) copy.gatewayUrl = '<redacted>';
  if (copy.basePassword) copy.basePassword = '<redacted>';
  if (copy.password) copy.password = '<redacted>';
  if (Array.isArray(copy.proxies)) {
    const arr = copy.proxies;
    copy.proxies = `<${arr.length} proxies redacted>`;
  }
  return copy;
}

/**
 * Unified factory for creating proxy providers.
 * @param {Record<string, unknown>} config
 * @returns {StaticProxyProvider | DynamicTunnelProvider}
 */
export function createProxyProvider(config) {
  if (!config || typeof config !== 'object') {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Provider configuration object is required',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  if (config.gatewayUrl && (config.proxies || config.pool) && !config.type) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Ambiguous proxy configuration: both gatewayUrl and static proxies provided without explicit type',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  if (config.type === 'dynamic') {
    return new DynamicTunnelProvider(/** @type {Partial<DynamicTunnelOptions>} */ (config));
  }

  if (config.type === 'static') {
    return new StaticProxyProvider(/** @type {{ pool?: ProxyIpPool, proxies?: Array<string | Record<string, unknown>>, validateOnAdd?: boolean }} */ (config));
  }

  if (config.gatewayUrl) {
    return new DynamicTunnelProvider(/** @type {Partial<DynamicTunnelOptions>} */ (config));
  }

  if (config.proxies || config.pool) {
    return new StaticProxyProvider(/** @type {{ pool?: ProxyIpPool, proxies?: Array<string | Record<string, unknown>>, validateOnAdd?: boolean }} */ (config));
  }

  throw new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: `Unknown or unsupported proxy provider configuration: "${JSON.stringify(redactConfig(config))}"`,
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
  });
}
