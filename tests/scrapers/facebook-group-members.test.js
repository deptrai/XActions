// by nichxbt
// Tests for Story 4.6: scrapeGroupMembers
// Browser-free: fake page + DOM fixtures + injectable delay seam. No vi.mock.

import { describe, it, expect } from 'vitest';
import { scrapeGroupMembers } from '../../src/scrapers/facebook/index.js';

function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

const noDelay = makeDelaySpy();

// Fake page factory.
// memberPages: array of batches returned per successive evaluate(member-extraction) call.
// When index exceeds length, returns [].
// restricted: waitForSelector throws (member container not found).
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
      // Member extraction call
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

// ── happy path ────────────────────────────────────────────────────────────────

describe('scrapeGroupMembers — happy path', () => {
  it('returns normalized array with name/profileUrl/platform', async () => {
    const page = makeFakePage({
      memberPages: [[makeMember(1), makeMember(2)], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: 'Member 1',
      username: 'member1',
      profileUrl: 'https://www.facebook.com/member1',
      platform: 'facebook',
    });
  });

  it('navigates to {groupUrl}/members', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(page.calls.goto[0]).toBe(`${GROUP_URL}/members`);
  });

  it('strips trailing slash from groupUrl before appending /members', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await scrapeGroupMembers(page, `${GROUP_URL}/`, { delay: noDelay, maxStalls: 1 });
    expect(page.calls.goto[0]).toBe(`${GROUP_URL}/members`);
  });

  it('deduplicates members by profileUrl', async () => {
    const dup = makeMember(1);
    const page = makeFakePage({ memberPages: [[dup, dup, makeMember(2)], []] });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result).toHaveLength(2);
  });

  it('member without username → username field absent (optional)', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'No-username', username: null, profileUrl: 'https://www.facebook.com/profile.php?id=123' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].platform).toBe('facebook');
    expect(result[0].profileUrl).toBe('https://www.facebook.com/profile.php?id=123');
    // username absent or undefined when null input
    expect(result[0].username === undefined || result[0].username === null).toBe(true);
  });
});

// ── limit ─────────────────────────────────────────────────────────────────────

describe('scrapeGroupMembers — limit', () => {
  it('limit=5 stops after collecting 5 members from a larger fixture', async () => {
    const batch = Array.from({ length: 10 }, (_, i) => makeMember(i));
    const page = makeFakePage({ memberPages: [batch] });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, limit: 5 });
    expect(result).toHaveLength(5);
  });

  it('limit=1 returns only 1 member', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1), makeMember(2)]] });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, limit: 1 });
    expect(result).toHaveLength(1);
  });

  it('empty group (0 members) returns [] — not { note }', async () => {
    const page = makeFakePage({ memberPages: [[], [], []] });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, maxStalls: 2,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ── restricted group ──────────────────────────────────────────────────────────

describe('scrapeGroupMembers — restricted group', () => {
  it('returns { note, platform } when member list container not found', async () => {
    const page = makeFakePage({ restricted: true });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay });
    expect(Array.isArray(result)).toBe(false);
    expect(result).toMatchObject({ platform: 'facebook' });
    expect(typeof result.note).toBe('string');
    expect(result.note.length).toBeGreaterThan(10);
  });

  it('does NOT throw on restricted group', async () => {
    const page = makeFakePage({ restricted: true });
    await expect(
      scrapeGroupMembers(page, GROUP_URL, { delay: noDelay }),
    ).resolves.not.toThrow();
  });

  it('restricted: goto was still called (navigates before detecting restriction)', async () => {
    const page = makeFakePage({ restricted: true });
    await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay });
    expect(page.calls.goto).toHaveLength(1);
  });

  it('restricted result does NOT have numeric keys (is not array-like)', async () => {
    const page = makeFakePage({ restricted: true });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay });
    expect(result[0]).toBeUndefined();
  });
});

// ── NFR-11: no phone/email in output ─────────────────────────────────────────

describe('scrapeGroupMembers — NFR-11 PII filter (P0)', () => {
  it('strips phone number from member name', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Alice +84 912 345 678', username: 'alice', profileUrl: 'https://www.facebook.com/alice' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).not.toMatch(/\+84/);
    expect(result[0].name).not.toMatch(/912\s*345\s*678/);
  });

  it('strips email address from member name', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Bob bob@example.com', username: 'bob', profileUrl: 'https://www.facebook.com/bob' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).not.toMatch(/bob@example\.com/);
  });

  it('strips phone from username field', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Charlie', username: '0912345678', profileUrl: 'https://www.facebook.com/charlie' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    const u = result[0].username;
    // After PII strip, username is either null/undefined or a string without the phone
    if (typeof u === 'string') {
      expect(u).not.toMatch(/0912345678/);
    } else {
      expect(u == null).toBe(true);
    }
  });

  it('strips email from username field', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Dave', username: 'dave@work.io', profileUrl: 'https://www.facebook.com/dave' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    const u = result[0].username;
    // After PII strip, username is either null/undefined or a string without the email
    if (typeof u === 'string') {
      expect(u).not.toMatch(/dave@work\.io/);
    } else {
      expect(u == null).toBe(true);
    }
  });

  it('profileUrl is preserved (not treated as PII phone/email)', async () => {
    const page = makeFakePage({
      memberPages: [[
        { name: 'Eve', username: 'eve', profileUrl: 'https://www.facebook.com/eve' },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].profileUrl).toBe('https://www.facebook.com/eve');
  });

  it('DOM text with both phone AND email → both stripped', async () => {
    const page = makeFakePage({
      memberPages: [[
        {
          name: 'Frank +1 800 555 0199 frank@example.org',
          username: 'frank',
          profileUrl: 'https://www.facebook.com/frank',
        },
      ], []],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, { delay: noDelay, maxStalls: 1 });
    expect(result[0].name).not.toMatch(/\+1 800/);
    expect(result[0].name).not.toMatch(/frank@example\.org/);
  });
});

// ── URL validation ────────────────────────────────────────────────────────────

describe('scrapeGroupMembers — URL validation', () => {
  it('invalid URL → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, 'not-a-url', { delay: noDelay }),
    ).rejects.toThrow();
    expect(page.calls.goto).toHaveLength(0);
  });

  it('non-facebook URL → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, 'https://evil.com/groups/x', { delay: noDelay }),
    ).rejects.toThrow('facebook.com');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('file:/ URL → throws before navigation (SSRF guard)', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, 'file:///etc/passwd', { delay: noDelay }),
    ).rejects.toThrow();
    expect(page.calls.goto).toHaveLength(0);
  });

  it('javascript: URL → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, 'javascript:alert(1)', { delay: noDelay }),
    ).rejects.toThrow();
    expect(page.calls.goto).toHaveLength(0);
  });

  it('empty string → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      scrapeGroupMembers(page, '', { delay: noDelay }),
    ).rejects.toThrow();
    expect(page.calls.goto).toHaveLength(0);
  });

  it('valid facebook group URL → proceeds without throw', async () => {
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await expect(
      scrapeGroupMembers(page, 'https://www.facebook.com/groups/mygroup', { delay: noDelay, maxStalls: 1 }),
    ).resolves.not.toThrow();
  });
});

// ── stall detection ───────────────────────────────────────────────────────────

describe('scrapeGroupMembers — stall detection + delay seam', () => {
  it('stops after maxStalls consecutive scrolls with no new members', async () => {
    const page = makeFakePage({
      memberPages: [
        [makeMember(1), makeMember(2)], // initial batch
        [], [], [],                      // 3 stalls
      ],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, maxStalls: 3, limit: 100,
    });
    expect(result).toHaveLength(2);
    expect(page.calls.scrollTo.length).toBeGreaterThanOrEqual(3);
  });

  it('stall counter resets when new members found mid-scroll', async () => {
    const page = makeFakePage({
      memberPages: [
        [makeMember(1)],   // found → stalls=0
        [],                // stall 1
        [makeMember(2)],   // found → reset stalls=0
        [],                // stall 1
        [],                // stall 2 → stop (maxStalls=2)
      ],
    });
    const result = await scrapeGroupMembers(page, GROUP_URL, {
      delay: noDelay, maxStalls: 2, limit: 100,
    });
    expect(result).toHaveLength(2);
  });

  it('delay seam called between scrolls (never sleeps real seconds)', async () => {
    const delay = makeDelaySpy();
    const page = makeFakePage({ memberPages: [[makeMember(1)], [], []] });
    await scrapeGroupMembers(page, GROUP_URL, { delay, maxStalls: 2, limit: 100 });
    expect(delay.calls.length).toBeGreaterThan(0);
  });

  it('delay seam: calls use 1000/3000 range by default', async () => {
    const delay = makeDelaySpy();
    const page = makeFakePage({ memberPages: [[makeMember(1)], []] });
    await scrapeGroupMembers(page, GROUP_URL, { delay, maxStalls: 1 });
    // initial delay + at least one scroll delay
    for (const [min, max] of delay.calls) {
      expect(min).toBeGreaterThanOrEqual(1000);
      expect(max).toBeLessThanOrEqual(3000);
    }
  });
});
