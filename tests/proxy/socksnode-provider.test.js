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
  });

  describe('Geo-Targeting & Session Parameter Formatting (AC-2)', () => {
    it('[P0] should format username with country and city targeting', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        city: 'hanoi',
        sessionId: 'sess01',
      });

      expect(proxy.username).toContain('testuser');
      expect(proxy.username).toContain('-country-vn');
      expect(proxy.username).toContain('-city-hanoi');
      expect(proxy.username).toContain('-session-sess01');
      expect(proxy.server).toBe('socks5://gate.socksnode.com:1080');
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
      expect(proxy1.username).toContain('-session-');
    });

    it('[P1] should include lifetime or session duration in username when provided', async () => {
      const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');

      const provider = new DynamicTunnelProvider({
        gatewayUrl: 'socks5://testuser:testpass@gate.socksnode.com:1080',
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({
        country: 'vn',
        lifetime: '15',
      });

      expect(proxy.username).toContain('-lifetime-15');
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
        username: expect.stringContaining('-country-vn'),
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
