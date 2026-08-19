// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StaticProxyProvider,
  DynamicTunnelProvider,
  createProxyProvider,
  parseProxyUrl,
  normalizeProxy,
  getProxyAgent,
} from '../../src/proxy/providers.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';

describe('Story 11.2 - Static & Dynamic Residential Tunnel Proxy Providers (ATDD Red Phase)', () => {
  describe('AC-1: StaticProxyProvider Implementation & Unified Contract', () => {
    test.skip('should instantiate with a list of proxy strings and wrap an internal ProxyIpPool', () => {
      const provider = new StaticProxyProvider({
        proxies: [
          'http://proxy1.example.com:8080',
          'http://proxy2.example.com:8080',
        ],
      });

      expect(provider.totalCount).toBe(2);
      expect(provider.healthyCount).toBe(2);
      expect(provider.isAllQuarantined()).toBe(false);
    });

    test.skip('should accept an existing ProxyIpPool instance in options', () => {
      const pool = new ProxyIpPool({
        proxies: ['http://pool-proxy.example.com:8080'],
      });
      const provider = new StaticProxyProvider({ pool });

      expect(provider.totalCount).toBe(1);
      expect(provider.getNext().host).toBe('pool-proxy.example.com');
    });

    test.skip('should return sticky proxy for accountId and round-robin when accountId is omitted', () => {
      const provider = new StaticProxyProvider({
        proxies: [
          'http://proxy1.example.com:8080',
          'http://proxy2.example.com:8080',
        ],
      });

      const p1 = provider.getProxy({ accountId: 'acc_1' });
      const p2 = provider.getProxy({ accountId: 'acc_1' });
      expect(p1.server).toBe(p2.server);

      const rr1 = provider.getProxy();
      const rr2 = provider.getProxy();
      expect(rr1.server).not.toBe(rr2.server);
    });

    test.skip('should provide getStickyProxy, getNext, and quarantine methods adhering to contract', () => {
      const provider = new StaticProxyProvider({
        proxies: ['http://proxy1.example.com:8080'],
      });

      const sticky = provider.getStickyProxy('acc_x');
      expect(sticky.host).toBe('proxy1.example.com');

      const next = provider.getNext();
      expect(next.host).toBe('proxy1.example.com');

      provider.quarantine(sticky, 5000);
      expect(provider.healthyCount).toBe(0);
      expect(provider.isAllQuarantined()).toBe(true);
    });

    test.skip('should generate Playwright proxy config, agents, and browser launch args', () => {
      const provider = new StaticProxyProvider({
        proxies: ['http://user:pass@proxy1.example.com:8080'],
      });

      const proxy = provider.getNext();
      const pwConfig = provider.toPlaywrightProxy(proxy);
      expect(pwConfig).toEqual({
        server: 'http://proxy1.example.com:8080',
        username: 'user',
        password: 'pass',
      });

      const browserArgs = provider.getBrowserArgs(proxy);
      expect(browserArgs).toContain('--proxy-server=http://proxy1.example.com:8080');
      expect(browserArgs).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');

      const agent = provider.getProxyAgent(proxy);
      expect(agent).toBeInstanceOf(ProxyAgent);
    });
  });

  describe('AC-2: DynamicTunnelProvider Gateway Parsing & Auto-Detection', () => {
    test.skip('should parse gateway URL and auto-detect provider presets from hostname', () => {
      const brightdata = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@brd.superproxy.io:22225',
      });
      expect(brightdata.provider).toBe('brightdata');

      const smartproxy = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@gate.smartproxy.com:7000',
      });
      expect(smartproxy.provider).toBe('smartproxy');

      const iproyal = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://user:pass@geo.iproyal.com:12321',
      });
      expect(iproyal.provider).toBe('iproyal');

      const kuaidaili = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@open.kdlapi.com:10000',
      });
      expect(kuaidaili.provider).toBe('kuaidaili');

      const custom = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@unknown-proxy.com:8080',
      });
      expect(custom.provider).toBe('custom');
    });

    test.skip('should allow explicit provider override regardless of gateway hostname', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@custom-domain.com:8080',
        provider: 'brightdata',
      });
      expect(provider.provider).toBe('brightdata');
    });

    test.skip('should throw PlatformError XACT_4001 on missing or invalid gatewayUrl', () => {
      expect(() => new DynamicTunnelProvider({})).toThrow(PlatformError);
      expect(() => new DynamicTunnelProvider({ gatewayUrl: '' })).toThrow(PlatformError);
      expect(() => new DynamicTunnelProvider({ gatewayUrl: 'invalid://url' })).toThrow(PlatformError);
    });
  });

  describe('AC-3: Per-Request Residential IP Rotation', () => {
    test.skip('should generate unique per-request session tag and credentials on each getProxy() call', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        rotatePerRequest: true,
      });

      const p1 = provider.getProxy();
      const p2 = provider.getProxy();

      expect(p1.host).toBe('gate.smartproxy.com');
      expect(p1.port).toBe(7000);
      expect(p1.username).toContain('myuser');
      expect(p1.username).toContain('session-');
      expect(p2.username).toContain('myuser');

      // Credentials must differ to force fresh residential exit IP
      expect(p1.username).not.toBe(p2.username);
    });

    test.skip('should provide getNext() as an alias for per-request rotation', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@brd.superproxy.io:22225',
      });

      const p1 = provider.getNext();
      const p2 = provider.getNext();
      expect(p1.username).not.toBe(p2.username);
    });
  });

  describe('AC-4: Sticky Residential Session per Account & Expiration Lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test.skip('should maintain deterministic session credentials for the same accountId within session window', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        sessionDurationMs: 600000, // 10 mins
      });

      const p1 = provider.getProxy({ accountId: 'acc_target' });
      const p2 = provider.getProxy({ accountId: 'acc_target' });

      expect(p1.username).toBe(p2.username);
      expect(p1.server).toBe(p2.server);
    });

    test.skip('should automatically roll over to a new session tag when sessionDurationMs elapses', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        sessionDurationMs: 600000,
      });

      const p1 = provider.getProxy({ accountId: 'acc_target' });

      // Advance time beyond session duration (10m + 1s)
      vi.advanceTimersByTime(600001);

      const p2 = provider.getProxy({ accountId: 'acc_target' });
      expect(p1.username).not.toBe(p2.username);
    });

    test.skip('should immediately invalidate session tag on rotateSession(accountId) or quarantine(proxy)', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        sessionDurationMs: 600000,
      });

      const p1 = provider.getProxy({ accountId: 'acc_target' });
      provider.rotateSession('acc_target');

      const p2 = provider.getProxy({ accountId: 'acc_target' });
      expect(p1.username).not.toBe(p2.username);

      provider.quarantine(p2);
      const p3 = provider.getProxy({ accountId: 'acc_target' });
      expect(p2.username).not.toBe(p3.username);
    });
  });

  describe('AC-5: Geo-Targeting Formatting Presets & Custom Template', () => {
    test.skip('should format BrightData username with country, city, and session correctly', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://lum_user:lum_pass@brd.superproxy.io:22225',
        provider: 'brightdata',
      });

      const proxy = provider.getProxy({
        country: 'us',
        city: 'newyork',
        sessionId: 'sess123',
      });

      expect(proxy.username).toBe('user-lum_user-country-us-city-newyork-session-sess123');
    });

    test.skip('should format Smartproxy and IPRoyal with underscore delimited tags', () => {
      const sp = new DynamicTunnelProvider({
        gatewayUrl: 'http://sp_user:sp_pass@gate.smartproxy.com:7000',
        provider: 'smartproxy',
      });

      const spProxy = sp.getProxy({
        country: 'gb',
        sessionId: 'sess456',
      });
      expect(spProxy.username).toBe('user-sp_user_country-gb_session-sess456');

      const ipr = new DynamicTunnelProvider({
        gatewayUrl: 'http://ipr_user:ipr_pass@geo.iproyal.com:12321',
        provider: 'iproyal',
      });

      const iprProxy = ipr.getProxy({
        country: 'de',
        city: 'berlin',
        sessionId: 'sess789',
      });
      expect(iprProxy.username).toBe('user-ipr_user_country-de_city-berlin_session-sess789');
    });

    test.skip('should format Kuaidaili with user and session tags', () => {
      const kdl = new DynamicTunnelProvider({
        gatewayUrl: 'http://kdl_user:kdl_pass@open.kdlapi.com:10000',
        provider: 'kuaidaili',
      });

      const proxy = kdl.getProxy({ sessionId: 'sess999' });
      expect(proxy.username).toBe('user-kdl_user_session-sess999');
    });

    test.skip('should render custom template pattern string accurately', () => {
      const custom = new DynamicTunnelProvider({
        gatewayUrl: 'http://baseuser:basepass@custom.proxy:8080',
        provider: 'custom',
        template: '{username}:country={country}:session={sessionId}',
      });

      const proxy = custom.getProxy({
        country: 'vn',
        sessionId: 'sessVN',
      });

      expect(proxy.username).toBe('baseuser:country=vn:session=sessVN');
    });

    test.skip('should cleanly omit optional geo segments without creating dangling delimiters', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@brd.superproxy.io:22225',
        provider: 'brightdata',
      });

      const proxy = provider.getProxy({ sessionId: 'sess1' });
      expect(proxy.username).toBe('user-user-session-sess1');
      expect(proxy.username).not.toContain('country-');
      expect(proxy.username).not.toContain('city-');
      expect(proxy.username).not.toContain('--');
    });
  });

  describe('AC-6: Unified Provider Factory (createProxyProvider)', () => {
    test.skip('should instantiate DynamicTunnelProvider when type is dynamic or gatewayUrl is provided', () => {
      const p1 = createProxyProvider({
        type: 'dynamic',
        gatewayUrl: 'http://user:pass@gate.smartproxy.com:7000',
      });
      expect(p1).toBeInstanceOf(DynamicTunnelProvider);

      const p2 = createProxyProvider({
        gatewayUrl: 'http://user:pass@brd.superproxy.io:22225',
      });
      expect(p2).toBeInstanceOf(DynamicTunnelProvider);
    });

    test.skip('should instantiate StaticProxyProvider when type is static or proxies list is provided', () => {
      const p1 = createProxyProvider({
        type: 'static',
        proxies: ['http://proxy1.example.com:8080'],
      });
      expect(p1).toBeInstanceOf(StaticProxyProvider);

      const p2 = createProxyProvider({
        proxies: ['http://proxy1.example.com:8080'],
      });
      expect(p2).toBeInstanceOf(StaticProxyProvider);
    });

    test.skip('should throw PlatformError XACT_4001 on unknown provider type or invalid configuration', () => {
      expect(() => createProxyProvider({ type: 'unknown' })).toThrow(PlatformError);
      expect(() => createProxyProvider(null)).toThrow(PlatformError);
      expect(() => createProxyProvider({})).toThrow(PlatformError);
    });
  });

  describe('AC-7: Anti-Leak Browser & Protocol Compatibility', () => {
    test.skip('should create valid undici ProxyAgent / Socks5ProxyAgent and anti-leak Chromium flags', () => {
      const httpProvider = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@brd.superproxy.io:22225',
      });
      const httpProxy = httpProvider.getProxy();
      const httpAgent = httpProvider.getProxyAgent(httpProxy);
      expect(httpAgent).toBeInstanceOf(ProxyAgent);

      const socksProvider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://user:pass@geo.iproyal.com:12321',
      });
      const socksProxy = socksProvider.getProxy();
      const socksAgent = socksProvider.getProxyAgent(socksProxy);
      expect(socksAgent).toBeInstanceOf(Socks5ProxyAgent);

      const browserArgs = socksProvider.getBrowserArgs(socksProxy);
      expect(browserArgs).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      expect(browserArgs).toContain(`--proxy-server=${socksProxy.server}`);
    });
  });
});
