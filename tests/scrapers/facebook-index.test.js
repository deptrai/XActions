// tests/scrapers/facebook-index.test.js
// P1 Kill: mutation tests for index.js pure functions.
import { describe, it, expect } from 'vitest';
import {
  normalizeHandle,
  normalizePost,
  normalizeProfile,
  normalizeFollower,
  normalizeSearchResult,
  generateTotp,
} from '../../src/scrapers/facebook/index.js';

// ============================================================================
// normalizeHandle (L94-111)
// ============================================================================

describe('normalizeHandle (P1 kill)', () => {
  it('throws for non-string input (L95: typeof input !== "string")', () => {
    expect(() => normalizeHandle(123)).toThrow(/handle is required/);
    expect(() => normalizeHandle(null)).toThrow(/handle is required/);
    expect(() => normalizeHandle(undefined)).toThrow(/handle is required/);
    expect(() => normalizeHandle({})).toThrow(/handle is required/);
  });

  it('throws for empty/whitespace string (L95: !input.trim())', () => {
    expect(() => normalizeHandle('')).toThrow(/handle is required/);
    expect(() => normalizeHandle('   ')).toThrow(/handle is required/);
  });

  it('strips @ prefix (L102: /^@/)', () => {
    expect(normalizeHandle('@zuck')).toBe('zuck');
    expect(normalizeHandle('@@zuck')).toBe('@zuck'); // only first @
  });

  it('extracts handle from https URL (L99-100)', () => {
    expect(normalizeHandle('https://facebook.com/zuck')).toBe('zuck');
    expect(normalizeHandle('https://www.facebook.com/zuck')).toBe('zuck');
  });

  it('extracts handle from http URL (L99-100)', () => {
    expect(normalizeHandle('http://facebook.com/zuck')).toBe('zuck');
    expect(normalizeHandle('http://www.facebook.com/zuck')).toBe('zuck');
  });

  it('strips trailing slash from URL (L100: /\\/\\$/, "")', () => {
    expect(normalizeHandle('https://facebook.com/zuck/')).toBe('zuck');
  });

  it('preserves profile.php?id=<digits> (L103-106)', () => {
    expect(normalizeHandle('profile.php?id=123456789')).toBe('profile.php?id=123456789');
    expect(normalizeHandle('https://facebook.com/profile.php?id=123456789')).toBe('profile.php?id=123456789');
  });

  it('strips trailing params from profile.php (L105-106: match only id)', () => {
    expect(normalizeHandle('profile.php?id=123456789&foo=bar')).toBe('profile.php?id=123456789');
  });

  it('strips subpath from handle (L108: .split("/")[0])', () => {
    expect(normalizeHandle('zuck/photos')).toBe('zuck');
    expect(normalizeHandle('zuck/posts/123')).toBe('zuck');
  });

  it('strips query params from handle (L108: .split("?")[0])', () => {
    expect(normalizeHandle('zuck?ref=foo')).toBe('zuck');
  });

  it('plain handle without URL/@/subpath → unchanged', () => {
    expect(normalizeHandle('zuck')).toBe('zuck');
  });

  it('profile.php with non-digit id → does NOT match regex (L103: \\d+)', () => {
    // profile.php?id=abc → regex doesn't match → falls to else branch
    expect(normalizeHandle('profile.php?id=abc')).toBe('profile.php');
  });

  it('profile.php case insensitive (L103: /i flag)', () => {
    expect(normalizeHandle('PROFILE.PHP?id=123')).toBe('PROFILE.PHP?id=123');
  });
});

// ============================================================================
// normalizePost (L122-137)
// ============================================================================

describe('normalizePost (P1 kill)', () => {
  it('normalizes full post object', () => {
    const result = normalizePost({
      id: 'post1', text: 'hello', timestamp: 123,
      likes: '5', comments: '2', postUrl: 'https://fb.com/post1',
      images: ['img1'], hasVideo: true,
    });
    expect(result).toEqual({
      id: 'post1', text: 'hello', timestamp: 123,
      likes: '5', comments: '2', url: 'https://fb.com/post1',
      media: { images: ['img1'], hasVideo: true },
      platform: 'facebook',
    });
  });

  it('defaults: id null, text null, timestamp null (L125-127: || null)', () => {
    const result = normalizePost({});
    expect(result.id).toBeNull();
    expect(result.text).toBeNull();
    expect(result.timestamp).toBeNull();
  });

  it('defaults: likes "0", comments "0" (L128-129: || "0")', () => {
    const result = normalizePost({});
    expect(result.likes).toBe('0');
    expect(result.comments).toBe('0');
  });

  it('defaults: url null (L130: postUrl || null)', () => {
    const result = normalizePost({});
    expect(result.url).toBeNull();
  });

  it('defaults: images [], hasVideo false (L132-133)', () => {
    const result = normalizePost({});
    expect(result.media.images).toEqual([]);
    expect(result.media.hasVideo).toBe(false);
  });

  it('platform is always "facebook" (L135)', () => {
    const result = normalizePost({});
    expect(result.platform).toBe('facebook');
  });

  it('falsy values use defaults (|| operator)', () => {
    const result = normalizePost({
      id: '', text: '', timestamp: 0, likes: '', comments: '',
      postUrl: '', images: null, hasVideo: 0,
    });
    expect(result.id).toBeNull(); // '' || null → null
    expect(result.text).toBeNull();
    expect(result.timestamp).toBeNull(); // 0 || null → null
    expect(result.likes).toBe('0');
    expect(result.comments).toBe('0');
    expect(result.url).toBeNull();
    expect(result.media.images).toEqual([]);
    expect(result.media.hasVideo).toBe(false);
  });
});

// ============================================================================
// normalizeProfile (L145-189)
// ============================================================================

describe('normalizeProfile (P1 kill)', () => {
  it('strips " | Facebook" suffix from name (L151: /\\s*[|\\|-–—]\\s*Facebook.*$/i)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg | Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
  });

  it('strips " - Facebook" suffix from name (L151)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg - Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
  });

  it('strips " – Facebook" suffix (en dash, L151)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg – Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
  });

  it('strips " — Facebook" suffix (em dash, L151)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg — Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
  });

  it('name without Facebook suffix → unchanged (L151)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg',
    }, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
  });

  it('extracts followers from ogDescription (L159: /([\\d,.]+[KkMmBb]?)\\s*(followers?|people)/)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test Page | Facebook',
      ogDescription: '1,234 followers · Public figure',
    }, 'testpage');
    expect(result.followers).toBe('1,234');
  });

  it('extracts followers with K/M/B suffix (L159)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '1.5M followers',
    }, 'test');
    expect(result.followers).toBe('1.5M');
  });

  it('extracts "people follow" count (L159: followers?|people follow)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '5,000 people follow this',
    }, 'test');
    expect(result.followers).toBe('5,000');
  });

  it('falls back to domFollowers when ogDescription has no count (L162: !followers && domFollowers)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: 'no count here',
      domFollowers: '999',
    }, 'test');
    // LogicalOperator mutant L162: !followers || domFollowers → always use domFollowers
    expect(result.followers).toBe('999');
  });

  it('followers null when neither ogDescription nor domFollowers has count', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: 'no count',
    }, 'test');
    expect(result.followers).toBeNull();
  });

  it('extracts bio from ogDescription after removing follower count (L169)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '1,234 followers · This is the bio text',
    }, 'test');
    expect(result.bio).toContain('This is the bio text');
  });

  it('bio is full ogDescription when no follower count prefix (L169)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: 'Just a bio without count',
    }, 'test');
    expect(result.bio).toBe('Just a bio without count');
  });

  it('sets username from inputHandle (L145)', () => {
    const result = normalizeProfile({ ogTitle: 'Test | Facebook' }, 'myhandle');
    expect(result.username).toBe('myhandle');
  });

  it('uses pageUrl from raw when present (L?)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      pageUrl: 'https://facebook.com/testpage',
    }, 'testpage');
    expect(result.url).toBe('https://facebook.com/testpage');
  });
});

// ============================================================================
// normalizeFollower (L463-490)
// ============================================================================

describe('normalizeFollower (P1 kill)', () => {
  it('normalizes full follower object', () => {
    const result = normalizeFollower({
      name: 'John Doe', username: 'johndoe',
      url: 'https://fb.com/johndoe',
    });
    expect(result).toEqual({
      name: 'John Doe', username: 'johndoe',
      url: 'https://fb.com/johndoe',
      platform: 'facebook',
    });
  });

  it('defaults: name null, username null, url null (|| null)', () => {
    const result = normalizeFollower({});
    expect(result.name).toBeNull();
    expect(result.username).toBeNull();
    expect(result.url).toBeNull();
  });

  it('platform is always "facebook"', () => {
    const result = normalizeFollower({});
    expect(result.platform).toBe('facebook');
  });
});

// ============================================================================
// normalizeSearchResult (L675-700)
// ============================================================================

describe('normalizeSearchResult (P1 kill)', () => {
  it('normalizes full search result', () => {
    const result = normalizeSearchResult({
      id: 'post1', text: 'hello', author: 'johndoe',
      timestamp: 123, url: 'https://fb.com/post1',
    });
    expect(result).toEqual({
      id: 'post1', text: 'hello', author: 'johndoe',
      timestamp: 123, url: 'https://fb.com/post1',
      platform: 'facebook',
    });
  });

  it('defaults for empty input', () => {
    const result = normalizeSearchResult({});
    expect(result.id).toBeNull();
    expect(result.text).toBeNull();
    expect(result.author).toBeNull();
    expect(result.timestamp).toBeNull();
    expect(result.url).toBeNull();
    expect(result.platform).toBe('facebook');
  });
});

// ============================================================================
// generateTotp (L231-241)
// ============================================================================

describe('generateTotp (P1 kill)', () => {
  it('returns null for falsy seed (L232: !seed)', () => {
    expect(generateTotp(null)).toBeNull();
    expect(generateTotp(undefined)).toBeNull();
    expect(generateTotp('')).toBeNull();
  });

  it('returns null for non-string seed (L232: typeof seed !== "string")', () => {
    expect(generateTotp(123)).toBeNull();
    expect(generateTotp({})).toBeNull();
  });

  it('returns null for whitespace-only seed (L232: !seed.trim())', () => {
    expect(generateTotp('   ')).toBeNull();
    expect(generateTotp('\t\n')).toBeNull();
  });

  it('returns null for seed with wrong length (L234: seed.length !== 32)', () => {
    expect(generateTotp('short')).toBeNull();
    expect(generateTotp('thisis31charslong123456789012345')).toBeNull();
    expect(generateTotp('thisis33charslong12345678901234567')).toBeNull();
  });

  it('returns null for seed containing @ (L234: seed.includes("@"))', () => {
    const seed = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@1'; // 32 chars with @
    expect(generateTotp(seed)).toBeNull();
  });

  it('returns null for seed containing "user=" (L234: seed.includes("user="))', () => {
    const seed = 'aaaaaaaaaaaaaaaaaaaaaauser=aaaaa'; // 32 chars with user=
    expect(generateTotp(seed)).toBeNull();
  });

  it('returns null for invalid base32 seed (L237: catch)', () => {
    // 32 chars but not valid base32 (contains 0, 1, 8, 9 which are not base32)
    const invalidBase32 = '01234567890123456789012345678901';
    expect(generateTotp(invalidBase32)).toBeNull();
  });

  it('returns TOTP code for valid 32-char base32 seed (L236)', () => {
    // Valid base32 seed (32 chars, A-Z + 2-7)
    const validSeed = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const code = generateTotp(validSeed);
    expect(code).not.toBeNull();
    expect(typeof code).toBe('string');
    expect(code).toMatch(/^\d{6}$/); // 6-digit TOTP
  });

  it('LogicalOperator mutant L232: !seed || typeof → !seed && typeof', () => {
    // With non-string truthy seed (e.g. 123): original returns null (typeof check)
    // Mutant (!seed && typeof): 123 is truthy → !seed=false → false && ... → false → skip guard
    // → tries totpGenerateSync({secret: 123}) → may throw → catch → null
    // Either way returns null, so this is equivalent
    expect(generateTotp(123)).toBeNull();
  });

  it('LogicalOperator mutant L234: || → && (all conditions must be true)', () => {
    // With seed containing @ but length=32: original returns null (@ check)
    // Mutant (&&): length!==32 is false → false && ... → false → skip guard → tries TOTP
    const seed = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@1';
    expect(generateTotp(seed)).toBeNull();
  });
});
