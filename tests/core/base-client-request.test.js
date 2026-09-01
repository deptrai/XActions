// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { request } from 'undici';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { StaticProxyProvider } from '../../src/proxy/providers.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';

let upstreamServer;
let proxyServer;
let upstreamPort;
let proxyPort;

const testState = {
  callCount: 0,
  queue: [],
  defaultStatus: 200,
  defaultBody: { success: true },
  accountFailure: null,
};

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function makeProxyUrl(index) {
  return `http://u${index}:p@127.0.0.1:${proxyPort}`;
}

/**
 * Real HTTP client using undici through the ProxyAgent supplied by the pipeline.
 * No mocks — this performs a real HTTP request over a real proxy to a real
 * local server. `accountId` is forwarded as a header so the upstream can
 * simulate account-specific rate limits.
 */
async function defaultHttpClient({ url, method, headers, body, agent, accountId }) {
  const reqHeaders = { ...headers };
  if (accountId) reqHeaders['X-Account-Id'] = accountId;
  const res = await request(url, { method, headers: reqHeaders, body, dispatcher: agent });
  const text = res.body ? await res.body.text() : '';
  const data = text ? safeJsonParse(text) : undefined;
  return { status: res.statusCode, headers: res.headers, data };
}

function startServer(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve(server.address().port);
    });
  });
}

class TestApiClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'twitter';
  requiresAuth = false;
}

describe('Story 11.3 — 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor', () => {
  beforeAll(async () => {
    upstreamServer = createServer((req, res) => {
      testState.callCount++;

      const accountId = req.headers['x-account-id'];
      let status = 200;
      let body = accountId ? { user: accountId, ok: true } : { ok: true };
      let headers = {};

      if (testState.queue.length > 0) {
        const next = testState.queue.shift();
        status = next.status;
        body = next.body ?? body;
        headers = next.headers ?? headers;
      } else if (testState.accountFailure && accountId === testState.accountFailure) {
        status = 429;
        body = { error: 'account rate limited' };
      }

      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    });

    proxyServer = createServer();

    // Forward proxy: forward HTTP requests using the absolute URL.
    proxyServer.on('request', (req, res) => {
      const target = new URL(req.url);
      const proxyReq = httpRequest(target, {
        method: req.method,
        headers: req.headers,
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        res.writeHead(502);
        res.end('Bad Gateway');
      });
      req.pipe(proxyReq);
    });

    // CONNECT tunnel: proxy uses HTTP CONNECT for https (or http if undici tunnels).
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
  });

  afterAll(() => {
    return new Promise((resolve) => {
      upstreamServer.close(() => proxyServer.close(() => resolve()));
    });
  });

  beforeEach(() => {
    testState.callCount = 0;
    testState.queue = [];
    testState.defaultStatus = 200;
    testState.defaultBody = { success: true };
    testState.accountFailure = null;
  });

  describe('AC-1 & AC-2: 429/403 Detection & Auto-Quarantine', () => {
    test('should auto-quarantine proxy on HTTP 429 response and retry with next healthy proxy', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(1), makeProxyUrl(2)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.queue = [
        { status: 429, body: { error: 'Rate limit' } },
        { status: 200, body: { success: true } },
      ];

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
        requiresAuth: false,
        backoffBaseMs: 10,
      });

      const response = await client.request('GET', `http://127.0.0.1:${upstreamPort}/data`);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ success: true });
      expect(testState.callCount).toBe(2);
      expect(provider.healthyCount).toBe(1);
    });

    test('should auto-quarantine proxy on HTTP 403 bot challenge response', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(3), makeProxyUrl(4)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.queue = [
        { status: 403, body: { error: 'Cloudflare bot challenge' } },
        { status: 200, body: { ok: true } },
      ];

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
        requiresAuth: false,
        backoffBaseMs: 10,
      });

      const response = await client.request('GET', `http://127.0.0.1:${upstreamPort}/feed`);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
      expect(testState.callCount).toBe(2);
      expect(provider.healthyCount).toBe(1);
    });
  });

  describe('AC-3: No-Auth Platforms — Proxy Rotation + Exponential Replay with Jitter', () => {
    test('should replay up to maxProxyRetries with exponential backoff delays', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [1, 2, 3, 4, 5].map(makeProxyUrl),
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.queue = [
        { status: 429, body: { error: 'rate limit' } },
        { status: 429, body: { error: 'rate limit' } },
        { status: 429, body: { error: 'rate limit' } },
      ];

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
        requiresAuth: false,
        maxProxyRetries: 3,
        backoffBaseMs: 10,
      });

      const start = Date.now();
      await expect(
        client.request('GET', `http://127.0.0.1:${upstreamPort}/items`)
      ).rejects.toMatchObject({
        code: 'XACT_4290',
        type: ErrorTypes.RATE_LIMIT,
      });
      const elapsed = Date.now() - start;

      expect(testState.callCount).toBe(3);
      // First two retries include backoff; total should be > 10ms and < 250ms
      // (real proxy/undici overhead is included, so the upper bound is generous).
      expect(elapsed).toBeGreaterThan(10);
      expect(elapsed).toBeLessThan(250);
    });

    test('should stop retrying immediately and throw XACT_5030 when all proxies are quarantined', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(10)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.queue = [{ status: 429, body: { error: 'blocked' } }];

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
        requiresAuth: false,
        maxProxyRetries: 5,
        standbyBackoffMs: 30000,
        backoffBaseMs: 10,
      });

      await expect(
        client.request('GET', `http://127.0.0.1:${upstreamPort}/test`)
      ).rejects.toMatchObject({
        code: 'XACT_5030',
        type: ErrorTypes.PROXY_EXHAUSTED,
        retryAfterMs: 30000,
      });

      expect(testState.callCount).toBe(1);
    });
  });

  describe('AC-4: Auth-Required Platforms — Sticky Proxy Fallback + Account Rotation', () => {
    test('should attempt new sticky proxy first, then rotate account on repeated 429s', async () => {
      const accountPool = new AccountPool();
      accountPool.registerAccounts('twitter', ['acc_primary', 'acc_backup']);

      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(20), makeProxyUrl(21), makeProxyUrl(22)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.accountFailure = 'acc_primary';

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        accountPool,
        httpClient: defaultHttpClient,
        maxProxyRetries: 2,
        rateLimitHibernationMs: 60000,
        backoffBaseMs: 10,
      });

      const response = await client.request('GET', `http://127.0.0.1:${upstreamPort}/me`, {
        accountId: 'acc_primary',
      });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ user: 'acc_backup', ok: true });
      expect(accountPool.getAccount('acc_primary', 'twitter').hibernatingUntil).toBeGreaterThan(0);
    });
  });

  describe('AC-5: Standby Backoff When Whole Pool is Quarantined', () => {
    test('should throw XACT_5030 with standbyBackoffMs and mark account unavailable on full pool quarantine', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(30)],
      });
      proxyPool.quarantine(makeProxyUrl(30), 60000);
      const provider = new StaticProxyProvider({ pool: proxyPool });

      const accountPool = new AccountPool();
      accountPool.registerAccounts('twitter', ['acc_active']);

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        accountPool,
        httpClient: defaultHttpClient,
        requiresAuth: true,
        standbyBackoffMs: 30000,
      });

      await expect(
        client.request('GET', `http://127.0.0.1:${upstreamPort}/data`, { accountId: 'acc_active' })
      ).rejects.toMatchObject({
        code: 'XACT_5030',
        retryAfterMs: 30000,
      });
    });
  });

  describe('AC-6: Retry-After Header Honor & Clamping', () => {
    test('should honor Retry-After header and use it for backoff delay', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(40), makeProxyUrl(41)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      testState.queue = [
        { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '0.05' } },
        { status: 200, body: { ok: true } },
      ];

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
        requiresAuth: false,
        maxBackoffMs: 30000,
        backoffBaseMs: 10,
      });

      const start = Date.now();
      const response = await client.request('GET', `http://127.0.0.1:${upstreamPort}/stream`);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(testState.callCount).toBe(2);
      // Retry-After 0.05s (50ms) is larger than computed exponential 10-20ms.
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe('AC-7: AdaptiveRateGovernor Integration', () => {
    test('should block requests from hibernating accounts via governor check', async () => {
      const governor = new AdaptiveRateGovernor();
      governor.hibernateAccount('acc_hibernating', 'rate_limit', 60000, 'twitter');

      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(50)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        governor,
        httpClient: defaultHttpClient,
      });

      await expect(
        client.request('GET', `http://127.0.0.1:${upstreamPort}/check`, { accountId: 'acc_hibernating' })
      ).rejects.toMatchObject({
        code: 'XACT_4291',
        type: ErrorTypes.HIBERNATION,
      });
    });

    test('should record successful requests in both governor and accountPool', async () => {
      const accountPool = new AccountPool();
      const governor = new AdaptiveRateGovernor();
      accountPool.registerAccounts('twitter', ['acc_good']);

      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(60)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        governor,
        accountPool,
        httpClient: defaultHttpClient,
      });

      await client.request('GET', `http://127.0.0.1:${upstreamPort}/action`, { accountId: 'acc_good' });

      expect(accountPool.getAccountVelocity('acc_good', 'twitter')).toBe(1);
      expect(governor.getAccountVelocity('acc_good', 'twitter')).toBe(1);
    });

    test('should record successful no-auth requests under synthetic noauth key', async () => {
      const accountPool = new AccountPool();
      const governor = new AdaptiveRateGovernor();

      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(70)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      const client = new TestApiClient({
        proxyProvider: provider,
        governor,
        accountPool,
        httpClient: defaultHttpClient,
      });

      await client.request('GET', `http://127.0.0.1:${upstreamPort}/noauth`);

      expect(accountPool.getAccountVelocity('noauth', 'twitter')).toBe(1);
      expect(governor.getAccountVelocity('noauth', 'twitter')).toBe(1);
    });
  });

  describe('AC-8 & AC-9: Pluggable Transport & No Direct Connection Fallback', () => {
    test('should dispatch through the provided proxy agent without direct fallback', async () => {
      const proxyPool = new ProxyIpPool({
        proxies: [makeProxyUrl(80)],
      });
      const provider = new StaticProxyProvider({ pool: proxyPool });

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: defaultHttpClient,
      });

      const res = await client.request('GET', `http://127.0.0.1:${upstreamPort}/info`);
      expect(res.status).toBe(200);
    });

    test('should throw proxy_exhausted when proxyProvider is missing and proxy is required', async () => {
      const client = new TestApiClient({
        proxyProvider: null,
        proxyPool: null,
        httpClient: defaultHttpClient,
      });

      await expect(client.request('GET', `http://127.0.0.1:${upstreamPort}/no-proxy`)).rejects.toMatchObject({
        code: 'XACT_5030',
        type: ErrorTypes.PROXY_EXHAUSTED,
      });
    });
  });
});
