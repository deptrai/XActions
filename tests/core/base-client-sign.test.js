// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { PreSignedTokenRing, SignerWorkerPagePool } from '../../src/core/signer-pool.js';
import { PlaywrightAdapter } from '../../src/scrapers/adapters/playwright.js';
import { StaticProxyProvider } from '../../src/proxy/providers.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';

class TestApiClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'test-platform';
  requiresAuth = false;
  client = 'undici';
}

class CustomSignClient extends TestApiClient {
  async sign(payload) {
    return {
      headers: { 'x-custom-sig': 'custom_signature_abc' },
    };
  }
}

function startServer(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve(server.address().port);
    });
  });
}

function makeProxyUrl(index, proxyPort) {
  return `http://u${index}:p@127.0.0.1:${proxyPort}`;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

describe('Story 13.1 — AbstractApiClient.requestWithSign Integration (AC-3, AC-4, AC-5, AC-6)', () => {
  let upstreamServer;
  let proxyServer;
  let upstreamPort;
  let proxyPort;
  let receivedRequests;
  let proxyProvider;
  let playwrightAvailable = false;
  let playwrightAdapter;
  let browser;

  beforeAll(async () => {
    playwrightAdapter = new PlaywrightAdapter();
    const dep = await playwrightAdapter.checkDependencies();
    playwrightAvailable = dep.available;
    if (playwrightAvailable) {
      browser = await playwrightAdapter.launch({ headless: true });
    }

    upstreamServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: req.url, headers: req.headers, body }));
      });
    });

    proxyServer = createServer();

    // Forward proxy: forward HTTP requests using the absolute URL.
    proxyServer.on('request', (req, res) => {
      const target = new URL(req.url);
      const proxyReq = httpRequest(
        target,
        { method: req.method, headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', () => {
        res.writeHead(502);
        res.end('Bad Gateway');
      });
      req.pipe(proxyReq);
    });

    // CONNECT tunnel for https (or http if undici tunnels).
    proxyServer.on('connect', (req, clientSocket, head) => {
      const { hostname, port } = new URL(`http://${req.url}`);
      const serverSocket = connect(Number(port) || 80, hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      serverSocket.on('error', () => clientSocket.end());
      clientSocket.on('error', () => serverSocket.end());
    });

    upstreamPort = await startServer(upstreamServer);
    proxyPort = await startServer(proxyServer);

    const proxyPool = new ProxyIpPool({
      proxies: [makeProxyUrl(1, proxyPort)],
    });
    proxyProvider = new StaticProxyProvider({ pool: proxyPool });
  });

  afterAll(async () => {
    if (browser) {
      try {
        await playwrightAdapter.closeBrowser(browser);
      } catch {}
    }
    await new Promise((resolve) => upstreamServer?.close(resolve));
    await new Promise((resolve) => proxyServer?.close(resolve));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  const upstreamUrl = () => `http://127.0.0.1:${upstreamPort}`;

  it('[P0] should inject token from PreSignedTokenRing into headers when signType is token (AC-3)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['bearer_token_xyz']);

    const client = new TestApiClient({ tokenRing: ring, proxyProvider });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/test`, {
      signType: 'token',
      location: 'header',
      name: 'authorization',
      prefix: 'Bearer ',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].headers['authorization']).toBe('Bearer bearer_token_xyz');
  });

  it('[P0] should inject token from PreSignedTokenRing into query parameters (AC-3)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['token_query_123']);

    const client = new TestApiClient({ tokenRing: ring, proxyProvider });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/test`, {
      signType: 'token',
      location: 'query',
      name: 'token',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].url).toContain('token=token_query_123');
  });

  it('[P1] should inject token from PreSignedTokenRing into cookies and sync client.cookies (AC-6)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['cookie_dtsg_val']);

    const client = new TestApiClient({ tokenRing: ring, proxyProvider });

    const res = await client.requestWithSign('POST', `${upstreamUrl()}/api/test`, {
      signType: 'token',
      location: 'cookie',
      name: 'fb_dtsg',
    });

    expect(res.status).toBe(200);
    expect(client.cookies['fb_dtsg']).toBe('cookie_dtsg_val');
    expect(receivedRequests[0].headers['cookie']).toContain('fb_dtsg=cookie_dtsg_val');
  });

  it('[P0] should throw when tokenRing is configured but empty', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill([]);

    const client = new TestApiClient({ tokenRing: ring, proxyProvider });

    await expect(
      client.requestWithSign('GET', `${upstreamUrl()}/api/test`, { signType: 'token' }),
    ).rejects.toMatchObject({ code: 'XACT_5000' });
  });

  it('[P1] should fallback to this.sign() when no ring or pool is configured (AC-3)', async () => {
    const client = new CustomSignClient({ proxyProvider });
    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/data`, {
      signType: 'custom',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
  });

  it('[P1] should reject relative URLs when using the default HTTP client', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['tok_rel_123']);

    const client = new TestApiClient({ tokenRing: ring, proxyProvider });

    await expect(
      client.requestWithSign('GET', '/api/relative/endpoint', {
        signType: 'token',
        location: 'query',
        name: 'auth_token',
      }),
    ).rejects.toMatchObject({ code: 'XACT_4001' });
  });

  it('[P0] should dispatch to SignerWorkerPagePool when signType is page (AC-3)', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser page-sign test');
      return;
    }

    const pool = new SignerWorkerPagePool({
      browser,
      adapter: playwrightAdapter,
      minSize: 1,
      maxSize: 2,
    });
    await pool.init();

    try {
      const client = new TestApiClient({ signerPool: pool, proxyProvider });

      const res = await client.requestWithSign('POST', `${upstreamUrl()}/api/graphql`, {
        signType: 'page',
        script: () => ({ headers: { 'x-client-transaction-id': 'signed_tx_999' }, query: { sig: 'dyn_sig_456' } }),
        args: [],
      });

      expect(res.status).toBe(200);
      expect(receivedRequests[0].headers['x-client-transaction-id']).toBe('signed_tx_999');
      expect(receivedRequests[0].url).toContain('sig=dyn_sig_456');
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 1000 });
    }
  });

  it('[P1] should map primitive signature string to header when signType is page', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser primitive-signature test');
      return;
    }

    const pool = new SignerWorkerPagePool({
      browser,
      adapter: playwrightAdapter,
      minSize: 1,
      maxSize: 2,
    });
    await pool.init();

    try {
      const client = new TestApiClient({ signerPool: pool, proxyProvider });
      const res = await client.requestWithSign('POST', `${upstreamUrl()}/api/tx`, {
        signType: 'page',
        script: () => 'raw_tx_string_999',
        location: 'header',
        name: 'x-client-transaction-id',
      });

      expect(res.status).toBe(200);
      expect(receivedRequests[0].headers['x-client-transaction-id']).toBe('raw_tx_string_999');
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 1000 });
    }
  });

  it('[P1] should stringify JSON body and preserve custom content-type for default httpClient', async () => {
    const client = new TestApiClient({ proxyProvider });

    const res = await client.requestWithSign('POST', `${upstreamUrl()}/api/json`, {
      signType: 'custom',
    }, {
      json: { hello: 'world' },
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['content-type']).toContain('application/json');
    const body = safeJsonParse(receivedRequests[0].body);
    expect(body).toEqual({ hello: 'world' });
  });
});

describe('Story 13.1.2 — Tier 0 Pure-Algorithm Crypto Signer Bridge (requestWithSign)', () => {
  let upstreamServer;
  let upstreamPort;
  let receivedRequests;

  beforeAll(async () => {
    upstreamServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    upstreamPort = await startServer(upstreamServer);
  });

  afterAll(async () => {
    await new Promise((resolve) => upstreamServer?.close(resolve));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  const upstreamUrl = () => `http://127.0.0.1:${upstreamPort}`;

  it('[P0] should dispatch to pure signer (signType=pure_algorithm) without a browser', async () => {
    const pureSigners = {
      'x-request-fingerprint': (p) => ({ headers: { 'x-request-fingerprint': `fp_${p.method}` } }),
    };
    const client = new TestApiClient({ pureSigners });

    const start = performance.now();
    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/fp`, {
      signType: 'pure_algorithm',
      algorithm: 'x-request-fingerprint',
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-request-fingerprint']).toBe('fp_GET');
    // Pure signer path should be fast; generous bound (full HTTP request included).
    expect(elapsed).toBeLessThan(5000);
  });

  it('[P0] should map a raw-string pure signer return to the payload.name header', async () => {
    const pureSigners = { 'x-sig': () => 'raw_sig_abc' };
    const client = new TestApiClient({ pureSigners });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/raw`, {
      signType: 'pure_algorithm',
      algorithm: 'x-sig',
      location: 'header',
      name: 'x-sig',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-sig']).toBe('raw_sig_abc');
  });

  it('[P1] should auto-detect a registered algorithm when signType is not token/page', async () => {
    const pureSigners = { 'x-request-fingerprint': () => ({ headers: { 'x-request-fingerprint': 'auto_fp' } }) };
    const client = new TestApiClient({ pureSigners });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/auto`, {
      signType: 'custom',
      algorithm: 'x-request-fingerprint',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-request-fingerprint']).toBe('auto_fp');
  });

  it('[P0] should auto-detect a registered algorithm when signType is omitted (AC AUTO_DETECT)', async () => {
    const pureSigners = { 'x-request-fingerprint': () => ({ headers: { 'x-request-fingerprint': 'detected_fp' } }) };
    const client = new TestApiClient({ pureSigners });

    // No signType at all — payload.algorithm alone must route to Tier 0.
    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/detect`, {
      algorithm: 'x-request-fingerprint',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-request-fingerprint']).toBe('detected_fp');
  });

  it('[P1] should fall back to sign() when algorithm is not registered', async () => {
    const client = new CustomSignClient({ pureSigners: {} });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/nosigner`, {
      signType: 'pure_algorithm',
      algorithm: 'not-registered',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
  });

  it('[P1] should fall back to sign() when the pure signer returns null', async () => {
    const client = new CustomSignClient({
      pureSigners: { 'x-null': () => null },
    });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/null`, {
      signType: 'pure_algorithm',
      algorithm: 'x-null',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
  });

  it('[P1] should fall back to sign() when the pure signer throws', async () => {
    const client = new CustomSignClient({
      pureSigners: {
        'x-throws': () => {
          throw new Error('boom');
        },
      },
    });

    const res = await client.requestWithSign('GET', `${upstreamUrl()}/api/throw`, {
      signType: 'pure_algorithm',
      algorithm: 'x-throws',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
  });

  it('[P0] should be deterministic and under 0.1ms for the HMAC fingerprint signer', async () => {
    const { signRequestFingerprint } = await import('../../src/scrapers/social/twitter/pure-signers.js');

    const payload = { method: 'GET', url: 'http://x.com/i/api/graphql/Q/UserTweets', seed: 's3cret' };
    const a = signRequestFingerprint(payload);
    const b = signRequestFingerprint(payload);
    expect(a).toEqual(b);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) signRequestFingerprint(payload);
    const perCall = (performance.now() - start) / 1000;
    expect(perCall).toBeLessThan(0.1);

    expect(signRequestFingerprint({ method: 'GET', url: 'http://x.com/x' })).toBeNull();
  });
});
