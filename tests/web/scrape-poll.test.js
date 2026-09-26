// tests/web/scrape-poll.test.js
// Unit tests for apps/web/lib/scrape-poll.ts — pollOperation + isAsyncAccepted
// via injected seams (_setPollApiImpl/_setPollIntervalMs), no vi.mock.
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  pollOperation,
  isAsyncAccepted,
  _setPollApiImpl,
  _setPollIntervalMs,
  _resetPollSeams,
} from '../../apps/web/lib/scrape-poll.ts';

const ok = (data) => ({ ok: true, status: 200, data });
const httpErr = (status, message = 'boom') => ({ ok: false, status, error: { code: `HTTP_${status}`, message } });

beforeEach(() => {
  _resetPollSeams();
  _setPollIntervalMs(5); // shrink the real 2s interval for tests
});
afterEach(() => _resetPollSeams());

describe('isAsyncAccepted', () => {
  it('detects the 202 async accept shape only', () => {
    expect(isAsyncAccepted({ mode: 'async', statusUrl: '/api/ai/action/status/x' })).toBe(true);
    expect(isAsyncAccepted({ mode: 'sync' })).toBe(false);
    expect(isAsyncAccepted({ mode: 'async' })).toBe(false);
    expect(isAsyncAccepted(null)).toBe(false);
    expect(isAsyncAccepted('x')).toBe(false);
  });
});

describe('pollOperation', () => {
  it('completed → returns result in sync shape', async () => {
    _setPollApiImpl(async () => ok({ status: 'completed', result: { coins: 7 } }));
    const res = await pollOperation('/status/op1');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ coins: 7 });
  });

  it('queued → completed across polls; failed → JOB_FAILED with upstream message', async () => {
    let n = 0;
    _setPollApiImpl(async () => {
      n += 1;
      return ok({ status: n < 3 ? 'processing' : 'completed', result: 'done' });
    });
    const res = await pollOperation('/status/op2');
    expect(res.ok).toBe(true);
    expect(n).toBe(3);

    _setPollApiImpl(async () => ok({ status: 'failed', error: { message: 'upstream exploded' } }));
    const fail = await pollOperation('/status/op3');
    expect(fail.ok).toBe(false);
    expect(fail.error.code).toBe('JOB_FAILED');
    expect(fail.error.message).toBe('upstream exploded');
  });

  it('transient 5xx tolerated — a prisma blip does not abandon a live job', async () => {
    let n = 0;
    _setPollApiImpl(async () => {
      n += 1;
      if (n <= 2) return httpErr(503);
      return ok({ status: 'completed', result: 'recovered' });
    });
    const res = await pollOperation('/status/op4');
    expect(res.ok).toBe(true);
    expect(res.data).toBe('recovered');
    expect(n).toBe(3);
  });

  it('3 consecutive 5xx → STATUS_POLL_FAILED (gives up)', async () => {
    let n = 0;
    _setPollApiImpl(async () => { n += 1; return httpErr(500); });
    const res = await pollOperation('/status/op5');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('STATUS_POLL_FAILED');
    expect(n).toBe(3);
  });

  it('definitive 4xx returns immediately (no burn of failure budget)', async () => {
    let n = 0;
    _setPollApiImpl(async () => { n += 1; return httpErr(404, 'gone'); });
    const res = await pollOperation('/status/op6');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(n).toBe(1);
  });

  it('honours the 202 retry_after_ms as the first poll delay', async () => {
    const t0 = Date.now();
    _setPollApiImpl(async () => ok({ status: 'completed', result: 1 }));
    const res = await pollOperation('/status/op7', undefined, 120);
    expect(res.ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('aborted signal → ABORTED, no poll calls', async () => {
    const controller = new AbortController();
    controller.abort();
    let n = 0;
    _setPollApiImpl(async () => { n += 1; return ok({ status: 'completed' }); });
    const res = await pollOperation('/status/op8', controller.signal);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('ABORTED');
    expect(n).toBe(0);
  });
});
