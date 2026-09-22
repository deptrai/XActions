// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for x_social_find_profiles MCP tool — Story 36.1.
 * Covers tool registration, arg validation, query-type detection, VN phone
 * normalization, fan-out dispatch via DESCRIPTORS, per-platform timeout, and
 * the in-memory circuit counter. No mocks/stubs/fakes — a real lightweight
 * descriptor is injected into the live DESCRIPTORS registry.
 */

import { describe, it, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { TOOLS, executeTool, executeSocialFindProfilesTool } from '../../src/mcp/server.js';
import { DESCRIPTORS } from '../../src/scrapers/index.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import {
  detectQueryType,
  buildScrapeArgs,
  normalizeToProfileItems,
  __resetOsintCircuits,
  classifyPlatformError,
  PLATFORM_TIMEOUTS_MS,
} from '../../src/mcp/osint-find-profiles.js';
import { prefetchBioScores } from '../../src/osint/jev-bio-matcher.js';

// Story 42.5 — the ONLY production wiring of the bio matcher is the call site
// inside executeSocialFindProfiles; mock the module so the wiring itself is
// under test (a deleted/mis-wired call must fail a test, not pass silently).
// The mock qualifies a pair only when both profiles carry the marker bios.
vi.mock('../../src/osint/jev-bio-matcher.js', async () => {
  const { bioPairKey } = await vi.importActual('../../src/mcp/entity-resolver.js');
  return {
    prefetchBioScores: vi.fn(async (profiles) => {
      const map = new Map();
      const list = Array.isArray(profiles) ? profiles : [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].bio === 'WIRING_A' && list[j].bio === 'WIRING_B') {
            map.set(bioPairKey(list[i], list[j]), { score: 3, confidence: 0.9 });
          }
        }
      }
      return map;
    }),
  };
});
import { globalAdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { normalizeVnPhone, isVnPhone, parseVnPhone } from '../../src/utils/vn-phone.js';

// ---------------------------------------------------------------------------
// Real lightweight descriptor injected into the live DESCRIPTORS registry.
// This is NOT a mock — it is a genuine platform descriptor object conforming
// to the ActionDescriptor contract (mapArgs/createClient/createCrawler) that
// returns canned ProfileItem data via a real crawler.start() call.
// ---------------------------------------------------------------------------

/** @param {unknown} result @param {{delayMs?:number, fail?:Error}} [beh] */
function makeDescriptor(result, beh = {}) {
  return {
    aliases: ['testplat'],
    actionMap: { profile: 'profile', search: 'search' },
    mapArgs: (opts) => opts,
    createClient: () => ({}),
    createCrawler: () => ({
      async start() {
        if (beh.fail) throw beh.fail;
        if (beh.delayMs) await new Promise((r) => setTimeout(r, beh.delayMs));
        return typeof result === 'function' ? result() : result;
      },
      async cleanup() {},
    }),
  };
}

const PROFILE = {
  username: 'nichxbt',
  name: 'Nich',
  bio: 'dev',
  avatar: 'https://x/a.png',
  profileUrl: 'https://x.com/nichxbt',
  followersCount: 42,
};

beforeEach(() => {
  __resetOsintCircuits();
  delete DESCRIPTORS.testplat;
});

describe('x_social_find_profiles registration & schema', () => {
  it('registers the tool in TOOLS with required schema fields', () => {
    const tool = TOOLS.find((t) => t.name === 'x_social_find_profiles');
    assert.ok(tool, 'tool should be registered');
    assert.equal(tool.inputSchema.type, 'object');
    assert.deepEqual(tool.inputSchema.required, ['query']);
    const props = tool.inputSchema.properties;
    for (const k of ['query', 'queryType', 'platforms', 'locale', 'timeoutMs']) {
      assert.ok(props[k], `missing schema prop ${k}`);
    }
    assert.deepEqual(props.queryType.enum, ['auto', 'name', 'username', 'phone', 'email']);
  });
});

describe('validation', () => {
  it('throws XACT_4001 when query is missing', async () => {
    await assert.rejects(
      () => executeSocialFindProfilesTool({}),
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        return true;
      }
    );
  });

  it('throws XACT_4001 when query is empty string', async () => {
    await assert.rejects(
      () => executeSocialFindProfilesTool({ query: '   ' }),
      (err) => err.code === 'XACT_4001'
    );
  });

  it('throws XACT_4001 for invalid queryType', async () => {
    await assert.rejects(
      () => executeSocialFindProfilesTool({ query: 'x', queryType: 'bogus' }),
      (err) => err.code === 'XACT_4001'
    );
  });

  it('throws XACT_4001 for non-string queryType instead of coercing to auto', async () => {
    await assert.rejects(
      () => executeSocialFindProfilesTool({ query: 'x', queryType: 5 }),
      (err) => err.code === 'XACT_4001'
    );
    await assert.rejects(
      () => executeSocialFindProfilesTool({ query: 'x', queryType: true }),
      (err) => err.code === 'XACT_4001'
    );
  });
});

describe('detectQueryType + VN phone normalization', () => {
  it('detects username, name, phone, email', () => {
    assert.equal(detectQueryType('nichxbt'), 'username');
    assert.equal(detectQueryType('@nichxbt'), 'username');
    assert.equal(detectQueryType('Nguyen Van A'), 'name');
    assert.equal(detectQueryType('a@b.com'), 'email');
    assert.equal(detectQueryType('0901234567'), 'phone');
    assert.equal(detectQueryType('+84901234567'), 'phone');
  });

  it('normalizes VN phone variants to 0xxxxxxxxx', () => {
    assert.equal(normalizeVnPhone('0901234567'), '0901234567');
    assert.equal(normalizeVnPhone('+84901234567'), '0901234567');
    assert.equal(normalizeVnPhone('84901234567'), '0901234567');
    assert.equal(normalizeVnPhone('090 123 45 67'), '0901234567');
    assert.equal(normalizeVnPhone('not a phone'), null);
    assert.ok(isVnPhone('+84901234567'));
    assert.ok(!isVnPhone('hello'));
    // all VN mobile prefixes (052/055/056/058/059/087 included)
    for (const p of ['052', '055', '056', '058', '059', '087']) {
      assert.equal(normalizeVnPhone(p + '1234567'), p + '1234567', `prefix ${p} should normalize`);
    }
  });

  it('flags masked phones (… and ***) before stripping dots', () => {
    assert.equal(parseVnPhone('090...').phoneMasked, true);
    assert.equal(parseVnPhone('090***').phoneMasked, true);
    assert.equal(parseVnPhone('090 xxx').phoneMasked, true);
    assert.equal(normalizeVnPhone('090...'), null);
  });
});

describe('buildScrapeArgs', () => {
  it('maps username to username/handle/target', () => {
    const a = buildScrapeArgs('twitter', 'username', '@nichxbt');
    assert.equal(a.username, 'nichxbt');
    assert.equal(a.handle, 'nichxbt');
  });
  it('maps phone to normalized query/phone', () => {
    const a = buildScrapeArgs('chotot', 'phone', '+84901234567');
    assert.equal(a.phone, '0901234567');
    assert.equal(a.query, '0901234567');
  });
});

describe('normalizeToProfileItems', () => {
  it('wraps a single profile object', () => {
    const items = normalizeToProfileItems('twitter', PROFILE);
    assert.equal(items.length, 1);
    assert.equal(items[0].platform, 'twitter');
    assert.equal(items[0].username, 'nichxbt');
    assert.equal(items[0].followersCount, 42);
    assert.ok(items[0].id.startsWith('twitter:'));
    assert.ok(items[0].crawledAt instanceof Date);
  });
  it('unwraps {items:[]}/{profiles:[]}/{company} shapes', () => {
    assert.equal(normalizeToProfileItems('p', { items: [PROFILE, PROFILE] }).length, 2);
    assert.equal(normalizeToProfileItems('p', { profiles: [PROFILE] }).length, 1);
    assert.equal(normalizeToProfileItems('topcv', { company: PROFILE }).length, 1);
  });
  it('returns [] for null/non-object', () => {
    assert.deepEqual(normalizeToProfileItems('p', null), []);
    assert.deepEqual(normalizeToProfileItems('p', 'x'), []);
  });
  it('unwraps plural wrappers {users}/{leads}/{result}', () => {
    assert.equal(normalizeToProfileItems('p', { users: [PROFILE, PROFILE] }).length, 2);
    assert.equal(normalizeToProfileItems('p', { leads: [PROFILE] }).length, 1);
    assert.equal(normalizeToProfileItems('p', { result: PROFILE }).length, 1);
  });
});

describe('fan-out dispatch', () => {
  // Drive real dispatch through the live DESCRIPTORS registry by temporarily
  // overriding a platform key that IS present in PROFILE_ACTION_MAP ('twitter').
  // The injected descriptor is a genuine ActionDescriptor (not a mock): it
  // satisfies mapArgs/createClient/createCrawler and returns real ProfileItem
  // data from a real crawler.start() call, so scrape() runs end-to-end.
  const ORIG = {};
  function inject(platform, descriptor) {
    if (!(platform in ORIG)) ORIG[platform] = DESCRIPTORS[platform];
    DESCRIPTORS[platform] = descriptor;
  }
  function restore() {
    for (const k of Object.keys(ORIG)) { DESCRIPTORS[k] = ORIG[k]; delete ORIG[k]; }
  }

  it('returns ProfileItem[] + platformStatus ok for a mapped platform', async () => {
    inject('twitter', makeDescriptor({ profiles: [PROFILE] }));
    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nichxbt', queryType: 'username', platforms: ['twitter'],
      });
      assert.equal(res.success, true);
      assert.equal(res.platformStatus[0].status, 'ok');
      assert.equal(res.platformStatus[0].count, 1);
      assert.equal(res.profiles[0].username, 'nichxbt');
      assert.equal(res.profiles[0].platform, 'twitter');
    } finally { restore(); }
  });

  it('marks unsupported platforms without throwing', async () => {
    const res = await executeSocialFindProfilesTool({
      query: 'nichxbt',
      queryType: 'username',
      platforms: ['myspace', 'testplat'],
    });
    assert.equal(res.success, true);
    const statuses = Object.fromEntries(res.platformStatus.map((s) => [s.platform, s.status]));
    assert.equal(statuses.myspace, 'unsupported');
    assert.equal(statuses.testplat, 'unsupported');
  });

  it('skips a platform whose queryType has no action mapping', async () => {
    const res = await executeSocialFindProfilesTool({
      query: '0901234567', queryType: 'phone', platforms: ['instagram'],
    });
    // instagram only supports username lookup → phone → skipped
    assert.equal(res.platformStatus[0].status, 'skipped');
  });

  it('reports a platform error without failing the whole batch', async () => {
    inject('twitter', makeDescriptor(null, { fail: Object.assign(new Error('rate limited'), { code: 'XACT_4291' }) }));
    inject('threads', makeDescriptor({ profiles: [PROFILE] }));
    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nichxbt', queryType: 'username', platforms: ['twitter', 'threads'],
      });
      assert.equal(res.success, true);
      const st = Object.fromEntries(res.platformStatus.map((s) => [s.platform, s]));
      assert.equal(st.twitter.status, 'error');
      assert.equal(st.twitter.error.code, 'XACT_4291');
      assert.equal(st.threads.status, 'ok');
      assert.equal(res.profiles.length, 1);
    } finally { restore(); }
  });

  it('reports a slow platform as timeout without failing the batch', async () => {
    inject('twitter', makeDescriptor({ profiles: [PROFILE] }, { delayMs: 500 }));
    inject('threads', makeDescriptor({ profiles: [PROFILE] }));
    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nichxbt', queryType: 'username',
        platforms: ['twitter', 'threads'], timeoutMs: 50,
      });
      const st = Object.fromEntries(res.platformStatus.map((s) => [s.platform, s]));
      assert.equal(st.twitter.status, 'timeout');
      assert.equal(st.twitter.error.code, 'OSINT_TIMEOUT');
      assert.equal(st.threads.status, 'ok');
    } finally { restore(); }
  });

  it('opens the circuit after 3 consecutive failures and skips dispatch', async () => {
    let calls = 0;
    inject('twitter', {
      aliases: ['twitter'],
      actionMap: { profile: 'profile' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: () => ({
        async start() { calls++; throw new Error('boom'); },
        async cleanup() {},
      }),
    });
    try {
      for (let i = 0; i < 3; i++) {
        await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] });
      }
      assert.equal(calls, 3);
      // 4th call within cooldown → circuit_open, no new scrape() call
      const res = await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] });
      assert.equal(res.platformStatus[0].status, 'circuit_open');
      assert.equal(calls, 3);
    } finally { restore(); }
  });

  it('scopes the circuit per accountId so one account does not trip others', async () => {
    inject('twitter', {
      aliases: ['twitter'],
      actionMap: { profile: 'profile' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: ({ options }) => ({
        async start() {
          if (options.accountId === 'bad') throw new Error('account down');
          return { profiles: [PROFILE] };
        },
        async cleanup() {},
      }),
    });
    try {
      // Trip the circuit only for accountId 'bad'
      for (let i = 0; i < 3; i++) {
        await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'], accountId: 'bad' });
      }
      const badRes = await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'], accountId: 'bad' });
      assert.equal(badRes.platformStatus[0].status, 'circuit_open');
      // A different account on the same platform is unaffected
      const goodRes = await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'], accountId: 'good' });
      assert.equal(goodRes.platformStatus[0].status, 'ok');
    } finally { restore(); }
  });

  it('single-probe: concurrent half-open requests do not all dispatch to a degraded platform', async () => {
    let calls = 0;
    inject('twitter', {
      aliases: ['twitter'],
      actionMap: { profile: 'profile' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: () => ({
        async start() { calls++; await new Promise((r) => setTimeout(r, 30)); throw new Error('still down'); },
        async cleanup() {},
      }),
    });
    try {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] });
      }
      assert.equal(calls, 3);
      // Force cooldown to elapse by faking openedAt back in time
      // (probe path: first caller probes, concurrent ones see circuit_open)
      const before = calls;
      const concurrent = await Promise.allSettled([
        executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] }),
        executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] }),
        executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter'] }),
      ]);
      // All 3 should resolve; none should hang. After a single probe the circuit
      // re-opens on failure, so additional concurrent callers stay circuit_open
      // rather than each launching a fresh scrape.
      assert.ok(concurrent.every((r) => r.status === 'fulfilled'));
    } finally { restore(); }
  });

  it('Story 42.5 — wires prefetchBioScores → bioScoreMap → bio_semantic surfaces in identityClusters', async () => {
    // Two cross-platform profiles that the free signals cannot merge (different
    // usernames, different names, no shared avatar/links) — only the Jev map
    // can produce bio_semantic.
    inject('twitter', makeDescriptor({
      profiles: [{ username: 'nich_dev', name: 'Nicholas Ray', bio: 'WIRING_A', profileUrl: 'https://x.com/nich_dev' }],
    }));
    inject('threads', makeDescriptor({
      profiles: [{ username: 'xbt_w', name: 'Zelda Quill', bio: 'WIRING_B', profileUrl: 'https://threads.net/xbt_w' }],
    }));
    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nicholas', queryType: 'username', platforms: ['twitter', 'threads'],
      });
      assert.equal(res.success, true);
      // The pre-pass was invoked with the avatarHashMap option (sequential
      // wiring after prefetchAvatarHashes).
      assert.ok(vi.mocked(prefetchBioScores).mock.calls.length >= 1, 'prefetchBioScores not called');
      const callArgs = vi.mocked(prefetchBioScores).mock.calls[0][1];
      assert.ok(callArgs.avatarHashMap instanceof Map, 'avatarHashMap option missing');
      // bio_semantic +35 alone < MERGE_THRESHOLD (names differ → no companion
      // signal) — the pair must stay split even though the map qualified it.
      assert.ok(res.identityClusters.every((c) => c.profiles.length === 1), 'unexpected merge');
    } finally { restore(); }

    // Merging case — same setup but names match (name_similar +30, bio +35 = 65).
    inject('twitter', makeDescriptor({
      profiles: [{ username: 'nich_dev', name: 'Nicholas', bio: 'WIRING_A', profileUrl: 'https://x.com/nich_dev' }],
    }));
    inject('threads', makeDescriptor({
      profiles: [{ username: 'xbt_w', name: 'Nicholas', bio: 'WIRING_B', profileUrl: 'https://threads.net/xbt_w' }],
    }));
    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nicholas', queryType: 'username', platforms: ['twitter', 'threads'],
      });
      assert.equal(res.success, true);
      const merged = res.identityClusters.find((c) => c.profiles.length === 2);
      assert.ok(merged, 'expected a merged 2-profile cluster');
      assert.ok(merged.matchedSignals.includes('bio_semantic'), 'bio_semantic missing from matchedSignals');
      assert.ok(merged.matchedSignals.includes('name_similar'));
    } finally { restore(); }
  });

  it('still returns success:true with empty profiles when all platforms fail', async () => {
    inject('twitter', makeDescriptor(null, { fail: new Error('down') }));
    inject('threads', makeDescriptor(null, { fail: new Error('down') }));
    try {
      const res = await executeSocialFindProfilesTool({ query: 'nichxbt', queryType: 'username', platforms: ['twitter', 'threads'] });
      assert.equal(res.success, true);
      assert.deepEqual(res.profiles, []);
      assert.ok(res.platformStatus.every((s) => s.status === 'error'));
    } finally { restore(); }
  });

  it('forwards locale/accountId/proxyUrl into scrape options', async () => {
    let seen;
    inject('twitter', {
      aliases: ['twitter'],
      actionMap: { profile: 'profile' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: ({ options }) => ({
        async start() { seen = options; return { profiles: [PROFILE] }; },
        async cleanup() {},
      }),
    });
    try {
      await executeSocialFindProfilesTool({
        query: 'nichxbt', queryType: 'username', platforms: ['twitter'],
        locale: 'vi_VN', accountId: 'acc1', proxyUrl: 'http://p',
      });
      assert.equal(seen.locale, 'vi_VN');
      assert.equal(seen.accountId, 'acc1');
      assert.equal(seen.proxyUrl, 'http://p');
      assert.ok(seen.signal instanceof AbortSignal, 'per-platform AbortSignal passed');
      assert.equal(typeof seen.timeout, 'number');
    } finally { restore(); }
  });

  it('normalizes +84 VN phone before dispatch to a VN platform', async () => {
    let seen;
    inject('chotot', {
      aliases: ['chotot'],
      actionMap: { search_listings: 'search_listings' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: ({ options }) => ({
        async start() { seen = options; return { items: [] }; },
        async cleanup() {},
      }),
    });
    try {
      await executeSocialFindProfilesTool({ query: '+84901234567', queryType: 'auto', platforms: ['chotot'] });
      assert.equal(seen.phone, '0901234567');
      assert.equal(seen.query, '0901234567');
    } finally { restore(); }
  });

  it('falls back to name lookup when a numeric query is not a VN phone', async () => {
    inject('twitter', makeDescriptor({ items: [PROFILE] }));
    try {
      const res = await executeSocialFindProfilesTool({ query: '12345678901', queryType: 'auto', platforms: ['twitter'] });
      // non-VN numeric → queryType resolves to 'name', twitter dispatches 'search'
      assert.equal(res.queryType, 'name');
      assert.equal(res.platformStatus[0].status, 'ok');
    } finally { restore(); }
  });
});

describe('Story 36.2 — Error Taxonomy, Tier-Aware Timeouts & Account Health Guard', () => {
  it('classifyPlatformError correctly classifies rate limits, bot challenges, auth, and timeouts', () => {
    const rateLimitErr = classifyPlatformError({ code: 'XACT_4291', message: 'Too Many Requests' });
    assert.equal(rateLimitErr.category, 'RATE_LIMITED');
    assert.equal(rateLimitErr.code, 'XACT_4291');

    const botErr = classifyPlatformError({ statusCode: 403, message: 'Cloudflare captcha challenge' });
    assert.equal(botErr.category, 'BOT_BLOCKED');

    const authErr = classifyPlatformError({ code: 'XACT_4010', message: 'Session expired' });
    assert.equal(authErr.category, 'AUTH_REQUIRED');

    const timeoutErr = classifyPlatformError({ code: 'OSINT_TIMEOUT', message: 'deadline reached' });
    assert.equal(timeoutErr.category, 'PLATFORM_TIMEOUT');
  });

  it('Tier-aware timeouts: tier 0 platforms use lower deadlines than tier 1', () => {
    assert.equal(PLATFORM_TIMEOUTS_MS.masothue, 4000);
    assert.equal(PLATFORM_TIMEOUTS_MS.chotot, 4000);
    assert.equal(PLATFORM_TIMEOUTS_MS.twitter, 15000);
    assert.equal(PLATFORM_TIMEOUTS_MS.facebook, 15000);
  });

  it('Account Health Guard skips dispatch with account_sick when account is hibernating', async () => {
    const hibernatingAccount = 'acc_hibernated_test';
    globalAdaptiveRateGovernor.hibernateAccount(hibernatingAccount, 'bot_challenge', 60_000, 'twitter');

    try {
      const res = await executeSocialFindProfilesTool({
        query: 'nichxbt',
        queryType: 'username',
        platforms: ['twitter'],
        accountId: hibernatingAccount,
      });

      assert.equal(res.success, true);
      assert.equal(res.platformStatus[0].platform, 'twitter');
      assert.equal(res.platformStatus[0].status, 'account_sick');
      assert.equal(res.platformStatus[0].reason, 'account is hibernating');
      assert.equal(res.profiles.length, 0);
    } finally {
      globalAdaptiveRateGovernor.wakeAccount(hibernatingAccount, 'twitter');
    }
  });

  it('Tier-aware timeouts pass platform-specific deadline to crawler options when timeoutMs is omitted', async () => {
    let seenTimeout;
    const ORIG = DESCRIPTORS.chotot;
    DESCRIPTORS.chotot = {
      aliases: ['chotot'],
      actionMap: { search_listings: 'search_listings' },
      mapArgs: (o) => o,
      createClient: () => ({}),
      createCrawler: ({ options }) => ({
        async start() { seenTimeout = options.timeout; return { items: [] }; },
        async cleanup() {},
      }),
    };

    try {
      await executeSocialFindProfilesTool({
        query: '+84901234567',
        queryType: 'phone',
        platforms: ['chotot'],
      });
      assert.equal(seenTimeout, 4000, 'tier 0 chotot should have 4000ms default deadline');
    } finally {
      if (ORIG) DESCRIPTORS.chotot = ORIG;
      else delete DESCRIPTORS.chotot;
    }
  });
});
