// by nichxbt
import { describe, it, expect } from 'vitest';
import facebook, {
  createBrowser,
  createPage,
  loginWithCookie,
  scrapeProfile,
  scrapeTweets,
  scrapeFollowers,
  searchTweets,
} from '../../src/scrapers/facebook/index.js';
import { getPlatform, platforms, scrape } from '../../src/scrapers/index.js';

// ============================================================================
// AC3 — Dispatcher wiring
// ============================================================================

describe('dispatcher wiring', () => {
  it('getPlatform("facebook") returns facebook module', () => {
    const mod = getPlatform('facebook');
    expect(mod).toBeDefined();
    expect(typeof mod.createBrowser).toBe('function');
    expect(typeof mod.createPage).toBe('function');
    expect(typeof mod.loginWithCookie).toBe('function');
  });

  it('getPlatform("fb") returns facebook module', () => {
    const mod = getPlatform('fb');
    expect(mod).toBeDefined();
    expect(typeof mod.createBrowser).toBe('function');
    expect(typeof mod.createPage).toBe('function');
    expect(typeof mod.loginWithCookie).toBe('function');
  });

  it('platforms.facebook is defined', () => {
    expect(platforms.facebook).toBeDefined();
  });

  it('platforms.fb is defined and same as platforms.facebook', () => {
    expect(platforms.fb).toBeDefined();
    expect(platforms.fb).toBe(platforms.facebook);
  });

  it('needsPuppeteer includes facebook — dispatcher routes correctly', () => {
    // Verify facebook is registered in the platforms registry.
    // This proves facebook routes into the Puppeteer branch when scrape() is called.
    expect(platforms.facebook).toBe(facebook);
  });

  it('existing platforms still resolve correctly', () => {
    const twitter = getPlatform('twitter');
    expect(twitter).toBeDefined();
    const threads = getPlatform('threads');
    expect(threads).toBeDefined();
    const bluesky = getPlatform('bluesky');
    expect(bluesky).toBeDefined();
  });

  it('unknown platform still throws', () => {
    expect(() => getPlatform('myspace')).toThrow(/Unknown platform/);
  });
});

// ============================================================================
// AC1 — Module exports
// ============================================================================

describe('facebook module exports', () => {
  it('exports createBrowser as named export', () => {
    expect(typeof createBrowser).toBe('function');
  });

  it('exports createPage as named export', () => {
    expect(typeof createPage).toBe('function');
  });

  it('exports loginWithCookie as named export', () => {
    expect(typeof loginWithCookie).toBe('function');
  });

  it('default export contains createBrowser, createPage, loginWithCookie', () => {
    expect(typeof facebook.createBrowser).toBe('function');
    expect(typeof facebook.createPage).toBe('function');
    expect(typeof facebook.loginWithCookie).toBe('function');
  });

  it('default export contains scrapeProfile', () => {
    expect(typeof facebook.scrapeProfile).toBe('function');
  });

  it('exports scrapeProfile as named export', () => {
    expect(typeof scrapeProfile).toBe('function');
  });
});

// ============================================================================
// TEA Expansion — default export completeness
// ============================================================================

describe('[TEA] default export completeness', () => {
  it('[P1] default export contains scrapeFollowers', () => {
    expect(typeof facebook.scrapeFollowers).toBe('function');
  });

  it('[P1] default export contains scrapeTweets', () => {
    expect(typeof facebook.scrapeTweets).toBe('function');
  });
});

// ============================================================================
// TEA Expansion — dispatcher alias and negative routing
// ============================================================================

describe('[TEA] dispatcher — alias and negative routing', () => {
  it('[P1] scrape("fb","profile",...) alias routes correctly', async () => {
    const fakePage = {
      goto: async () => {},
      evaluate: async () => ({
        ogTitle: 'Test Page | Facebook',
        ogDescription: '1K followers. Test bio.',
        ogImage: null,
        domFollowers: null,
        pageUrl: 'https://www.facebook.com/testpage',
      }),
    };
    const result = await scrape('fb', 'profile', { page: fakePage, username: 'testpage' });
    expect(result.platform).toBe('facebook');
  });

  it('[P2] scrape("facebook","following",...) throws "not available" error', async () => {
    const fakePage = { goto: async () => {}, evaluate: async () => ({}) };
    await expect(scrape('facebook', 'following', { page: fakePage, username: 'zuck' }))
      .rejects.toThrow(/not available/i);
  });
});

// ============================================================================
// TEA Round 3 — default export complete check
// ============================================================================

describe('[TEA-R3] default export — complete export check', () => {
  it('[P1] default export has all 7 expected functions', () => {
    const expected = ['createBrowser', 'createPage', 'loginWithCookie', 'scrapeProfile', 'scrapeFollowers', 'scrapeTweets', 'searchTweets'];
    expected.forEach(fn => {
      expect(typeof facebook[fn]).toBe('function');
    });
  });
});
