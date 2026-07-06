// by nichxbt
// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — Facebook Automation Guardrail Tests: runGuardedBatch

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runGuardedBatch,
  randomDelay,
  assertFacebookUrl,
  ACCOUNT_RISK_WARNING,
} from '../../api/services/facebookAutomation.js';

const noDelay = () => {};

describe('runGuardedBatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('throws when items is null', async () => {
      await expect(runGuardedBatch(null, vi.fn())).rejects.toThrow(/items must be an array/i);
    });

    it('throws when items is undefined', async () => {
      await expect(runGuardedBatch(undefined, vi.fn())).rejects.toThrow(/items must be an array/i);
    });

    it('throws when items is a string', async () => {
      await expect(runGuardedBatch('post-1', vi.fn())).rejects.toThrow(/items must be an array/i);
    });

    it('throws when maxBatch is NaN', async () => {
      await expect(
        runGuardedBatch([], vi.fn(), { dryRun: false, maxBatch: NaN })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('throws when maxBatch is 0', async () => {
      await expect(
        runGuardedBatch([], vi.fn(), { dryRun: false, maxBatch: 0 })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('throws when maxBatch is negative', async () => {
      await expect(
        runGuardedBatch([], vi.fn(), { dryRun: false, maxBatch: -5 })
      ).rejects.toThrow(/maxBatch/i);
    });

    // L105: maxBatch < 1 → maxBatch <= 1 mutant — maxBatch=1 must be ACCEPTED
    it('accepts maxBatch=1 (boundary: < 1 must reject, <= 1 must NOT)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['only-item'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxBatch: 1,
      });
      expect(actionFn).toHaveBeenCalledTimes(1);
      expect(result.succeeded).toBe(1);
    });

    // L105: typeof maxBatch !== 'number' branch — non-number must throw
    it('throws when maxBatch is a string', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxBatch: '20' })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('throws when maxBatch is null', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxBatch: null })
      ).rejects.toThrow(/maxBatch/i);
    });

    // Patch: maxRetry must be finite (Infinity would hang the loop on persistent failures)
    it('throws when maxRetry is Infinity', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxRetry: Infinity })
      ).rejects.toThrow(/maxRetry/i);
    });

    it('throws when maxRetry is NaN', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxRetry: NaN })
      ).rejects.toThrow(/maxRetry/i);
    });

    it('throws when maxRetry is negative', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxRetry: -1 })
      ).rejects.toThrow(/maxRetry/i);
    });

    // L110: typeof maxRetry !== 'number' branch — non-number must throw
    it('throws when maxRetry is a string', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxRetry: '1' })
      ).rejects.toThrow(/maxRetry/i);
    });

    it('throws when maxRetry is null', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, maxRetry: null })
      ).rejects.toThrow(/maxRetry/i);
    });

    // L110: maxRetry=0 is valid (boundary — < 0 rejects, 0 accepted)
    it('accepts maxRetry=0 (boundary: < 0 rejects, 0 accepted)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['x'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });
      expect(result.succeeded).toBe(1);
    });

    // Patch: actionFn must be a function for real writes (else silent per-item TypeError)
    it('throws when actionFn is null and dryRun is false', async () => {
      await expect(
        runGuardedBatch(['x'], null, { dryRun: false })
      ).rejects.toThrow(/actionFn must be a function/i);
    });

    it('throws when actionFn is undefined and dryRun is false', async () => {
      await expect(
        runGuardedBatch(['x'], undefined, { dryRun: false })
      ).rejects.toThrow(/actionFn must be a function/i);
    });

    it('throws when actionFn is a string and dryRun is false', async () => {
      await expect(
        runGuardedBatch(['x'], 'notAFunction', { dryRun: false })
      ).rejects.toThrow(/actionFn must be a function/i);
    });

    // dryRun=true with non-function actionFn should NOT throw — preview path doesn't call it
    it('does NOT validate actionFn in dry-run mode (preview path)', async () => {
      const result = await runGuardedBatch(['x'], null);
      expect(result.dryRun).toBe(true);
      expect(result.preview).toHaveLength(1);
    });

    // L117: delayMin validation — negative / non-number must throw
    it('throws when delayMin is negative', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, delayMin: -1 })
      ).rejects.toThrow(/delayMin/i);
    });

    it('throws when delayMin is a string', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, delayMin: '1000' })
      ).rejects.toThrow(/delayMin/i);
    });

    // L117: delayMin < 0 → delayMin <= 0 mutant — delayMin=0 must be ACCEPTED
    it('accepts delayMin=0 (boundary: < 0 rejects, <= 0 must NOT)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['a', 'b'], actionFn, {
        dryRun: false,
        delay: noDelay,
        delayMin: 0,
        delayMax: 100,
      });
      expect(result.succeeded).toBe(2);
    });

    // L117: null delayMin falls back to default (1000) — must NOT throw
    it('null delayMin falls back to default (does not throw)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['x'], actionFn, {
        dryRun: false,
        delay: noDelay,
        delayMin: null,
      });
      expect(result.succeeded).toBe(1);
    });

    // L120: delayMax validation — negative / non-number / < delayMin must throw
    it('throws when delayMax is negative', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, delayMax: -1 })
      ).rejects.toThrow(/delayMax/i);
    });

    it('throws when delayMax is a string', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, delayMax: '3000' })
      ).rejects.toThrow(/delayMax/i);
    });

    it('throws when delayMax < delayMin', async () => {
      await expect(
        runGuardedBatch(['x'], vi.fn(), { dryRun: false, delayMin: 5000, delayMax: 1000 })
      ).rejects.toThrow(/delayMax/i);
    });

    // L120: null delayMax falls back to default (3000) — must NOT throw
    it('null delayMax falls back to default (does not throw)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['x'], actionFn, {
        dryRun: false,
        delay: noDelay,
        delayMax: null,
      });
      expect(result.succeeded).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Patch: strict dry-run gate — falsy non-boolean must NOT trigger real writes
  // -------------------------------------------------------------------------

  describe('strict dryRun gate (HIGH safety guard)', () => {
    it('dryRun: null stays in dry-run (does NOT enable real writes)', async () => {
      const actionFn = vi.fn();
      const result = await runGuardedBatch(['x'], actionFn, { dryRun: null, delay: noDelay });
      expect(actionFn).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.warning).toBeNull();
    });

    it('dryRun: 0 stays in dry-run', async () => {
      const actionFn = vi.fn();
      const result = await runGuardedBatch(['x'], actionFn, { dryRun: 0, delay: noDelay });
      expect(actionFn).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
    });

    it('dryRun: "" stays in dry-run', async () => {
      const actionFn = vi.fn();
      const result = await runGuardedBatch(['x'], actionFn, { dryRun: '', delay: noDelay });
      expect(actionFn).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
    });

    it('only explicit dryRun:false enables real writes', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch(['x'], actionFn, { dryRun: false, delay: noDelay });
      expect(actionFn).toHaveBeenCalledTimes(1);
      expect(result.dryRun).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC2.4 / AC3 — dry-run is the default
  // -------------------------------------------------------------------------

  describe('dry-run default', () => {
    it('returns preview without calling actionFn', async () => {
      const actionFn = vi.fn();
      const items = ['post-1', 'post-2', 'post-3'];

      const result = await runGuardedBatch(items, actionFn);

      expect(actionFn).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.platform).toBe('facebook');
      expect(result.attempted).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('preview contains one entry per item with target + action fields', async () => {
      const items = ['post-a', 'post-b'];
      const result = await runGuardedBatch(items, vi.fn());

      expect(result.preview).toHaveLength(2);
      result.preview.forEach((entry, i) => {
        expect(entry).toHaveProperty('target', items[i]);
        expect(entry).toHaveProperty('action');
      });
    });

    it('results array is empty on dry-run', async () => {
      const result = await runGuardedBatch(['x'], vi.fn());
      expect(result.results).toEqual([]);
    });

    it('explicit dryRun:true also skips actionFn', async () => {
      const actionFn = vi.fn();
      await runGuardedBatch(['post-1'], actionFn, { dryRun: true, delay: noDelay });
      expect(actionFn).not.toHaveBeenCalled();
    });

    it('dry-run also enforces maxBatch — throws on oversized batch', async () => {
      const items = Array.from({ length: 21 }, (_, i) => `post-${i}`);
      await expect(
        runGuardedBatch(items, vi.fn(), { dryRun: true })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('dry-run accepts exactly maxBatch items', async () => {
      const items = Array.from({ length: 20 }, (_, i) => `post-${i}`);
      await expect(runGuardedBatch(items, vi.fn(), { dryRun: true })).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AC2 / AC3 — dryRun:false invokes actionFn per item
  // -------------------------------------------------------------------------

  describe('dryRun:false — real write branch', () => {
    it('calls actionFn once per item', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const items = ['post-1', 'post-2', 'post-3'];

      const result = await runGuardedBatch(items, actionFn, {
        dryRun: false,
        delay: noDelay,
      });

      expect(actionFn).toHaveBeenCalledTimes(3);
      items.forEach((item, i) => {
        expect(actionFn).toHaveBeenNthCalledWith(i + 1, item);
      });
    });

    it('returns correct attempted/succeeded counts', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const items = ['a', 'b', 'c'];

      const result = await runGuardedBatch(items, actionFn, {
        dryRun: false,
        delay: noDelay,
      });

      expect(result.dryRun).toBe(false);
      expect(result.platform).toBe('facebook');
      expect(result.attempted).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('tracks failed items without throwing', async () => {
      const actionFn = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(undefined);

      const result = await runGuardedBatch(['a', 'b', 'c'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      const failedEntry = result.results.find((r) => !r.ok);
      expect(failedEntry.error).toContain('network error');
    });

    it('results array has one entry per item', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const items = ['x', 'y'];

      const result = await runGuardedBatch(items, actionFn, {
        dryRun: false,
        delay: noDelay,
      });

      expect(result.results).toHaveLength(2);
      result.results.forEach((r, i) => {
        expect(r.target).toBe(items[i]);
        expect(r.ok).toBe(true);
      });
    });

    it('preview is empty on real run', async () => {
      const result = await runGuardedBatch(['x'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: noDelay,
      });
      expect(result.preview).toEqual([]);
    });

    it('skips null items and records them as failed', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const result = await runGuardedBatch([null, 'post-1', undefined], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(actionFn).toHaveBeenCalledTimes(1);
      expect(actionFn).toHaveBeenCalledWith('post-1');
      expect(result.failed).toBe(2);
      expect(result.succeeded).toBe(1);
    });

    // L193: lastErr?.message → lastErr.message mutant — throwing a non-Error
    // (undefined) must NOT crash; optional chaining yields undefined, then ?? falls
    // back to String(lastErr). Without optional chaining, undefined.message throws.
    it('records String(err) when actionFn rejects with undefined (L193 OptionalChaining)', async () => {
      const actionFn = vi.fn().mockRejectedValue(undefined);
      const result = await runGuardedBatch(['x'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });
      expect(result.failed).toBe(1);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('undefined');
    });

    // L193: error with empty .message — ?? must fall back to String(err)
    it('records String(err) when error has no message property (L193)', async () => {
      const actionFn = vi.fn().mockRejectedValue({ code: 'NO_MSG' });
      const result = await runGuardedBatch(['x'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });
      expect(result.failed).toBe(1);
      expect(result.results[0].error).toBe('[object Object]');
    });
  });

  // -------------------------------------------------------------------------
  // AC2.6 — batch over maxBatch is rejected (dry-run AND real)
  // -------------------------------------------------------------------------

  describe('maxBatch enforcement', () => {
    it('throws when items.length > maxBatch (default 20) — real run', async () => {
      const items = Array.from({ length: 21 }, (_, i) => `post-${i}`);
      await expect(
        runGuardedBatch(items, vi.fn(), { dryRun: false, delay: noDelay })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('throws when items.length > maxBatch (default 20) — dry-run', async () => {
      const items = Array.from({ length: 21 }, (_, i) => `post-${i}`);
      await expect(
        runGuardedBatch(items, vi.fn(), { dryRun: true })
      ).rejects.toThrow(/maxBatch/i);
    });

    it('accepts exactly maxBatch items', async () => {
      const items = Array.from({ length: 20 }, (_, i) => `post-${i}`);
      const actionFn = vi.fn().mockResolvedValue(undefined);
      await expect(
        runGuardedBatch(items, actionFn, { dryRun: false, delay: noDelay })
      ).resolves.not.toThrow();
      expect(actionFn).toHaveBeenCalledTimes(20);
    });

    it('throws when items.length > custom maxBatch', async () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f'];
      await expect(
        runGuardedBatch(items, vi.fn(), { dryRun: false, delay: noDelay, maxBatch: 5 })
      ).rejects.toThrow(/maxBatch/i);
    });

    // L128: error message must contain guidance text 'Split' / 'raise maxBatch'
    it('oversized-batch error message contains split guidance (L128 StringLiteral)', async () => {
      const items = Array.from({ length: 21 }, (_, i) => `post-${i}`);
      await expect(
        runGuardedBatch(items, vi.fn(), { dryRun: false, delay: noDelay })
      ).rejects.toThrow(/Split into smaller batches/i);
    });
  });

  // -------------------------------------------------------------------------
  // AC2.7 — account-risk warning present before first real batch
  // -------------------------------------------------------------------------

  describe('account-risk warning', () => {
    it('result.warning is populated on real run', async () => {
      const result = await runGuardedBatch(['post-1'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: noDelay,
      });
      expect(result.warning).toBeTruthy();
      expect(result.warning).toMatch(/warning/i);
    });

    it('console.warn is called before first real write', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const actionFn = vi.fn().mockResolvedValue(undefined);

      await runGuardedBatch(['post-1', 'post-2'], actionFn, {
        dryRun: false,
        delay: noDelay,
      });

      expect(warnSpy).toHaveBeenCalledWith(ACCOUNT_RISK_WARNING);
      const warnOrder = warnSpy.mock.invocationCallOrder[0];
      const firstActionOrder = actionFn.mock.invocationCallOrder[0];
      expect(warnOrder).toBeLessThan(firstActionOrder);
    });

    it('warning is null on dry-run (no real writes, no risk)', async () => {
      const result = await runGuardedBatch(['post-1'], vi.fn());
      expect(result.warning).toBeNull();
    });

    it('ACCOUNT_RISK_WARNING constant mentions account risk', () => {
      expect(ACCOUNT_RISK_WARNING).toMatch(/risk|lock|restrict/i);
    });
  });

  // -------------------------------------------------------------------------
  // AC4 — result shape
  // -------------------------------------------------------------------------

  describe('result shape', () => {
    it('dry-run result has all required fields', async () => {
      const result = await runGuardedBatch(['post-1'], vi.fn());
      expect(result).toMatchObject({
        dryRun: true,
        platform: 'facebook',
        attempted: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        preview: expect.any(Array),
        results: expect.any(Array),
      });
    });

    it('real-run result has all required fields', async () => {
      const result = await runGuardedBatch(['post-1'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: noDelay,
      });
      expect(result).toMatchObject({
        dryRun: false,
        platform: 'facebook',
        attempted: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        preview: expect.any(Array),
        results: expect.any(Array),
        warning: expect.any(String),
      });
    });
  });

  // -------------------------------------------------------------------------
  // Delay seam — injectable (AC2.4 blocker from Epic 1 lessons)
  // -------------------------------------------------------------------------

  describe('delay seam', () => {
    it('uses injected delay function between items', async () => {
      const delaySpy = vi.fn().mockResolvedValue(undefined);
      const items = ['a', 'b', 'c'];

      await runGuardedBatch(items, vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: delaySpy,
      });

      expect(delaySpy).toHaveBeenCalledTimes(items.length - 1);
    });

    it('does not call delay in dry-run', async () => {
      const delaySpy = vi.fn();
      await runGuardedBatch(['a', 'b'], vi.fn(), { dryRun: true, delay: delaySpy });
      expect(delaySpy).not.toHaveBeenCalled();
    });

    it('batch continues when delay throws — does not abort', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const delayThatThrows = vi.fn().mockRejectedValue(new Error('delay failed'));
      const actionFn = vi.fn().mockResolvedValue(undefined);

      const result = await runGuardedBatch(['a', 'b', 'c'], actionFn, {
        dryRun: false,
        delay: delayThatThrows,
      });

      expect(actionFn).toHaveBeenCalledTimes(3);
      expect(result.succeeded).toBe(3);
    });

    // L223-225: catch block must log to console.warn with the delay error message.
    // L223 BlockStatement → empty mutant: console.warn would NOT be called.
    // L225 StringLiteral → '' mutant: message would be empty/missing 'delay threw'.
    it('logs delay error to console.warn with "delay threw" text (L223/L225)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const delayThatThrows = vi.fn().mockRejectedValue(new Error('delay failed'));

      await runGuardedBatch(['a', 'b'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: delayThatThrows,
      });

      const delayWarn = warnSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('delay threw')
      );
      expect(delayWarn).toBeDefined();
      expect(delayWarn[0]).toContain('delay failed');
    });

    // L225: err?.message ?? err → err?.message && err mutant.
    // When delay rejects with a non-Error (string), err?.message is undefined.
    // With ??: undefined ?? 'boom' → 'boom'. With &&: undefined && 'boom' → undefined.
    // The warn message must contain the thrown string 'boom'.
    it('warns String(err) when delay rejects with a non-Error string (L225 LogicalOperator)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const delayThatThrows = vi.fn().mockRejectedValue('boom-string');

      await runGuardedBatch(['a', 'b'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: delayThatThrows,
      });

      const delayWarn = warnSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('delay threw')
      );
      expect(delayWarn).toBeDefined();
      // ?? fallback: 'boom-string' appears in message; && mutant: undefined → 'undefined'
      expect(delayWarn[0]).toContain('boom-string');
    });
  });

  // -------------------------------------------------------------------------
  // maxRetry — bounded retry per item
  // -------------------------------------------------------------------------

  describe('maxRetry', () => {
    it('retries failed item up to maxRetry times', async () => {
      const actionFn = vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined);

      const result = await runGuardedBatch(['post-1'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 1,
      });

      expect(actionFn).toHaveBeenCalledTimes(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('records failed after exhausting retries', async () => {
      const actionFn = vi.fn().mockRejectedValue(new Error('persistent'));

      const result = await runGuardedBatch(['post-1'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 2,
      });

      expect(actionFn).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(0);
    });

    it('maxRetry=0 means no retry — single attempt only', async () => {
      const actionFn = vi.fn().mockRejectedValue(new Error('fail'));

      const result = await runGuardedBatch(['post-1'], actionFn, {
        dryRun: false,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(actionFn).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // shouldStop — explicit stop condition
  // -------------------------------------------------------------------------

  describe('shouldStop', () => {
    it('stops batch early when shouldStop returns true', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      let callCount = 0;
      const shouldStop = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount >= 2; // stop after 2 items
      });

      const result = await runGuardedBatch(['a', 'b', 'c', 'd', 'e'], actionFn, {
        dryRun: false,
        delay: noDelay,
        shouldStop,
      });

      expect(actionFn).toHaveBeenCalledTimes(2);
      expect(result.succeeded).toBe(2);
    });

    it('shouldStop receives an immutable summary (attempted/succeeded/failed/lastResult)', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const captured = [];
      const shouldStop = vi.fn().mockImplementation((summary) => {
        captured.push(summary);
        return false;
      });

      await runGuardedBatch(['a', 'b'], actionFn, {
        dryRun: false,
        delay: noDelay,
        shouldStop,
      });

      expect(captured[0]).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
      expect(captured[0].lastResult).toMatchObject({ target: 'a', ok: true });
      expect(captured[1]).toMatchObject({ attempted: 2, succeeded: 2, failed: 0 });
    });

    it('does not call shouldStop in dry-run', async () => {
      const shouldStop = vi.fn().mockReturnValue(false);
      await runGuardedBatch(['a', 'b'], vi.fn(), { dryRun: true, shouldStop });
      expect(shouldStop).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onProgress — guarded against non-function and throwing callbacks
  // -------------------------------------------------------------------------

  describe('onProgress', () => {
    it('calls onProgress after each item with correct counts', async () => {
      const onProgress = vi.fn();
      await runGuardedBatch(['a', 'b', 'c'], vi.fn().mockResolvedValue(undefined), {
        dryRun: false,
        delay: noDelay,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, { attempted: 1, total: 3 });
      expect(onProgress).toHaveBeenNthCalledWith(3, { attempted: 3, total: 3 });
    });

    it('non-function onProgress does not throw', async () => {
      await expect(
        runGuardedBatch(['a'], vi.fn().mockResolvedValue(undefined), {
          dryRun: false,
          delay: noDelay,
          onProgress: true,
        })
      ).resolves.not.toThrow();
    });

    // L199: typeof onProgress === 'function' → true mutant — non-function values
    // must NOT be invoked. If the guard is removed (always true), calling a
    // non-function throws TypeError, crashing the batch.
    it('null onProgress is not invoked (L199 ConditionalExpression)', async () => {
      await expect(
        runGuardedBatch(['a', 'b'], vi.fn().mockResolvedValue(undefined), {
          dryRun: false,
          delay: noDelay,
          onProgress: null,
        })
      ).resolves.not.toThrow();
    });

    it('string onProgress is not invoked (L199)', async () => {
      await expect(
        runGuardedBatch(['a'], vi.fn().mockResolvedValue(undefined), {
          dryRun: false,
          delay: noDelay,
          onProgress: 'not a function',
        })
      ).resolves.not.toThrow();
    });

    it('object onProgress is not invoked (L199)', async () => {
      await expect(
        runGuardedBatch(['a'], vi.fn().mockResolvedValue(undefined), {
          dryRun: false,
          delay: noDelay,
          onProgress: { foo: 'bar' },
        })
      ).resolves.not.toThrow();
    });

    it('throwing onProgress does not corrupt batch state', async () => {
      const actionFn = vi.fn().mockResolvedValue(undefined);
      const onProgress = vi.fn().mockImplementation(() => { throw new Error('progress error'); });

      const result = await runGuardedBatch(['a', 'b', 'c'], actionFn, {
        dryRun: false,
        delay: noDelay,
        onProgress,
      });

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // randomDelay — guard min > max
  // -------------------------------------------------------------------------

  describe('randomDelay', () => {
    it('throws when min > max', () => {
      expect(() => randomDelay(3000, 1000)).toThrow(/min.*max/i);
    });

    it('accepts equal min and max', async () => {
      await expect(randomDelay(0, 0)).resolves.toBeUndefined();
    });

    it('computes min + random * (max - min) correctly (L20: ArithmeticOperator)', async () => {
      // Override Math.random to control delay value
      const originalRandom = Math.random;
      Math.random = () => 0.5;
      try {
        // Original: 1000 + 0.5 * (3000 - 1000) = 1000 + 1000 = 2000
        // Mutant -: 1000 - 0.5 * 2000 = 0 → sleep(0)
        // Mutant /: 1000 + 0.5 / 2000 ≈ 1000 → sleep(1000)
        // Mutant max+min: 3000 + 1000 = 4000 → sleep(4000 + random*...)
        // To kill: verify sleep duration is exactly 2000
        // But randomDelay returns a Promise from sleep() — we can't directly inspect the duration
        // Instead, mock setTimeout to capture the duration
        const durations = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => {
          durations.push(ms);
          return originalSetTimeout(fn, 0); // resolve immediately
        };
        try {
          await randomDelay(1000, 3000);
          expect(durations).toHaveLength(1);
          expect(durations[0]).toBe(2000); // exactly min + 0.5*(max-min)
        } finally {
          global.setTimeout = originalSetTimeout;
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it('delay with random=0 → exactly min (L20: ArithmeticOperator)', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.0;
      try {
        const durations = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => {
          durations.push(ms);
          return originalSetTimeout(fn, 0);
        };
        try {
          await randomDelay(1000, 3000);
          expect(durations[0]).toBe(1000); // min + 0*(max-min) = min
        } finally {
          global.setTimeout = originalSetTimeout;
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it('delay with random=1 → exactly max (L20: ArithmeticOperator)', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.9999; // close to 1
      try {
        const durations = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => {
          durations.push(ms);
          return originalSetTimeout(fn, 0);
        };
        try {
          await randomDelay(1000, 3000);
          // min + 0.9999*(max-min) ≈ 2999.8 → Math.floor not applied, so ~2999.8
          // Mutant max+min: 3000+1000 = 4000 + 0.9999*... → way more
          expect(durations[0]).toBeGreaterThan(2900);
          expect(durations[0]).toBeLessThan(3000);
        } finally {
          global.setTimeout = originalSetTimeout;
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it('delay with random=1.0 → exactly max (L20: ArithmeticOperator boundary)', async () => {
      const originalRandom = Math.random;
      Math.random = () => 1.0;
      try {
        const durations = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, ms) => {
          durations.push(ms);
          return originalSetTimeout(fn, 0);
        };
        try {
          await randomDelay(1000, 3000);
          // Original: 1000 + 1.0 * (3000 - 1000) = 3000 (exactly max)
          // Mutant -: 1000 - 1.0 * 2000 = -1000
          // Mutant /: 1000 + 1.0 / 2000 ≈ 1000.0005
          // Mutant max+min: 1000 + 1.0 * (3000 + 1000) = 5000
          expect(durations[0]).toBe(3000);
        } finally {
          global.setTimeout = originalSetTimeout;
        }
      } finally {
        Math.random = originalRandom;
      }
    });
  });
});

// =============================================================================
// assertFacebookUrl — default label 'URL' must appear in error messages (L35)
// =============================================================================

describe('assertFacebookUrl', () => {
  // L35: StringLiteral label='URL' → '' mutant.
  // The default label 'URL' must appear in every error message when no custom
  // label is supplied. If the default becomes '', the prefix vanishes.
  it('default error message contains the "URL" label (L35 StringLiteral)', () => {
    expect(() => assertFacebookUrl('   ')).toThrow('URL');
  });

  it('default error for non-facebook host contains "URL" label (L35)', () => {
    expect(() => assertFacebookUrl('https://evil.com/x')).toThrow('URL');
  });

  it('default error for non-http scheme contains "URL" label (L35)', () => {
    expect(() => assertFacebookUrl('file:///etc/passwd')).toThrow('URL');
  });

  it('default error for unparseable URL contains "URL" label (L35)', () => {
    expect(() => assertFacebookUrl('not a url')).toThrow('URL');
  });

  it('custom label appears in error message instead of "URL"', () => {
    expect(() => assertFacebookUrl('https://evil.com', 'shareUrl')).toThrow('shareUrl');
  });

  it('accepts a valid https facebook.com URL without throwing', () => {
    expect(() => assertFacebookUrl('https://www.facebook.com/groups/x')).not.toThrow();
  });

  it('accepts an http facebook.com URL without throwing', () => {
    expect(() => assertFacebookUrl('http://facebook.com/post/1')).not.toThrow();
  });

  it('rejects non-string input', () => {
    expect(() => assertFacebookUrl(undefined)).toThrow('non-empty string');
    expect(() => assertFacebookUrl(42)).toThrow('non-empty string');
  });

  it('rejects non-facebook host', () => {
    expect(() => assertFacebookUrl('https://notfacebook.com/x')).toThrow('facebook.com');
  });
});
