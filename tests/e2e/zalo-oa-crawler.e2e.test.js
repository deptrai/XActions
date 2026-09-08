// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for Zalo OA & Public Content Crawler (Story 33.1).
// by nichxbt

import { describe, it, expect, vi } from 'vitest';
import { scrape, scrapeZalo, ZaloClient } from '../../src/scrapers/index.js';
import { AuthSessionExpiredError, RateLimitError } from '../../src/core/error-envelope.js';
import articlesFixture from '../scrapers/social/zalo/fixtures/zalo-articles.json';
import followersFixture from '../scrapers/social/zalo/fixtures/zalo-followers.json';
import infoFixture from '../scrapers/social/zalo/fixtures/zalo-info.json';
import productsFixture from '../scrapers/social/zalo/fixtures/zalo-products.json';

describe('Story 33.1 — Zalo OA & Public Content Crawler E2E Pipeline', () => {
  it('executes full pipeline for oa_posts with PostItem normalization', async () => {
    vi.spyOn(ZaloClient.prototype, 'getArticles').mockResolvedValueOnce(articlesFixture);

    const result = await scrape('zalo', 'oa_posts', {
      accessToken: 'valid_test_token_2026',
      oaId: 'oa_live_test',
      limit: 10,
      offset: 0,
    });

    expect(result).toHaveProperty('posts');
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts).toHaveLength(2);

    const firstPost = result.posts[0];
    expect(firstPost.id).toMatch(/^zalo:art_\d+/);
    expect(firstPost.platform).toBe('zalo');
    expect(firstPost.category).toBe('social');
    expect(firstPost.authorId).toBe('oa_live_test');
    expect(firstPost.title).toBeTruthy();
    expect(firstPost.content).toBeTruthy();
    expect(firstPost.mediaUrls).toHaveLength(2);
    expect(firstPost.metadata.sourcePlatform).toBe('zalo');

    expect(result.pageInfo).toEqual({
      total: 2,
      offset: 0,
      limit: 10,
      has_next_page: false,
    });
  });

  it('executes full pipeline for oa_followers with ProfileItem normalization', async () => {
    vi.spyOn(ZaloClient.prototype, 'getFollowers').mockResolvedValueOnce(followersFixture);

    const result = await scrape('zalo_oa', 'oa_followers', {
      accessToken: 'valid_test_token_2026',
      oaId: 'oa_live_test',
      count: 50,
    });

    expect(result).toHaveProperty('profiles');
    expect(Array.isArray(result.profiles)).toBe(true);
    expect(result.profiles).toHaveLength(2);

    const firstProfile = result.profiles[0];
    expect(firstProfile.id).toMatch(/^zalo:usr_\d+/);
    expect(firstProfile.platform).toBe('zalo');
    expect(firstProfile.profileUrl).toContain('zalo.me');
  });

  it('executes full pipeline for oa_detail / oa_info with official verified metadata', async () => {
    vi.spyOn(ZaloClient.prototype, 'getOaInfo').mockResolvedValueOnce(infoFixture);

    const result = await scrapeZalo('oa_detail', {
      accessToken: 'valid_test_token_2026',
      oaId: 'oa_123456',
    });

    expect(result).toHaveProperty('profile');
    const profile = result.profile;
    expect(profile.id).toBe('zalo:oa_123456');
    expect(profile.name).toBe('Nowing AI Official Account');
    expect(profile.followersCount).toBe(5420);
    expect(profile.metadata.isVerified).toBe(true);
    expect(profile.metadata.category).toBe('Technology');
  });

  it('executes full pipeline for marketplace_products with product catalog metadata', async () => {
    vi.spyOn(ZaloClient.prototype, 'getProducts').mockResolvedValueOnce(productsFixture);

    const result = await scrape('zalo', 'marketplace_products', {
      accessToken: 'valid_test_token_2026',
      oaId: 'oa_123456',
      limit: 10,
    });

    expect(result).toHaveProperty('posts');
    expect(result.posts).toHaveLength(2);

    const firstProduct = result.posts[0];
    expect(firstProduct.id).toMatch(/^zalo:product:prod_\d+/);
    expect(firstProduct.metadata.isProduct).toBe(true);
    expect(firstProduct.metadata.price).toBe(12000000);
    expect(firstProduct.metadata.code).toBe('LEAD-1Y');
  });

  it('properly triggers AuthSessionExpiredError on Zalo business error -216', async () => {
    vi.spyOn(ZaloClient.prototype, 'request').mockResolvedValueOnce({
      error: -216,
      message: 'Access token invalid or revoked',
    });

    await expect(
      scrape('zalo', 'oa_posts', {
        accessToken: 'expired_token',
        oaId: 'oa_test',
      })
    ).rejects.toThrow(AuthSessionExpiredError);
  });

  it('properly triggers RateLimitError on Zalo business error -211', async () => {
    vi.spyOn(ZaloClient.prototype, 'request').mockResolvedValueOnce({
      error: -211,
      message: 'Out of quota for this OA',
    });

    await expect(
      scrape('zalo', 'oa_posts', {
        accessToken: 'token_quota_limit',
        oaId: 'oa_test',
      })
    ).rejects.toThrow(RateLimitError);
  });
});
