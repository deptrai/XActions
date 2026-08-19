// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Proxy normalization and URL parser utilities for ProxyIpPool.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';

export const SUPPORTED_PROXY_SCHEMES = ['http', 'https', 'socks5'];

const DEFAULT_SCHEME_PORTS = {
  http: 80,
  https: 443,
  socks5: 1080,
};

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
