// by nichxbt
import { describe, it, expect } from 'vitest';
import facebook, {
  loginWithCookie,
  normalizeProfile,
  normalizeHandle,
  scrapeProfile,
} from '../../src/scrapers/facebook/index.js';
import { getPlatform, platforms, scrape } from '../../src/scrapers/index.js';

// ============================================================================
// AC2 — loginWithCookie error handling
// ============================================================================

describe('loginWithCookie', () => {
  it('throws when c_user is missing', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    await expect(loginWithCookie(fakePage, { c_user: '', xs: 'some-xs-token' }))
      .rejects.toThrow('❌ Facebook login requires both c_user and xs cookies');
  });

  it('throws when xs is missing', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    await expect(loginWithCookie(fakePage, { c_user: '123456789012345', xs: '' }))
      .rejects.toThrow('❌ Facebook login requires both c_user and xs cookies');
  });

  it('throws when both cookies are missing', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    await expect(loginWithCookie(fakePage, {}))
      .rejects.toThrow('❌ Facebook login requires both c_user and xs cookies');
  });

  it('error message does not include cookie values', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    const secretValue = 'SUPER_SECRET_XS_TOKEN';
    let caughtMessage = '';
    try {
      await loginWithCookie(fakePage, { c_user: '', xs: secretValue });
    } catch (e) {
      caughtMessage = e.message;
    }
    expect(caughtMessage).not.toContain(secretValue);
  });
});

// ============================================================================
// AC1/AC2 — normalizeProfile (pure function, no browser)
// ============================================================================

describe('normalizeProfile', () => {
  it('returns normalized shape with all fields', () => {
    const raw = {
      ogTitle: 'Mark Zuckerberg | Facebook',
      ogDescription: '100M followers. CEO of Meta.',
      ogImage: 'https://cdn.fb.com/avatar.jpg',
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/zuck',
    };
    const result = normalizeProfile(raw, 'zuck');
    expect(result.name).toBe('Mark Zuckerberg');
    expect(result.username).toBe('zuck');
    expect(result.followers).toBe('100M');
    expect(result.bio).toBe('CEO of Meta.');
    expect(result.avatar).toBe('https://cdn.fb.com/avatar.jpg');
    expect(result.url).toBe('https://www.facebook.com/zuck');
    expect(result.platform).toBe('facebook');
  });

  it('sets username from inputHandle even when ogTitle missing name', () => {
    const raw = {
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/someuser',
    };
    const result = normalizeProfile(raw, 'someuser');
    expect(result.username).toBe('someuser');
    expect(result.platform).toBe('facebook');
  });

  it('sets followers to null when not extractable', () => {
    const raw = {
      ogTitle: 'Some Page | Facebook',
      ogDescription: 'A page about stuff.',
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/somepage',
    };
    const result = normalizeProfile(raw, 'somepage');
    expect(result.followers).toBeNull();
  });

  it('falls back to domFollowers when og:description has no count', () => {
    const raw = {
      ogTitle: 'Test Page | Facebook',
      ogDescription: 'Just a bio.',
      ogImage: null,
      domFollowers: '5.2K', // already-extracted count (scrapeProfile captures group 1)
      pageUrl: 'https://www.facebook.com/testpage',
    };
    const result = normalizeProfile(raw, 'testpage');
    expect(result.followers).toBe('5.2K');
  });

  it('strips pipe and Facebook suffix from name', () => {
    const raw = {
      ogTitle: 'NASA | Facebook',
      ogDescription: '50M followers. Space agency.',
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/NASA',
    };
    const result = normalizeProfile(raw, 'NASA');
    expect(result.name).toBe('NASA');
  });

  it('uses pageUrl from raw when present', () => {
    const raw = {
      ogTitle: 'Test | Facebook',
      ogDescription: null,
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/test?fref=nf',
    };
    const result = normalizeProfile(raw, 'test');
    expect(result.url).toBe('https://www.facebook.com/test?fref=nf');
  });
});

// ============================================================================
// AC3/AC4 — scrapeProfile input normalization (browser-free via fake page)
// ============================================================================

describe('scrapeProfile input normalization', () => {
  const makePageWithMeta = (ogTitle, ogDescription = null, ogImage = null) => ({
    goto: async () => {},
    evaluate: async (fn) => fn.call({
      // Simulate browser document context
    }),
  });

  it('scrapeProfile returns blocked status on missing/blocked profile (ogTitle absent)', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/nonexistent',
      }),
    };
    const res = await scrapeProfile(fakePage, 'nonexistent');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });

  it('scrapeProfile returns blocked status when ogTitle is generic "Facebook"', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Facebook',
        ogDescription: null,
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/',
      }),
    };
    const res = await scrapeProfile(fakePage, 'unknown');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });

  it('scrapeProfile returns normalized profile on valid page', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Mark Zuckerberg | Facebook',
        ogDescription: '100M followers. CEO of Meta.',
        ogImage: 'https://cdn.fb.com/zuck.jpg',
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/zuck',
      }),
    };
    const result = await scrapeProfile(fakePage, 'zuck');
    expect(result.username).toBe('zuck');
    expect(result.name).toBe('Mark Zuckerberg');
    expect(result.platform).toBe('facebook');
    expect(result.followers).toBe('100M');
  });

  it('scrapeProfile strips leading @ from handle', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Test User | Facebook',
        ogDescription: null,
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/testuser',
      }),
    };
    const result = await scrapeProfile(fakePage, '@testuser');
    expect(result.username).toBe('testuser');
  });

  it('scrapeProfile accepts full URL and extracts handle', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'NASA | Facebook',
        ogDescription: '50M followers. Space.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/NASA',
      }),
    };
    const result = await scrapeProfile(fakePage, 'https://www.facebook.com/NASA');
    expect(result.username).toBe('NASA');
  });

  it('scrapeProfile strips subpath from handle (zuck/photos → zuck)', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Mark Zuckerberg | Facebook',
        ogDescription: '100M followers.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/zuck',
      }),
    };
    const result = await scrapeProfile(fakePage, 'https://www.facebook.com/zuck/photos');
    expect(result.username).toBe('zuck');
  });

  it('scrapeProfile strips query string from bare handle (zuck?fref=nf → zuck)', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Mark Zuckerberg | Facebook',
        ogDescription: '100M followers.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/zuck',
      }),
    };
    const result = await scrapeProfile(fakePage, 'zuck?fref=nf');
    expect(result.username).toBe('zuck');
  });

  it('scrapeProfile preserves profile.php?id= numeric identifier', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Some User | Facebook',
        ogDescription: null,
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/profile.php?id=100069',
      }),
    };
    const result = await scrapeProfile(fakePage, 'https://www.facebook.com/profile.php?id=100069');
    expect(result.username).toBe('profile.php?id=100069');
  });
});

// ============================================================================
// AC4 — dispatcher scrape() routes facebook to puppeteer branch
// ============================================================================

describe('dispatcher scrape() facebook routing', () => {
  it('scrape("facebook","profile",...) invokes scrapeProfile on provided page', async () => {
    const calls = [];
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Test Page | Facebook',
        ogDescription: '1K followers. Test.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/testpage',
      }),
    };

    const result = await scrape('facebook', 'profile', {
      page: fakePage,
      username: 'testpage',
    });

    expect(result.platform).toBe('facebook');
    expect(result.username).toBe('testpage');
  });

  it('scrape("facebook",...) rejects authToken with a clear message (must use authCookie)', async () => {
    await expect(
      scrape('facebook', 'profile', { username: 'zuck', authToken: 'some-string-token' })
    ).rejects.toThrow(/authCookie.*not.*authToken/i);
  });
});

// ============================================================================
// Story 1.3 — normalizeHandle
// ============================================================================

describe('normalizeHandle', () => {
  it('strips leading @', () => {
    expect(normalizeHandle('@zuck')).toBe('zuck');
  });

  it('extracts handle from full URL', () => {
    expect(normalizeHandle('https://www.facebook.com/zuck')).toBe('zuck');
  });

  it('extracts handle from URL without www', () => {
    expect(normalizeHandle('https://facebook.com/NASA')).toBe('NASA');
  });

  it('strips subpath', () => {
    expect(normalizeHandle('zuck/photos')).toBe('zuck');
  });

  it('strips query string', () => {
    expect(normalizeHandle('zuck?fref=nf')).toBe('zuck');
  });

  it('preserves profile.php?id= identifier', () => {
    expect(normalizeHandle('profile.php?id=123456789')).toBe('profile.php?id=123456789');
  });

  it('passes through plain handle unchanged', () => {
    expect(normalizeHandle('markzuckerberg')).toBe('markzuckerberg');
  });

  it('strips trailing params from profile.php?id=', () => {
    expect(normalizeHandle('https://www.facebook.com/profile.php?id=100069&fref=nf')).toBe('profile.php?id=100069');
  });

  it('throws on null/undefined/non-string input', () => {
    expect(() => normalizeHandle(null)).toThrow(/handle is required/i);
    expect(() => normalizeHandle(undefined)).toThrow(/handle is required/i);
    expect(() => normalizeHandle(123)).toThrow(/handle is required/i);
    expect(() => normalizeHandle('')).toThrow(/handle is required/i);
  });
});

// ============================================================================
// TEA Expansion — normalizeHandle edge cases
// ============================================================================

describe('[TEA] normalizeHandle — edge cases', () => {
  it('[P1] throws on empty string', () => {
    expect(() => normalizeHandle('')).toThrow(/handle is required/i);
  });

  it('[P1] throws on whitespace-only string', () => {
    expect(() => normalizeHandle('   ')).toThrow(/handle is required/i);
  });
});

// ============================================================================
// TEA Expansion — normalizeProfile edge cases
// ============================================================================

describe('[TEA] normalizeProfile — edge cases', () => {
  it('[P1] parses name when dash separator used (Name – Facebook)', () => {
    const raw = { ogTitle: 'SpaceX – Facebook', ogDescription: null, ogImage: null, domFollowers: null, pageUrl: null };
    const result = normalizeProfile(raw, 'spacex');
    expect(result.name).toBe('SpaceX');
  });

  it('[P1] sets bio to null when ogDescription is null', () => {
    const raw = { ogTitle: 'Test | Facebook', ogDescription: null, ogImage: null, domFollowers: null, pageUrl: null };
    expect(normalizeProfile(raw, 'test').bio).toBeNull();
  });

  it('[P2] sets avatar to null when ogImage is null', () => {
    const raw = { ogTitle: 'Test | Facebook', ogDescription: null, ogImage: null, domFollowers: null, pageUrl: null };
    expect(normalizeProfile(raw, 'test').avatar).toBeNull();
  });

  it('[P2] constructs url from FACEBOOK_BASE when pageUrl is null', () => {
    const raw = { ogTitle: 'Test | Facebook', ogDescription: null, ogImage: null, domFollowers: null, pageUrl: null };
    expect(normalizeProfile(raw, 'testpage').url).toBe('https://www.facebook.com/testpage');
  });
});

// ============================================================================
// TEA Expansion — scrapeProfile login-wall detection variants
// ============================================================================

describe('[TEA] scrapeProfile — login-wall detection variants', () => {
  const makeLoginWallPage = (title) => ({
    goto: async () => {},
    evaluate: async () => ({
      ogTitle: title,
      ogDescription: null,
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/login',
    }),
  });

  it('[P1] returns blocked status on "Log in to Facebook" login-wall title', async () => {
    const res = await scrapeProfile(makeLoginWallPage('Log in to Facebook'), 'target');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });

  it('[P1] returns blocked status on "Log into Facebook" login-wall title', async () => {
    const res = await scrapeProfile(makeLoginWallPage('Log into Facebook'), 'target');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });

  it('[P1] returns blocked status on "Facebook – Log in" login-wall title', async () => {
    const res = await scrapeProfile(makeLoginWallPage('Facebook – Log in'), 'target');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });
});

// ============================================================================
// TEA Round 3 — normalizeHandle comprehensive edge cases
// ============================================================================

describe('[TEA-R3] normalizeHandle — comprehensive edge cases', () => {
  it('[P1] handles http:// URL without www', () => {
    expect(normalizeHandle('http://facebook.com/zuck')).toBe('zuck');
  });

  it('[P1] strips trailing slash from URL', () => {
    expect(normalizeHandle('https://www.facebook.com/zuck/')).toBe('zuck');
  });

  it('[P1] handles URL with path after handle', () => {
    expect(normalizeHandle('https://www.facebook.com/zuck/about')).toBe('zuck');
  });

  it('[P2] handles double @@ prefix gracefully', () => {
    // Single @ stripped, second @ becomes part of handle
    const result = normalizeHandle('@@handle');
    expect(result).toBe('@handle'); // strips only leading @
  });
});

// ============================================================================
// TEA Round 3 — normalizeProfile comprehensive edge cases
// ============================================================================

describe('[TEA-R3] normalizeProfile — comprehensive edge cases', () => {
  it('[P1] parses "people follow" variant for followers count', () => {
    const raw = {
      ogTitle: 'Test Page | Facebook',
      ogDescription: '5.2M people follow this.',
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/testpage',
    };
    expect(normalizeProfile(raw, 'testpage').followers).toBe('5.2M');
  });

  it('[P2] parses follower count with comma-separated thousands', () => {
    const raw = {
      ogTitle: 'Test | Facebook',
      ogDescription: '1,234 followers. Bio here.',
      ogImage: null,
      domFollowers: null,
      pageUrl: null,
    };
    expect(normalizeProfile(raw, 'test').followers).toBe('1,234');
  });

  it('[P2] handles em-dash separator in title (Name — Facebook)', () => {
    const raw = { ogTitle: 'NASA — Facebook', ogDescription: null, ogImage: null, domFollowers: null, pageUrl: null };
    expect(normalizeProfile(raw, 'NASA').name).toBe('NASA');
  });

  it('[P1] bio is null when description only contains follower count', () => {
    const raw = {
      ogTitle: 'Test | Facebook',
      ogDescription: '100K followers.',
      ogImage: null,
      domFollowers: null,
      pageUrl: null,
    };
    const result = normalizeProfile(raw, 'test');
    expect(result.bio).toBeNull();
    expect(result.followers).toBe('100K');
  });
});

// ============================================================================
// TEA Round 3 — loginWithCookie edge cases
// ============================================================================

describe('[TEA-R3] loginWithCookie — edge cases', () => {
  it('[P1] throws when xs is whitespace-only', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    await expect(loginWithCookie(fakePage, { c_user: '123456789', xs: '   ' }))
      .rejects.toThrow('❌ Facebook login requires both c_user and xs cookies');
  });

  it('[P1] throws when c_user is whitespace-only', async () => {
    const fakePage = { setCookie: async () => {}, goto: async () => {} };
    await expect(loginWithCookie(fakePage, { c_user: '   ', xs: 'some-xs' }))
      .rejects.toThrow('❌ Facebook login requires both c_user and xs cookies');
  });

  it('[P1] calls setCookie with correct domain and flags', async () => {
    const cookiesSet = [];
    const fakePage = {
      setCookie: async (...cookies) => { cookiesSet.push(...cookies); },
      goto: async () => {},
      evaluate: async () => ({ hasLoginForm: false, hasLoginButton: false, hasSecurityCheck: false }),
    };
    // Skip warming for this cookie-flags test; cookie attributes are independent of warming.
    await loginWithCookie(fakePage, { c_user: '12345', xs: 'xs-token' }, { headless: false, skipWarmup: true });
    const cUserCookie = cookiesSet.find(c => c.name === 'c_user');
    const xsCookie = cookiesSet.find(c => c.name === 'xs');
    expect(cUserCookie.domain).toBe('.facebook.com');
    expect(cUserCookie.httpOnly).toBe(false);
    expect(cUserCookie.secure).toBe(true);
    expect(xsCookie.domain).toBe('.facebook.com');
    expect(xsCookie.httpOnly).toBe(false);
    expect(xsCookie.secure).toBe(true);
  });
});

// ============================================================================
// TEA Round 3 — scrapeProfile login-wall detection comprehensive
// ============================================================================

describe('[TEA-R3] scrapeProfile — login-wall detection comprehensive', () => {
  const makeWallPage = (title) => ({
    goto: async () => {},
    evaluate: async () => ({
      ogTitle: title,
      ogDescription: null,
      ogImage: null,
      domFollowers: null,
      pageUrl: 'https://www.facebook.com/login',
    }),
  });

  it('[P1] returns blocked status on "Facebook — Log in" em-dash variant', async () => {
    const res = await scrapeProfile(makeWallPage('Facebook — Log in'), 'target');
    expect(res.error).toBe('Profile requires authentication or is blocked');
  });

  it('[P2] does NOT throw on legitimate page with "Facebook" in bio title', async () => {
    const page = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'I Love Facebook | Some Page',
        ogDescription: '100 followers. A page about Facebook.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/ilovefacebook',
      }),
    };
    const result = await scrapeProfile(page, 'ilovefacebook');
    expect(result.platform).toBe('facebook');
  });
});
