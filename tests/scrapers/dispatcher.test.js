// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { scrape, getPlatform, platforms } from '../../src/scrapers/index.js';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { RedditCrawler } from '../../src/scrapers/social/reddit/crawler.js';
import { RedditClient } from '../../src/scrapers/social/reddit/client.js';

/**
 * Story 25.1 — Universal scrape() Dispatcher
 *
 * Verifies the thin descriptor-based dispatcher preserves the behavior of the
 * old monolithic scrape(): alias resolution, DI forwarding, mapped args
 * (cursor/resume), unknown platform/action errors, autoClose, and the
 * Facebook options.page legacy path.
 *
 * No mocks/stubs/fakes of behavior under test — only prototype spies that
 * capture the CrawlerCommand handed to crawler.start().
 */
describe('Story 25.1 — Universal scrape() dispatcher', () => {
  beforeAll(() => {
    // Keep TikTokClient lightweight — no browser signer machinery needed here
    // (same toggle used by tests/scrapers/social/tiktok/caller-migration.test.js).
    process.env.TIKTOK_BROWSER_SIGN = 'false';
  });

  it('throws for invalid platform parameter (null, undefined, non-string)', async () => {
    await expect(scrape(null, 'profile')).rejects.toThrow(/platform must be a non-empty string/);
    await expect(scrape(undefined, 'profile')).rejects.toThrow(/platform must be a non-empty string/);
    await expect(scrape('', 'profile')).rejects.toThrow(/platform must be a non-empty string/);
    await expect(scrape(123, 'profile')).rejects.toThrow(/platform must be a non-empty string/);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------------
  // Alias resolution — every alias must reach the right crawler
  // ------------------------------------------------------------------------

  it('resolves platform aliases to the same descriptor (rdt → reddit)', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(RedditCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    await scrape('rdt', 'search', { query: 'openai' });
    expect(calls).toHaveLength(1);
    expect(calls[0].crawler).toBeInstanceOf(RedditCrawler);
    expect(calls[0].command.action).toBe('search');
    expect(calls[0].command.args.query).toBe('openai');
  });

  it.each([
    ['x', 'profile', { username: 'someone' }, 'profile'],
    ['masto', 'trending', {}, 'trending'],
    ['bsky', 'profile', { handle: 'user.bsky.social' }, 'profile'],
    ['vnw', 'search', { keyword: 'dev' }, 'search_jobs'],
    ['mst', 'search', { q: 'abc' }, 'search'],
    ['bds', 'search', { keyword: 'nhà' }, 'search_listings'],
    ['cho_tot', 'search', { keyword: 'xe' }, 'search_listings'],
    ['top_cv', 'jobs', { keyword: 'dev' }, 'search_jobs'],
    ['yt', 'search', { query: 'lofi' }, 'search'],
    ['zalo_oa', 'followers', { oaId: '123' }, 'oa_followers'],
    ['md', 'user', { username: 'author' }, 'user'],
    ['ig', 'user', { username: 'acct' }, 'user'],
    ['medium_com', 'user', { username: 'author' }, 'user'],
    ['tiktok_shop', 'search', { keyword: 'áo' }, 'search_products'],
    ['foody', 'search', { keyword: 'phở' }, 'search_restaurants'],
    ['medpro', 'search', { keyword: 'clinic' }, 'search_clinics'],
    ['oto_vn', 'search', { keyword: 'vf3' }, 'search'],
    ['hosocongty', 'search', { q: 'abc' }, 'search'],
    ['muasamcong', 'search_tenders', { q: 'x' }, 'search_tenders'],
    ['legal', 'search', { keyword: 'tm' }, 'search_gazette'],
    ['fb', 'profile', {
      page: {
        goto: async () => {},
        evaluate: async () => ({
          ogTitle: 'P | Facebook',
          ogDescription: '1 follower.',
          ogImage: null,
          domFollowers: null,
          pageUrl: 'https://www.facebook.com/p',
        }),
      },
      username: 'p',
    }, null],
  ])('alias %s dispatches action %s correctly', async (alias, action, options, expectedAction) => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    // Any crawler reached through the generic path gets cleanup short-circuited
    // (facebook page-path never constructs a crawler).
    vi.spyOn(AbstractCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    if (alias === 'fb') {
      // facebook page-path: legacy module fns take over — no crawler.start
      const res = await scrape(alias, action, options);
      expect(res).toBeDefined();
      expect(res.platform).toBe('facebook');
      return;
    }
    await scrape(alias, action, options);
    expect(calls).toHaveLength(1);
    expect(calls[0].command.action).toBe(expectedAction);
  });

  // ------------------------------------------------------------------------
  // Unknown platform / unknown action errors keep their shapes
  // ------------------------------------------------------------------------

  it('throws "Unknown platform" for unregistered platforms', async () => {
    await expect(scrape('myspace', 'profile', {})).rejects.toThrow(/Unknown platform "myspace"/);
  });

  it('unknown-platform error lists available platforms without short aliases', async () => {
    const err = await scrape('myspace', 'profile', {}).catch((e) => e);
    expect(err.message).toContain('Available:');
    expect(err.message).not.toMatch(/(?:^|[, ])\bx\b/);
    expect(err.message).not.toMatch(/(?:^|[, ])\bfb\b/);
  });

  it('throws 400-level actionNotAvailable for unknown actions on strict platforms', async () => {
    const err = await scrape('topcv', 'bogus_action', {}).catch((e) => e);
    expect(err.message).toMatch(/Action "bogus_action" not available on platform "topcv"/);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('XACT_4001');
  });

  // ------------------------------------------------------------------------
  // DI injection — options.{client,store,proxyPool,...} forwarded verbatim
  // ------------------------------------------------------------------------

  it('reuses options.client when it is a RedditClient instance', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(RedditCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    const injected = new RedditClient({});
    await scrape('reddit', 'search', { query: 'x', client: injected });
    expect(calls[0].crawler.client).toBe(injected);
  });

  it('forwards store, proxyPool, governor, accountPool, sessionManager to crawler ctor', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(RedditCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    const store = { kind: 'custom-store' };
    const proxyPool = { kind: 'pool' };
    const proxyProvider = { kind: 'provider' };
    const governor = { kind: 'gov' };
    const accountPool = { kind: 'accounts' };
    const sessionManager = { kind: 'sessions' };

    await scrape('reddit', 'search', {
      query: 'x',
      store,
      proxyPool,
      proxyProvider,
      governor,
      accountPool,
      sessionManager,
    });

    const crawler = calls[0].crawler;
    expect(crawler.store).toBe(store);
    // sessionManager is forwarded to the crawler deps (AbstractCrawler stores it),
    // matching the original dispatcher — it was never passed to RedditClient.
    expect(crawler.sessionManager).toBe(sessionManager);
    // Client received the forwarded DI options (base-client stores them)
    expect(crawler.client.proxyPool).toBe(proxyPool);
    expect(crawler.client.proxyProvider).toBe(proxyProvider);
    expect(crawler.client.governor).toBe(governor);
    expect(crawler.client.accountPool).toBe(accountPool);
  });

  it('preserves store: null to disable persistence', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(RedditCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    await scrape('reddit', 'search', { query: 'x', store: null });
    expect(calls[0].crawler.store).toBeNull();
  });

  // ------------------------------------------------------------------------
  // resume:false + cursor forwarding into crawler.start args
  // ------------------------------------------------------------------------

  it('forwards resume:false, dryRun and cursor verbatim in mapped args (tiktok)', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(AbstractCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    await scrape('tiktok', 'search', { query: 'dance', resume: false, dryRun: true, cursor: 'cur_1' });
    const args = calls[0].command.args;
    expect(args.resume).toBe(false);
    expect(args.dryRun).toBe(true);
    expect(args.cursor).toBe('cur_1');
    expect(calls[0].command.action).toBe('search');
  });

  it('maps cursor → max_id for mastodon posts', async () => {
    const calls = [];
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async function (command) {
      calls.push({ command, crawler: this });
      return [];
    });
    vi.spyOn(AbstractCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    await scrape('mastodon', 'posts', { username: 'Gargron', cursor: 'cur_99', since_id: 's_1', includeReplies: false });
    const args = calls[0].command.args;
    expect(args.max_id).toBe('cur_99');
    expect(args.since_id).toBe('s_1');
    expect(args.exclude_replies).toBe(true);
  });

  // ------------------------------------------------------------------------
  // autoClose — crawler.cleanup() gated by options.autoClose !== false
  // ------------------------------------------------------------------------

  it('calls crawler.cleanup() by default and skips it when autoClose === false', async () => {
    vi.spyOn(AbstractCrawler.prototype, 'start').mockImplementation(async () => []);
    const cleanupSpy = vi.spyOn(RedditCrawler.prototype, 'cleanup').mockImplementation(async () => {});

    await scrape('reddit', 'search', { query: 'x' });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    await scrape('reddit', 'search', { query: 'x', autoClose: false });
    expect(cleanupSpy).toHaveBeenCalledTimes(1); // unchanged
  });

  // ------------------------------------------------------------------------
  // Facebook options.page legacy path — real module fns, no crawler
  // ------------------------------------------------------------------------

  it('facebook + options.page routes through legacy module functions', async () => {
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

  it('facebook page-path throws actionNotAvailable for unmapped actions', async () => {
    const fakePage = { goto: async () => {}, evaluate: async () => ({}) };
    await expect(scrape('facebook', 'following', { page: fakePage, username: 'zuck' }))
      .rejects.toThrow(/not available/i);
  });

  // ------------------------------------------------------------------------
  // Registry contract — platforms map unchanged (legacy modules preserved)
  // ------------------------------------------------------------------------

  it('platforms registry still resolves legacy module objects', () => {
    expect(platforms.facebook).toBeDefined();
    expect(typeof platforms.facebook.createBrowser).toBe('function');
    expect(platforms.fb).toBe(platforms.facebook);
    expect(getPlatform('twitter')).toBe(platforms.twitter);
  });
});
