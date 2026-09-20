// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 41.2 — EntityResolver (Jaro-Winkler + identityClusters[]).
 * Pure-JS, no network, no mocks — real ProfileItem-shaped objects.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  jaroWinkler,
  scorePair,
  resolveIdentities,
  prefetchAvatarHashes,
  MERGE_THRESHOLD,
} from '../../src/mcp/entity-resolver.js';
import { computeDHash } from '../../src/osint/phash.js';
import { decodeImage } from '../../src/osint/image-decode.js';
import fs from 'node:fs';
import path from 'node:path';
import { executeSocialFindProfiles } from '../../src/mcp/osint-find-profiles.js';
import { DESCRIPTORS } from '../../src/scrapers/index.js';
import { __resetOsintCircuits } from '../../src/mcp/osint-find-profiles.js';
import { beforeEach } from 'vitest';

// A ProfileItem factory — matches normalizeToProfileItems output shape.
const prof = (platform, over = {}) => ({
  id: `${platform}:${over.externalId || over.username || 'x'}`,
  platform,
  externalId: over.externalId || over.username || 'x',
  username: over.username,
  name: over.name,
  bio: over.bio,
  avatar: over.avatar,
  profileUrl: over.profileUrl,
  followersCount: over.followersCount,
  metadata: over.metadata || {},
  crawledAt: new Date('2026-01-01'),
  ...over,
});

// ---------------------------------------------------------------------------
// Jaro-Winkler correctness (standard reference vectors)
// ---------------------------------------------------------------------------

describe('jaroWinkler', () => {
  it('matches published reference vectors', () => {
    assert.ok(Math.abs(jaroWinkler('MARTHA', 'MARHTA') - 0.961) < 0.001);
    assert.ok(Math.abs(jaroWinkler('DIXON', 'DICKSONX') - 0.813) < 0.001);
    assert.ok(Math.abs(jaroWinkler('DWAYNE', 'DUANE') - 0.840) < 0.001);
  });
  it('returns 1 for identical, 0 for empty, handles prefix boost', () => {
    assert.equal(jaroWinkler('abc', 'abc'), 1);
    assert.equal(jaroWinkler('', 'x'), 0);
    assert.ok(jaroWinkler('nich', 'nicholas') > 0.85);
    assert.ok(jaroWinkler('zzz', 'abc') < 0.5);
  });
});

// ---------------------------------------------------------------------------
// scorePair signals
// ---------------------------------------------------------------------------

describe('scorePair signals', () => {
  it('fires username_exact (+40) for identical usernames', () => {
    const { score, signals } = scorePair(
      prof('github', { username: 'nichxbt' }),
      prof('twitter', { username: 'nichxbt' })
    );
    assert.ok(signals.includes('username_exact'));
    assert.ok(score >= 40);
  });

  it('fires name_similar (+30) for JW-sim>0.85', () => {
    const { signals } = scorePair(
      prof('a', { username: 'x1', name: 'Nicholas' }),
      prof('b', { username: 'y2', name: 'Nicholas' })
    );
    assert.ok(signals.includes('name_similar'));
  });

  it('fires avatar_match (+30) for identical avatar URL', () => {
    const { signals } = scorePair(
      prof('a', { username: 'u1', avatar: 'https://x/av.png' }),
      prof('b', { username: 'u2', avatar: 'https://x/av.png' })
    );
    assert.ok(signals.includes('avatar_match'));
  });

  it('fires crosslink_bio (+20) when a bio references the other username', () => {
    const { signals } = scorePair(
      prof('github', { username: 'nichxbt', bio: 'also on x as nichxbt' }),
      prof('twitter', { username: 'nichxbt' })
    );
    assert.ok(signals.includes('crosslink_bio'));
  });

  it('returns score 0 / no signals for unrelated profiles', () => {
    const { score, signals } = scorePair(
      prof('a', { username: 'alpha', name: 'Alpha', avatar: 'https://a/1.png' }),
      prof('b', { username: 'omega', name: 'Omega', avatar: 'https://b/2.png' })
    );
    assert.equal(score, 0);
    assert.deepEqual(signals, []);
  });
});

// ---------------------------------------------------------------------------
// resolveIdentities clustering
// ---------------------------------------------------------------------------

describe('resolveIdentities clustering', () => {
  it('merges same-username cross-platform profiles into one cluster', () => {
    const clusters = resolveIdentities([
      prof('github', { username: 'nichxbt', followersCount: 100 }),
      prof('twitter', { username: 'nichxbt', followersCount: 500 }),
      prof('reddit', { username: 'someone_else' }),
    ]);
    const merged = clusters.find((c) => c.profiles.length === 2);
    assert.ok(merged, 'a 2-member cluster exists');
    assert.ok(merged.confidence >= 0.4);
    assert.ok(merged.matchedSignals.includes('username_exact'));
    // primary = highest followers
    assert.equal(merged.primaryProfile.platform, 'twitter');
  });

  it('keeps distinct people in separate clusters', () => {
    const clusters = resolveIdentities([
      prof('github', { username: 'nichxbt' }),
      prof('twitter', { username: 'totally_different', name: 'Zzz Qqq' }),
    ]);
    assert.equal(clusters.length, 2);
    clusters.forEach((c) => assert.equal(c.profiles.length, 1));
  });

  it('returns [] for empty/null input', () => {
    assert.deepEqual(resolveIdentities([]), []);
    assert.deepEqual(resolveIdentities(null), []);
    assert.deepEqual(resolveIdentities(undefined), []);
  });

  it('returns a singleton cluster for one profile with confidence 0.5', () => {
    const clusters = resolveIdentities([prof('github', { username: 'nichxbt' })]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].confidence, 0.5);
    assert.deepEqual(clusters[0].matchedSignals, ['singleton']);
  });

  it('merges on name_similar + avatar even when usernames differ', () => {
    const clusters = resolveIdentities([
      prof('github', { username: 'nichxbt', name: 'Nicholas', avatar: 'https://x/same.png' }),
      prof('medium', { username: 'nich_b', name: 'Nicholas', avatar: 'https://x/same.png' }),
    ]);
    assert.equal(clusters.length, 1);
    assert.ok(clusters[0].matchedSignals.includes('name_similar'));
    assert.ok(clusters[0].matchedSignals.includes('avatar_match'));
  });

  it('does NOT merge when only one weak signal fires below threshold', () => {
    // name_similar alone = 30 < 40 → no merge
    const clusters = resolveIdentities([
      prof('a', { username: 'user_one', name: 'Nicholas' }),
      prof('b', { username: 'user_two', name: 'Nicholas' }),
    ]);
    assert.equal(clusters.length, 2);
  });

  it('confidence stays within [0,1]', () => {
    const clusters = resolveIdentities([
      prof('a', { username: 'same', name: 'Same', avatar: 'https://x/a.png' }),
      prof('b', { username: 'same', name: 'Same', avatar: 'https://x/a.png' }),
    ]);
    assert.ok(clusters[0].confidence <= 1 && clusters[0].confidence >= 0);
  });
});

// ---------------------------------------------------------------------------
// Integration: executeSocialFindProfiles output carries identityClusters
// ---------------------------------------------------------------------------

function makeDescriptor(result) {
  return {
    aliases: ['platx'],
    actionMap: { profile: 'profile' },
    mapArgs: (o) => o,
    createClient: () => ({}),
    createCrawler: () => ({ async start() { return result; }, async cleanup() {} }),
  };
}

describe('executeSocialFindProfiles → identityClusters (integration)', () => {
  beforeEach(() => { __resetOsintCircuits(); delete DESCRIPTORS.platx; });

  it('returns identityClusters alongside unchanged profiles[]', async () => {
    DESCRIPTORS.platx = makeDescriptor({
      profile: { username: 'nichxbt', name: 'Nich', externalId: 'p1' },
    });
    const res = await executeSocialFindProfiles({ query: 'nichxbt', queryType: 'username', platforms: ['platx', 'github'], timeoutMs: 8000 });
    assert.ok(Array.isArray(res.identityClusters), 'identityClusters present');
    assert.ok(Array.isArray(res.profiles), 'profiles still present');
    assert.equal(res.identityClusters.length >= 1, true);
    // github profile + platx profile share username → should cluster together
    const all = res.identityClusters.flatMap((c) => c.profiles.map((p) => p.platform));
    assert.ok(all.includes('github'));
  });
});

// ---------------------------------------------------------------------------
// Story 41.3 — avatar pHash path (avatarHashMap)
// ---------------------------------------------------------------------------

const PHASH_FIXTURES = path.resolve(__dirname, '../osint/fixtures');
const hashOf = (name) => {
  const d = decodeImage(fs.readFileSync(path.join(PHASH_FIXTURES, name)));
  return computeDHash(d.rgba, d.width, d.height);
};

describe('Story 41.3 — avatar pHash matching', () => {
  it('scorePair fires avatar_match for different URLs with same image (hamming ≤ 10)', () => {
    const h = hashOf('avatar_64.png');
    const h2 = hashOf('avatar_128_reencoded.png'); // same photo, different size/encode
    const map = new Map([
      ['https://fbcdn.example/a.jpg', h],
      ['https://cdninstagram.example/b.jpg', h2],
    ]);
    const a = prof('facebook', { username: 'u1', name: 'A', avatar: 'https://fbcdn.example/a.jpg' });
    const b = prof('instagram', { username: 'u2', name: 'B', avatar: 'https://cdninstagram.example/b.jpg' });
    const { signals } = scorePair(a, b, map);
    assert.ok(signals.includes('avatar_match'), `expected avatar_match, got ${signals}`);
  });

  it('scorePair does NOT fire avatar_match when hashes differ beyond threshold', () => {
    const map = new Map([
      ['https://a.example/x.png', hashOf('avatar_64.png')],
      ['https://b.example/y.png', hashOf('different_64.png')],
    ]);
    const a = prof('a', { username: 'u1', name: 'X', avatar: 'https://a.example/x.png' });
    const b = prof('b', { username: 'u2', name: 'Y', avatar: 'https://b.example/y.png' });
    const { signals } = scorePair(a, b, map);
    assert.ok(!signals.includes('avatar_match'));
  });

  it('resolveIdentities merges same-person profiles across CDNs via pHash', () => {
    const map = new Map([
      ['https://fbcdn.example/a.jpg', hashOf('avatar_64.png')],
      ['https://cdninstagram.example/b.jpg', hashOf('avatar_32.png')],
    ]);
    const clusters = resolveIdentities([
      prof('facebook', { username: 'nichxbt', name: 'Nicholas', avatar: 'https://fbcdn.example/a.jpg' }),
      prof('instagram', { username: 'nichxbt', name: 'Nicholas', avatar: 'https://cdninstagram.example/b.jpg' }),
    ], 'nichxbt', map);
    assert.equal(clusters.length, 1);
    assert.ok(clusters[0].matchedSignals.includes('avatar_match'));
  });

  it('prefetchAvatarHashes returns Map keyed by normalized URL (injected client, no network)', async () => {
    const buf = fs.readFileSync(path.join(PHASH_FIXTURES, 'avatar_64.png'));
    const client = { request: async () => ({ body: buf }) };
    const map = await prefetchAvatarHashes(
      [prof('a', { avatar: 'https://A.example/Avatar.PNG' }), prof('b', { avatar: 'https://a.example/avatar.png' })],
      { httpClient: client }
    );
    assert.ok(map instanceof Map);
    assert.equal(map.size, 1, 'dedupes normalized URLs');
    assert.equal(typeof map.get('https://a.example/avatar.png'), 'bigint');
  });

  it('prefetchAvatarHashes returns empty Map when OSINT_AVATAR_PHASH=0', async () => {
    const prev = process.env.OSINT_AVATAR_PHASH;
    process.env.OSINT_AVATAR_PHASH = '0';
    try {
      const map = await prefetchAvatarHashes([prof('a', { avatar: 'https://x/a.png' })]);
      assert.equal(map.size, 0);
    } finally {
      if (prev === undefined) delete process.env.OSINT_AVATAR_PHASH; else process.env.OSINT_AVATAR_PHASH = prev;
    }
  });

  it('prefetchAvatarHashes never throws on non-array input', async () => {
    const map = await prefetchAvatarHashes(null);
    assert.equal(map.size, 0);
  });
});

