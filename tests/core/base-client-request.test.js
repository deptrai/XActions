// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { StaticProxyProvider, DynamicTunnelProvider } from '../../src/proxy/providers.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';
import { ProxyAgent } from 'undici';

class TestApiClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'twitter';
  requiresAuth = false;
}

describe('Story 11.3 — 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor (ATDD Red Phase)', () => {
  let proxyPool;
  let provider;
  let accountPool;
  let governor;

  beforeEach(() => {
    vi.useFakeTimers();
    proxyPool = new ProxyIpPool({
      proxies: [
        'http://p1.example.com:8080',
        'http://p2.example.com:8080',
        'http://p3.example.com:8080',
      ],
    });
    provider = new StaticProxyProvider({ pool: proxyPool });
    accountPool = new AccountPool();
    governor = new AdaptiveRateGovernor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('AC-1 & AC-2: 429/403 Detection & Auto-Quarantine', () => {
    test('should auto-quarantine proxy on HTTP 429 response and retry with next healthy proxy', async () => {
      let callCount = 0;
      const mockHttpClient = vi.fn(async ({ proxy }) => {
        callCount++;
        if (callCount === 1) {
          return { status: 429, headers: {}, data: { error: 'Rate limit' } };
        }
        return { status: 200, headers: {}, data: { success: true } };
      });

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: mockHttpClient,
        requiresAuth: false,
      });

      const responsePromise = client.request('GET', 'https://api.example.com/data');
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ success: true });
      expect(callCount).toBe(2);
      expect(provider.healthyCount).toBe(2); // 1 quarantined
    });

    test('should auto-quarantine proxy on HTTP 403 bot challenge response', async () => {
      let callCount = 0;
      const mockHttpClient = vi.fn(async ({ proxy }) => {
        callCount++;
        if (callCount === 1) {
          return { status: 403, headers: {}, data: { error: 'Cloudflare bot challenge' } };
        }
        return { status: 200, headers: {}, data: { ok: true } };
      });

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: mockHttpClient,
        requiresAuth: false,
      });

      const responsePromise = client.request('GET', 'https://api.example.com/feed');
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(callCount).toBe(2);
      expect(provider.healthyCount).toBe(2);
    });
  });

  describe('AC-3: No-Auth Platforms — Proxy Rotation + Exponential Replay with Jitter', () => {
    test('should replay up to maxProxyRetries with exponential backoff delays', async () => {
      let callCount = 0;
      const mockHttpClient = vi.fn(async () => {
        callCount++;
        return { status: 429, headers: {}, data: 'rate limit' };
      });

      const fivePool = new ProxyIpPool({
        proxies: [
          'http://p1.example.com:8080',
          'http://p2.example.com:8080',
          'http://p3.example.com:8080',
          'http://p4.example.com:8080',
          'http://p5.example.com:8080',
        ],
      });
      const fiveProvider = new StaticProxyProvider({ pool: fivePool });

      const client = new TestApiClient({
        proxyProvider: fiveProvider,
        httpClient: mockHttpClient,
        requiresAuth: false,
        maxProxyRetries: 3,
        backoffBaseMs: 1000,
      });

      let error = null;
      const req = client.request('GET', 'https://api.example.com/items').catch((err) => {
        error = err;
      });

      await vi.runAllTimersAsync();
      await req;

      expect(callCount).toBe(3); // 1 initial + 2 retries (or 3 attempts)
      expect(error).toBeInstanceOf(PlatformError);
      expect(error.code).toBe('XACT_4290');
    });

    test('should stop retrying immediately and throw XACT_5030 when all proxies are quarantined', async () => {
      const smallProvider = new StaticProxyProvider({
        proxies: ['http://single.proxy:8080'],
      });

      const mockHttpClient = vi.fn(async () => {
        return { status: 429, headers: {}, data: 'blocked' };
      });

      const client = new TestApiClient({
        proxyProvider: smallProvider,
        httpClient: mockHttpClient,
        requiresAuth: false,
        maxProxyRetries: 5,
        standbyBackoffMs: 30000,
      });

      let error = null;
      const req = client.request('GET', 'https://api.example.com/test').catch((err) => {
        error = err;
      });

      await vi.runAllTimersAsync();
      await req;

      expect(mockHttpClient).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(PlatformError);
      expect(error.code).toBe('XACT_5030');
      expect(error.type).toBe(ErrorTypes.PROXY_EXHAUSTED);
      expect(error.retryAfterMs).toBe(30000);
    });
  });

  describe('AC-4: Auth-Required Platforms — Sticky Proxy Fallback + Account Rotation', () => {
    test('should attempt new sticky proxy first, then rotate account on repeated 429s', async () => {
      accountPool.registerAccounts('twitter', ['acc_primary', 'acc_backup']);

      let callCount = 0;
      const mockHttpClient = vi.fn(async ({ accountId }) => {
        callCount++;
        if (accountId === 'acc_primary') {
          return { status: 429, headers: {}, data: 'account rate limited' };
        }
        return { status: 200, headers: {}, data: { user: accountId } };
      });

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        accountPool,
        httpClient: mockHttpClient,
        maxProxyRetries: 2,
        rateLimitHibernationMs: 60000,
      });

      const responsePromise = client.request('GET', 'https://api.example.com/me', {
        accountId: 'acc_primary',
      });

      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ user: 'acc_backup' });
      // acc_primary should be marked unavailable / hibernating
      expect(accountPool.getAccount('acc_primary', 'twitter').hibernatingUntil).toBeGreaterThan(0);
    });
  });

  describe('AC-5: Standby Backoff When Whole Pool is Quarantined', () => {
    test('should throw XACT_5030 with standbyBackoffMs and mark account unavailable on full pool quarantine', async () => {
      const exhaustedPool = new ProxyIpPool({ proxies: ['http://p1.example.com:8080'] });
      exhaustedPool.quarantine('http://p1.example.com:8080', 60000);
      const exhaustedProvider = new StaticProxyProvider({ pool: exhaustedPool });

      accountPool.registerAccounts('twitter', ['acc_active']);

      const client = new TestApiClient({
        proxyProvider: exhaustedProvider,
        accountPool,
        requiresAuth: true,
        standbyBackoffMs: 30000,
      });

      await expect(
        client.request('GET', 'https://api.example.com/data', { accountId: 'acc_active' })
      ).rejects.toMatchObject({
        code: 'XACT_5030',
        retryAfterMs: 30000,
      });
    });
  });

  describe('AC-6: Retry-After Header Honor & Clamping', () => {
    test('should parse Retry-After header in seconds and use it for backoff delay', async () => {
      let callCount = 0;
      const mockHttpClient = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 429, headers: { 'retry-after': '5' }, data: 'slow down' };
        }
        return { status: 200, headers: {}, data: 'ok' };
      });

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: mockHttpClient,
        requiresAuth: false,
        maxBackoffMs: 30000,
      });

      const req = client.request('GET', 'https://api.example.com/stream');
      await vi.advanceTimersByTimeAsync(4900);
      expect(callCount).toBe(1); // not retried yet before 5s

      await vi.advanceTimersByTimeAsync(200);
      const response = await req;
      expect(response.status).toBe(200);
      expect(callCount).toBe(2);
    });
  });

  describe('AC-7: AdaptiveRateGovernor Integration', () => {
    test('should block requests from hibernating accounts via governor check', async () => {
      governor.hibernateAccount('acc_hibernating', 'rate_limit', 60000, 'twitter');

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        governor,
        accountPool,
        httpClient: vi.fn(),
      });

      await expect(
        client.request('GET', 'https://api.example.com/check', { accountId: 'acc_hibernating' })
      ).rejects.toMatchObject({
        code: 'XACT_4291',
        type: ErrorTypes.HIBERNATION,
      });
    });

    test('should record successful requests in both governor and accountPool', async () => {
      accountPool.registerAccounts('twitter', ['acc_good']);

      const mockHttpClient = vi.fn(async () => ({
        status: 200,
        headers: {},
        data: 'success',
      }));

      class AuthClient extends AbstractApiClient {
        name = 'auth-client';
        platform = 'twitter';
        requiresAuth = true;
      }

      const client = new AuthClient({
        proxyProvider: provider,
        governor,
        accountPool,
        httpClient: mockHttpClient,
      });

      await client.request('GET', 'https://api.example.com/action', { accountId: 'acc_good' });

      expect(accountPool.getAccountVelocity('acc_good', 'twitter')).toBe(1);
    });
  });

  describe('AC-8 & AC-9: Pluggable Transport & No Direct Connection Fallback', () => {
    test('should pass correct proxy agent to httpClient without direct fallback', async () => {
      let passedAgent = null;
      const mockHttpClient = vi.fn(async ({ agent, proxy }) => {
        passedAgent = agent;
        return { status: 200, headers: {}, data: { proxyServer: proxy.server } };
      });

      const client = new TestApiClient({
        proxyProvider: provider,
        httpClient: mockHttpClient,
      });

      const res = await client.request('GET', 'https://api.example.com/info');
      expect(res.status).toBe(200);
      expect(passedAgent).toBeDefined();
      expect(passedAgent).toBeInstanceOf(ProxyAgent);
    });

    test('should throw proxy_exhausted when proxyProvider is missing and proxy is required', async () => {
      const client = new TestApiClient({
        proxyProvider: null,
        proxyPool: null,
        httpClient: vi.fn(),
      });

      await expect(client.request('GET', 'https://api.example.com/no-proxy')).rejects.toMatchObject({
        code: 'XACT_5030',
        type: ErrorTypes.PROXY_EXHAUSTED,
      });
    });
  });
});
