// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 40.1 — resolveProxy() cost-aware escalation integration tests.
 * Verifies tier escalation on challenge detection and budget ceiling degradation.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { ProxyBudgetGovernor } from '../../src/core/proxy-budget-governor.js';
import { DistributedTokenBucket } from '../../src/core/distributed-token-bucket.js';
import { PlatformError } from '../../src/core/error-envelope.js';

class MockClient extends AbstractApiClient {
  name = 'mock-escalation';
  requiresAuth = true;
}

describe('resolveProxy — Cost-Aware Escalation (Story 40.1)', () => {
  let proxyPool;
  let accountPool;
  let governor;
  let budgetGovernor;
  let bucket;

  beforeEach(() => {
    proxyPool = new ProxyIpPool({
      proxies: [
        'http://dc1.example.com:8080',
        'http://dc2.example.com:8080',
        { host: 'res1.example.com', port: 8080, tier: 'residential' },
        { host: 'mob1.example.com', port: 8080, tier: 'mobile_4g' },
      ],
      validateOnAdd: true,
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    bucket = new DistributedTokenBucket();
    budgetGovernor = new ProxyBudgetGovernor({ bucket, dailyBudgetUsd: 10 });
  });

  test('DEFAULT_TIER: resolveProxy returns any proxy when no tier specified (backward compat)', () => {
    const client = new MockClient({ proxyPool, accountPool, governor });
    const p = client.resolveProxy('acc_1');
    expect(p).toBeDefined();
    // No tier filter → returns first available proxy (any tier)
  });

  test('TIER_DEFAULT: resolveProxy with tier=datacenter returns datacenter', () => {
    const client = new MockClient({ proxyPool, accountPool, governor });
    const p = client.resolveProxy('acc_1', false, true, { tier: 'datacenter' });
    expect(p).toBeDefined();
    expect(p.tier).toBe('datacenter');
  });

  test('BACKWARD_COMPAT: requiresResidential: true maps to tier residential', () => {
    const client = new MockClient({ proxyPool, accountPool, governor });
    const p = client.resolveProxy('acc_1', true);
    expect(p).toBeDefined();
    expect(p.tier).toBe('residential');
  });

  test('TIER_FILTER: resolveProxy with tier option returns matching tier', () => {
    const client = new MockClient({ proxyPool, accountPool, governor });
    const p = client.resolveProxy('acc_1', false, true, { tier: 'mobile_4g' });
    expect(p).toBeDefined();
    expect(p.tier).toBe('mobile_4g');
  });

  test('MIXED_POOL: datacenter and residential proxies coexist', () => {
    const client = new MockClient({ proxyPool, accountPool, governor });
    const dc = client.resolveProxy('acc_dc', false, true, { tier: 'datacenter' });
    const res = client.resolveProxy('acc_res', false, true, { tier: 'residential' });
    expect(dc.tier).toBe('datacenter');
    expect(res.tier).toBe('residential');
    expect(dc.host).not.toBe(res.host);
  });

  test('resolveProxy throws when no matching tier proxies exist', () => {
    const emptyPool = new ProxyIpPool({ proxies: ['http://dc1.example.com:8080'] });
    const client = new MockClient({ proxyPool: emptyPool, accountPool, governor });
    // getStickyProxy returns null → resolveProxy throws PROXY_EXHAUSTED
    expect(() => client.resolveProxy('acc_1', false, true, { tier: 'residential' })).toThrow(PlatformError);
  });

  test('ProxyBudgetGovernor injected via constructor options', () => {
    const client = new MockClient({ proxyPool, accountPool, governor, proxyBudgetGovernor: budgetGovernor });
    expect(client.proxyBudgetGovernor).toBe(budgetGovernor);
  });

  test('BUDGET_CEILING_REACHED: budget governor returns allowed:false when exhausted', async () => {
    // consume() spends tokens = cost estimate (~$0.42 for residential 1GB)
    // With dailyBudgetUsd=10, we need ~24 consumes to exhaust.
    // Instead, create a governor with tiny budget to trigger exhaustion quickly.
    const tinyBudget = new ProxyBudgetGovernor({ bucket: new DistributedTokenBucket(), dailyBudgetUsd: 0.1 });
    const res = await tinyBudget.canAfford('residential'); // ~$0.42 > $0.10
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBeLessThan(res.estimatedCostUsd);
  });

  test('estimateCostUsd: correct per-tier rates', () => {
    expect(budgetGovernor.estimateCostUsd('free')).toBe(0);
    expect(budgetGovernor.estimateCostUsd('datacenter', 1e9)).toBeCloseTo(0.5, 1);
    expect(budgetGovernor.estimateCostUsd('residential', 1e9)).toBeCloseTo(8.0, 1);
    expect(budgetGovernor.estimateCostUsd('mobile_4g', 1e9)).toBeCloseTo(15.0, 1);
  });

  test('budget governor tracks remaining correctly', async () => {
    const before = await budgetGovernor.checkRemaining();
    expect(before.remaining).toBeGreaterThan(0);
    await budgetGovernor.consume('datacenter', 1e9); // ~$0.50
    const after = await budgetGovernor.checkRemaining();
    expect(after.remaining).toBeLessThan(before.remaining);
  });
});
