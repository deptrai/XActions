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

describe('Story 11.2 - Static & Dynamic Residential Tunnel Proxy Providers', () => {
  describe('AC-1: StaticProxyProvider Implementation & Unified Contract', () => {
    test('should instantiate with a list of proxy strings and wrap an internal ProxyIpPool', () => {
      const provider = new StaticProxyProvider({
        proxies: [
          'http://proxy1.example.com:8080',
          'http://proxy2.example.com:8080',
        ],
      });

      expect(provider.name).toBe('static');
      expect(provider.totalCount).toBe(2);
      expect(provider.healthyCount).toBe(2);
      expect(provider.isAllQuarantined()).toBe(false);
    });

    test('should accept an existing ProxyIpPool instance in options', () => {
      const pool = new ProxyIpPool({
        proxies: ['http://pool-proxy.example.com:8080'],
      });
      const provider = new StaticProxyProvider({ pool });

      expect(provider.totalCount).toBe(1);
      expect(provider.getNext().host).toBe('pool-proxy.example.com');
    });

    test('should return sticky proxy for accountId and round-robin when accountId is omitted', () => {
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

    test('should provide getStickyProxy, getNext, and quarantine methods adhering to contract', () => {
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

    test('should generate Playwright proxy config, agents, and browser launch args', () => {
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
    test('should parse gateway URL and auto-detect provider presets from hostname', () => {
      const brightdata = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@brd.superproxy.io:22225',
      });
      expect(brightdata.provider).toBe('brightdata');
      expect(brightdata.name).toBe('dynamic');

      const smartproxy = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@gate.smartproxy.com:7000',
      });
      expect(smartproxy.provider).toBe('smartproxy');

      const decodo = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@gate.decodo.com:7000',
      });
      expect(decodo.provider).toBe('smartproxy');

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
        template: '{username}',
      });
      expect(custom.provider).toBe('custom');
    });

    test('should reject unrelated hosts that only contain provider substrings', () => {
      const notBright = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@notsuperproxy.io:8080',
        template: '{username}',
      });
      expect(notBright.provider).toBe('custom');

      const notRoyal = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@someiproyal.com:8080',
        template: '{username}',
      });
      expect(notRoyal.provider).toBe('custom');
    });

    test('should allow explicit provider override regardless of gateway hostname', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@custom-domain.com:8080',
        provider: 'brightdata',
      });
      expect(provider.provider).toBe('brightdata');
    });

    test('should throw PlatformError XACT_4001 on missing, invalid, or unsupported gatewayUrl', () => {
      expect(() => new DynamicTunnelProvider({})).toThrow(PlatformError);
      expect(() => new DynamicTunnelProvider({ gatewayUrl: '' })).toThrow(PlatformError);
      expect(() => new DynamicTunnelProvider({ gatewayUrl: 'invalid://url' })).toThrow(PlatformError);
    });

    test('should throw PlatformError XACT_4001 for invalid provider preset', () => {
      expect(() => new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@example.com:8080',
        provider: 'notreal',
      })).toThrow(PlatformError);
    });

    test('should throw PlatformError XACT_4001 for custom preset without explicit template', () => {
      expect(() => new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@custom.com:8080',
        provider: 'custom',
      })).toThrow(PlatformError);

      expect(() => new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@unknown-proxy.com:8080',
      })).toThrow(PlatformError);
    });
  });

  describe('AC-3: Per-Request Residential IP Rotation', () => {
    test('should generate unique per-request session tag and credentials on each getProxy() call', () => {
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

    test('should generate provider-compatible random session IDs per request', () => {
      const brightdata = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@brd.superproxy.io:22225',
        provider: 'brightdata',
        rotatePerRequest: true,
      });
      const bd = brightdata.getProxy();
      const bdSid = bd.username.match(/session-([a-z0-9]+)$/)?.[1];
      expect(bdSid).toMatch(/^[a-z0-9]{20}$/);

      const iproyal = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
        rotatePerRequest: true,
      });
      const ipr = iproyal.getProxy();
      const iprSid = ipr.password.match(/session-([a-z0-9]{8})/)?.[1];
      expect(iprSid).toMatch(/^[a-z0-9]{8}$/);

      const kuaidaili = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@tps.kdlapi.com:15818',
        provider: 'kuaidaili',
        rotatePerRequest: true,
      });
      const kdl = kuaidaili.getProxy();
      const kdlSid = kdl.password.match(/:([a-z0-9]{1,6})$/)?.[1];
      expect(kdlSid).toMatch(/^[a-z0-9]{1,6}$/);
    });

    test('should maintain static session when rotatePerRequest is false and accountId is omitted', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        rotatePerRequest: false,
      });

      const p1 = provider.getProxy();
      const p2 = provider.getProxy();
      expect(p1.username).toBe(p2.username);
    });

    test('should provide getNext() as an alias for per-request rotation', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@brd.superproxy.io:22225',
      });

      const p1 = provider.getNext();
      const p2 = provider.getNext();
      expect(p1.username).not.toBe(p2.username);
    });

    test('should safely handle null options passed to getProxy', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@brd.superproxy.io:22225',
      });

      expect(() => provider.getProxy(null)).not.toThrow();
    });
  });

  describe('AC-4: Sticky Residential Session per Account & Expiration Lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('should maintain deterministic session credentials for the same accountId within session window', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
        sessionDurationMs: 600000, // 10 mins
      });

      const p1 = provider.getProxy({ accountId: 'acc_target' });
      const p2 = provider.getProxy({ accountId: 'acc_target' });

      expect(p1.username).toBe(p2.username);
      expect(p1.server).toBe(p2.server);
    });

    test('should automatically roll over to a new session tag when sessionDurationMs elapses', () => {
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

    test('should immediately invalidate session tag on rotateSession(accountId) or quarantine(proxy)', () => {
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

    test('should support clearAccount and reset for cache cleanup', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://myuser:mypass@gate.smartproxy.com:7000',
      });

      provider.getProxy({ accountId: 'acc_cleanup' });
      expect(provider.healthyCount).toBe(2);

      provider.clearAccount('acc_cleanup');
      expect(provider.healthyCount).toBe(1);

      provider.reset();
      expect(provider.healthyCount).toBe(1);
      expect(provider.isAllQuarantined()).toBe(false);
    });

    test('should reject non-positive sessionDurationMs values', () => {
      expect(() => new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@brd.superproxy.io:22225',
        sessionDurationMs: 0,
      })).toThrow(PlatformError);

      expect(() => new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@brd.superproxy.io:22225',
        sessionDurationMs: -1,
      })).toThrow(PlatformError);
    });
  });

  describe('AC-5: Geo-Targeting Formatting Presets & Custom Template', () => {
    test('should format BrightData username with country, city, state, zip, asn, session and const', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://lum_user:lum_pass@brd.superproxy.io:22225',
        provider: 'brightdata',
      });

      const proxy = provider.getProxy({
        country: 'US',
        city: 'New York',
        state: 'CA',
        zip: '94105',
        asn: '1234',
        sessionId: 'sess123',
        const: true,
      });

      expect(proxy.username).toBe('user-lum_user-country-us-state-ca-city-newyork-zip-94105-asn-1234-session-sess123-const');
    });

    test('should avoid duplicate user- prefix if baseUser already has user-, brd-, or lum-', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://brd-customer-123-zone-res:pass@brd.superproxy.io:22225',
        provider: 'brightdata',
      });

      const proxy = provider.getProxy({ sessionId: 's1' });
      expect(proxy.username).toBe('brd-customer-123-zone-res-session-s1');
    });

    test('should format Smartproxy / Decodo username with underscore delimited tags', () => {
      const sp = new DynamicTunnelProvider({
        gatewayUrl: 'http://sp_user:sp_pass@gate.smartproxy.com:7000',
        provider: 'smartproxy',
      });

      const spProxy = sp.getProxy({
        country: 'gb',
        city: 'london',
        sessionId: 'sess456',
        sessionduration: 30,
      });
      expect(spProxy.username).toBe('user-sp_user_country-gb_city-london_session-sess456_sessionduration-30');
    });

    test('should format IPRoyal by appending geo/session tags to the password', () => {
      const ipr = new DynamicTunnelProvider({
        gatewayUrl: 'http://ipr_user:ipr_pass@geo.iproyal.com:12321',
        provider: 'iproyal',
      });

      const iprProxy = ipr.getProxy({
        country: 'br',
        city: 'sao paulo',
        state: 'sp',
        region: 'southeast',
        isp: 'tim',
        sessionId: 'sgn34f3e',
        lifetime: '10m',
      });

      expect(iprProxy.username).toBe('ipr_user');
      expect(iprProxy.password).toBe('ipr_pass_country-br_city-saopaulo_state-sp_region-southeast_isp-tim_session-sgn34f3e_lifetime-10m');
    });

    test('should format Kuaidaili Normal tunnel by appending :sid to the password', () => {
      const kdl = new DynamicTunnelProvider({
        gatewayUrl: 'http://t18725652473456:jkr369ry@tps.kdlapi.com:15818',
        provider: 'kuaidaili',
        kuaidailiMode: 'normal',
      });

      const proxy = kdl.getProxy({ sid: 'abc' });
      expect(proxy.username).toBe('t18725652473456');
      expect(proxy.password).toBe('jkr369ry:abc');
    });

    test('should format Kuaidaili Pro tunnel with period, sid and city in username', () => {
      const kdl = new DynamicTunnelProvider({
        gatewayUrl: 'http://t2964279696:jkr369ry@tps.kdlapi.com:15818',
        provider: 'kuaidaili',
        kuaidailiMode: 'pro',
      });

      const proxy = kdl.getProxy({
        period: 0.5,
        sid: 's01',
        city: 'hn',
      });

      expect(proxy.username).toBe('t2964279696-period-0.5-sid-s01-city-hn');
      expect(proxy.password).toBe('jkr369ry');
    });

    test('should render custom template pattern string accurately with replaceAll', () => {
      const custom = new DynamicTunnelProvider({
        gatewayUrl: 'http://baseuser:basepass@custom.proxy:8080',
        provider: 'custom',
        template: '{username}:country={country}:session={sessionId}:s={sessionId}',
      });

      const proxy = custom.getProxy({
        country: 'vn',
        sessionId: 'sessVN',
      });

      expect(proxy.username).toBe('baseuser:country=vn:session=sessVN:s=sessVN');
    });

    test('should cleanly omit optional geo segments without creating dangling delimiters', () => {
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
    test('should instantiate DynamicTunnelProvider when type is dynamic or gatewayUrl is provided', () => {
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

    test('should instantiate StaticProxyProvider when type is static or proxies list is provided', () => {
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

    test('should support custom dynamic provider with an explicit template', () => {
      const p = createProxyProvider({
        gatewayUrl: 'http://user:pass@custom.com:8080',
        provider: 'custom',
        template: '{username}',
      });
      expect(p).toBeInstanceOf(DynamicTunnelProvider);
      expect(p.provider).toBe('custom');
    });

    test('should prioritize explicit type when both gatewayUrl and proxies are provided', () => {
      const p1 = createProxyProvider({
        type: 'static',
        gatewayUrl: 'http://user:pass@gate.smartproxy.com:7000',
        proxies: ['http://proxy1.example.com:8080'],
      });
      expect(p1).toBeInstanceOf(StaticProxyProvider);
    });

    test('should throw PlatformError XACT_4001 on ambiguous or unknown provider configuration', () => {
      expect(() => createProxyProvider({ type: 'unknown' })).toThrow(PlatformError);
      expect(() => createProxyProvider(null)).toThrow(PlatformError);
      expect(() => createProxyProvider({})).toThrow(PlatformError);
      expect(() => createProxyProvider({
        gatewayUrl: 'http://user:pass@gate.smartproxy.com:7000',
        proxies: ['http://proxy1.example.com:8080'],
      })).toThrow(PlatformError);
    });
  });

  describe('AC-7: Anti-Leak Browser & Protocol Compatibility', () => {
    test('should create valid undici ProxyAgent / Socks5ProxyAgent and anti-leak Chromium flags including DNS rules', () => {
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
      expect(browserArgs).toContain('--disable-features=WebRtcHideLocalIpsWithMdns');
      expect(browserArgs).toContain('--proxy-server=socks5://geo.iproyal.com:12321');
      expect(browserArgs).toContain(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${socksProxy.host}`);
    });

    test('should bracket IPv6 proxy hosts in browser args', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://user:pass@[2001:db8::1]:8080',
        provider: 'brightdata',
      });
      const proxy = provider.getProxy();
      const args = provider.getBrowserArgs(proxy);
      expect(args).toContain('--proxy-server=http://[2001:db8::1]:8080');
      expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE [2001:db8::1]');
    });
  });

  describe('Story 11.2 review patches: session limits and health tracking', () => {
    test('should respect valid user-supplied session IDs and regenerate invalid ones', () => {
      const brightdata = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@brd.superproxy.io:22225',
        provider: 'brightdata',
      });
      // BrightData: underscores are not allowed; provider should regenerate.
      const bd = brightdata.getProxy({ sessionId: 'bad_sid' });
      const bdSid = bd.username.match(/session-([a-z0-9]+)$/)?.[1];
      expect(bdSid).not.toBe('bad_sid');
      expect(bdSid).toMatch(/^[a-z0-9]{20}$/);

      const smartproxy = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@gate.smartproxy.com:7000',
        provider: 'smartproxy',
      });
      // Smartproxy: underscores are allowed.
      const sp = smartproxy.getProxy({ sessionId: 'my_sid_123' });
      expect(sp.username).toContain('session-my_sid_123');

      const iproyal = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
      });
      // IPRoyal: session IDs must be exactly 8 chars.
      const ipr = iproyal.getProxy({ sessionId: 'short' });
      const iprSid = ipr.password.match(/session-([a-z0-9]{8})/)?.[1];
      expect(iprSid).not.toBe('short');
      expect(iprSid).toMatch(/^[a-z0-9]{8}$/);

      // Kuaidaili: session IDs must be <= 6 chars.
      const kuaidaili = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@tps.kdlapi.com:15818',
        provider: 'kuaidaili',
      });
      const kdl = kuaidaili.getProxy({ sessionId: 'toolong' });
      const kdlSid = kdl.password.match(/:([a-z0-9]{1,6})$/)?.[1];
      expect(kdlSid).toMatch(/^[a-z0-9]{1,6}$/);
    });

    test('should track healthyCount, totalCount and isAllQuarantined through quarantine lifecycle', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
        rotatePerRequest: true,
      });

      expect(provider.totalCount).toBe(1);
      expect(provider.healthyCount).toBe(1);
      expect(provider.isAllQuarantined()).toBe(false);

      const proxy = provider.getProxy();
      provider.quarantine(proxy);

      expect(provider.healthyCount).toBe(0);
      expect(provider.isAllQuarantined()).toBe(true);
    });

    test('should throw proxy_exhausted with retryAfterMs when all sessions are quarantined', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
        rotatePerRequest: true,
        standbyBackoffMs: 15000,
      });

      provider.quarantine(provider.getProxy());

      let err;
      try {
        provider.getProxy();
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(PlatformError);
      expect(err.code).toBe('XACT_5030');
      expect(err.type).toBe('proxy_exhausted');
      expect(err.retryAfterMs).toBe(15000);
    });

    test('should quarantine only the resolved account session and allow others to remain healthy', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@gate.smartproxy.com:7000',
        provider: 'smartproxy',
      });

      const p1 = provider.getProxy({ accountId: 'acc1' });
      const p2 = provider.getProxy({ accountId: 'acc2' });

      expect(provider.healthyCount).toBe(3); // two accounts + gateway

      provider.quarantine(p1);

      expect(provider.healthyCount).toBe(2); // one account quarantined, gateway healthy
      expect(provider.isAllQuarantined()).toBe(false);

      const p1Next = provider.getProxy({ accountId: 'acc1' });
      expect(p1Next.username).not.toBe(p1.username);
      expect(provider.healthyCount).toBe(3);

      const p2Again = provider.getProxy({ accountId: 'acc2' });
      expect(p2Again.username).toBe(p2.username);
    });

    test('should reject invalid quarantine duration values', () => {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
      });
      const proxy = provider.getProxy();

      expect(() => provider.quarantine(proxy, 0)).toThrow(PlatformError);
      expect(() => provider.quarantine(proxy, -1000)).toThrow(PlatformError);
    });

    test('should prune expired quarantines and restore healthy sessions', () => {
      vi.useFakeTimers();
      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://u:p@geo.iproyal.com:12321',
        provider: 'iproyal',
        rotatePerRequest: true,
      });

      provider.quarantine(provider.getProxy(), 100);
      expect(provider.isAllQuarantined()).toBe(true);

      vi.advanceTimersByTime(150);
      expect(provider.isAllQuarantined()).toBe(false);
      expect(provider.getProxy()).toBeDefined();

      vi.useRealTimers();
    });
  });
});
