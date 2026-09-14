// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 28.2 — SelectorCanary: Periodic DOM Probe & Drift Alert.
 * Uses real test harnesses (no vi.mock) with dependency injection.
 * Tests fallback chain walking, consecutive failure tracking, AlertDispatcher integration,
 * governor state persistence, scheduler lifecycle, and error isolation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { describe, test, expect, beforeEach } from 'vitest';
import { SelectorCanary, globalSelectorCanary } from '../../src/services/selector-canary.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { AlertDispatcher } from '../../api/services/benchmark/alerting.js';

function makePageHarness(options = {}) {
  const { matchingSelectors = [], throwOnGoto = false } = options;
  const matchedSet = new Set(matchingSelectors);
  let closed = false;
  let visitedUrl = null;
  const checkedSelectors = [];

  return {
    async goto(url) {
      if (throwOnGoto) {
        throw new Error(`Navigation failed: ${url}`);
      }
      visitedUrl = url;
    },
    async $(selector) {
      checkedSelectors.push(selector);
      if (matchedSet.has(selector)) {
        return { selector };
      }
      return null;
    },
    async close() {
      closed = true;
    },
    get isClosed() {
      return closed;
    },
    get visitedUrl() {
      return visitedUrl;
    },
    get checkedSelectors() {
      return checkedSelectors;
    },
  };
}

function makeBrowserHarness(pageResolver) {
  const pages = [];
  let closed = false;

  return {
    pages,
    async newPage() {
      const page = typeof pageResolver === 'function' ? pageResolver() : makePageHarness();
      pages.push(page);
      return page;
    },
    async close() {
      closed = true;
    },
    get isClosed() {
      return closed;
    },
  };
}

describe('Story 28.2 — SelectorCanary: Periodic DOM Probe & Drift Alert', () => {
  let governor;
  let dispatchedAlerts;
  let alertDispatcher;

  beforeEach(() => {
    governor = new AdaptiveRateGovernor();
    dispatchedAlerts = [];
    alertDispatcher = new AlertDispatcher({
      dispatchSeam: async (alert) => {
        dispatchedAlerts.push(alert);
      },
    });
  });

  test('[AC-1] HAPPY_PATH: primary selector matches -> successRate=1.0, usedFallback=false, driftDetected=false', async () => {
    let createdPage = null;
    const browser = makeBrowserHarness(() => {
      createdPage = makePageHarness({
        matchingSelectors: ['[data-testid="UserName"]'],
      });
      return createdPage;
    });

    const canary = new SelectorCanary({
      config: {
        twitter: [
          {
            name: 'twitter-profile',
            url: 'https://x.com/nasa',
            selectorChain: [
              '[data-testid="UserName"]',
              '[data-testid="UserDescription"]',
              'main [role="main"]',
            ],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
      now: () => 1700000000000,
    });

    const results = await canary.runOnce();

    expect(results.twitter).toBeDefined();
    expect(results.twitter.successRate).toBe(1.0);
    expect(results.twitter.usedFallback).toBe(false);
    expect(results.twitter.driftDetected).toBe(false);
    expect(results.twitter.lastWorkingSelector).toBe('[data-testid="UserName"]');
    expect(results.twitter.consecutiveFailures).toBe(0);
    expect(results.twitter.alert).toBe(false);

    // Verify governor status updated
    const status = governor.getStatus();
    expect(status.platformDrift.twitter).toBeDefined();
    expect(status.platformDrift.twitter.alert).toBe(false);
    expect(status.platformDrift.twitter.successRate).toBe(1.0);
    expect(status.platformDrift.twitter.lastWorkingSelector).toBe('[data-testid="UserName"]');

    // Verify browser and page lifecycle
    expect(createdPage.isClosed).toBe(true);
    expect(browser.isClosed).toBe(true);
    expect(dispatchedAlerts.length).toBe(0);
  });

  test('[AC-2] FALLBACK_USED: primary selector absent, fallback matches -> usedFallback=true, driftDetected=true', async () => {
    const browser = makeBrowserHarness(() =>
      makePageHarness({
        matchingSelectors: ['[data-testid="UserDescription"]'], // 2nd selector in chain
      })
    );

    const canary = new SelectorCanary({
      config: {
        twitter: [
          {
            name: 'twitter-profile',
            url: 'https://x.com/nasa',
            selectorChain: [
              '[data-testid="UserName"]',
              '[data-testid="UserDescription"]',
              'main [role="main"]',
            ],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
    });

    const results = await canary.runOnce();

    expect(results.twitter.successRate).toBe(1.0);
    expect(results.twitter.usedFallback).toBe(true);
    expect(results.twitter.driftDetected).toBe(true);
    expect(results.twitter.lastWorkingSelector).toBe('[data-testid="UserDescription"]');
    expect(results.twitter.consecutiveFailures).toBe(0);
    expect(results.twitter.alert).toBe(false);
    expect(dispatchedAlerts.length).toBe(0);
  });

  test('[AC-3] BELOW_THRESHOLD_ONCE: successRate < 0.8 on run 1 only -> no alert dispatched', async () => {
    // All selectors fail on this run
    const browser = makeBrowserHarness(() =>
      makePageHarness({
        matchingSelectors: [],
      })
    );

    const canary = new SelectorCanary({
      config: {
        facebook: [
          {
            name: 'fb-profile',
            url: 'https://facebook.com/meta',
            selectorChain: ['[role="main"]', 'h1'],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
    });

    const results = await canary.runOnce();

    expect(results.facebook.successRate).toBe(0);
    expect(results.facebook.driftDetected).toBe(true);
    expect(results.facebook.consecutiveFailures).toBe(1);
    expect(results.facebook.alert).toBe(false);

    // No alert dispatched on first failure
    expect(dispatchedAlerts.length).toBe(0);
    expect(governor.getStatus().platformDrift.facebook.alert).toBe(false);
  });

  test('[AC-4] DRIFT_DETECTED: successRate < 0.8 for two consecutive runs -> alert dispatched & governor alert=true', async () => {
    const browser = makeBrowserHarness(() =>
      makePageHarness({
        matchingSelectors: [],
      })
    );

    const canary = new SelectorCanary({
      config: {
        threads: [
          {
            name: 'threads-profile',
            url: 'https://threads.net/@nasa',
            selectorChain: ['[role="main"]', 'h1', 'header'],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
      now: () => 1700000100000,
    });

    // Run 1: first failure
    await canary.runOnce();
    expect(dispatchedAlerts.length).toBe(0);
    expect(governor.getStatus().platformDrift.threads.alert).toBe(false);

    // Run 2: second consecutive failure
    const results2 = await canary.runOnce();
    expect(results2.threads.successRate).toBe(0);
    expect(results2.threads.consecutiveFailures).toBe(2);
    expect(results2.threads.alert).toBe(true);

    // Alert must be dispatched
    expect(dispatchedAlerts.length).toBe(1);
    expect(dispatchedAlerts[0].platform).toBe('threads');
    expect(dispatchedAlerts[0].scraper_id).toBe('selector-canary:threads');
    expect(dispatchedAlerts[0].current_tier).toBe('C');

    // Governor status must reflect alert: true
    const status = governor.getStatus();
    expect(status.platformDrift.threads.alert).toBe(true);
    expect(status.platformDrift.threads.successRate).toBe(0);
    expect(status.platformDrift.threads.consecutiveFailures).toBe(2);
  });

  test('[AC-5] THRESHOLD_RECOVERY: consecutive failure resets and alert clears when successRate recovers', async () => {
    let shouldFail = true;
    const browser = makeBrowserHarness(() => {
      if (shouldFail) {
        return makePageHarness({ matchingSelectors: [] });
      }
      return makePageHarness({ matchingSelectors: ['ytd-channel-name'] });
    });

    const canary = new SelectorCanary({
      config: {
        youtube: [
          {
            name: 'youtube-channel',
            url: 'https://youtube.com/@nasa',
            selectorChain: ['ytd-channel-name', '#channel-header'],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
    });

    // Run 1 & 2: fail -> trigger alert
    await canary.runOnce();
    await canary.runOnce();
    expect(governor.getStatus().platformDrift.youtube.alert).toBe(true);
    expect(dispatchedAlerts.length).toBe(1);

    // Run 3: recovery (shouldFail = false)
    shouldFail = false;
    const results3 = await canary.runOnce();

    expect(results3.youtube.successRate).toBe(1.0);
    expect(results3.youtube.consecutiveFailures).toBe(0);
    expect(results3.youtube.alert).toBe(false);

    // Governor alert must be cleared
    const status = governor.getStatus();
    expect(status.platformDrift.youtube.alert).toBe(false);
    expect(status.platformDrift.youtube.consecutiveFailures).toBe(0);
  });

  test('[AC-6] BROWSER_LAUNCH_FAILS: fails cleanly without crashing service, records 0 successRate', async () => {
    const canary = new SelectorCanary({
      config: {
        twitter: [
          {
            name: 'target-1',
            url: 'https://x.com/nasa',
            selectorChain: ['[data-testid="UserName"]'],
          },
        ],
      },
      browserFactory: async () => {
        throw new Error('Chrome spawn error: ENOENT');
      },
      alertDispatcher,
      governor,
      delayMs: 0,
    });

    const results = await canary.runOnce();
    expect(results.twitter).toBeDefined();
    expect(results.twitter.successRate).toBe(0);
    expect(results.twitter.driftDetected).toBe(true);
    expect(results.twitter.consecutiveFailures).toBe(1);
  });

  test('[AC-7] TARGET_UNREACHABLE: navigation throws for one target, other targets still probed', async () => {
    let callCount = 0;
    const browser = makeBrowserHarness(() => {
      callCount++;
      if (callCount === 1) {
        // First target throws during navigation
        return makePageHarness({ throwOnGoto: true });
      }
      // Second target succeeds
      return makePageHarness({ matchingSelectors: ['h1'] });
    });

    const canary = new SelectorCanary({
      config: {
        multi: [
          {
            name: 'target-broken',
            url: 'https://broken.invalid',
            selectorChain: ['h1'],
          },
          {
            name: 'target-working',
            url: 'https://working.invalid',
            selectorChain: ['h1'],
          },
        ],
      },
      browserFactory: async () => browser,
      alertDispatcher,
      governor,
      delayMs: 0,
    });

    const results = await canary.runOnce();
    expect(results.multi.successRate).toBe(0.5);
    expect(results.multi.driftDetected).toBe(true);
  });

  test('[AC-8] MISSING_CONFIG: missing or empty config file no-ops without throwing', async () => {
    const canaryEmpty = new SelectorCanary({
      config: {},
      governor,
      delayMs: 0,
    });

    const resEmpty = await canaryEmpty.runOnce();
    expect(resEmpty).toEqual({});

    const canaryMissing = new SelectorCanary({
      configPath: '/non/existent/path/canary-targets.json',
      governor,
      delayMs: 0,
    });

    const resMissing = await canaryMissing.runOnce();
    expect(resMissing).toEqual({});
  });

  test('[AC-9] SELECTOR_CHAIN_EMPTY: targets with empty selector chains are skipped', async () => {
    const canary = new SelectorCanary({
      config: {
        twitter: [
          {
            name: 'invalid-target',
            url: 'https://x.com/nasa',
            selectorChain: [],
          },
        ],
      },
      governor,
      delayMs: 0,
    });

    const results = await canary.runOnce();
    expect(results.twitter).toBeUndefined();
  });

  test('[AC-10] Scheduler start/stop lifecycle and global singleton instance', () => {
    const canary = new SelectorCanary({
      config: {},
      delayMs: 0,
    });

    const started = canary.startScheduler('0 0 1 1 *');
    expect(started).toBe(true);

    // Second start should return false because scheduler is already active
    expect(canary.startScheduler()).toBe(false);

    canary.stopScheduler();

    // After stopping, it can be started again
    expect(canary.startScheduler('0 0 1 1 *')).toBe(true);
    canary.stopScheduler();

    // Invalid cron expression is rejected without scheduling (cron.validate guard)
    expect(canary.startScheduler('not-a-cron')).toBe(false);
    canary.stopScheduler();

    // Global singleton
    expect(globalSelectorCanary).toBeInstanceOf(SelectorCanary);
  });

  test('[AC-11] getStatus() exposes per-platform drift status map', async () => {
    const browser = makeBrowserHarness(() =>
      makePageHarness({ matchingSelectors: ['h1'] })
    );

    const canary = new SelectorCanary({
      config: {
        threads: [
          {
            name: 'threads-profile',
            url: 'https://threads.net/@nasa',
            selectorChain: ['h1'],
          },
        ],
      },
      browserFactory: async () => browser,
      delayMs: 0,
    });

    await canary.runOnce();
    const status = canary.getStatus();

    expect(status.threads).toBeDefined();
    expect(status.threads.successRate).toBe(1.0);
    expect(status.threads.alert).toBe(false);
    expect(status.threads.lastWorkingSelector).toBe('h1');
  });

  test('[AC-12] loads real config/canary-targets.json default configuration', async () => {
    const browser = makeBrowserHarness(() =>
      makePageHarness({ matchingSelectors: ['[data-testid="UserName"]', '[role="main"]', 'ytd-channel-name'] })
    );

    const canary = new SelectorCanary({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const results = await canary.runOnce();
    // Default config has twitter, facebook, youtube, threads
    expect(results.twitter).toBeDefined();
    expect(results.facebook).toBeDefined();
    expect(results.youtube).toBeDefined();
    expect(results.threads).toBeDefined();
  });
});
