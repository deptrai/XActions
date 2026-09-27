// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * IPFS image proxy — /api/ipfs/<cid>
 *
 * pump.fun metadata points images at public gateways (ipfs.io et al) that are
 * being sunset, rate-limit aggressively (429), and send
 * Cross-Origin-Resource-Policy blocks that make browser <img> tags fail with
 * ERR_BLOCKED_BY_RESPONSE. The BFF fetches the bytes from a healthy gateway
 * and re-serves them same-origin, with a small in-memory cache.
 */

import { NextResponse } from 'next/server';

const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
];

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

/** cid|path → upstream candidate URLs. `_https/<host>/<path>` proxies
 *  arbitrary remote hosts (non-IPFS media that also sets CORP blocks). */
function gatewayUrls(cidOrPath: string): string[] {
  const clean = cidOrPath.replace(/^\/+/, '');
  if (clean.startsWith('_https/')) {
    return ['https://' + clean.slice('_https/'.length)];
  }
  const hash = clean.startsWith('ipfs/') ? clean.slice(5) : clean;
  return GATEWAYS.map((gw) => gw + hash);
}

/** Small same-process cache: cid → {bytes, contentType} (bounded, LRU-ish). */
const CACHE = new Map<string, { bytes: ArrayBuffer; contentType: string; at: number }>();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheGet(key: string) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key: string, value: { bytes: ArrayBuffer; contentType: string }) {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
  CACHE.set(key, { ...value, at: Date.now() });
}

export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const key = cid.replace(/^\/+/, '');

  const cached = cacheGet(key);
  if (cached) {
    return new NextResponse(cached.bytes, {
      status: 200,
      headers: {
        'content-type': cached.contentType,
        'cache-control': 'public, max-age=1800',
        'x-ipfs-proxy': 'cache-hit',
      },
    });
  }

  for (const url of gatewayUrls(key)) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      if (contentType.includes('text/html')) continue; // gateway error page
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) continue;
      cacheSet(key, { bytes, contentType });
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=1800',
          'x-ipfs-proxy': 'miss',
        },
      });
    } catch {
      // try next gateway
    }
  }

  return NextResponse.json(
    { success: false, error: { code: 'IPFS_UNREACHABLE', message: `Could not fetch ${key} from any gateway` } },
    { status: 502 }
  );
}
