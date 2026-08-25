// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';

// Note: In ATDD Red Phase, tests are scaffolded with it.skip().
// Activate each test during dev-story implementation as features are built.

describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/proxy/socksnode-provider.test.js)', () => {
  describe('Preset Registration & Gateway Parsing (AC-1)', () => {
    it('[P0] should recognise socksnode provider and parse socks5 gateway URL', async () => {
      const { DynamicTunnelProvider, PROVIDER_PRESETS } = await import('../../src/proxy/providers.js');

      expect(PROVIDER_PRESETS.has('socksnode')).toBe(true);

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      expect(provider.provider).toBe('socksnode');
      expect(provider.scheme).toBe('socks5');
      expect(provider.host).toBe('gate.socksnode.com');
      expect(provider.port).toBe(1080);
      expect(provider.username).toBe('testuser');
      expect(provider.password).toBe('testpass');
    });

    it('[P0] should support http scheme gateway for socksnode', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://testuser:testpass@gate.socksnode.com:8080',
        provider: 'socksnode',
      });

      expect(provider.scheme).toBe('http');
      expect(provider.port).toBe(8080);
    });

    it('[P1] should enforce session ID length and character constraints', async () => {
      const { PROVIDER_SID_LIMITS } = await import('../../src/proxy/providers.js');

      expect(PROVIDER_SID_LIMITS.socksnode).toBeDefined();
      expect(PROVIDER_SID_LIMITS.socksnode.max).toBe(32);
      expect(PROVIDER_SID_LIMITS.socksnode.regex.test('valid_session-123')).toBe(true);
      expect(PROVIDER_SID_LIMITS.socksnode.regex.test('invalid space sid')).toBe(false);
    });

    it('[P1] should not auto-detect non-.com socksnode gateways without explicit provider', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://testuser:testpass@gate.socksnode.io:8080',
        provider: 'socksnode',
      });

      expect(provider.provider).toBe('socksnode');
    });

    it('[P1] should expose exported provider constants as read-only', async () => {
      const { PROVIDER_PRESETS, PROVIDER_SID_LIMITS } = await import('../../src/proxy/providers.js');

      expect(() => PROVIDER_PRESETS.add('evil')).toThrow();
      expect(() => PROVIDER_PRESETS.delete('socksnode')).toThrow();
      expect(() => PROVIDER_PRESETS.clear()).toThrow();

      expect(Object.isFrozen(PROVIDER_SID_LIMITS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_SID_LIMITS.socksnode)).toBe(true);
      expect(() => {
        PROVIDER_SID_LIMITS.socksnode.max = 1;
      }).toThrow();
    });

    it('[P1] should redact credentials when provider is JSON-serialized', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://testuser:testpass@gate.socksnode.com:8080',
        provider: 'socksnode',
      });

      const json = JSON.stringify(provider);
      expect(json).not.toContain('testpass');
      expect(json).not.toContain('testuser');
      expect(json).toContain('"scheme":"http"');
      expect(json).toContain('"host":"gate.socksnode.com"');
    });
  });

  describe('Geo-Targeting & Session Parameter Formatting (AC-2)', () => {
    it('[P0] should format username with country, state, city and session targeting', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        state: 'hanoi',
        city: 'badinh',
        sessionId: 'sess01',
      });

      expect(proxy.username).toBe('user-testuser-country-vn-state-hanoi-city-badinh-session-sess01-duration-600');
      expect(proxy.server).toBe('socks5://gate.socksnode.com:1080');
    });

    it('[P0] should append asn token when provided', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'us',
        asn: '12345',
      });

      expect(proxy.username).toMatch(/^user-testuser-country-us-asn-12345-session-[a-z0-9]{20}-duration-600$/);
    });

    it('[P0] should generate deterministic sticky session ID per accountId', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy1 = provider.getStickyProxy('account_fb_123');
      const proxy2 = provider.getStickyProxy('account_fb_123');
      const proxyOther = provider.getStickyProxy('account_tw_456');

      expect(proxy1.username).toBe(proxy2.username);
      expect(proxy1.username).not.toBe(proxyOther.username);
      expect(proxy1.username).toMatch(/^user-testuser-session-[a-z0-9]{20}-duration-600$/);
    });

    it('[P1] should include lifetime token as a literal string', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        lifetime: '15',
      });

      expect(proxy.username).toMatch(/^user-testuser-country-vn-session-[a-z0-9]{20}-lifetime-15$/);
    });

    it('[P1] should convert sessionduration minutes to duration seconds', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        sessionduration: 10,
      });

      expect(proxy.username).toMatch(/^user-testuser-country-vn-session-[a-z0-9]{20}-duration-600$/);
    });

    it('[P1] should prefer lifetime over sessionduration when both are provided', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        lifetime: '30',
        sessionduration: 5,
      });

      expect(proxy.username).toMatch(/^user-testuser-country-vn-session-[a-z0-9]{20}-lifetime-30$/);
    });

    it('[P1] should not produce dangling delimiters or empty tokens', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getNext();

      expect(proxy.username).not.toMatch(/--/);
      expect(proxy.username).not.toMatch(/-$/);
    });
  });

  describe('Multi-Protocol Proxy Agent Integration (AC-3)', () => {
    it('[P0] should return Socks5ProxyAgent for socks5 scheme proxy', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getNext();
      const agent = provider.getProxyAgent(proxy);

      expect(agent).toBeDefined();
    });

    it('[P0] should return ProxyAgent for http scheme proxy', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'http://testuser:testpass@gate.socksnode.com:8080',
        provider: 'socksnode',
      });

      const proxy = provider.getNext();
      const agent = provider.getProxyAgent(proxy);

      expect(agent).toBeDefined();
    });
  });

  describe('Playwright & Browser Launch Arguments (AC-4)', () => {
    it('[P0] should convert to Playwright proxy configuration object', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({ country: 'vn' });
      const pwProxy = provider.toPlaywrightProxy(proxy);

      expect(pwProxy).toEqual({
        server: 'socks5://gate.socksnode.com:1080',
        username: expect.stringMatching(/^user-testuser-country-vn-session-[a-z0-9]{20}-duration-600$/),
        password: 'testpass',
      });
    });

    it('[P1] should generate browser launch flags with WebRTC policy', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getNext();
      const args = provider.getBrowserArgs(proxy);

      expect(args).toContain('--proxy-server=socks5://gate.socksnode.com:1080');
      expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    });
  });

  describe('ProxyIpPool Integration & Quarantine (AC-5)', () => {
    it('[P0] should integrate seamlessly with ProxyIpPool', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
      const { ProxyIpPool } = await import('../../src/proxy/proxy-pool.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const pool = new ProxyIpPool({
        providers: [provider],
      });

      const proxy = pool.getNext();
      expect(proxy).toBeDefined();

      const stickyProxy = pool.getStickyProxy('acc_01');
      expect(stickyProxy).toBeDefined();
    });

    it('[P1] should quarantine failed proxy and report pool status', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      expect(provider.healthyCount).toBe(1);
      expect(provider.isAllQuarantined()).toBe(false);

      const proxy = provider.getNext();
      provider.quarantine(proxy, 1000);

      // Quarantining a single per-request proxy session doesn't block the full gateway
      expect(provider.healthyCount).toBe(1);

      // Quarantining the raw gateway blocks the provider
      provider.quarantine(provider.rawGateway, 1000);
      expect(provider.healthyCount).toBe(0);
      expect(provider.isAllQuarantined()).toBe(true);
    });
  });
});
