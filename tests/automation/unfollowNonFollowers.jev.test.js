// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.8 — unfollowNonFollowers × Jev guard wiring tests.
 *
 * Browser path: `vi.mock` browserAutomation (createPage/getFollowing/
 * getFollowers/unfollowUser) and stub global fetch — the real
 * jevUnfollowGuard + real JevBrain run end-to-end over the mocked HTTP
 * boundary, keyed off state.username.
 *
 * API path: `vi.mock` prisma + getTwitterClient — same real guard, exercised
 * through the fused per-user loop.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

const mockPage = { close: vi.fn(async () => {}) };

vi.mock('../../api/services/browserAutomation.js', () => ({
  createPage: vi.fn(async () => mockPage),
  navigateToTwitter: vi.fn(async () => {}),
  checkAuthentication: vi.fn(async () => true),
  getFollowing: vi.fn(async () => []),
  getFollowers: vi.fn(async () => []),
  unfollowUser: vi.fn(async () => ({ success: true })),
  randomDelay: vi.fn(async () => {}),
}));

vi.mock('../../api/lib/prisma.js', () => ({
  default: {
    operation: { update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock('../../api/routes/twitter.js', () => ({
  getTwitterClient: vi.fn(async () => ({})),
}));

import {
  createPage,
  getFollowing,
  getFollowers,
  unfollowUser,
} from '../../api/services/browserAutomation.js';
import prisma from '../../api/lib/prisma.js';
import { getTwitterClient } from '../../api/routes/twitter.js';
import { unfollowNonFollowersBrowser } from '../../api/services/operations/puppeteer/unfollowNonFollowers.js';
import { processUnfollowNonFollowers } from '../../api/services/operations/unfollowNonFollowers.js';

// ── Fetch stub — Jev System One boundary ─────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Program the Jev endpoint: `verdicts` maps username → {choice, confidence}.
 * A username of '__http__' with status forces an HTTP error for every call.
 */
function mockJevEndpoint(verdictByUsername, { httpStatus = 200 } = {}) {
  mockFetch.mockImplementation(async (_url, init) => {
    const state = JSON.parse(init.body).state;
    if (httpStatus !== 200) {
      return {
        ok: false,
        status: httpStatus,
        text: async () => 'upstream error',
      };
    }
    const v = verdictByUsername[state.username] || { choice: 'keep_active_peer', confidence: 0.9 };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        answers: { verdict: { type: 'choice', choice: v.choice, confidence: v.confidence } },
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
      text: async () => '{}',
    };
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VIP = { username: 'bigceo', name: 'Big CEO', bio: 'CEO @ BigCo, 500k followers', verified: true, followersCount: 500000 };
const SPAM = { username: 'airdrop_farm', name: 'Airdrop Farm', bio: 'crypto airdrop farmer 🚀 DM for promo', verified: false, followersCount: 12 };
const PEER = { username: 'real_peer', name: 'Real Peer', bio: 'dev, coffee, shipping', verified: false, followersCount: 900 };
const FOLLOWER = { username: 'mutual', name: 'Mutual', bio: 'follows back', verified: false, followersCount: 50 };

const noopProgress = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  // vitest.config defaults JEV_COGNITIVE_UNFOLLOW=0 — enable per test.
  vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '1');
  vi.stubEnv('TYPESAFE_API_KEY', 'test-jev-key'); // never a live key
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Browser executor — puppeteer/unfollowNonFollowers.js
// ---------------------------------------------------------------------------

describe('unfollowNonFollowersBrowser + Jev guard', () => {
  function setupLists() {
    getFollowing.mockResolvedValue([VIP, SPAM, PEER, FOLLOWER]);
    getFollowers.mockResolvedValue([FOLLOWER]); // only mutual follows back
  }

  it('spam verdict → unfollowUser; VIP verdict → kept, lands in keptByJev', async () => {
    setupLists();
    mockJevEndpoint({
      bigceo: { choice: 'keep_high_value_influencer', confidence: 0.9 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.9 },
      real_peer: { choice: 'keep_active_peer', confidence: 0.8 },
    });

    const result = await unfollowNonFollowersBrowser('u1', { sessionCookie: 'c', username: 'me' }, noopProgress);

    expect(unfollowUser).toHaveBeenCalledTimes(1);
    expect(unfollowUser).toHaveBeenCalledWith(mockPage, 'airdrop_farm');
    expect(unfollowUser).not.toHaveBeenCalledWith(mockPage, 'bigceo');
    expect(result.unfollowed).toEqual(['airdrop_farm']);
    expect(result.keptByJev).toEqual(expect.arrayContaining(['bigceo', 'real_peer']));
    expect(result.keptByJev).toHaveLength(2);
    expect(result.success).toBe(true);
  });

  it('low-confidence unfollow_* verdict → kept (fail-safe polarity)', async () => {
    setupLists();
    mockJevEndpoint({
      bigceo: { choice: 'unfollow_dead', confidence: 0.5 }, // below 0.70
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.69 }, // below 0.70
      real_peer: { choice: 'unfollow_spam', confidence: 0.95 },
    });

    const result = await unfollowNonFollowersBrowser('u1', { sessionCookie: 'c', username: 'me' }, noopProgress);

    expect(unfollowUser).toHaveBeenCalledTimes(1);
    expect(unfollowUser).toHaveBeenCalledWith(mockPage, 'real_peer');
    expect(result.keptByJev).toEqual(expect.arrayContaining(['bigceo', 'airdrop_farm']));
  });

  it('Jev fully degraded → unfollowed:[], keptByJev = all candidates, jevDegraded = N, success', async () => {
    setupLists();
    mockJevEndpoint({}, { httpStatus: 400 }); // immediate degrade, no retry backoff

    const result = await unfollowNonFollowersBrowser('u1', { sessionCookie: 'c', username: 'me' }, noopProgress);

    expect(unfollowUser).not.toHaveBeenCalled();
    expect(result.unfollowed).toEqual([]);
    expect(result.keptByJev).toEqual(expect.arrayContaining(['bigceo', 'airdrop_farm', 'real_peer']));
    expect(result.jevDegraded).toBe(3);
    expect(result.success).toBe(true);
  });

  it('KILL_SWITCH: JEV_COGNITIVE_UNFOLLOW=0 → zero decide calls, unfollows all non-followers', async () => {
    vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '0');
    setupLists();
    mockJevEndpoint({});

    const result = await unfollowNonFollowersBrowser('u1', { sessionCookie: 'c', username: 'me' }, noopProgress);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(unfollowUser).toHaveBeenCalledTimes(3);
    expect(result.unfollowed).toEqual(['bigceo', 'airdrop_farm', 'real_peer']);
    expect(result.jevDegraded).toBe(0);
  });

  it('dryRun:true → zero unfollowUser calls, returns dryRun + verdicts preview (pre-existing gap fix)', async () => {
    setupLists();
    mockJevEndpoint({
      bigceo: { choice: 'keep_high_value_influencer', confidence: 0.9 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.9 },
      real_peer: { choice: 'unfollow_spam', confidence: 0.4 }, // low-conf → kept
    });

    const result = await unfollowNonFollowersBrowser(
      'u1',
      { sessionCookie: 'c', username: 'me', dryRun: true },
      noopProgress,
    );

    expect(unfollowUser).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.success).toBe(true);
    expect(result.wouldUnfollow).toEqual(['airdrop_farm']);
    expect(result.keptByJev).toEqual(expect.arrayContaining(['bigceo', 'real_peer']));
    const verdictMap = new Map(result.verdicts.map((v) => [v.username, v]));
    expect(verdictMap.get('airdrop_farm').choice).toBe('unfollow_spam');
    expect(verdictMap.get('bigceo').choice).toBe('keep_high_value_influencer');
  });

  it('maxUnfollows (route field) bounds evaluation AND the unfollow loop to the same slice', async () => {
    setupLists();
    mockJevEndpoint({
      bigceo: { choice: 'unfollow_dead', confidence: 0.9 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.9 },
    });

    const result = await unfollowNonFollowersBrowser(
      'u1',
      { sessionCookie: 'c', username: 'me', maxUnfollows: 2 },
      noopProgress,
    );

    // Only the first 2 non-followers are operative — Jev sees exactly those.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(unfollowUser).toHaveBeenCalledTimes(2);
    expect(result.unfollowed).toEqual(['bigceo', 'airdrop_farm']);
  });

  it('eval budget < candidates → beyond-budget accounts are KEPT (deferred), never unfollowed', async () => {
    vi.stubEnv('JEV_UNFOLLOW_MAX_EVALS', '2');
    setupLists();
    mockJevEndpoint({
      bigceo: { choice: 'unfollow_dead', confidence: 0.9 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.9 },
      real_peer: { choice: 'unfollow_spam', confidence: 0.9 }, // never evaluated
    });

    const result = await unfollowNonFollowersBrowser('u1', { sessionCookie: 'c', username: 'me' }, noopProgress);

    // The operative slice is capped at the eval budget — real_peer is never
    // seen by the loop, so it is neither unfollowed nor counted as keptByJev.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(unfollowUser).toHaveBeenCalledTimes(2);
    expect(unfollowUser).not.toHaveBeenCalledWith(mockPage, 'real_peer');
    expect(result.unfollowed).toEqual(['bigceo', 'airdrop_farm']);
    expect(result.keptByJev).toEqual([]);
    expect(result.nonFollowers).toHaveLength(3); // real_peer still reported as a non-follower
  });
});

// ---------------------------------------------------------------------------
// API executor — operations/unfollowNonFollowers.js (fused loop)
// ---------------------------------------------------------------------------

describe('processUnfollowNonFollowers + Jev guard (fused loop)', () => {
  const MY_ID = 'my-twitter-id';

  function setupApi() {
    prisma.operation.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', twitterAccessToken: 'tok' });

    const following = [
      { id: 'id-vip', username: 'bigceo', name: 'Big CEO', description: 'CEO @ BigCo', verified: true, public_metrics: { followers_count: 500000 } },
      { id: 'id-spam', username: 'airdrop_farm', name: 'Farm', description: 'crypto airdrop farmer', verified: false, public_metrics: { followers_count: 9 } },
      { id: 'id-mutual', username: 'mutual', name: 'Mutual', description: 'fb', verified: false },
    ];

    const client = {
      get: vi.fn(async (url) => {
        if (url === '/users/me') return { data: { data: { id: MY_ID } } };
        if (url === `/users/${MY_ID}/following`) return { data: { data: following } };
        if (url === '/users/id-vip/followers') return { data: { data: [{ id: 'someone' }] } }; // not me → non-follower
        if (url === '/users/id-spam/followers') return { data: { data: [] } }; // non-follower
        if (url === '/users/id-mutual/followers') return { data: { data: [{ id: MY_ID }] } }; // follows back
        return { data: { data: [] } };
      }),
      delete: vi.fn(async () => ({ data: {} })),
    };
    getTwitterClient.mockResolvedValue(client);
    return client;
  }

  it('requests expanded user.fields (bio/verified/metrics) for the Jev state', async () => {
    const client = setupApi();
    mockJevEndpoint({});

    await processUnfollowNonFollowers({ operationId: 'op1', userId: 'u1', config: { maxUnfollows: 10 } });

    const followingCall = client.get.mock.calls.find((c) => c[0] === `/users/${MY_ID}/following`);
    expect(followingCall[1].params['user.fields']).toBe('username,name,description,verified,public_metrics');
  });

  it('inline guard: VIP kept (no delete), spam deleted, follows-back untouched', async () => {
    const client = setupApi();
    mockJevEndpoint({
      bigceo: { choice: 'keep_high_value_influencer', confidence: 0.92 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.88 },
    });

    const result = await processUnfollowNonFollowers({ operationId: 'op1', userId: 'u1', config: { maxUnfollows: 10 } });

    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(`/users/${MY_ID}/following/id-spam`);
    expect(result.unfollowedCount).toBe(1);
    expect(result.keptByJev).toEqual(['bigceo']);
    // mutual never reaches Jev — followsBack check precedes the guard.
    const evaluated = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body).state.username);
    expect(evaluated.sort()).toEqual(['airdrop_farm', 'bigceo']);
  });

  it('degraded Jev → zero deletes, accounts kept, job completes', async () => {
    const client = setupApi();
    mockJevEndpoint({}, { httpStatus: 400 });

    const result = await processUnfollowNonFollowers({ operationId: 'op1', userId: 'u1', config: { maxUnfollows: 10 } });

    expect(client.delete).not.toHaveBeenCalled();
    expect(result.unfollowedCount).toBe(0);
    expect(result.jevDegraded).toBe(2); // vip + spam (mutual follows back, never evaluated)
    expect(result.keptByJev).toEqual(expect.arrayContaining(['bigceo', 'airdrop_farm']));
  });

  it('KILL_SWITCH: JEV_COGNITIVE_UNFOLLOW=0 → zero decide calls, deletes all non-followers', async () => {
    vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '0');
    const client = setupApi();
    mockJevEndpoint({});

    const result = await processUnfollowNonFollowers({ operationId: 'op1', userId: 'u1', config: { maxUnfollows: 10 } });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledTimes(2);
    expect(result.unfollowedCount).toBe(2);
  });

  it('dryRun:true → zero client.delete, result.dryRun true, verdicts previewed per user', async () => {
    const client = setupApi();
    mockJevEndpoint({
      bigceo: { choice: 'keep_high_value_influencer', confidence: 0.92 },
      airdrop_farm: { choice: 'unfollow_spam', confidence: 0.88 },
    });

    const result = await processUnfollowNonFollowers({
      operationId: 'op1',
      userId: 'u1',
      config: { maxUnfollows: 10, dryRun: true },
    });

    expect(client.delete).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.unfollowedCount).toBe(0);
    expect(result.verdicts).toEqual(expect.arrayContaining([
      { username: 'bigceo', choice: 'keep_high_value_influencer', confidence: 0.92 },
      { username: 'airdrop_farm', choice: 'unfollow_spam', confidence: 0.88 },
    ]));
    expect(result.keptByJev).toEqual(['bigceo']);
  });

  it('eval budget exhausted → beyond-budget non-followers are KEPT (deferred), not deleted', async () => {
    vi.stubEnv('JEV_UNFOLLOW_MAX_EVALS', '1');
    const client = setupApi();
    mockJevEndpoint({ bigceo: { choice: 'unfollow_dead', confidence: 0.9 } });

    const result = await processUnfollowNonFollowers({ operationId: 'op1', userId: 'u1', config: { maxUnfollows: 10 } });

    // Only bigceo got a paid verdict; airdrop_farm is beyond budget → kept.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(`/users/${MY_ID}/following/id-vip`);
    expect(result.unfollowedCount).toBe(1);
    expect(result.keptByJev).toEqual(['airdrop_farm']);
    expect(result.verdicts).toHaveLength(1);
  });
});
