// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeEach } from 'vitest';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import * as undici from 'undici';

describe('ProxyIpPool Acceptance Tests (Story 11.1 - TDD Red Phase)', () => {
  let pool;

  beforeEach(() => {
    pool = new ProxyIpPool();
  });

  describe('AC-1: Proxy Input Normalization', () => {
    test('should normalize string URLs with auth to canonical object', () => {
      pool.add('http://user:pass@1.2.3.4:8080');
      const next = pool.getNext();
      expect(next).toEqual({
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass',
        server: 'http://1.2.3.4:8080',
      });
    });

    test('should support https and socks5 schemes in addition to http', () => {
      pool.add('https://secure.proxy.com:8443');
      pool.add('socks5://user:pass@socks.proxy.com:1080');
      
      expect(pool.totalCount).toBe(2);
      const p1 = pool.getNext();
      const p2 = pool.getNext();
      expect(p1.scheme).toBe('https');
      expect(p2.scheme).toBe('socks5');
    });

    test('should accept pre-normalized proxy objects', () => {
      pool.add({
        scheme: 'http',
        host: '10.0.0.1',
        port: 3128,
        username: 'u',
        password: 'p',
        server: 'http://10.0.0.1:3128',
      });
      const next = pool.getNext();
      expect(next.host).toBe('10.0.0.1');
      expect(next.port).toBe(3128);
    });

    test('should throw PlatformError XACT_4001 on invalid proxy strings', () => {
      expect(() => {
        pool.add('invalid-proxy-format');
      }).toThrowError();

      expect(() => {
        pool.add('ftp://unsupported.com:21');
      }).toThrowError(PlatformError);
    });
  });

  describe('AC-2: Anti-Leak Browser Configuration', () => {
    test('should return Chromium flags including WebRTC disable and proxy server', () => {
      const proxy = {
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
        server: 'http://1.2.3.4:8080',
      };
      const args = pool.getBrowserArgs(proxy);
      expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      expect(args).toContain('--proxy-server=http://1.2.3.4:8080');

      // Test string URL support
      const strArgs = pool.getBrowserArgs('http://5.6.7.8:3128');
      expect(strArgs).toContain('--proxy-server=http://5.6.7.8:3128');
    });

    test('should provide toPlaywrightProxy helper with server, username, password', () => {
      const proxy = {
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
        username: 'user123',
        password: 'secret@pass',
        server: 'http://1.2.3.4:8080',
      };
      const pwProxy = pool.toPlaywrightProxy ? pool.toPlaywrightProxy(proxy) : ProxyIpPool.toPlaywrightProxy(proxy);
      expect(pwProxy).toEqual({
        server: 'http://1.2.3.4:8080',
        username: 'user123',
        password: 'secret@pass',
      });
    });
  });

  describe('AC-3: Sticky Proxy per Account', () => {
    beforeEach(() => {
      pool.add('http://1.1.1.1:8080');
      pool.add('http://2.2.2.2:8080');
      pool.add('http://3.3.3.3:8080');
    });

    test('should return the same proxy for repeated calls with same accountId', () => {
      const p1 = pool.getStickyProxy('account_abc');
      const p2 = pool.getStickyProxy('account_abc');
      const p3 = pool.getStickyProxy('account_abc');
      expect(p1).toBeDefined();
      expect(p1).toEqual(p2);
      expect(p2).toEqual(p3);
    });

    test('should select proxy deterministically across fresh pool instances', () => {
      const pool2 = new ProxyIpPool({
        proxies: ['http://1.1.1.1:8080', 'http://2.2.2.2:8080', 'http://3.3.3.3:8080'],
      });
      const selected1 = pool.getStickyProxy('deterministic_user_123');
      const selected2 = pool2.getStickyProxy('deterministic_user_123');
      expect(selected1.host).toEqual(selected2.host);
    });

    test('should rebind to a new healthy proxy when assigned proxy is quarantined', () => {
      const initialProxy = pool.getStickyProxy('acc_rebind');
      expect(initialProxy).toBeDefined();

      pool.quarantine(initialProxy, 60000);
      const newProxy = pool.getStickyProxy('acc_rebind');
      expect(newProxy).toBeDefined();
      expect(newProxy.host).not.toEqual(initialProxy.host);
    });
  });

  describe('AC-4: Round-Robin Proxy for No-Auth Platforms', () => {
    beforeEach(() => {
      pool.add('http://10.0.0.1:8080');
      pool.add('http://10.0.0.2:8080');
      pool.add('http://10.0.0.3:8080');
    });

    test('should rotate healthy proxies in round-robin order', () => {
      const p1 = pool.getNext();
      const p2 = pool.getNext();
      const p3 = pool.getNext();
      const p4 = pool.getNext();

      expect(p1.host).toBe('10.0.0.1');
      expect(p2.host).toBe('10.0.0.2');
      expect(p3.host).toBe('10.0.0.3');
      expect(p4.host).toBe('10.0.0.1'); // Wrapped around
    });

    test('should skip quarantined proxies during round-robin', () => {
      pool.quarantine('http://10.0.0.2:8080');
      const p1 = pool.getNext();
      const p2 = pool.getNext();
      const p3 = pool.getNext();

      expect(p1.host).toBe('10.0.0.1');
      expect(p2.host).toBe('10.0.0.3');
      expect(p3.host).toBe('10.0.0.1');
    });

    test('should return null when all proxies are quarantined or pool is empty', () => {
      const emptyPool = new ProxyIpPool();
      expect(emptyPool.getNext()).toBeNull();

      pool.quarantine('http://10.0.0.1:8080');
      pool.quarantine('http://10.0.0.2:8080');
      pool.quarantine('http://10.0.0.3:8080');
      expect(pool.getNext()).toBeNull();
    });
  });

  describe('AC-5: Quarantine and Refresh Lifecycle', () => {
    beforeEach(() => {
      pool.add('http://192.168.1.1:8080');
      pool.add('http://192.168.1.2:8080');
    });

    test('should default to 5 minutes quarantine duration', () => {
      const p = pool.getNext();
      pool.quarantine(p);
      expect(pool.healthyCount).toBe(1);
    });

    test('should report isAllQuarantined accurately', () => {
      expect(pool.isAllQuarantined()).toBe(false);
      pool.quarantine('http://192.168.1.1:8080');
      expect(pool.isAllQuarantined()).toBe(false);
      pool.quarantine('http://192.168.1.2:8080');
      expect(pool.isAllQuarantined()).toBe(true);
    });

    test('should prune expired quarantines and restore proxy to pool', () => {
      pool.quarantine('http://192.168.1.1:8080', 50); // 50ms
      expect(pool.healthyCount).toBe(1);

      return new Promise((resolve) => {
        setTimeout(() => {
          pool.pruneExpiredQuarantines();
          expect(pool.healthyCount).toBe(2);
          resolve();
        }, 80);
      });
    });
  });

  describe('AC-6: Proxy Agent Factory', () => {
    test('should return undici.ProxyAgent for http/https proxies', () => {
      const proxy = {
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
        server: 'http://1.2.3.4:8080',
      };
      const agent = pool.getProxyAgent(proxy, { client: 'undici' });
      expect(agent).toBeDefined();
      expect(agent instanceof undici.ProxyAgent).toBe(true);
    });

    test('should return got-scraping proxyUrl string when client is got', () => {
      const proxy = {
        scheme: 'socks5',
        host: 'proxy.net',
        port: 1080,
        username: 'u',
        password: 'p',
        server: 'socks5://u:p@proxy.net:1080',
      };
      const proxyUrl = pool.getProxyAgent(proxy, { client: 'got' });
      expect(proxyUrl).toBe('socks5://u:p@proxy.net:1080');
    });

    test('should return SocksProxyAgent for socks5 proxies with undici client', () => {
      const proxy = {
        scheme: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        server: 'socks5://1.2.3.4:1080',
      };
      const agent = pool.getProxyAgent(proxy, { client: 'undici' });
      expect(agent).toBeDefined();
    });

    test('should never fall back to direct connection if proxy is invalid or null', () => {
      expect(() => pool.getProxyAgent(null, { client: 'undici' })).toThrow();
    });
  });

  describe('AC-10: Health and Total Counts', () => {
    test('should accurately reflect totalCount and healthyCount through lifecycle', () => {
      expect(pool.totalCount).toBe(0);
      expect(pool.healthyCount).toBe(0);

      pool.add('http://1.1.1.1:8080');
      pool.add('http://2.2.2.2:8080');
      expect(pool.totalCount).toBe(2);
      expect(pool.healthyCount).toBe(2);

      pool.quarantine('http://1.1.1.1:8080');
      expect(pool.totalCount).toBe(2);
      expect(pool.healthyCount).toBe(1);
    });
  });
});
