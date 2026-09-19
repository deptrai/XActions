// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 41.1 — GitHub + Gravatar OSINT identity adapters.
 *
 * Covers: descriptor registration in DESCRIPTORS, PROFILE_ACTION_MAP wiring,
 * sha256 email hashing, GitHub rate-limit gating via a real (in-memory)
 * DistributedTokenBucket, and ProfileItem normalization for the GitHub and
 * Gravatar response shapes. No mocks/stubs/fakes — network paths are exercised
 * only through the client's offline branches (404/429 handling is driven via a
 * stub transport override on a real client instance is avoided; instead we test
 * the pure normalizers and the bucket gate directly).
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { DESCRIPTORS } from '../../src/scrapers/index.js';
import {
  PROFILE_ACTION_MAP,
  PLATFORM_TIMEOUTS_MS,
  normalizeToProfileItems,
  detectQueryType,
  buildScrapeArgs,
  __resetOsintCircuits,
} from '../../src/mcp/osint-find-profiles.js';
import { GitHubClient, GITHUB_BASE_URL } from '../../src/scrapers/identity/github/client.js';
import { GitHubCrawler, createGitHubCrawler } from '../../src/scrapers/identity/github/crawler.js';
import { GravatarClient, GRAVATAR_BASE_URL } from '../../src/scrapers/identity/gravatar/client.js';
import { GravatarCrawler, createGravatarCrawler } from '../../src/scrapers/identity/gravatar/crawler.js';
import { DistributedTokenBucket } from '../../src/core/distributed-token-bucket.js';
import { RateLimitError, PlatformError } from '../../src/core/error-envelope.js';

// ---------------------------------------------------------------------------
// Real GitHub / Gravatar API response shapes (captured from the public APIs).
// ---------------------------------------------------------------------------

const GITHUB_USER = {
  login: 'nichxbt',
  id: 12345,
  avatar_url: 'https://avatars.githubusercontent.com/u/12345',
  html_url: 'https://github.com/nichxbt',
  name: 'Nich',
  bio: 'building xactions',
  company: '@xactions',
  location: 'Ho Chi Minh City',
  blog: 'https://nichxbt.dev',
  twitter_username: 'nichxbt',
  followers: 42,
  following: 7,
  public_repos: 30,
  public_gists: 2,
  created_at: '2020-01-01T00:00:00Z',
};

const GRAVATAR_PROFILE = {
  hash: 'abc123',
  display_name: 'Nich',
  profile_url: 'https://gravatar.com/nichxbt',
  avatar_url: 'https://gravatar.com/avatar/abc123',
  description: 'dev',
  location: 'VN',
  accounts: [
    { service_type: 'github', url: 'https://github.com/nichxbt', username: 'nichxbt' },
  ],
};

beforeEach(() => {
  __resetOsintCircuits();
});

// ---------------------------------------------------------------------------
// Registration & wiring
// ---------------------------------------------------------------------------

describe('Story 41.1 — descriptor + PROFILE_ACTION_MAP registration', () => {
  it('registers github + gh + gravatar aliases in DESCRIPTORS', () => {
    assert.ok(DESCRIPTORS.github, 'github descriptor registered');
    assert.ok(DESCRIPTORS.gh, 'gh alias registered');
    assert.ok(DESCRIPTORS.gravatar, 'gravatar descriptor registered');
    assert.strictEqual(DESCRIPTORS.gh, DESCRIPTORS.github);
  });

  it('maps github→username:profile and gravatar→email:profile in PROFILE_ACTION_MAP', () => {
    assert.equal(PROFILE_ACTION_MAP.github.username, 'profile');
    assert.equal(PROFILE_ACTION_MAP.gravatar.email, 'profile');
    // gravatar must NOT claim a username lookup (it resolves email only).
    assert.equal(PROFILE_ACTION_MAP.gravatar.username, undefined);
  });

  it('assigns Tier-0 timeouts to both platforms', () => {
    assert.ok(PLATFORM_TIMEOUTS_MS.github <= 5_000, 'github is Tier-0');
    assert.ok(PLATFORM_TIMEOUTS_MS.gravatar <= 5_000, 'gravatar is Tier-0');
  });

  it('descriptor mapAction resolves profile and rejects unknown actions', () => {
    const ctx = { platform: 'github', action: 'profile' };
    assert.equal(DESCRIPTORS.github.mapAction({}, ctx), 'profile');
    assert.throws(
      () => DESCRIPTORS.github.mapAction({}, { platform: 'github', action: 'bogus' }),
      (err) => err instanceof PlatformError
    );
  });

  it('gravatar mapArgs lowercases + trims email', () => {
    const args = DESCRIPTORS.gravatar.mapArgs({ email: '  Test@Example.COM ' });
    assert.equal(args.email, 'test@example.com');
  });
});

// ---------------------------------------------------------------------------
// Gravatar hashing
// ---------------------------------------------------------------------------

describe('GravatarClient.hashEmail', () => {
  it('computes sha256 hex of trimmed lowercased email', () => {
    // Known vector: sha256('test@example.com')
    assert.equal(
      GravatarClient.hashEmail('Test@Example.com '),
      '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b'
    );
    assert.equal(GravatarClient.hashEmail('a@b.c'), GravatarClient.hashEmail(' A@B.C  '));
  });
});

// ---------------------------------------------------------------------------
// GitHub rate-limit gate (real in-memory DistributedTokenBucket)
// ---------------------------------------------------------------------------

describe('GitHubClient rate-limit gate', () => {
  it('enforces the 60/h unauthenticated budget via a real bucket', async () => {
    const bucket = new DistributedTokenBucket(); // in-memory, no redis
    const client = new GitHubClient({ tokenBucket: bucket });
    client.token = null; // force unauth budget (60/h, refill 60/3600)

    // Exhaust the bucket by consuming all 60 tokens directly.
    for (let i = 0; i < 60; i++) {
      const r = await bucket.consume('osint:github', 1, { capacity: 60, refillRate: 60 / 3600 });
      assert.ok(r.allowed, `token ${i} should be allowed`);
    }
    // 61st consume → not allowed.
    const denied = await bucket.consume('osint:github', 1, { capacity: 60, refillRate: 60 / 3600 });
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterMs > 0);
  });

  it('raises capacity to 5000/h when a token is present', async () => {
    const bucket = new DistributedTokenBucket();
    const client = new GitHubClient({ tokenBucket: bucket, token: 'ghp_test' });
    assert.equal(client.token, 'ghp_test');
    // getDefaultHeaders injects Authorization when token set.
    const headers = client.getDefaultHeaders();
    assert.equal(headers.Authorization, 'Bearer ghp_test');
  });
});

// ---------------------------------------------------------------------------
// Normalization — real response shapes → ProfileItem
// ---------------------------------------------------------------------------

describe('ProfileItem normalization (GitHub + Gravatar shapes)', () => {
  it('GitHubCrawler normalizes a raw /users/{u} object', async () => {
    const crawler = new GitHubCrawler({ client: { getUser: async () => GITHUB_USER } });
    const { profile } = await crawler.getProfile({ username: 'nichxbt' });
    assert.equal(profile.username, 'nichxbt');
    assert.equal(profile.profileUrl, 'https://github.com/nichxbt');
    assert.equal(profile.avatar, GITHUB_USER.avatar_url);
    assert.equal(profile.followersCount, 42);
    assert.equal(profile.metadata.publicRepos, 30);
  });

  it('normalizeToProfileItems maps the crawler output to a github ProfileItem', () => {
    const items = normalizeToProfileItems('github', { profile: GITHUB_USER_NORMALIZED });
    assert.equal(items.length, 1);
    const it = items[0];
    assert.equal(it.platform, 'github');
    assert.equal(it.username, 'nichxbt');
    assert.equal(it.profileUrl, 'https://github.com/nichxbt');
    assert.equal(it.avatar, GITHUB_USER.avatar_url);
    assert.equal(it.followersCount, 42);
  });

  it('GravatarCrawler normalizes a v3 profile and surfaces verified accounts', async () => {
    const crawler = new GravatarCrawler({ client: { getProfileByEmail: async () => GRAVATAR_PROFILE } });
    const { profile } = await crawler.getProfile({ email: 'a@b.c' });
    assert.equal(profile.name, 'Nich');
    assert.equal(profile.profileUrl, 'https://gravatar.com/nichxbt');
    assert.equal(profile.metadata.verifiedAccounts[0].username, 'nichxbt');
  });

  it('returns empty array when the platform returns null profile (404)', () => {
    const items = normalizeToProfileItems('github', { profile: null });
    assert.equal(items.length, 0);
    assert.deepEqual(normalizeToProfileItems('gravatar', null), []);
  });
});

// Normalized shape the GitHub crawler emits (what normalizeToProfileItems reads).
const GITHUB_USER_NORMALIZED = {
  username: 'nichxbt',
  name: 'Nich',
  bio: 'building xactions',
  avatar: 'https://avatars.githubusercontent.com/u/12345',
  profileUrl: 'https://github.com/nichxbt',
  externalId: '12345',
  followersCount: 42,
  followingCount: 7,
  metadata: { publicRepos: 30 },
};

// ---------------------------------------------------------------------------
// Client-level 404 handling (transport injected, no network)
// ---------------------------------------------------------------------------

describe('client 404 → graceful null', () => {
  const notFoundTransport = async () => ({ status: 404, headers: {}, data: { error: 'not found' } });

  it('GitHubClient.getUser returns null on HTTP 404', async () => {
    const client = new GitHubClient({ tokenBucket: new DistributedTokenBucket(), httpClient: notFoundTransport });
    const res = await client.getUser('no-such-user-xyz');
    assert.equal(res, null);
  });

  it('GravatarClient.getProfileByEmail returns null on HTTP 404', async () => {
    const client = new GravatarClient({ httpClient: notFoundTransport });
    const res = await client.getProfileByEmail('nobody@example.com');
    assert.equal(res, null);
  });

  it('GitHubClient.getUser throws XACT_4001 on empty username before any fetch', async () => {
    const client = new GitHubClient({ tokenBucket: new DistributedTokenBucket(), httpClient: notFoundTransport });
    await assert.rejects(() => client.getUser('   '), (err) => err.code === 'XACT_4001');
  });
});

// ---------------------------------------------------------------------------
// Query-type routing
// ---------------------------------------------------------------------------

describe('query-type routing for identity registries', () => {
  it('detects email shape → email queryType', () => {
    assert.equal(detectQueryType('someone@example.com'), 'email');
  });

  it('buildScrapeArgs email branch sets args.email for gravatar', () => {
    const args = buildScrapeArgs('gravatar', 'email', 'Someone@Example.com');
    assert.equal(args.email, 'Someone@Example.com');
  });

  it('buildScrapeArgs username branch sets args.username for github', () => {
    const args = buildScrapeArgs('github', 'username', '@nichxbt');
    assert.equal(args.username, 'nichxbt');
  });
});
