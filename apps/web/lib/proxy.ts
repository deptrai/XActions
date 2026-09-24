// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * BFF Proxy utility — forwards same-origin requests to backend upstream.
 * Handles header sanitization, credential injection from httpOnly cookies,
 * and verbatim response streaming.
 */

import { getApiInternalUrl } from './config';
import { parseCookies, COOKIE_XA_BEARER, COOKIE_XA_SESSION } from './session';

export interface ProxyOptions {
  /** Target backend base URL. Defaults to API_INTERNAL_URL. */
  baseUrl?: string;
  /** Explicit pathname override. Defaults to pathname of req.url. */
  targetPath?: string;
}

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'host',
  'content-length',
  'te',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

/**
 * Proxies a Next.js Request to the backend upstream using native fetch.
 * Streams response verbatim.
 */
export async function proxyToBackend(
  req: Request,
  opts: ProxyOptions = {}
): Promise<Response> {
  const baseUrl = (opts.baseUrl || getApiInternalUrl()).replace(/\/+$/, '');
  const incomingUrl = new URL(req.url);
  const pathname = opts.targetPath ?? incomingUrl.pathname;
  const targetUrl = `${baseUrl}${pathname}${incomingUrl.search}`;

  // Forward headers with hop-by-hop stripped
  const forwardHeaders = new Headers();
  req.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(lower) && lower !== 'authorization' && lower !== 'x-session-cookie') {
      forwardHeaders.set(key, val);
    }
  });

  // Auth injection from httpOnly cookies
  const cookies = parseCookies(req);

  // Cookie xa_bearer -> Authorization: Bearer <token> (cookie wins over explicit header)
  if (cookies[COOKIE_XA_BEARER]) {
    forwardHeaders.set('authorization', `Bearer ${cookies[COOKIE_XA_BEARER]}`);
  } else if (req.headers.has('authorization')) {
    forwardHeaders.set('authorization', req.headers.get('authorization')!);
  }

  // Cookie xa_session -> x-session-cookie: <session> (cookie wins over explicit header)
  if (cookies[COOKIE_XA_SESSION]) {
    forwardHeaders.set('x-session-cookie', cookies[COOKIE_XA_SESSION]);
  } else if (req.headers.has('x-session-cookie')) {
    forwardHeaders.set('x-session-cookie', req.headers.get('x-session-cookie')!);
  }

  const method = req.method.toUpperCase();
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: forwardHeaders,
    redirect: 'manual',
  };

  if (method !== 'GET' && method !== 'HEAD' && req.body) {
    init.body = req.body;
    init.duplex = 'half';
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl, init);
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'UPSTREAM_UNREACHABLE',
          message: 'Upstream service is unreachable',
        },
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  // Response headers forward: strip encoding/length, keep cookies & content-type
  const responseHeaders = new Headers();
  upstreamRes.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (!STRIP_RESPONSE_HEADERS.has(lower) && lower !== 'set-cookie') {
      responseHeaders.set(key, val);
    }
  });

  if (typeof upstreamRes.headers.getSetCookie === 'function') {
    const setCookies = upstreamRes.headers.getSetCookie();
    for (const sc of setCookies) {
      responseHeaders.append('set-cookie', sc);
    }
  } else if (upstreamRes.headers.has('set-cookie')) {
    responseHeaders.set('set-cookie', upstreamRes.headers.get('set-cookie')!);
  }

  const isNullBodyStatus = upstreamRes.status === 204 || upstreamRes.status === 304;
  const resBody = isNullBodyStatus ? null : upstreamRes.body;

  return new Response(resBody, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: responseHeaders,
  });
}
