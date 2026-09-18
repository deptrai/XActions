// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 40.1 — ProxyIpPool tier-aware selection.
 * Verifies getProxy/getNext filter by tier correctly.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';

describe('ProxyIpPool — Tier-Aware Selection (Story 40.1)', () => {
  let pool;

  beforeEach(() => {
    pool = new ProxyIpPool({
      proxies: [
        'http://dc1.example.com:8080',
        'http://dc2.example.com:8080',
        { host: 'res1.example.com', port: 8080, tier: 'residential' },
        { host: 'mob1.example.com', port: 8080, tier: 'mobile_4g' },
        { host: 'free1.example.com', port: 8080, tier: 'free' },
      ],
      validateOnAdd: true,
    });
  });

  test('normalizeProxy maps residential: true → tier residential', () => {
    const p = pool.getProxy({ tier: 'residential' });
    expect(p).toBeDefined();
    expect(p.tier).toBe('residential');
    expect(p.residential).toBe(true);
  });

  test('normalizeProxy maps residential: false/undefined → tier datacenter', () => {
    const p = pool.getProxy({ tier: 'datacenter' });
    expect(p).toBeDefined();
    expect(p.tier).toBe('datacenter');
  });

  test('getProxy({ tier: datacenter }) returns only datacenter proxies', () => {
    const p = pool.getProxy({ tier: 'datacenter' });
    expect(p.tier).toBe('datacenter');
    expect(['dc1.example.com', 'dc2.example.com']).toContain(p.host);
  });

  test('getProxy({ tier: residential }) returns only residential proxies', () => {
    const p = pool.getProxy({ tier: 'residential' });
    expect(p.tier).toBe('residential');
    expect(p.host).toBe('res1.example.com');
  });

  test('getProxy({ tier: mobile_4g }) returns only mobile_4g proxies', () => {
    const p = pool.getProxy({ tier: 'mobile_4g' });
    expect(p.tier).toBe('mobile_4g');
    expect(p.host).toBe('mob1.example.com');
  });

  test('getProxy({ tier: free }) returns only free proxies', () => {
    const p = pool.getProxy({ tier: 'free' });
    expect(p.tier).toBe('free');
    expect(p.host).toBe('free1.example.com');
  });

  test('getProxy({ requiresResidential: true }) maps to tier residential (backward compat)', () => {
    const p = pool.getProxy({ requiresResidential: true });
    expect(p.tier).toBe('residential');
  });

  test('getNext(tier) filters by tier', () => {
    const p = pool.getNext(false, 'residential');
    expect(p.tier).toBe('residential');
  });

  test('getNext() without tier returns any proxy (backward compat)', () => {
    const p = pool.getNext();
    expect(p).toBeDefined();
  });

  test('mixed pool: datacenter + residential coexist correctly', () => {
    const dc = pool.getProxy({ tier: 'datacenter' });
    const res = pool.getProxy({ tier: 'residential' });
    expect(dc.tier).toBe('datacenter');
    expect(res.tier).toBe('residential');
    expect(dc.host).not.toBe(res.host);
  });
});
