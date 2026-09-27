// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Rewrite a remote IPFS/media image URL to a same-origin BFF proxy URL so
 * browser <img> tags never hit gateways that send
 * Cross-Origin-Resource-Policy blocks (ERR_BLOCKED_BY_RESPONSE) or sunset
 * rate-limited gateways (ipfs.io 429).
 *
 * Non-IPFS URLs (https://socialimages.pump.fun/..., data:, blob:, ...) pass
 * through unchanged — they already serve with browser-friendly CORS headers.
 */

const IPFS_GATEWAY_HOSTS = [
  'ipfs.io',
  'gateway.pinata.cloud',
  'cloudflare-ipfs.com',
  'cf-ipfs.com',
  'ipfs.dweb.link',
  'gateway.ipfs.io',
  'hardbin.com',
  '4everland.io',
  'w3s.link',
  'nftstorage.link',
  'mypinata.cloud',
];

export function proxiedImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  // ipfs://<cid> scheme
  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.slice(7).replace(/^ipfs\//, '');
    return `/api/ipfs/${cid}`;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const u = new URL(trimmed);
      // Any pump.fun media host already serves same-origin-safe: pass through
      if (u.hostname.endsWith('pump.fun')) return trimmed;
      if (IPFS_GATEWAY_HOSTS.includes(u.hostname)) {
        const path = u.pathname.replace(/^\/ipfs\//, '');
        return `/api/ipfs/${path}`;
      }
      // Other remote hosts — proxy them too (arbitrary hosts may set CORP)
      return `/api/ipfs/_https/${u.hostname}${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  }

  return trimmed;
}
