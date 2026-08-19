// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Proxy normalization, URL parser utilities, StaticProxyProvider, and DynamicTunnelProvider for ProxyIpPool.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';
import { ProxyIpPool } from './proxy-pool.js';

export const SUPPORTED_PROXY_SCHEMES = ['http', 'https', 'socks5'];

const DEFAULT_SCHEME_PORTS = {
  http: 80,
  https: 443,
  socks5: 1080,
};

const MAX_ACCOUNT_SEEDS = 10000;

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
 * @param {any} value
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

  const result = {
    scheme,
    host,
    port,
    server,
  };

  if (username !== undefined) result.username = username;
  if (password !== undefined) result.password = password;

  return result;
}

/**
 * Normalize a proxy input (string URL or object) to canonical structure.
 * @param {string | Object} input
 * @returns {NormalizedProxy}
 */
export function normalizeProxy(input) {
  if (typeof input === 'string') {
    return parseProxyUrl(input);
  }

  if (typeof input === 'object' && input !== null) {
    const scheme = String(input.scheme || 'http').toLowerCase();
    if (!SUPPORTED_PROXY_SCHEMES.includes(scheme)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Unsupported proxy scheme: "${scheme}". Supported: ${SUPPORTED_PROXY_SCHEMES.join(', ')}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (!input.host) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy host is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Strip surrounding brackets from an IPv6 host supplied as an object.
    const host = String(input.host).replace(/^\[|\]$/g, '');
    const defaultPort = DEFAULT_SCHEME_PORTS[scheme] ?? 80;
    const port = parsePort(input.port, defaultPort);
    const server = buildServer(scheme, host, port);

    const result = {
      scheme,
      host,
      port,
      server,
    };

    if (input.username !== undefined && input.username !== '') result.username = input.username;
    if (input.password !== undefined) result.password = input.password;

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
 * @param {string | Object} proxy
 * @returns {string}
 */
export function formatProxyUrl(proxy) {
  const norm = normalizeProxy(proxy);
  const hostStr = bracketHost(norm.host);

  const hasUser = norm.username !== undefined && norm.username !== '';
  const hasPass = norm.password !== undefined && norm.password !== '';

  if (!hasUser) {
    return `${norm.scheme}://${hostStr}:${norm.port}`;
  }

  const passPart = hasPass ? `:${encodeURIComponent(norm.password)}` : '';
  return `${norm.scheme}://${encodeURIComponent(norm.username)}${passPart}@${hostStr}:${norm.port}`;
}

/**
 * Factory for creating client-specific proxy agents without direct connection fallback.
 * @param {string | Object} proxy
 * @param {Object} [options]
 * @param {'undici' | 'got'} [options.client='undici']
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
   * @param {Object} [options]
   * @param {ProxyIpPool} [options.pool]
   * @param {Array<string | Object>} [options.proxies]
   * @param {boolean} [options.validateOnAdd]
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

  getProxy(options = {}) {
    const opts = options || {};
    if (opts.accountId) {
      return this.pool.getStickyProxy(opts.accountId);
    }
    return this.pool.getNext();
  }

  getStickyProxy(accountId) {
    return this.pool.getStickyProxy(accountId);
  }

  getNext() {
    return this.pool.getNext();
  }

  quarantine(proxy, durationMs) {
    this.pool.quarantine(proxy, durationMs);
  }

  toPlaywrightProxy(proxy) {
    return this.pool.toPlaywrightProxy(proxy);
  }

  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

  getBrowserArgs(proxy) {
    return this.pool.getBrowserArgs(proxy);
  }
}

/**
 * Dynamic Tunnel Residential Proxy Provider with multi-provider presets and rotation.
 */
export class DynamicTunnelProvider {
  name = 'dynamic';
  #accountSeeds = new Map();
  #quarantinedSessions = new Map();
  #globalSeed = 0;

  /**
   * @param {Object} options
   * @param {string} options.gatewayUrl
   * @param {'brightdata' | 'smartproxy' | 'iproyal' | 'kuaidaili' | 'custom'} [options.provider]
   * @param {string} [options.template]
   * @param {boolean} [options.rotatePerRequest=true]
   * @param {number} [options.sessionDurationMs=600000]
   * @param {string} [options.country]
   * @param {string} [options.city]
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
    this.provider = options.provider || this.#autoDetectProvider(this.rawGateway.host);
    this.template = options.template || '{username}:country={country}:session={sessionId}';
    this.rotatePerRequest = options.rotatePerRequest !== false;
    this.sessionDurationMs = options.sessionDurationMs || 600000;
    this.defaultCountry = options.country;
    this.defaultCity = options.city;
  }

  #autoDetectProvider(host) {
    const h = (host || '').toLowerCase();
    if (h.endsWith('superproxy.io') || h.endsWith('luminati.io') || h.includes('superproxy.') || h.includes('luminati.')) {
      return 'brightdata';
    }
    if (h.endsWith('smartproxy.com') || h.endsWith('smartproxy.io') || h.endsWith('decodo.com') || h.includes('smartproxy.') || h.includes('decodo.')) {
      return 'smartproxy';
    }
    if (h.endsWith('iproyal.com') || h.endsWith('royalproxy.io') || h.includes('iproyal.') || h.includes('royalproxy.')) {
      return 'iproyal';
    }
    if (h.endsWith('kdlapi.com') || h.endsWith('kuaidaili.com') || h.includes('kdlapi.') || h.includes('kuaidaili.')) {
      return 'kuaidaili';
    }
    return 'custom';
  }

  get healthyCount() {
    this.pruneExpiredQuarantines();
    return 1;
  }

  get totalCount() {
    return 1;
  }

  isAllQuarantined() {
    this.pruneExpiredQuarantines();
    return false;
  }

  pruneExpiredQuarantines() {
    const now = Date.now();
    for (const [key, expiresAt] of this.#quarantinedSessions.entries()) {
      if (now >= expiresAt) {
        this.#quarantinedSessions.delete(key);
      }
    }
  }

  rotateSession(accountId) {
    if (accountId) {
      const current = this.#accountSeeds.get(accountId) || 0;
      if (this.#accountSeeds.size >= MAX_ACCOUNT_SEEDS) {
        const firstKey = this.#accountSeeds.keys().next().value;
        if (firstKey) this.#accountSeeds.delete(firstKey);
      }
      this.#accountSeeds.set(accountId, current + 1);
    } else {
      this.#globalSeed++;
    }
  }

  clearAccount(accountId) {
    if (accountId) {
      this.#accountSeeds.delete(accountId);
    }
  }

  reset() {
    this.#accountSeeds.clear();
    this.#quarantinedSessions.clear();
    this.#globalSeed = 0;
  }

  quarantine(proxy, durationMs = 300000) {
    if (proxy) {
      const norm = normalizeProxy(proxy);
      const key = formatProxyUrl(norm);
      this.#quarantinedSessions.set(key, Date.now() + durationMs);
    }

    for (const [accId] of this.#accountSeeds.entries()) {
      const current = this.#accountSeeds.get(accId) || 0;
      this.#accountSeeds.set(accId, current + 1);
    }
    this.#globalSeed++;
  }

  #formatUsername({ country, city, sessionId }) {
    const rawUser = this.rawGateway.username || '';
    const cleanCountry = country ? String(country).toLowerCase().trim() : '';
    const cleanCity = city ? String(city).toLowerCase().replace(/\s+/g, '').trim() : '';
    const preset = this.provider;

    const baseUser = (rawUser.startsWith('user-') || rawUser.startsWith('brd-') || rawUser.startsWith('lum-'))
      ? rawUser
      : (rawUser ? `user-${rawUser}` : '');

    if (preset === 'brightdata') {
      const parts = [baseUser];
      if (cleanCountry) parts.push(`country-${cleanCountry}`);
      if (cleanCity) parts.push(`city-${cleanCity}`);
      if (sessionId) parts.push(`session-${sessionId}`);
      return parts.filter(Boolean).join('-');
    }

    if (preset === 'smartproxy' || preset === 'iproyal') {
      const parts = [baseUser];
      if (cleanCountry) parts.push(`country-${cleanCountry}`);
      if (cleanCity) parts.push(`city-${cleanCity}`);
      if (sessionId) parts.push(`session-${sessionId}`);
      return parts.filter(Boolean).join('_');
    }

    if (preset === 'kuaidaili') {
      const parts = [baseUser];
      if (sessionId) parts.push(`session-${sessionId}`);
      return parts.filter(Boolean).join('_');
    }

    if (preset === 'custom') {
      let tpl = this.template;
      tpl = tpl.replaceAll('{username}', rawUser);
      tpl = tpl.replaceAll('{country}', cleanCountry);
      tpl = tpl.replaceAll('{city}', cleanCity);
      tpl = tpl.replaceAll('{sessionId}', sessionId || '');
      return tpl;
    }

    return rawUser;
  }

  getProxy(options = {}) {
    const opts = options || {};
    const accountId = opts.accountId;
    const country = opts.country || this.defaultCountry;
    const city = opts.city || this.defaultCity;
    let sessionId = opts.sessionId;

    if (!sessionId) {
      if (accountId) {
        const bucket = Math.floor(Date.now() / this.sessionDurationMs);
        const seed = (this.#accountSeeds.get(accountId) || 0) + this.#globalSeed;
        sessionId = `${accountId}_${bucket}_${seed}`;
      } else if (this.rotatePerRequest) {
        const rnd = Math.random().toString(36).slice(2, 10);
        const ts = Date.now().toString(36);
        sessionId = `sess_${rnd}${ts}_${this.#globalSeed}`;
      } else {
        sessionId = `sess_static_${this.#globalSeed}`;
      }
    }

    const username = this.#formatUsername({ country, city, sessionId });
    const password = this.rawGateway.password;

    return normalizeProxy({
      scheme: this.rawGateway.scheme,
      host: this.rawGateway.host,
      port: this.rawGateway.port,
      username,
      password,
    });
  }

  getStickyProxy(accountId) {
    return this.getProxy({ accountId });
  }

  getNext() {
    return this.getProxy();
  }

  toPlaywrightProxy(proxy) {
    if (!proxy) return null;
    const norm = normalizeProxy(proxy);
    const result = {
      server: norm.server,
    };
    if (norm.username !== undefined) result.username = norm.username;
    if (norm.password !== undefined) result.password = norm.password;
    return result;
  }

  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

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
    return [
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE ${norm.host}"`,
      `--proxy-server=${norm.server}`,
    ];
  }
}

/**
 * Unified factory for creating proxy providers.
 * @param {Object} config
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
    return new DynamicTunnelProvider(config);
  }

  if (config.type === 'static') {
    return new StaticProxyProvider(config);
  }

  if (config.gatewayUrl) {
    return new DynamicTunnelProvider(config);
  }

  if (config.proxies || config.pool) {
    return new StaticProxyProvider(config);
  }

  throw new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: `Unknown or unsupported proxy provider configuration: "${JSON.stringify(config)}"`,
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
  });
}
