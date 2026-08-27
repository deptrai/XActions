// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeEach } from 'vitest';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { PlatformError } from '../../src/core/error-envelope.js';

class MockAuthClient extends AbstractApiClient {
  name = 'mock-auth';
  requiresAuth = true;
}

class MockNoAuthClient extends AbstractApiClient {
  name = 'mock-no-auth';
  requiresAuth = false;
}

describe('AbstractApiClient Proxy Resolution Contract', () => {
  let proxyPool;
  let accountPool;
  let governor;

  beforeEach(() => {
    proxyPool = new ProxyIpPool({
      proxies: ['http://1.1.1.1:8080', 'http://2.2.2.2:8080'],
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
  });

  test('should throw proxy_exhausted when proxy provider is not configured on client', () => {
    const client = new MockAuthClient();
    expect(() => client.resolveProxy('user1')).toThrow(PlatformError);
    try {
      client.resolveProxy('user1');
    } catch (err) {
      expect(err.type).toBe('proxy_exhausted');
      expect(err.code).toBe('XACT_5030');
      expect(err.retryAfterMs).toBe(30_000);
    }
  });

  test('should return sticky proxy for authenticated client with accountId', () => {
    const client = new MockAuthClient({ proxyPool, accountPool, governor });
    const p1 = client.resolveProxy('acc_1');
    const p2 = client.resolveProxy('acc_1');

    expect(p1).toBeDefined();
    expect(p1.host).toBe(p2.host);
  });

  test('should fallback to round-robin when authenticated client does not provide accountId', () => {
    const client = new MockAuthClient({ proxyPool, accountPool, governor });
    const p1 = client.resolveProxy();
    const p2 = client.resolveProxy();

    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1.host).not.toBe(p2.host);
  });

  test('should return rotating proxy for no-auth client regardless of accountId', () => {
    const client = new MockNoAuthClient({ proxyPool, accountPool, governor });
    const p1 = client.resolveProxy('acc_1');
    const p2 = client.resolveProxy('acc_1');

    expect(p1.host).not.toBe(p2.host);
  });

  test('should throw proxy_exhausted PlatformError when pool is exhausted', () => {
    const emptyPool = new ProxyIpPool();
    const client = new MockNoAuthClient({ proxyPool: emptyPool, accountPool, governor });

    expect(() => client.resolveProxy()).toThrow(PlatformError);
    try {
      client.resolveProxy();
    } catch (err) {
      expect(err.type).toBe('proxy_exhausted');
      expect(err.retryAfterMs).toBe(30_000);
    }
  });

  test('should hibernate the account when auth client proxy pool is exhausted', () => {
    const emptyPool = new ProxyIpPool();
    accountPool.registerAccounts('twitter', ['exhausted_acc']);
    const client = new MockAuthClient({ proxyPool: emptyPool, accountPool, governor });

    expect(() => client.resolveProxy('exhausted_acc')).toThrow(PlatformError);
    expect(accountPool.getNextAvailable('twitter')).toBeNull();
  });

  test('resolveProxy uses effective requiresAuth instead of instance default', () => {
    const client = new MockNoAuthClient({ proxyPool, accountPool, governor });

    // Platform default is no-auth, but an action declares requiresAuth=true with account
    const p1 = client.resolveProxy('acc_1', false, true);
    const p2 = client.resolveProxy('acc_1', false, true);
    expect(p1.host).toBe(p2.host);

    // Conversely, auth platform with requiresAuth=false and no account should rotate
    const authClient = new MockAuthClient({ proxyPool, accountPool, governor });
    const r1 = authClient.resolveProxy(null, false, false);
    const r2 = authClient.resolveProxy(null, false, false);
    expect(r1.host).not.toBe(r2.host);
  });
});
