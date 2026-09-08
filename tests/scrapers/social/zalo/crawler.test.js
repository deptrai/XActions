import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZaloCrawler } from '../../../../src/scrapers/social/zalo/crawler.js';
import { ZaloClient } from '../../../../src/scrapers/social/zalo/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import articlesFixture from './fixtures/zalo-articles.json';
import followersFixture from './fixtures/zalo-followers.json';
import infoFixture from './fixtures/zalo-info.json';
import productsFixture from './fixtures/zalo-products.json';

describe('Story 33.1: ZaloCrawler', () => {
  let mockClient;
  let mockStore;
  let mockPublisher;
  let mockAccountPool;
  let crawler;

  beforeEach(() => {
    mockClient = {
      requiresAuth: true,
      requiresProxy: false,
      platform: 'zalo',
      setAccessToken: vi.fn(),
      getArticles: vi.fn().mockResolvedValue(articlesFixture),
      getFollowers: vi.fn().mockResolvedValue(followersFixture),
      getOaInfo: vi.fn().mockResolvedValue(infoFixture),
      getProducts: vi.fn().mockResolvedValue(productsFixture),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    mockStore = {
      savePost: vi.fn().mockResolvedValue(undefined),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      storeBatch: vi.fn().mockResolvedValue(undefined),
    };

    mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockAccountPool = {
      getNextAvailable: vi.fn().mockReturnValue("oa_acc_1"),
      getAccount: vi.fn().mockReturnValue({
        credentials: { accessToken: 'pool_token_abc' },
      }),
      listAccounts: vi.fn().mockReturnValue([
        { credentials: { accessToken: 'pool_token_abc' } },
      ]),
      hibernateAccount: vi.fn(),
    };

    crawler = new ZaloCrawler({
      client: mockClient,
      store: mockStore,
      publisher: mockPublisher,
      accountPool: mockAccountPool,
    });
  });

  it('inherits from AbstractCrawler and sets expected properties', () => {
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('zalo');
    expect(crawler.platform).toBe('zalo');
    expect(crawler.category).toBe('social');
    expect(crawler.requiresAuth).toBe(true);
  });

  it('runs init and cleanup lifecycle cleanly', async () => {
    await expect(crawler.init()).resolves.toBeUndefined();
    await expect(crawler.cleanup()).resolves.toBeUndefined();
    expect(mockClient.cleanup).toHaveBeenCalled();
  });

  it('scrapes oa_posts, validates items, persists to store and publishes thin-events', async () => {
    const res = await crawler.start({
      action: 'oa_posts',
      args: { oaId: 'oa_999', limit: 10 },
    });

    expect(mockClient.getArticles).toHaveBeenCalledWith({ offset: 0, limit: 10, type: 'normal' });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].platform).toBe('zalo');
    expect(res.posts[0].category).toBe('social');
    expect(res.pageInfo.total).toBe(2);

    expect(mockStore.storeBatch).toHaveBeenCalledWith(res.posts);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(2);
  });

  it('supports action aliases for oa_posts (posts, articles, feed)', async () => {
    const res = await crawler.start({
      action: 'posts',
      args: { oaId: 'oa_999' },
    });
    expect(res.posts).toHaveLength(2);
  });

  it('scrapes oa_followers, persists profiles, and returns pagination', async () => {
    const res = await crawler.start({
      action: 'oa_followers',
      args: { oaId: 'oa_999', count: 50 },
    });

    expect(mockClient.getFollowers).toHaveBeenCalledWith({ offset: 0, count: 50 });
    expect(res.profiles).toHaveLength(2);
    expect(res.profiles[0].platform).toBe('zalo');
    expect(mockStore.saveProfile).toHaveBeenCalledTimes(2);
  });

  it('supports action aliases for oa_followers (followers)', async () => {
    const res = await crawler.start({
      action: 'followers',
      args: { oaId: 'oa_999' },
    });
    expect(res.profiles).toHaveLength(2);
  });

  it('scrapes oa_detail and returns profile', async () => {
    const res = await crawler.start({
      action: 'oa_detail',
      args: { oaId: 'oa_123456' },
    });

    expect(mockClient.getOaInfo).toHaveBeenCalled();
    expect(res.profile).toBeDefined();
    expect(res.profile.name).toBe('Nowing AI Official Account');
    expect(mockStore.saveProfile).toHaveBeenCalledWith(res.profile);
  });

  it('supports action aliases for oa_detail (info, profile, oa_info, detail)', async () => {
    const res = await crawler.start({
      action: 'oa_info',
      args: { oaId: 'oa_123456' },
    });
    expect(res.profile.name).toBe('Nowing AI Official Account');
  });

  it('scrapes marketplace_products and validates items', async () => {
    const res = await crawler.start({
      action: 'marketplace_products',
      args: { oaId: 'oa_999', limit: 10 },
    });

    expect(mockClient.getProducts).toHaveBeenCalledWith({ offset: 0, limit: 10 });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].metadata.isProduct).toBe(true);
    expect(mockStore.storeBatch).toHaveBeenCalledWith(res.posts);
  });

  it('resolves access token from direct args', async () => {
    await crawler.start({
      action: 'oa_posts',
      args: { accessToken: 'direct_token_xyz' },
    });
    expect(mockClient.setAccessToken).toHaveBeenCalledWith('direct_token_xyz');
  });

  it('resolves access token from AccountPool if not provided directly', async () => {
    await crawler.start({
      action: 'oa_posts',
      args: { accountId: 'oa_acc_1' },
    });
    expect(mockClient.setAccessToken).toHaveBeenCalledWith('pool_token_abc');
  });
});
