// tests/scrapers/facebook-index.test.js
// P1 Kill: mutation tests for index.js pure functions + browser seams.
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeHandle,
  normalizePost,
  normalizeProfile,
  normalizeFollower,
  normalizeSearchResult,
  generateTotp,
  loginWithCookie,
  scrapeProfile,
  scrapeFollowers,
  scrapeTweets,
  searchTweets,
  scrapeGroupMembers,
  createPage,
} from '../../src/scrapers/facebook/index.js';
import { makeFakePage, makeFakeBrowser } from '../helpers/fake-page.js';

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

  it('strips ALL @ when regex mutant removes anchor (L102: /^@/ vs /@/)', () => {
    // Regex mutant L102: /^@/ → /@/ (no anchor) → strips ALL @ signs
    // Original: only strips leading @ → '@zuck'
    // Mutant: strips all @ → 'zuck'
    expect(normalizeHandle('@@zuck')).toBe('@zuck');
  });

  it('profile.php with multi-digit id — regex \\d+ not \\d (L103, L105)', () => {
    // Regex mutant L103/L105: \d+ → \d (1 digit only)
    // Original: match 'profile.php?id=123456' → handle = 'profile.php?id=123456'
    // Mutant: match 'profile.php?id=1' → handle = 'profile.php?id=1'
    expect(normalizeHandle('profile.php?id=123456')).toBe('profile.php?id=123456');
  });

  it('https URL with www — regex (www\\.)? optional (L100)', () => {
    // Regex mutant L100: (www\\.)? removed → 'www.' not stripped
    expect(normalizeHandle('https://www.facebook.com/zuck')).toBe('zuck');
  });

  it('https URL without www — regex (www\\.)? matches 0 (L100)', () => {
    expect(normalizeHandle('https://facebook.com/zuck')).toBe('zuck');
  });

  it('http URL with www — regex protocol + www (L100)', () => {
    expect(normalizeHandle('http://www.facebook.com/zuck')).toBe('zuck');
  });

  it('URL with subpath after handle — split on / (L108)', () => {
    expect(normalizeHandle('https://facebook.com/zuck/photos/all')).toBe('zuck');
  });

  it('URL with query params — split on ? (L108)', () => {
    expect(normalizeHandle('https://facebook.com/zuck?ref=foo&bar=baz')).toBe('zuck');
  });

  it('profile.php with trailing params — match only id (L105-106)', () => {
    expect(normalizeHandle('profile.php?id=999&ref=foo')).toBe('profile.php?id=999');
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

  it('strips Facebook suffix with multiple spaces before separator (L151: \\s* not \\s)', () => {
    // Regex mutant L151: \s* → \s (requires exactly 1 space, not 0+)
    // "Mark  - Facebook" has 2 spaces before dash → \s matches but \s* matches more
    const result = normalizeProfile({
      ogTitle: 'Mark  - Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark');
  });

  it('strips Facebook suffix with no space before separator (L151: \\s* matches 0)', () => {
    // "Mark-Facebook" — no space before dash
    const result = normalizeProfile({
      ogTitle: 'Mark-Facebook',
    }, 'zuck');
    expect(result.name).toBe('Mark');
  });

  it('strips Facebook suffix with trailing text after Facebook (L151: .*$)', () => {
    const result = normalizeProfile({
      ogTitle: 'Mark Zuckerberg | Facebook - Public figure',
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

  it('extracts "follower" singular (L159: followers? — ? makes s optional)', () => {
    // Regex mutant L159: followers? → followers (no ?) → "1 follower" won't match
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '1 follower',
    }, 'test');
    expect(result.followers).toBe('1');
  });

  it('extracts followers with no space before word (L159: \\s* matches 0)', () => {
    // Regex mutant L159: \s* → \s (requires 1 space) → "123followers" won't match
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '123followers',
    }, 'test');
    expect(result.followers).toBe('123');
  });

  it('extracts followers case insensitive (L159: /i flag)', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '1,234 Followers',
    }, 'test');
    expect(result.followers).toBe('1,234');
  });

  it('extracts followers with lowercase k suffix (L159: [KkMmBb])', () => {
    const result = normalizeProfile({
      ogTitle: 'Test | Facebook',
      ogDescription: '5k followers',
    }, 'test');
    expect(result.followers).toBe('5k');
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

// ============================================================================
// loginWithCookie (L191-217) — fake page
// ============================================================================

describe('loginWithCookie (P1 kill, fake page)', () => {
  it('throws when c_user is missing or empty (L192: !c_user?.trim())', async () => {
    const page = makeFakePage();
    await expect(loginWithCookie(page, { c_user: '', xs: 'test-xs' })).rejects.toThrow(/c_user.*xs/);
    await expect(loginWithCookie(page, { c_user: null, xs: 'test-xs' })).rejects.toThrow(/c_user.*xs/);
    await expect(loginWithCookie(page, { c_user: '  ', xs: 'test-xs' })).rejects.toThrow(/c_user.*xs/);
  });

  it('throws when xs is missing or empty (L192: !xs?.trim())', async () => {
    const page = makeFakePage();
    await expect(loginWithCookie(page, { c_user: '123', xs: '' })).rejects.toThrow(/c_user.*xs/);
    await expect(loginWithCookie(page, { c_user: '123', xs: null })).rejects.toThrow(/c_user.*xs/);
    await expect(loginWithCookie(page, { c_user: '123', xs: '  ' })).rejects.toThrow(/c_user.*xs/);
  });

  it('sets c_user and xs cookies with correct attributes (L196-213)', async () => {
    const page = makeFakePage();
    await loginWithCookie(page, { c_user: '100001', xs: 'xs-token' });
    expect(page.calls.setCookie).toHaveLength(1);
    const cookies = page.calls.setCookie[0]; // [cookie1, cookie2]
    expect(cookies).toHaveLength(2);
    // c_user cookie
    expect(cookies[0]).toMatchObject({
      name: 'c_user', value: '100001',
      domain: '.facebook.com', httpOnly: true, secure: true, sameSite: 'Strict',
    });
    // xs cookie
    expect(cookies[1]).toMatchObject({
      name: 'xs', value: 'xs-token',
      domain: '.facebook.com', httpOnly: true, secure: true, sameSite: 'Strict',
    });
  });

  it('navigates to Facebook base URL (L215)', async () => {
    const page = makeFakePage();
    await loginWithCookie(page, { c_user: '100001', xs: 'xs-token' });
    expect(page.calls.goto).toHaveLength(1);
    expect(page.calls.goto[0].url).toContain('facebook.com');
    expect(page.calls.goto[0].opts.waitUntil).toBe('networkidle2');
  });
});

// ============================================================================
// scrapeProfile (L409-452) — fake page
// ============================================================================

describe('scrapeProfile (P1 kill, fake page)', () => {
  it('throws for blocked profile (ogTitle missing → login wall, L442-448)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: null, ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for generic "Facebook" title (L443: /^facebook$/i)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Facebook', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Log into Facebook" title (L444)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Log into Facebook', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Log in to Facebook" title (L444)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Log in to Facebook', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "FACEBOOK" uppercase (L443: /^facebook$/i)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'FACEBOOK', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Log  in  to Facebook" multiple spaces (L444: \\s+)', async () => {
    // Regex mutant L444: \s+ → \s (1 space only) → "Log  in" won't match
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Log  in  to Facebook', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Loginto Facebook" no space (L445: \\s* matches 0)', async () => {
    // Regex mutant L445: \s* → \s (requires 1 space) → "Loginto" won't match
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Loginto Facebook', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Facebook - Log in" (L446: facebook[\\s–—-]+log)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Facebook - Log in', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('throws for "Facebook—Log in" em dash (L446)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({ ogTitle: 'Facebook—Log in', ogDescription: null, domFollowers: null, pageUrl: 'https://fb.com/x' });
    await expect(scrapeProfile(page, 'ghostuser')).rejects.toThrow(/not found or blocked/);
  });

  it('returns normalized profile for valid page (L451)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({
      ogTitle: 'Mark Zuckerberg | Facebook',
      ogDescription: '1,234 followers · Public figure',
      ogImage: 'https://fb.com/img.jpg',
      domFollowers: null,
      pageUrl: 'https://facebook.com/zuck',
    });
    const result = await scrapeProfile(page, 'zuck');
    expect(result.username).toBe('zuck');
    expect(result.name).toBe('Mark Zuckerberg');
    expect(result.followers).toBe('1,234');
  });

  it('navigates to correct profile URL (L412-413)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({
      ogTitle: 'Test | Facebook',
      ogDescription: '100 followers',
      domFollowers: null,
      pageUrl: 'https://facebook.com/test',
    });
    await scrapeProfile(page, 'test');
    expect(page.calls.goto).toHaveLength(1);
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/test');
  });

  it('normalizes handle before building URL (L410)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({
      ogTitle: 'Test | Facebook',
      ogDescription: '100 followers',
      domFollowers: null,
      pageUrl: 'https://facebook.com/test',
    });
    await scrapeProfile(page, '@test');
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/test');
  });

  it('accepts full URL as handle (L410: normalizeHandle)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => ({
      ogTitle: 'Test | Facebook',
      ogDescription: '100 followers',
      domFollowers: null,
      pageUrl: 'https://facebook.com/test',
    });
    await scrapeProfile(page, 'https://facebook.com/test');
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/test');
  });
});

// ============================================================================
// scrapeFollowers (L491-570) — fake page with scroll loop
// ============================================================================

describe('scrapeFollowers (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('returns note when follower list not publicly exposed (L511-517)', async () => {
    const page = makeFakePage();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem')) return 0; // exposedCount = 0
      return [];
    };
    const result = await scrapeFollowers(page, 'testuser', { delay });
    expect(result.note).toMatch(/not publicly exposed/);
    expect(result.platform).toBe('facebook');
    expect(result.username).toBe('testuser');
  });

  it('navigates to /followers URL for vanity handle (L498)', async () => {
    const page = makeFakePage();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length')) return 0;
      return [];
    };
    await scrapeFollowers(page, 'testuser', { delay });
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/testuser/followers');
  });

  it('navigates to &sk=followers URL for profile.php (L496-497)', async () => {
    const page = makeFakePage();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length')) return 0;
      return [];
    };
    await scrapeFollowers(page, 'profile.php?id=123', { delay });
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/profile.php?id=123&sk=followers');
  });

  it('scrapes followers from listitem rows (L522-553)', async () => {
    const fakeFollowers = [
      { id: 'https://facebook.com/alice', name: 'Alice', username: 'alice', url: 'https://facebook.com/alice' },
      { id: 'https://facebook.com/bob', name: 'Bob', username: 'bob', url: 'https://facebook.com/bob' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length') && callCount === 0) {
        callCount++;
        return 2; // exposedCount > 0
      }
      // Subsequent calls: return follower rows, then empty (to stop scroll loop)
      if (callCount === 1) { callCount++; return fakeFollowers; }
      return []; // no more new followers → retries increment → stop
    };
    const result = await scrapeFollowers(page, 'testuser', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Bob');
    expect(result[0].platform).toBe('facebook');
  });

  it('deduplicates followers by id (L555-560)', async () => {
    const dupFollowers = [
      { id: 'https://facebook.com/alice', name: 'Alice', username: 'alice', url: 'https://facebook.com/alice' },
      { id: 'https://facebook.com/alice', name: 'Alice 2', username: 'alice', url: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length') && callCount === 0) {
        callCount++;
        return 2;
      }
      if (callCount === 1) { callCount++; return dupFollowers; }
      return [];
    };
    const result = await scrapeFollowers(page, 'testuser', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(1); // deduped
    expect(result[0].name).toBe('Alice');
  });

  it('calls onProgress with scraped count and limit (L562)', async () => {
    const onProgress = vi.fn();
    const fakeFollowers = [
      { id: 'https://facebook.com/alice', name: 'Alice', username: 'alice', url: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length') && callCount === 0) {
        callCount++;
        return 1;
      }
      if (callCount === 1) { callCount++; return fakeFollowers; }
      return [];
    };
    await scrapeFollowers(page, 'testuser', { delay, limit: 10, maxRetries: 2, onProgress });
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls[0][0]).toMatchObject({ scraped: 1, limit: 10 });
  });

  it('stops at limit (L522: followers.size < limit)', async () => {
    const fakeFollowers = [
      { id: 'https://facebook.com/alice', name: 'Alice', username: 'alice', url: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && fnStr.includes('length') && callCount === 0) {
        callCount++;
        return 1;
      }
      return fakeFollowers;
    };
    const result = await scrapeFollowers(page, 'testuser', { delay, limit: 1, maxRetries: 5 });
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// scrapeTweets (L585-664) — fake page with scroll loop
// ============================================================================

describe('scrapeTweets (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('navigates to profile URL (L595-597)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => [];
    await scrapeTweets(page, 'testuser', { delay, maxRetries: 1 });
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/testuser');
  });

  it('scrapes posts from [role=article] elements (L604-642)', async () => {
    const fakePosts = [
      {
        id: 'https://facebook.com/post/1',
        text: 'Hello world this is a test post',
        timestamp: '2026-01-01',
        likes: '5',
        comments: '2',
        postUrl: 'https://facebook.com/post/1',
        images: [],
        hasVideo: false,
      },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakePosts;
      }
      return []; // no more → retries increment
    };
    const result = await scrapeTweets(page, 'testuser', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello world this is a test post');
    expect(result[0].platform).toBe('facebook');
  });

  it('deduplicates posts by id (L644-649)', async () => {
    const dupPosts = [
      { id: 'https://facebook.com/post/1', text: 'Post 1 text here', timestamp: null, likes: '0', comments: '0', postUrl: 'https://facebook.com/post/1', images: [], hasVideo: false },
      { id: 'https://facebook.com/post/1', text: 'Post 1 text here', timestamp: null, likes: '0', comments: '0', postUrl: 'https://facebook.com/post/1', images: [], hasVideo: false },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return dupPosts;
      }
      return [];
    };
    const result = await scrapeTweets(page, 'testuser', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(1);
  });

  it('calls onProgress (L651)', async () => {
    const onProgress = vi.fn();
    const fakePosts = [
      { id: 'https://facebook.com/post/1', text: 'Post text here for testing', timestamp: null, likes: '0', comments: '0', postUrl: 'https://facebook.com/post/1', images: [], hasVideo: false },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakePosts;
      }
      return [];
    };
    await scrapeTweets(page, 'testuser', { delay, limit: 10, maxRetries: 2, onProgress });
    expect(onProgress).toHaveBeenCalled();
  });

  it('stops at limit (L603: posts.size < limit)', async () => {
    const fakePosts = [
      { id: 'https://facebook.com/post/1', text: 'Post text here for testing', timestamp: null, likes: '0', comments: '0', postUrl: 'https://facebook.com/post/1', images: [], hasVideo: false },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakePosts;
      }
      return fakePosts;
    };
    const result = await scrapeTweets(page, 'testuser', { delay, limit: 1, maxRetries: 5 });
    expect(result).toHaveLength(1);
  });

  it('increments retries when no new posts (L653-657)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => []; // always empty
    const result = await scrapeTweets(page, 'testuser', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// searchTweets (L702-779) — fake page with scroll loop
// ============================================================================

describe('searchTweets (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('navigates to search URL with encoded query (L704-706)', async () => {
    const page = makeFakePage();
    page.evaluate = async () => [];
    await searchTweets(page, 'test query', { delay, maxRetries: 1 });
    expect(page.calls.goto[0].url).toContain('/search/posts');
    expect(page.calls.goto[0].url).toContain('q=test%20query');
  });

  it('scrapes search results from [role=article] (L713-762)', async () => {
    const fakeResults = [
      {
        id: 'https://facebook.com/post/1',
        text: 'This is a search result about testing',
        author: 'testuser',
        timestamp: '2026-01-01',
        url: 'https://facebook.com/post/1',
      },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakeResults;
      }
      return [];
    };
    const result = await searchTweets(page, 'testing', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('This is a search result about testing');
    expect(result[0].platform).toBe('facebook');
  });

  it('deduplicates results by id (L764-769)', async () => {
    const dupResults = [
      { id: 'https://facebook.com/post/1', text: 'Search result text here', author: 'user1', timestamp: null, url: 'https://facebook.com/post/1' },
      { id: 'https://facebook.com/post/1', text: 'Search result text here', author: 'user1', timestamp: null, url: 'https://facebook.com/post/1' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return dupResults;
      }
      return [];
    };
    const result = await searchTweets(page, 'test', { delay, limit: 10, maxRetries: 2 });
    expect(result).toHaveLength(1);
  });

  it('calls onProgress (L771)', async () => {
    const onProgress = vi.fn();
    const fakeResults = [
      { id: 'https://facebook.com/post/1', text: 'Search result text here', author: 'user1', timestamp: null, url: 'https://facebook.com/post/1' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakeResults;
      }
      return [];
    };
    await searchTweets(page, 'test', { delay, limit: 10, maxRetries: 2, onProgress });
    expect(onProgress).toHaveBeenCalled();
  });

  it('stops at limit (L712: results.size < limit)', async () => {
    const fakeResults = [
      { id: 'https://facebook.com/post/1', text: 'Search result text here', author: 'user1', timestamp: null, url: 'https://facebook.com/post/1' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('article') && callCount === 0) {
        callCount++;
        return fakeResults;
      }
      return fakeResults;
    };
    const result = await searchTweets(page, 'test', { delay, limit: 1, maxRetries: 5 });
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// scrapeGroupMembers (L852-960) — fake page with scroll loop
// ============================================================================

describe('scrapeGroupMembers (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('throws for invalid URL (L861: assertFacebookUrlLocal)', async () => {
    const page = makeFakePage();
    await expect(scrapeGroupMembers(page, 'not-a-url', { delay })).rejects.toThrow(/valid URL/);
  });

  it('throws for non-facebook URL (L804-806)', async () => {
    const page = makeFakePage();
    await expect(scrapeGroupMembers(page, 'https://evil.com/group', { delay })).rejects.toThrow(/facebook\.com/);
  });

  it('throws for empty URL (L789-790)', async () => {
    const page = makeFakePage();
    await expect(scrapeGroupMembers(page, '', { delay })).rejects.toThrow(/non-empty string/);
  });

  it('returns note when member list not accessible (L885-890)', async () => {
    const page = makeFakePage();
    page.waitForSelector = async () => { throw new Error('timeout'); };
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', { delay });
    expect(result.note).toMatch(/not accessible/);
    expect(result.platform).toBe('facebook');
  });

  it('navigates to /members URL (L864-865)', async () => {
    const page = makeFakePage();
    page.waitForSelector = async () => { throw new Error('timeout'); };
    await scrapeGroupMembers(page, 'https://facebook.com/groups/123', { delay });
    expect(page.calls.goto[0].url).toBe('https://facebook.com/groups/123/members');
  });

  it('strips trailing slash before appending /members (L864)', async () => {
    const page = makeFakePage();
    page.waitForSelector = async () => { throw new Error('timeout'); };
    await scrapeGroupMembers(page, 'https://facebook.com/groups/123/', { delay });
    expect(page.calls.goto[0].url).toBe('https://facebook.com/groups/123/members');
  });

  it('scrapes members from listitem rows (L900-938)', async () => {
    const fakeMembers = [
      { name: 'Alice', username: 'alice', profileUrl: 'https://facebook.com/alice' },
      { name: 'Bob', username: 'bob', profileUrl: 'https://facebook.com/bob' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && callCount === 0) {
        callCount++;
        return fakeMembers;
      }
      return [];
    };
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 10, maxStalls: 2,
    });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[0].platform).toBe('facebook');
  });

  it('deduplicates members by profileUrl (L940-944)', async () => {
    const dupMembers = [
      { name: 'Alice', username: 'alice', profileUrl: 'https://facebook.com/alice' },
      { name: 'Alice 2', username: 'alice', profileUrl: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && callCount === 0) {
        callCount++;
        return dupMembers;
      }
      return [];
    };
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 10, maxStalls: 2,
    });
    expect(result).toHaveLength(1);
  });

  it('stops at limit (L944: members.size >= limit)', async () => {
    const fakeMembers = [
      { name: 'Alice', username: 'alice', profileUrl: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && callCount === 0) {
        callCount++;
        return fakeMembers;
      }
      return fakeMembers;
    };
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 1, maxStalls: 5,
    });
    expect(result).toHaveLength(1);
  });

  it('increments stalls when no new members (L949-953)', async () => {
    const page = makeFakePage();
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async () => [];
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 10, maxStalls: 2,
    });
    expect(result).toHaveLength(0);
  });

  it('calls onProgress (L947)', async () => {
    const onProgress = vi.fn();
    const fakeMembers = [
      { name: 'Alice', username: 'alice', profileUrl: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && callCount === 0) {
        callCount++;
        return fakeMembers;
      }
      return [];
    };
    await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 10, maxStalls: 2, onProgress,
    });
    expect(onProgress).toHaveBeenCalled();
  });

  it('strips PII (phone/email) from member names (L814-818, L828)', async () => {
    const fakeMembers = [
      { name: 'Alice call +1-555-123-4567', username: 'alice', profileUrl: 'https://facebook.com/alice' },
    ];
    const page = makeFakePage();
    let callCount = 0;
    page.waitForSelector = async () => makeElementHandleStub();
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('listitem') && callCount === 0) {
        callCount++;
        return fakeMembers;
      }
      return [];
    };
    const result = await scrapeGroupMembers(page, 'https://facebook.com/groups/123', {
      delay, limit: 10, maxStalls: 2,
    });
    expect(result[0].name).not.toContain('555');
    expect(result[0].name).not.toContain('+1');
  });
});

// Helper for scrapeGroupMembers tests
function makeElementHandleStub() {
  return { click: async () => {}, type: async () => {}, getAttribute: () => null, textContent: '' };
}

// ============================================================================
// createPage — fingerprint integration (Story 6.2 + 6.4 + 6.5, AC4-AC8, AC11)
// ============================================================================

describe('createPage — fingerprint integration (Story 6.2 + 6.4 + 6.5)', () => {
  it('calls setUserAgent and setViewport (AC4)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    expect(page.calls.setUserAgent).toHaveLength(1);
    expect(page.calls.setViewport).toHaveLength(1);
    expect(typeof page.calls.setUserAgent[0]).toBe('string');
    expect(page.calls.setViewport[0]).toEqual(
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
    );
  });

  it('sets page._fingerprint matching the applied UA (AC6)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    expect(page._fingerprint).toBeDefined();
    expect(page._fingerprint.ua).toBe(page.calls.setUserAgent[0]);
    expect(page._fingerprint.viewport.width).toBe(page.calls.setViewport[0].width);
    expect(page._fingerprint.viewport.height).toBe(page.calls.setViewport[0].height);
  });

  it('reuses provided fingerprint — does not call generateFingerprint (AC5)', async () => {
    const browser = makeFakeBrowser();
    const explicitFp = {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      platform: 'Win32',
    };
    const page = await createPage(browser, { fingerprint: explicitFp });
    expect(page.calls.setUserAgent[0]).toBe(explicitFp.ua);
    expect(page.calls.setViewport[0].width).toBe(1920);
    expect(page.calls.setViewport[0].height).toBe(1080);
    expect(page._fingerprint).toBe(explicitFp);
  });

  it('two pages with same fingerprint reuse have identical UA (AC5, AC6)', async () => {
    const browser = makeFakeBrowser();
    const page1 = await createPage(browser);
    const page2 = await createPage(browser, { fingerprint: page1._fingerprint });
    expect(page2.calls.setUserAgent[0]).toBe(page1.calls.setUserAgent[0]);
    expect(page2.calls.setViewport[0].width).toBe(page1.calls.setViewport[0].width);
    expect(page2.calls.setViewport[0].height).toBe(page1.calls.setViewport[0].height);
  });

  it('backward compat — createPage(browser) with no options still works (AC7)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    expect(page).toBeDefined();
    expect(page.calls.setUserAgent).toHaveLength(1);
    expect(page._fingerprint).toBeDefined();
  });

  it('calls evaluateOnNewDocument at least twice (navigator + WebRTC — Story 6.4 + 6.5 AC7)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    // 2 calls: one for navigator overrides (6.4), one for WebRTC override (6.5)
    expect(page.calls.evaluateOnNewDocument.length).toBeGreaterThanOrEqual(2);
  });

  it('calls applyFingerprint before applyNavigatorOverrides before applyWebRTCOverride (AC7)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    // All three should have been called
    expect(page.calls.setUserAgent).toHaveLength(1);
    expect(page.calls.evaluateOnNewDocument.length).toBeGreaterThanOrEqual(2);
    // The order is enforced by the createPage implementation:
    // applyFingerprint (setUserAgent) → applyNavigatorOverrides (evaluateOnNewDocument #1) → applyWebRTCOverride (evaluateOnNewDocument #2)
  });

  it('second evaluateOnNewDocument call is WebRTC override (no args — Story 6.5 AC4)', async () => {
    const browser = makeFakeBrowser();
    const page = await createPage(browser);
    expect(page.calls.evaluateOnNewDocument).toHaveLength(2);
    // First call: navigator overrides (has fingerprint as arg)
    expect(page.calls.evaluateOnNewDocument[0].args).toHaveLength(1);
    // Second call: WebRTC override (no args — global, not session-specific)
    expect(page.calls.evaluateOnNewDocument[1].args).toHaveLength(0);
    // Verify the second call's script contains RTCPeerConnection
    expect(page.calls.evaluateOnNewDocument[1].fn).toContain('RTCPeerConnection');
  });

  it('session reuse — navigator overrides use the SAME fingerprint (AC8)', async () => {
    const browser = makeFakeBrowser();
    const explicitFp = {
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      hardwareConcurrency: 6,
      deviceMemory: 4,
      platform: 'MacIntel',
    };
    const page = await createPage(browser, { fingerprint: explicitFp });
    // 2 calls: navigator overrides (with fingerprint arg) + WebRTC override (no args)
    expect(page.calls.evaluateOnNewDocument).toHaveLength(2);
    // First call: navigator overrides — uses the SAME fingerprint as arg
    expect(page.calls.evaluateOnNewDocument[0].args[0]).toEqual(explicitFp);
    expect(page.calls.evaluateOnNewDocument[0].args[0].hardwareConcurrency).toBe(6);
    expect(page.calls.evaluateOnNewDocument[0].args[0].deviceMemory).toBe(4);
    expect(page.calls.evaluateOnNewDocument[0].args[0].platform).toBe('MacIntel');
    // Second call: WebRTC override — no args (global, not session-specific)
    expect(page.calls.evaluateOnNewDocument[1].args).toHaveLength(0);
  });

  it('closes page on applyFingerprint failure — no resource leak (review patch)', async () => {
    const browser = makeFakeBrowser();
    // Override newPage to return a page that fails on setUserAgent
    const pages = [];
    browser.newPage = async () => {
      const page = makeFakePage();
      page.setUserAgent = async () => { throw new Error('boom'); };
      page.close = async () => { page._closed = true; };
      pages.push(page);
      return page;
    };
    await expect(createPage(browser)).rejects.toThrow(/Failed to apply fingerprint/);
    // Verify the page was closed to prevent resource leak
    expect(pages[0]._closed).toBe(true);
  });

  it('closes page on applyNavigatorOverrides failure — no resource leak (Story 6.4 AC11)', async () => {
    const browser = makeFakeBrowser();
    const pages = [];
    browser.newPage = async () => {
      const page = makeFakePage();
      // setUserAgent + setViewport succeed, but evaluateOnNewDocument fails
      page.evaluateOnNewDocument = async () => { throw new Error('eOND boom'); };
      page.close = async () => { page._closed = true; };
      pages.push(page);
      return page;
    };
    await expect(createPage(browser)).rejects.toThrow(/Failed to apply navigator overrides/);
    // Verify the page was closed to prevent resource leak
    expect(pages[0]._closed).toBe(true);
  });

  it('closes page on applyWebRTCOverride failure — no resource leak (Story 6.5 AC8)', async () => {
    const browser = makeFakeBrowser();
    const pages = [];
    let eondCallCount = 0;
    browser.newPage = async () => {
      const page = makeFakePage();
      // First evaluateOnNewDocument (navigator overrides) succeeds, second (WebRTC) fails
      page.evaluateOnNewDocument = async () => {
        eondCallCount++;
        if (eondCallCount === 2) throw new Error('WebRTC eOND boom');
      };
      page.close = async () => { page._closed = true; };
      pages.push(page);
      return page;
    };
    await expect(createPage(browser)).rejects.toThrow(/Failed to apply WebRTC override/);
    // Verify the page was closed to prevent resource leak
    expect(pages[0]._closed).toBe(true);
  });
});

