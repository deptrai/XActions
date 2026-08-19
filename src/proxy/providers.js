// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Proxy normalization and URL parser utilities for ProxyIpPool.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { ProxyAgent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export const SUPPORTED_PROXY_SCHEMES = ['http', 'https', 'socks5'];

/**
 * @typedef {Object} NormalizedProxy
 * @property {string} scheme
 * @property {string} host
 * @property {number} port
 * @property {string} [username]
 * @property {string} [password]
 * @property {string} server - Canonical host:port with scheme (e.g., "http://1.2.3.4:8080")
 */

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

  const host = parsed.hostname;
  const defaultPort = scheme === 'https' ? 443 : scheme === 'socks5' ? 1080 : 80;
  const parsedPort = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
  const port = Number.isFinite(parsedPort) ? parsedPort : defaultPort;

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

  const server = `${scheme}://${host}:${port}`;

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

    const defaultPort = scheme === 'https' ? 443 : scheme === 'socks5' ? 1080 : 80;
    const parsedPort = typeof input.port === 'number' ? input.port : (input.port ? parseInt(input.port, 10) : defaultPort);
    const port = Number.isFinite(parsedPort) ? parsedPort : defaultPort;
    const server = input.server || `${scheme}://${input.host}:${port}`;

    const result = {
      scheme,
      host: input.host,
      port,
      server,
    };

    if (input.username !== undefined) result.username = input.username;
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
 * @param {any} proxy
 * @returns {string}
 */
export function formatProxyUrl(proxy) {
  const norm = normalizeProxy(proxy);
  const auth = norm.username || norm.password ? `${encodeURIComponent(norm.username || '')}${norm.password !== undefined ? `:${encodeURIComponent(norm.password)}` : ''}@` : '';
  const hostStr = norm.host.includes(':') && !norm.host.startsWith('[') ? `[${norm.host}]` : norm.host;
  return `${norm.scheme}://${auth}${hostStr}:${norm.port}`;
}

/**
 * Factory for creating client-specific proxy agents without direct fallback.
 * @param {any} proxy
 * @param {Object} [options]
 * @param {'undici' | 'got'} [options.client='undici']
 * @returns {any}
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
      return new SocksProxyAgent(proxyUrl);
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
