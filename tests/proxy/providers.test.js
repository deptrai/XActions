// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import {
  parseProxyUrl,
  normalizeProxy,
  formatProxyUrl,
  getProxyAgent,
  SUPPORTED_PROXY_SCHEMES,
} from '../../src/proxy/providers.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import { ProxyAgent, Socks5ProxyAgent } from 'undici';

describe('Proxy Providers & Normalization Unit Tests', () => {
  describe('SUPPORTED_PROXY_SCHEMES', () => {
    test('should include http, https, and socks5', () => {
      expect(SUPPORTED_PROXY_SCHEMES).toEqual(['http', 'https', 'socks5']);
    });
  });

  describe('parseProxyUrl', () => {
    test('should parse standard http proxy URL', () => {
      const parsed = parseProxyUrl('http://proxy.example.com:8080');
      expect(parsed).toEqual({
        scheme: 'http',
        host: 'proxy.example.com',
        port: 8080,
        server: 'http://proxy.example.com:8080',
      });
    });

    test('should parse https and socks5 URLs with default ports when omitted', () => {
      const httpNoPort = parseProxyUrl('http://proxy.com');
      expect(httpNoPort.port).toBe(80);

      const httpsNoPort = parseProxyUrl('https://proxy.com');
      expect(httpsNoPort.port).toBe(443);

      const socks5NoPort = parseProxyUrl('socks5://proxy.com');
      expect(socks5NoPort.port).toBe(1080);
    });

    test('should parse authenticated proxy URLs with special characters', () => {
      const parsed = parseProxyUrl('http://myuser%40test.com:my%3Apass@10.0.0.1:3128');
      expect(parsed.username).toBe('myuser@test.com');
      expect(parsed.password).toBe('my:pass');
      expect(parsed.host).toBe('10.0.0.1');
      expect(parsed.port).toBe(3128);
    });

    test('should gracefully handle malformed percent encoding in credentials without crashing', () => {
      const parsed = parseProxyUrl('http://user%ZZ:pass%YY@10.0.0.1:8080');
      expect(parsed.username).toBe('user%ZZ');
      expect(parsed.password).toBe('pass%YY');
      expect(parsed.host).toBe('10.0.0.1');
    });

    test('should throw PlatformError XACT_4001 on empty or non-string input', () => {
      expect(() => parseProxyUrl('')).toThrow(PlatformError);
      expect(() => parseProxyUrl(null)).toThrow(PlatformError);
      expect(() => parseProxyUrl(12345)).toThrow(PlatformError);
    });

    test('should throw PlatformError XACT_4001 on malformed URL format', () => {
      expect(() => parseProxyUrl('not_a_valid_url')).toThrow(PlatformError);
    });

    test('should throw PlatformError XACT_4001 on unsupported protocol scheme', () => {
      expect(() => parseProxyUrl('ftp://10.0.0.1:21')).toThrow(PlatformError);
      expect(() => parseProxyUrl('ws://10.0.0.1:8080')).toThrow(PlatformError);
    });

    test('should bracket IPv6 addresses in the canonical server string', () => {
      const parsed = parseProxyUrl('http://[2001:db8::1]:8080');
      expect(parsed.host).toBe('2001:db8::1');
      expect(parsed.server).toBe('http://[2001:db8::1]:8080');
    });
  });

  describe('normalizeProxy', () => {
    test('should normalize string URLs via parseProxyUrl', () => {
      const normalized = normalizeProxy('http://admin:secret@127.0.0.1:8888');
      expect(normalized.username).toBe('admin');
      expect(normalized.password).toBe('secret');
      expect(normalized.server).toBe('http://127.0.0.1:8888');
    });

    test('should accept and normalize structured proxy objects', () => {
      const normalized = normalizeProxy({
        scheme: 'SOCKS5',
        host: 'socks.provider.io',
        port: 1080,
        username: 'user',
        password: 'pwd',
      });
      expect(normalized.scheme).toBe('socks5');
      expect(normalized.host).toBe('socks.provider.io');
      expect(normalized.port).toBe(1080);
      expect(normalized.server).toBe('socks5://socks.provider.io:1080');
    });

    test('should handle string and NaN ports by falling back to default scheme port', () => {
      const normalized = normalizeProxy({
        host: 'proxy.org',
        scheme: 'https',
        port: 'NaN',
      });
      expect(normalized.port).toBe(443);
      expect(normalized.server).toBe('https://proxy.org:443');
    });

    test('should throw PlatformError when object is missing host', () => {
      expect(() => normalizeProxy({ scheme: 'http', port: 8080 })).toThrow(PlatformError);
    });

    test('should throw PlatformError on unsupported scheme in object', () => {
      expect(() => normalizeProxy({ scheme: 'gopher', host: 'proxy.com' })).toThrow(PlatformError);
    });

    test('should throw PlatformError on invalid object types', () => {
      expect(() => normalizeProxy(undefined)).toThrow(PlatformError);
      expect(() => normalizeProxy(true)).toThrow(PlatformError);
    });
  });

  describe('formatProxyUrl', () => {
    test('should format proxy without authentication', () => {
      const url = formatProxyUrl({
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
      });
      expect(url).toBe('http://1.2.3.4:8080');
    });

    test('should format proxy with username and password encoding', () => {
      const url = formatProxyUrl({
        scheme: 'http',
        host: 'proxy.net',
        port: 3128,
        username: 'user@name',
        password: 'pass:word',
      });
      expect(url).toBe('http://user%40name:pass%3Aword@proxy.net:3128');
    });

    test('should format IPv6 host addresses with brackets per RFC 3986', () => {
      const url = formatProxyUrl({
        scheme: 'http',
        host: '2001:db8::1',
        port: 8080,
      });
      expect(url).toBe('http://[2001:db8::1]:8080');
    });

    test('should avoid double-bracket wrapping on IPv6 host already containing brackets', () => {
      const url = formatProxyUrl({
        scheme: 'http',
        host: '[2001:db8::1]',
        port: 8080,
      });
      expect(url).toBe('http://[2001:db8::1]:8080');
    });

    test('should not emit an auth segment when the username is empty', () => {
      const url = formatProxyUrl({
        scheme: 'http',
        host: 'proxy.net',
        port: 3128,
        username: '',
        password: 'p@ss:word',
      });
      expect(url).toBe('http://proxy.net:3128');
    });
  });

  describe('getProxyAgent', () => {
    test('should create undici.ProxyAgent for HTTP and HTTPS proxies', () => {
      const httpAgent = getProxyAgent('http://1.1.1.1:8080', { client: 'undici' });
      expect(httpAgent).toBeInstanceOf(ProxyAgent);

      const httpsAgent = getProxyAgent('https://1.1.1.1:443', { client: 'undici' });
      expect(httpsAgent).toBeInstanceOf(ProxyAgent);
    });

    test('should create undici.Socks5ProxyAgent for SOCKS5 proxy when client is undici', () => {
      const socksAgent = getProxyAgent('socks5://user:pass@127.0.0.1:1080', { client: 'undici' });
      expect(socksAgent).toBeInstanceOf(Socks5ProxyAgent);
    });

    test('should throw PlatformError for invalid or empty proxy input', () => {
      expect(() => getProxyAgent(null)).toThrow(PlatformError);
      expect(() => getProxyAgent('')).toThrow(PlatformError);
      expect(() => getProxyAgent('not-a-proxy')).toThrow(PlatformError);
    });

    test('should return proxy URL string when client is got', () => {
      const proxyUrl = getProxyAgent('http://admin:pass@10.0.0.1:8080', { client: 'got' });
      expect(proxyUrl).toBe('http://admin:pass@10.0.0.1:8080');
    });

    test('should default client option to undici when options is omitted or null', () => {
      const agent = getProxyAgent('http://127.0.0.1:8080');
      expect(agent).toBeInstanceOf(ProxyAgent);

      const agentNullOpts = getProxyAgent('http://127.0.0.1:8080', null);
      expect(agentNullOpts).toBeInstanceOf(ProxyAgent);
    });

    test('should throw PlatformError on unsupported client type', () => {
      expect(() => getProxyAgent('http://127.0.0.1:8080', { client: 'unsupported_client' })).toThrow(PlatformError);
    });

    test('should throw PlatformError when proxy parameter is null or empty', () => {
      expect(() => getProxyAgent(null)).toThrow(PlatformError);
    });
  });
});
