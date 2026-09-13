function driveToSick(o, platform, accountId) {
  for (let i = 0; i < 5; i++) o.recordError(platform, accountId);
  o.recordRateLimit(platform, accountId);
  o.recordRateLimit(platform, accountId);
  o.recordBotChallenge(platform, accountId);
}
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.2 — SessionHealthOrchestrator unit tests (real implementations, no mocks).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { StatusApi } from '../../src/core/status-api.js';

describe('Story 27.2 — SessionHealthOrchestrator (Scoring & Circuit Breaker)', () => {
  it('[P0] HEALTHY: fresh account starts at score 100 with breaker closed', () => {
    const o = new SessionHealthOrchestrator();
    expect(o.getHealthScore('tw', 'acc1')).toBe(100);
    expect(o.isAvailable('tw', 'acc1')).toBe(true);
    const st = o.getStatus();
    expect(st.healthScores).toBeDefined();
    expect(st.circuitBreakerStates).toBeDefined();
  });

  it('[P0] consecutive errors reduce health score deterministically', () => {
    const o = new SessionHealthOrchestrator();
    o.recordError('tw', 'acc1'); // -8
    expect(o.getHealthScore('tw', 'acc1')).toBe(92);
    o.recordError('tw', 'acc1'); // -16
    expect(o.getHealthScore('tw', 'acc1')).toBe(84);
    // Success clears consecutive errors
    o.recordSuccess('tw', 'acc1');
    expect(o.getHealthScore('tw', 'acc1')).toBe(100);
  });

  it('[P0] BREAK_OPEN: score < 30 opens breaker and marks account sick in pool/governor', () => {
    const pool = new AccountPool();
    pool.registerAccounts('tw', ['alice']);
    const gov = new AdaptiveRateGovernor();
    const o = new SessionHealthOrchestrator({ accountPool: pool, governor: gov });

    // 5 consecutive errors = -40 (cap) + 2 rate limits = -20 → score 40
    // + 1 bot challenge = -15 → score 25 (< 30)
    for (let i = 0; i < 5; i++) o.recordError('tw', 'alice');
    o.recordRateLimit('tw', 'alice');
    o.recordRateLimit('tw', 'alice');
    o.recordBotChallenge('tw', 'alice');

    expect(o.getHealthScore('tw', 'alice')).toBeLessThan(30);
    expect(o.isAvailable('tw', 'alice')).toBe(false);
    expect(gov.isHibernating('tw:alice')).toBe(true);
    expect(gov.getHibernationReason('tw:alice')).toBe('sick');
    // AccountPool excludes from rotation
    expect(pool.getNextAvailable('tw')).toBeNull();
  });

  it('[P0] HALF_OPEN: open breaker enters half-open after cooldown, closes on successful probe', async () => {
    let now = 1000;
    const pool = new AccountPool();
    pool.registerAccounts('tw', ['bob']);
    const gov = new AdaptiveRateGovernor();
    const o = new SessionHealthOrchestrator({
      accountPool: pool,
      governor: gov,
      baseCooldownMs: 1000,
      now: () => now,
    });

    // Drive to sick (<30)
    for (let i = 0; i < 5; i++) o.recordError('tw', 'bob');
    o.recordRateLimit('tw', 'bob');
    o.recordRateLimit('tw', 'bob');
    o.recordBotChallenge('tw', 'bob');
    expect(o.isAvailable('tw', 'bob')).toBe(false);

    // Before cooldown: checkRecovery remains open
    let st = await o.checkRecovery('tw', 'bob');
    expect(st.state).toBe('open');

    // Register a probe that returns success
    let probeRan = false;
    o.registerProbe('tw', 'bob', async () => {
      probeRan = true;
      return { success: true, complete: true };
    });

    // Advance past cooldown (1000 + 1000 = 2000)
    now = 2500;
    st = await o.checkRecovery('tw', 'bob');
    expect(probeRan).toBe(true);
    expect(st.state).toBe('closed');
    expect(o.isAvailable('tw', 'bob')).toBe(true);
    expect(o.getHealthScore('tw', 'bob')).toBe(60); // conservative reopen
    expect(pool.getNextAvailable('tw')).toBe('bob');
  });

  it('[P0] PROBE_FAIL: failed probe re-opens breaker with exponential backoff', async () => {
    let now = 1000;
    const o = new SessionHealthOrchestrator({
      baseCooldownMs: 1000,
      maxCooldownMs: 10000,
      now: () => now,
    });

    // Drive to sick
    driveToSick(o, 'tw', 'charlie');
    expect(o.isAvailable('tw', 'charlie')).toBe(false);

    o.registerProbe('tw', 'charlie', async () => ({ success: false }));

    // Past first cooldown (1s)
    now = 2500;
    const st1 = await o.checkRecovery('tw', 'charlie');
    expect(st1.state).toBe('open');
    expect(st1.failures).toBe(1);
    // Backoff was doubled: 1000 * 2^1 = 2000ms
    expect(st1.nextProbeAt).toBe(2500 + 2000);

    // 1s later (now 3500 < 4500): still cooling down
    now = 3500;
    const st2 = await o.checkRecovery('tw', 'charlie');
    expect(st2.state).toBe('open');
    expect(st2.failures).toBe(1); // unchanged

    // Past second cooldown (4600 > 4500)
    now = 4600;
    const st3 = await o.checkRecovery('tw', 'charlie');
    expect(st3.failures).toBe(2);
    // Next backoff: 1000 * 2^2 = 4000ms
    expect(st3.nextProbeAt).toBe(4600 + 4000);
  });

  it('[P1] latency & payload signals affect score', () => {
    const o = new SessionHealthOrchestrator();
    o.recordLatency('tw', 'dave', 9000); // avg > 8s → -20
    expect(o.getHealthScore('tw', 'dave')).toBe(80);
    o.recordPayload('tw', 'dave', false); // incomplete → -12
    expect(o.getHealthScore('tw', 'dave')).toBe(60);
    o.recordProxyHealth('tw', 'dave', false); // proxy unhealthy → -15
    expect(o.getHealthScore('tw', 'dave')).toBe(45);
  });

  it('[P1] NO_PROBE: half-open without probeFn defaults to manual-wake reopen', async () => {
    let now = 1000;
    const o = new SessionHealthOrchestrator({ baseCooldownMs: 500, now: () => now });
    driveToSick(o, 'tw', 'eve');
    now = 2000;
    const st = await o.checkRecovery('tw', 'eve');
    expect(st.state).toBe('closed');
    expect(o.getHealthScore('tw', 'eve')).toBe(60);
  });

  it('[P1] wake() explicitly closes breaker and resets state', () => {
    const o = new SessionHealthOrchestrator();
    driveToSick(o, 'tw', 'frank');
    expect(o.isAvailable('tw', 'frank')).toBe(false);
    o.wake('tw', 'frank');
    expect(o.isAvailable('tw', 'frank')).toBe(true);
    expect(o.getHealthScore('tw', 'frank')).toBe(60);
  });

  it('[P0] StatusApi merges health scores and circuit breaker states', () => {
    const o = new SessionHealthOrchestrator();
    o.recordError('tw', 'sam');
    const api = new StatusApi({ orchestrator: o });
    const status = api.getGovernorStatus();
    expect(status.healthScores).toBeDefined();
    expect(status.healthScores['tw:sam']).toBe(92);
    expect(status.circuitBreakerStates).toBeDefined();
  });
});
