import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scrape,
  getPlatform,
  ZaloCrawler,
  ZaloClient,
  createZaloClient,
  createZaloCrawler,
  scrapeZalo,
} from '../../../../src/scrapers/index.js';
import articlesFixture from './fixtures/zalo-articles.json';
import followersFixture from './fixtures/zalo-followers.json';
import infoFixture from './fixtures/zalo-info.json';
import productsFixture from './fixtures/zalo-products.json';

describe('Story 33.1: Unified Dispatcher - Zalo OA', () => {
  beforeEach(() => {
    vi.spyOn(ZaloClient.prototype, 'getArticles').mockResolvedValue(articlesFixture);
    vi.spyOn(ZaloClient.prototype, 'getFollowers').mockResolvedValue(followersFixture);
    vi.spyOn(ZaloClient.prototype, 'getOaInfo').mockResolvedValue(infoFixture);
    vi.spyOn(ZaloClient.prototype, 'getProducts').mockResolvedValue(productsFixture);
    vi.spyOn(ZaloClient.prototype, 'cleanup').mockResolvedValue(undefined);
  });

  it('resolves platform aliases via getPlatform', () => {
    expect(getPlatform('zalo')).toBeDefined();
    expect(getPlatform('zalo_oa')).toBeDefined();
    expect(getPlatform('zalo_official_account')).toBeDefined();
  });

  it('exports ZaloCrawler and ZaloClient from unified scrapers barrel', () => {
    expect(ZaloCrawler).toBeDefined();
    expect(ZaloClient).toBeDefined();
    expect(createZaloClient).toBeDefined();
    expect(createZaloCrawler).toBeDefined();
    expect(scrapeZalo).toBeDefined();
  });

  it('dispatches oa_posts via scrape(zalo, ...)', async () => {
    const res = await scrape('zalo', 'oa_posts', {
      accessToken: 'test_token',
      oaId: 'oa_123',
    });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].platform).toBe('zalo');
    expect(res.posts[0].category).toBe('social');
  });

  it('dispatches oa_followers via alias scrape(zalo_oa, followers, ...)', async () => {
    const res = await scrape('zalo_oa', 'followers', {
      accessToken: 'test_token',
      oaId: 'oa_123',
    });
    expect(res.profiles).toHaveLength(2);
    expect(res.profiles[0].platform).toBe('zalo');
  });

  it('dispatches oa_detail via alias scrape(zalo_official_account, profile, ...)', async () => {
    const res = await scrape('zalo_official_account', 'profile', {
      accessToken: 'test_token',
      oaId: 'oa_123',
    });
    expect(res.profile).toBeDefined();
    expect(res.profile.name).toBe('Nowing AI Official Account');
  });

  it('dispatches marketplace_products via scrape(zalo, marketplace, ...)', async () => {
    const res = await scrape('zalo', 'marketplace', {
      accessToken: 'test_token',
      oaId: 'oa_123',
    });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].metadata.isProduct).toBe(true);
  });

  it('executes scrapeZalo convenience helper', async () => {
    const res = await scrapeZalo('oa_posts', {
      accessToken: 'test_token',
      oaId: 'oa_123',
    });
    expect(res.posts).toHaveLength(2);
  });
});
