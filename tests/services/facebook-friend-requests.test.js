// by nichxbt
// Tests for Story 4.7: sendFriendRequests (Cluster-2, FR-21)
// Browser-free: fake page + injected requestFn/searchFn/delay-spy seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  sendFriendRequests,
  FRIEND_REQUEST_DELAY_FLOOR_MS,
  ACCOUNT_RISK_WARNING,
} from '../../api/services/facebookAutomation.js';

// Delay spy: records every (min,max); never actually sleeps.
function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

function makeFakePage() {
  const calls = { goto: [] };
  return {
    calls,
    goto: async (u) => { calls.goto.push(u); },
    click: async () => {},
    $: async () => null,
    $$eval: async () => [],
    evaluate: async () => {},
    waitForSelector: async () => ({}),
  };
}

// requestFn seam: returns per-profile status; throwOn simulates a not-found/unreachable.
function makeRequestFn({ alreadyFriendOn = null, pendingOn = null, throwOn = null } = {}) {
  const calls = [];
  const fn = async (page, profileUrl) => {
    calls.push({ page, profileUrl });
    if (throwOn === profileUrl) {
      throw new Error('❌ Add Friend button not found; profile unreachable or locale unsupported');
    }
    if (alreadyFriendOn === profileUrl) return { sent: false, status: 'already_friend' };
    if (pendingOn === profileUrl) return { sent: false, status: 'pending' };
    return { sent: true, status: 'sent' };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/profile.php?id=1001';
const URL_B = 'https://www.facebook.com/profile.php?id=1002';
const URL_C = 'https://www.facebook.com/johndoe';

const noDelay = makeDelaySpy();

// ── uid_list mode ─────────────────────────────────────────────────────────────

describe('sendFriendRequests — uid_list mode', () => {
  it('dry-run: preview of targets, no browser, no requests', async () => {
    const page = makeFakePage();
    const requestFn = makeRequestFn();
    const result = await sendFriendRequests(
      page,
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { requestFn, delay: noDelay },
    );
    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([
      { target: URL_A, action: 'pending' },
      { target: URL_B, action: 'pending' },
    ]);
    expect(requestFn.calls).toHaveLength(0);
    expect(page.calls.goto).toHaveLength(0);
  });

  it('real: requestFn called once per target; sent → ok', async () => {
    const page = makeFakePage();
    const requestFn = makeRequestFn();
    const delay = makeDelaySpy();
    const result = await sendFriendRequests(
      page,
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn, delay, maxRetry: 0 },
    );
    expect(requestFn.calls.map((c) => c.profileUrl)).toEqual([URL_A, URL_B]);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.results.find((r) => r.target === URL_A).status).toBe('sent');
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('already_friend → ok:true with status, NOT failed', async () => {
    const requestFn = makeRequestFn({ alreadyFriendOn: URL_B });
    const result = await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    const b = result.results.find((r) => r.target === URL_B);
    expect(b.ok).toBe(true);
    expect(b.status).toBe('already_friend');
    expect(result.failed).toBe(0);
  });

  it('pending → ok:true with status, NOT failed', async () => {
    const requestFn = makeRequestFn({ pendingOn: URL_A });
    const result = await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(true);
    expect(a.status).toBe('pending');
    expect(result.failed).toBe(0);
  });

  it('a request that throws → ok:false, PII-free error, batch continues', async () => {
    const requestFn = makeRequestFn({ throwOn: URL_A });
    const result = await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(requestFn.calls).toHaveLength(2); // continued past failure
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(false);
    expect(a.error).toContain('Add Friend button not found');
    expect(a.error).not.toMatch(/c_user|xs=|cookie/i);
    expect(result.results.find((r) => r.target === URL_B).ok).toBe(true);
  });
});

// ── suggestions mode ──────────────────────────────────────────────────────────

describe('sendFriendRequests — suggestions mode', () => {
  it('dry-run: empty preview + warning, no browser navigation', async () => {
    const page = makeFakePage();
    const searchFn = async () => [{ name: 'X', profileUrl: URL_A, location: null }];
    const result = await sendFriendRequests(
      page,
      { mode: 'suggestions', limit: 5 },
      { searchFn, requestFn: makeRequestFn(), delay: noDelay },
    );
    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([]);
    expect(result.warning).toContain('suggestions-mode dry-run');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('real: injected searchFn returns URLs → those become batch items', async () => {
    const page = makeFakePage();
    const searchFn = async () => [
      { name: 'Alice', profileUrl: URL_A, location: 'Hanoi' },
      { name: 'Bob', profileUrl: URL_B, location: 'Saigon' },
    ];
    const requestFn = makeRequestFn();
    const result = await sendFriendRequests(
      page,
      { mode: 'suggestions', limit: 5 },
      { dryRun: false, searchFn, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(requestFn.calls.map((c) => c.profileUrl)).toEqual([URL_A, URL_B]);
    expect(result.succeeded).toBe(2);
  });

  it('real: empty search results → empty result, no throw', async () => {
    const result = await sendFriendRequests(
      makeFakePage(),
      { mode: 'suggestions', limit: 5 },
      { dryRun: false, searchFn: async () => [], delay: noDelay },
    );
    expect(result.results).toEqual([]);
    expect(result.attempted).toBe(0);
  });
});

// ── location mode ─────────────────────────────────────────────────────────────

describe('sendFriendRequests — location mode', () => {
  it('filters collected profiles by location substring (case-insensitive)', async () => {
    const page = makeFakePage();
    const searchFn = async () => [
      { name: 'Alice', profileUrl: URL_A, location: 'Hanoi, Vietnam' },
      { name: 'Bob', profileUrl: URL_B, location: 'Ho Chi Minh City' },
      { name: 'Carol', profileUrl: URL_C, location: 'HANOI' },
    ];
    const requestFn = makeRequestFn();
    const result = await sendFriendRequests(
      page,
      { mode: 'location', location: 'hanoi', limit: 10 },
      { dryRun: false, searchFn, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    // Only Alice + Carol match 'hanoi'
    expect(requestFn.calls.map((c) => c.profileUrl).sort()).toEqual([URL_A, URL_C].sort());
  });

  it('location mode requires a non-empty location on real run → throws', async () => {
    await expect(
      sendFriendRequests(
        makeFakePage(),
        { mode: 'location', limit: 5 },
        { dryRun: false, searchFn: async () => [], delay: noDelay },
      ),
    ).rejects.toThrow('location');
  });

  it('dry-run: empty preview + warning (no browser)', async () => {
    const page = makeFakePage();
    const result = await sendFriendRequests(
      page,
      { mode: 'location', location: 'hanoi', limit: 5 },
      { searchFn: async () => [], delay: noDelay },
    );
    expect(result.dryRun).toBe(true);
    expect(result.warning).toContain('location-mode dry-run');
    expect(page.calls.goto).toHaveLength(0);
  });
});

// ── NFR-11: no PII collection ──────────────────────────────────────────────────

describe('sendFriendRequests — NFR-11 PII filter', () => {
  it('phone/email in collected location → stripped before location filter', async () => {
    const page = makeFakePage();
    // location field carries a phone number; after strip it should not match a phone needle
    const searchFn = async () => [
      { name: 'Alice +84 912 345 678', profileUrl: URL_A, location: 'Hanoi bob@x.com' },
    ];
    const requestFn = makeRequestFn();
    const result = await sendFriendRequests(
      page,
      { mode: 'location', location: 'hanoi', limit: 5 },
      { dryRun: false, searchFn, requestFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    // Alice still matches 'hanoi' (the word survives, the email/phone are stripped)
    expect(requestFn.calls.map((c) => c.profileUrl)).toEqual([URL_A]);
    // The result target is the profileUrl (no PII leaks into batch targets)
    expect(result.results[0].target).toBe(URL_A);
    expect(JSON.stringify(result)).not.toMatch(/bob@x\.com/);
    expect(JSON.stringify(result)).not.toMatch(/912 345 678/);
  });
});

// ── delay floor (60s, Cluster 2) ────────────────────────────────────────────────

describe('sendFriendRequests — 60s delay floor (NFR-6 Cluster 2)', () => {
  it('FRIEND_REQUEST_DELAY_FLOOR_MS constant is 60000', () => {
    expect(FRIEND_REQUEST_DELAY_FLOOR_MS).toBe(60000);
  });

  it('delayMin: 10000 → spy receives >= 60000', async () => {
    const delay = makeDelaySpy();
    await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn: makeRequestFn(), delay, delayMin: 10000, maxRetry: 0 },
    );
    expect(delay.calls.length).toBeGreaterThan(0);
    for (const [min] of delay.calls) {
      expect(min).toBeGreaterThanOrEqual(FRIEND_REQUEST_DELAY_FLOOR_MS);
    }
  });

  it('default delay range is 60000/180000 when caller omits it', async () => {
    const delay = makeDelaySpy();
    await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A, URL_B] },
      { dryRun: false, requestFn: makeRequestFn(), delay, maxRetry: 0 },
    );
    expect(delay.calls[0]).toEqual([60000, 180000]);
  });
});

// ── validation + batchLimit ─────────────────────────────────────────────────────

describe('sendFriendRequests — validation', () => {
  it('missing/invalid mode → throws', async () => {
    await expect(
      sendFriendRequests(makeFakePage(), { targets: [URL_A] }, { dryRun: false }),
    ).rejects.toThrow('mode');
    await expect(
      sendFriendRequests(makeFakePage(), { mode: 'bogus', targets: [URL_A] }, { dryRun: false }),
    ).rejects.toThrow('mode');
  });

  it('uid_list with empty targets → throws', async () => {
    await expect(
      sendFriendRequests(makeFakePage(), { mode: 'uid_list', targets: [] }, { dryRun: false }),
    ).rejects.toThrow('non-empty');
  });

  it('invalid / non-facebook target URL → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      sendFriendRequests(
        page,
        { mode: 'uid_list', targets: ['https://evil.com/profile/1'] },
        { dryRun: false },
      ),
    ).rejects.toThrow('facebook.com');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('batchLimit: 21 targets → runGuardedBatch throws maxBatch (inherited)', async () => {
    const targets = Array.from({ length: 21 }, (_, i) => `https://www.facebook.com/profile.php?id=${i}`);
    await expect(
      sendFriendRequests(
        makeFakePage(),
        { mode: 'uid_list', targets },
        { dryRun: false, requestFn: makeRequestFn(), delay: makeDelaySpy() },
      ),
    ).rejects.toThrow(/maxBatch|exceeds/i);
  });

  it('missing input object → throws', async () => {
    await expect(
      sendFriendRequests(makeFakePage(), null, { dryRun: false }),
    ).rejects.toThrow();
  });

  it('real-run result surfaces ACCOUNT_RISK_WARNING (NFR-8)', async () => {
    const result = await sendFriendRequests(
      makeFakePage(),
      { mode: 'uid_list', targets: [URL_A] },
      { dryRun: false, requestFn: makeRequestFn(), delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.warning).toBe(ACCOUNT_RISK_WARNING);
  });
});
