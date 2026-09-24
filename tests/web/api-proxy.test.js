// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * BFF Reverse Proxy Tests.
 * Uses an ephemeral Node.js HTTP server at 127.0.0.1:0 (zero mocks)
 * to verify proxyToBackend() behavior across all matrix scenarios.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { proxyToBackend } from '../../apps/web/lib/proxy.js';

describe('BFF proxyToBackend (lib/proxy.ts)', () => {
  let server;
  let serverUrl;
  let lastReceivedHeaders = {};
  let lastReceivedMethod = '';
  let lastReceivedBody = '';
  let lastReceivedUrl = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastReceivedHeaders = req.headers;
      lastReceivedMethod = req.method;
      lastReceivedUrl = req.url;

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        lastReceivedBody = body;

        // Custom route handling for testing matrix
        if (req.url.startsWith('/api/checkpoints')) {
          // Real gzip payload: undici will auto-decompress, so the proxy must
          // forward the decompressed stream verbatim and strip encoding headers.
          const gzipped = zlib.gzipSync(JSON.stringify({ success: true, data: [{ id: 'cp-1' }] }));
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
            'content-length': String(gzipped.length),
            'set-cookie': 'srv_sess=upstream123; Path=/',
          });
          res.end(gzipped);
        } else if (req.url === '/api/error-401') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Token expired' },
          }));
        } else if (req.url === '/api/stream') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
          });
          res.write('data: {"event":"start"}\n\n');
          res.write('data: {"event":"update"}\n\n');
          res.end('data: {"event":"end"}\n\n');
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, echo: true }));
        }
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('forward GET happy path with query and cookie auth injection', async () => {
    const req = new Request('http://localhost:3000/api/checkpoints?limit=5', {
      method: 'GET',
      headers: {
        cookie: 'xa_bearer=jwt_token_123',
        'x-custom-header': 'client-value',
      },
    });

    const res = await proxyToBackend(req, { baseUrl: serverUrl });
    expect(res.status).toBe(200);

    expect(lastReceivedMethod).toBe('GET');
    expect(lastReceivedUrl).toBe('/api/checkpoints?limit=5');
    expect(lastReceivedHeaders['authorization']).toBe('Bearer jwt_token_123');
    expect(lastReceivedHeaders['x-custom-header']).toBe('client-value');
    // In Node fetch, incoming client Host is stripped; undici populates target host:port
    expect(lastReceivedHeaders['host']).not.toBe('localhost:3000');

    // Strips content-encoding and content-length from response
    expect(res.headers.has('content-encoding')).toBe(false);

    // Passes set-cookie through
    expect(res.headers.get('set-cookie')).toContain('srv_sess=upstream123');

    const json = await res.json();
    expect(json).toEqual({ success: true, data: [{ id: 'cp-1' }] });
  });

  it('forward POST JSON with body and duplex half', async () => {
    const payload = JSON.stringify({ contactId: 'c1', tag: 'VIP' });
    const req = new Request('http://localhost:3000/api/crm/tag', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: payload,
      // @ts-ignore
      duplex: 'half',
    });

    const res = await proxyToBackend(req, { baseUrl: serverUrl });
    expect(res.status).toBe(200);
    expect(lastReceivedMethod).toBe('POST');
    expect(lastReceivedUrl).toBe('/api/crm/tag');
    expect(lastReceivedBody).toBe(payload);
  });

  it('cookie xa_session wins over explicit x-session-cookie header', async () => {
    const req = new Request('http://localhost:3000/api/checkpoints', {
      method: 'GET',
      headers: {
        cookie: 'xa_session=cookie_val_wins',
        'x-session-cookie': 'explicit_header_loses',
      },
    });

    await proxyToBackend(req, { baseUrl: serverUrl });
    expect(lastReceivedHeaders['x-session-cookie']).toBe('cookie_val_wins');
  });

  it('forward transitional explicit headers when cookie is absent', async () => {
    const req = new Request('http://localhost:3000/api/checkpoints', {
      method: 'GET',
      headers: {
        'x-session-cookie': 'transitional_sess_val',
        'authorization': 'Bearer direct_jwt',
      },
    });

    await proxyToBackend(req, { baseUrl: serverUrl });
    expect(lastReceivedHeaders['x-session-cookie']).toBe('transitional_sess_val');
    expect(lastReceivedHeaders['authorization']).toBe('Bearer direct_jwt');
  });

  it('passes upstream 401 error envelope verbatim', async () => {
    const req = new Request('http://localhost:3000/api/error-401', {
      method: 'GET',
    });

    const res = await proxyToBackend(req, { baseUrl: serverUrl });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Token expired' },
    });
  });

  it('returns canonical 502 UPSTREAM_UNREACHABLE when backend is down', async () => {
    const deadPortUrl = 'http://127.0.0.1:1'; // Unused port
    const req = new Request('http://localhost:3000/api/health', {
      method: 'GET',
    });

    const res = await proxyToBackend(req, { baseUrl: deadPortUrl });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: 'Upstream service is unreachable',
      },
    });
  });

  it('streams response verbatim (SSE stream)', async () => {
    const req = new Request('http://localhost:3000/api/stream', {
      method: 'GET',
    });

    const res = await proxyToBackend(req, { baseUrl: serverUrl });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data: {"event":"start"}');
    expect(text).toContain('data: {"event":"update"}');
    expect(text).toContain('data: {"event":"end"}');
  });
});
