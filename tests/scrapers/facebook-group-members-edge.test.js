// by nichxbt
// Coverage expansion (TEA automate) — Story 4.6 scrapeGroupMembers.
// Edge/negative paths not covered by facebook-group-members.test.js.
// Browser-free: fake page + DOM fixtures + injectable delay seam. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  scrapeGroupMembers,
} from '../../src/scrapers/facebook/index.js';
import defaultExport from '../../src/scrapers/facebook/index.js';

function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

const noDelay = makeDelaySpy();

function makeFakePage({ restricted = false, memberPages = [[]] } = {}) {
  const calls = { goto: [], scrollTo: [] };
  let memberCallIdx = 0;
  return {
    calls,
    goto: async (url) => { calls.goto.push(url); },
    waitForSelector: async () => {
      if (restricted) throw new Error('Timeout: selector not found');
    },
    evaluate: async (fn) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) {
        calls.scrollTo.push(true);
        return undefined;
      }
      const batch = memberCallIdx < memberPages.length ? memberPages[memberCallIdx] : [];
      memberCallIdx++;
      return batch;
    },
  };
}

function makeMember(n) {
  return {
    name: `Member ${n}`,
    username: `member${n}`,
    profileUrl: `https://www.facebook.com/member${n}`,
  };
}

const GROUP_URL = 'https://www.facebook.com/groups/testgroup';

// ── default export ────────────────────────────────────────────────────────────

describe('scrapeGroupMembers — default export', () => {
  it('scrapeGroupMembers is included in default export', () => {
    expect(typeof defaultExport.scrapeGroupMembers).toBe('function');
  });

  it('named export and default export are the same function', () => {
    expect(defaultExport.scrapeGroupMembers).toBe(scrapeGroupMembers);
  });
});

// ── assertFacebookUrlLocal edge cases ─────────────────────────────────────────

describe('scrapeGroupMembers — URL validation edge cases', () => {
  it('http:// facebook URL → valid (not https-only)', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await expect(
      scrapeGroupMembers(page, 'http://www.facebook.com/groups/test', { delay: noDelay, maxStalls: 1 }),
    ).resolves.not.toThrow();
  });

  it('faux suffix host (notfacebook.com) → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, 'https://notfacebook.com/groups/x', { delay: noDelay }),
    ).rejects.toThrow('facebook.com');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('subdomain of facebook.com (m.facebook.com) → valid', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await expect(
      scrapeGroupMembers(page, 'https://m.facebook.com/groups/test', { delay: noDelay, maxStalls: 1 }),
    ).resolves.not.toThrow();
  });

  it('null groupUrl → throws', async () => {
    await expect(
      scrapeGroupMembers(makeFakePage(), null, { delay: noDelay }),
    ).rejects.toThrow();
  });

  it('number groupUrl → throws', async () => {
    await expect(
      scrapeGroupMembers(makeFakePage(), 12345, { delay: noDelay }),
    ).rejects.toThrow();
  });

  it('groupUrl with query string → /members appended (ends with /members)', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await scrapeGroupMembers(page, 'https://www.facebook.com/groups/test?ref=share', {
      delay: noDelay, maxStalls: 1,
    });
    expect(page.calls.goto[0]).toMatch(/\/members$/);
  });
});

// ── normalizeGroupMember + stripPii edge cases ────────────────────────────────

describe('scrapeGroupMembers — normalizer edge cases', () => {
  it('member with null name → name:null in output (not crash)', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: null, username: 'noname', profileUrl: 'https://www.facebook.com/noname' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).toBeNull();
    expect(result[0].profileUrl).toBe('https://www.facebook.com/noname');
    expect(result[0].platform).toBe('facebook');
  });

  it('member with undefined username → username field absent from output', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Alice', username: undefined, profileUrl: 'https://www.facebook.com/alice' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0]).not.toHaveProperty('username');
  });

  it('stripPii: plain text without PII → preserved as-is', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'John Doe', username: 'johndoe', profileUrl: 'https://www.facebook.com/johndoe' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).toBe('John Doe');
    expect(result[0].username).toBe('johndoe');
  });

  it('stripPii: name that is ONLY a phone number → returns null (empty after strip)', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: '+84 912 345 678', username: 'user1', profileUrl: 'https://www.facebook.com/user1' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).toBeNull();
  });

  it('stripPii: name that is ONLY an email → returns null (empty after strip)', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'user@example.com', username: 'user2', profileUrl: 'https://www.facebook.com/user2' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).toBeNull();
  });

  it('platform field is always "facebook"', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1), makeMember(2)], []] });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result.every((m) => m.platform === 'facebook')).toBe(true);
  });

  it('member keyed by profile.php?id=N profileUrl is preserved', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'IdUser', username: 'profile.php?id=999', profileUrl: 'https://www.facebook.com/profile.php?id=999' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].profileUrl).toBe('https://www.facebook.com/profile.php?id=999');
    expect(result[0].username).toBe('profile.php?id=999');
  });
});

// ── onProgress callback ───────────────────────────────────────────────────────

describe('scrapeGroupMembers — onProgress callback', () => {
  it('onProgress called each iteration with { scraped, limit }', async () => {
    const progressEvents = [];
    const page = makeFakePage({
      memberPages: [[makeMember(1), makeMember(2)], [makeMember(3)], []],
    });
    await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay,
      maxStalls: 1,
      limit: 10,
      onProgress: (e) => progressEvents.push({ ...e }),
    });
    expect(progressEvents.length).toBeGreaterThan(0);
    for (const e of progressEvents) {
      expect(e).toHaveProperty('scraped');
      expect(e).toHaveProperty('limit');
      expect(e.limit).toBe(10);
    }
  });

  it('onProgress not required (omitting it does not throw)', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await expect(
      scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 }),
    ).resolves.not.toThrow();
  });
});

// ── scroll + limit boundary edge cases ────────────────────────────────────────

describe('scrapeGroupMembers — scroll + limit edge cases', () => {
  it('maxStalls default=5: stops after 5 stalls when not specified', async () => {
    const page = makeFakePage({
      memberPages: [
        [makeMember(1)],
        [], [], [], [], [], // 5 stalls → stop
      ],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay });
    expect(result).toHaveLength(1);
    expect(page.calls.scrollTo.length).toBe(6); // 1 after members + 5 stalls
  });

  it('large limit (1000) with small fixture → returns all available members', async () => {
    const batch = Array.from({ length: 3 }, (_, i) => makeMember(i));
    const page = makeFakePage({ memberPages: [batch, []] });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, limit: 1000, maxStalls: 1,
    });
    expect(result).toHaveLength(3);
  });

  it('members accumulate across multiple scroll batches', async () => {
    const page = makeFakePage({
      memberPages: [
        [makeMember(1), makeMember(2)],
        [makeMember(3), makeMember(4)],
        [],
      ],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, maxStalls: 1, limit: 10,
    });
    expect(result).toHaveLength(4);
  });

  it('cross-batch duplicate is deduplicated (same member in two scroll batches)', async () => {
    const page = makeFakePage({
      memberPages: [
        [makeMember(1), makeMember(2)],
        [makeMember(2), makeMember(3)], // member2 is a dup
        [],
      ],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, maxStalls: 1, limit: 10,
    });
    expect(result).toHaveLength(3); // 1, 2, 3 — no dup
  });

  it('restricted group: no scrollTo calls (exits before scroll loop)', async () => {
    const page = makeFakePage({ restricted: true });
    await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay });
    expect(page.calls.scrollTo).toHaveLength(0);
  });
});
