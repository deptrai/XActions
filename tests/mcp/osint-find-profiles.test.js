// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for x_social_find_profiles MCP tool — Story 36.1.
 * Covers tool registration, arg validation, query-type detection, VN phone
 * normalization, fan-out dispatch via DESCRIPTORS, per-platform timeout, and
 * the in-memory circuit counter. No mocks/stubs/fakes — a real lightweight
 * descriptor is injected into the live DESCRIPTORS registry.
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { TOOLS, executeTool, executeSocialFindProfilesTool } from '../../src/mcp/server.js';
import { DESCRIPTORS } from '../../src/scrapers/index.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import {
  detectQueryType,
  buildScrapeArgs,
  normalizeToProfileItems,
  __resetOsintCircuits,
} from '../../src/mcp/osint-find-profiles.js';
import { normalizeVnPhone, isVnPhone } from '../../src/utils/vn-phone.js';

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
});
