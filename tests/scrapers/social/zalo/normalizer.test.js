import { describe, it, expect } from 'vitest';
import {
  normalizeZaloArticle,
  normalizeZaloFollower,
  normalizeZaloOaProfile,
  normalizeZaloProduct,
  normalizeZaloResults,
} from '../../../../src/scrapers/social/zalo/normalizer.js';
import articlesFixture from './fixtures/zalo-articles.json';
import followersFixture from './fixtures/zalo-followers.json';
import infoFixture from './fixtures/zalo-info.json';
import productsFixture from './fixtures/zalo-products.json';

describe('Story 33.1: Zalo Normalizers', () => {
  const context = {
    oaId: 'oa_999',
    oaName: 'Nowing Official',
    oaAvatar: 'https://oa.zalo.me/avatar.png',
  };

  it('normalizes single article to PostItem', () => {
    const raw = articlesFixture.data.medias[0];
    const post = normalizeZaloArticle(raw, context);

    expect(post.id).toBe(`zalo:${raw.id}`);
    expect(post.platform).toBe('zalo');
    expect(post.category).toBe('social');
    expect(post.authorId).toBe('oa_999');
    expect(post.authorName).toBe(raw.author);
    expect(post.title).toBe(raw.title);
    expect(post.content).toContain('Nội dung đầy đủ');
    expect(post.mediaUrls).toEqual([raw.cover, raw.thumb]);
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.metadata.sourcePlatform).toBe('zalo');
  });

  it('normalizes single follower user to ProfileItem', () => {
    const raw = followersFixture.data.users[0];
    const profile = normalizeZaloFollower(raw, context);

    expect(profile.id).toBe(`zalo:${raw.user_id}`);
    expect(profile.platform).toBe('zalo');
    expect(profile.externalId).toBe(raw.user_id);
    expect(profile.profileUrl).toBe(`https://zalo.me/${raw.user_id}`);
    expect(profile.metadata.followedOaId).toBe('oa_999');
  });

  it('normalizes OA info to ProfileItem', () => {
    const raw = infoFixture.data;
    const profile = normalizeZaloOaProfile(raw);

    expect(profile.id).toBe(`zalo:${raw.oa_id}`);
    expect(profile.platform).toBe('zalo');
    expect(profile.name).toBe(raw.name);
    expect(profile.followersCount).toBe(raw.num_follower);
    expect(profile.metadata.isVerified).toBe(true);
    expect(profile.metadata.category).toBe('Technology');
  });

  it('normalizes product to PostItem with product metadata', () => {
    const raw = productsFixture.data.products[0];
    const post = normalizeZaloProduct(raw, context);

    expect(post.id).toBe(`zalo:product:${raw.id}`);
    expect(post.platform).toBe('zalo');
    expect(post.category).toBe('social');
    expect(post.title).toBe(raw.name);
    expect(post.metadata.price).toBe(12000000);
    expect(post.metadata.isProduct).toBe(true);
    expect(post.metadata.code).toBe('LEAD-1Y');
  });

  describe('normalizeZaloResults action router', () => {
    it('handles oa_posts with pagination', () => {
      const result = normalizeZaloResults(articlesFixture, 'oa_posts', { offset: 0, limit: 10, oaId: 'oa_999' });
      expect(result.posts).toHaveLength(2);
      expect(result.pageInfo.total).toBe(2);
      expect(result.pageInfo.has_next_page).toBe(false);
    });

    it('handles oa_followers with pagination', () => {
      const result = normalizeZaloResults(followersFixture, 'oa_followers', { offset: 0, count: 50, oaId: 'oa_999' });
      expect(result.profiles).toHaveLength(2);
      expect(result.pageInfo.total).toBe(2);
      expect(result.pageInfo.has_next_page).toBe(false);
    });

    it('handles oa_detail action', () => {
      const result = normalizeZaloResults(infoFixture, 'oa_detail');
      expect(result.profile).toBeDefined();
      expect(result.profile.name).toBe('Nowing AI Official Account');
    });

    it('handles marketplace_products action', () => {
      const result = normalizeZaloResults(productsFixture, 'marketplace_products', { offset: 0, limit: 10, oaId: 'oa_999' });
      expect(result.posts).toHaveLength(2);
      expect(result.posts[0].metadata.isProduct).toBe(true);
      expect(result.pageInfo.total).toBe(2);
    });
  });
});
