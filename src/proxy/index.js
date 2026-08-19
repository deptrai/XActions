// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Proxy — proxy pool, providers, and anti-leak utilities.
 * @author nich (@nichxbt)
 * @license MIT
 */

export { ProxyIpPool, globalProxyPool } from './proxy-pool.js';
export {
  SUPPORTED_PROXY_SCHEMES,
  parseProxyUrl,
  normalizeProxy,
  formatProxyUrl,
  getProxyAgent,
  StaticProxyProvider,
  DynamicTunnelProvider,
  createProxyProvider,
} from './providers.js';
