// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import {
  asRecord,
  namespacedMediumId,
  extractPostId,
  stripTrackingParams,
  extractFirstImage,
  extractImages,
  isPaywalledRss,
  normalizeMediumRssItem,
  normalizeMediumJsonPost,
  normalizeMediumGraphqlPost,
} from '../../../../src/scrapers/social/medium/normalizer.js';

describe('Medium normalizer helpers', () => {
  it('namespacedMediumId prefixes with medium:', () => {
    expect(namespacedMediumId('abc123def456')).toBe('medium:abc123def456');
    expect(namespacedMediumId('  abc  ')).toBe('medium:abc');
    expect(namespacedMediumId(0)).toBe('medium:0');
  });

  it('extractPostId pulls 12-char hex id from short, canonical, and plain ids', () => {
    expect(extractPostId('https://medium.com/p/abc123def456')).toBe('abc123def456');
    expect(extractPostId('https://medium.com/@user/my-post-abc123def456?source=rss-123')).toBe('abc123def456');
    expect(extractPostId('https://medium.com/@user/my-post-abc123def456/')).toBe('abc123def456');
    expect(extractPostId('ABC123DEF456')).toBe('abc123def456');
    expect(extractPostId('not-a-valid-id')).toBeNull();
  });

  it('stripTrackingParams removes Medium/UTM tracking', () => {
    expect(stripTrackingParams('https://medium.com/p/abc?source=rss-foo&utm_source=email&sk=abc')).toBe('https://medium.com/p/abc');
    expect(stripTrackingParams('https://medium.com/p/abc?source=twi&foo=bar')).toBe('https://medium.com/p/abc?foo=bar');
    expect(stripTrackingParams('not-a-url')).toBe('not-a-url');
  });

  it('extractFirstImage skips tracking pixels and data URIs', () => {
    const html = '<p>text</p><img src="data:image/gif;base64,abc" /><img src="https://cdn.example/hero.jpg" /><img src="https://medium.com/_/stat?abc=1" />';
    expect(extractFirstImage(html)).toBe('https://cdn.example/hero.jpg');
    expect(extractFirstImage('<img src="https://example.com/1x1.gif" />')).toBeNull();
    expect(extractFirstImage('')).toBeNull();
  });

  it('extractImages returns all meaningful image URLs', () => {
    const html = '<img src="https://a.com/1.jpg" /><img src="data:image/png;base64,x" /><img src="https://b.com/2.jpg" />';
    expect(extractImages(html)).toEqual(['https://a.com/1.jpg', 'https://b.com/2.jpg']);
  });

  it('isPaywalledRss detects member-only/teaser markers', () => {
    expect(isPaywalledRss('Continue reading on Medium', 'https://medium.com/p/abc')).toBe(true);
    expect(isPaywalledRss('Get unlimited access to every story', '')).toBe(true);
    expect(isPaywalledRss('<p>This is a long free article with lots of content that should not be considered a paywall because it has many words and no teaser marker.</p>', '')).toBe(false);
    expect(isPaywalledRss('', 'https://medium.com/p/abc')).toBe(true);
  });
});

describe('normalizeMediumRssItem', () => {
  it('maps an RSS item to a PostItem with extracted id and metadata', () => {
    const item = {
      title: 'RSS Post',
      link: { '#text': 'https://medium.com/@user/rss-post-abc123def456?source=rss-1' },
      guid: { '#text': 'https://medium.com/p/abc123def456' },
      'content:encoded': { __cdata: '<p>Content body</p><img src="https://cdn.example/hero.jpg" />' },
      'dc:creator': { '#text': 'Jane Doe' },
      pubDate: { '#text': 'Mon, 01 Jan 2024 00:00:00 GMT' },
      category: [{ '#text': 'programming' }, { '#text': 'ai' }],
    };

    const post = normalizeMediumRssItem(item);

    expect(post.id).toBe('medium:abc123def456');
    expect(post.externalId).toBe('abc123def456');
    expect(post.platform).toBe('medium');
    expect(post.category).toBe('social');
    expect(post.title).toBe('RSS Post');
    expect(post.authorName).toBe('Jane Doe');
    expect(post.postUrl).toBe('https://medium.com/@user/rss-post-abc123def456');
    expect(post.content).toContain('Content body');
    expect(post.mediaUrls).toEqual(['https://cdn.example/hero.jpg']);
    expect(post.likesCount).toBe(0);
    expect(post.repliesCount).toBe(0);
    expect(post.viewsCount).toBe(0);
    expect(post.publishedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(post.crawledAt).toBeInstanceOf(Date);
    expect(post.metadata.guid).toBe('https://medium.com/p/abc123def456');
    expect(post.metadata.tags).toEqual(['programming', 'ai']);
    expect(post.metadata.isLocked).toBe(false);
  });

  it('marks paywalled RSS items with isLocked and preserves teaser', () => {
    const item = {
      title: 'Member Post',
      link: 'https://medium.com/p/abc123def456',
      guid: 'https://medium.com/p/abc123def456',
      'content:encoded': '<p>Continue reading on Medium</p>',
      'dc:creator': 'Author',
      pubDate: 'Invalid Date',
    };

    const post = normalizeMediumRssItem(item);
    expect(post.id).toBe('medium:abc123def456');
    expect(post.metadata.isLocked).toBe(true);
    expect(post.publishedAt).toBeNull();
  });

  it('falls back to full guid when 12-char id is not present', () => {
    const item = {
      title: 'No Id Post',
      link: 'https://example.com/post',
      guid: 'https://example.com/post',
      'content:encoded': 'Body',
    };

    const post = normalizeMediumRssItem(item);
    expect(post.id).toBe('medium:https://example.com/post');
    expect(post.externalId).toBe('https://example.com/post');
  });
});

describe('normalizeMediumJsonPost', () => {
  it('maps a format=json post to a PostItem with counts and dates', () => {
    const raw = {
      id: 'abc123def456',
      title: 'JSON Post',
      mediumUrl: 'https://medium.com/@user/json-post-abc123def456',
      firstPublishedAt: 1704067200000,
      latestPublishedAt: 1704153600000,
      creatorId: 'user:u1',
      isSubscriptionLocked: false,
      visibility: 1,
      content: {
        subtitle: 'Subtitle',
        bodyModel: {
          paragraphs: [{ text: 'Paragraph one' }, { text: 'Paragraph two' }],
        },
      },
      virtuals: {
        totalClapCount: 42,
        responsesCreatedCount: 7,
        reads: 1234,
        tags: [{ name: 'programming' }, { slug: 'ai' }],
      },
    };

    const references = {
      'user:u1': { name: 'John Doe' },
    };

    const post = normalizeMediumJsonPost(raw, references);

    expect(post.id).toBe('medium:abc123def456');
    expect(post.externalId).toBe('abc123def456');
    expect(post.platform).toBe('medium');
    expect(post.category).toBe('social');
    expect(post.title).toBe('JSON Post');
    expect(post.authorName).toBe('John Doe');
    expect(post.authorId).toBe('user:u1');
    expect(post.postUrl).toBe('https://medium.com/@user/json-post-abc123def456');
    expect(post.content).toContain('Subtitle');
    expect(post.content).toContain('Paragraph one');
    expect(post.likesCount).toBe(42);
    expect(post.repliesCount).toBe(7);
    expect(post.viewsCount).toBe(1234);
    expect(post.publishedAt).toEqual(new Date(1704067200000));
    expect(post.metadata.isSubscriptionLocked).toBe(false);
    expect(post.metadata.visibility).toBe(1);
    expect(post.metadata.tags).toEqual(['programming', 'ai']);
  });

  it('marks locked JSON posts and zeroes missing counts', () => {
    const raw = {
      id: 'def789abc012',
      title: 'Locked Post',
      mediumUrl: 'https://medium.com/p/def789abc012',
      firstPublishedAt: 1704067200000,
      isSubscriptionLocked: true,
      visibility: 2,
    };

    const post = normalizeMediumJsonPost(raw);
    expect(post.metadata.isSubscriptionLocked).toBe(true);
    expect(post.likesCount).toBe(0);
    expect(post.repliesCount).toBe(0);
    expect(post.viewsCount).toBe(0);
  });
});

describe('normalizeMediumGraphqlPost', () => {
  it('maps a GraphQL post result to a PostItem', () => {
    const raw = {
      id: 'abc123def456',
      title: 'GraphQL Post',
      mediumUrl: 'https://medium.com/p/abc123def456',
      firstPublishedAt: 1704067200000,
      latestPublishedAt: 1704067200000,
      clapCount: 99,
      isLocked: true,
      visibility: 'LOCKED',
      creator: { id: 'user:u1', name: 'Graph Author' },
      previewContent: 'This is a preview.',
    };

    const post = normalizeMediumGraphqlPost(raw);

    expect(post.id).toBe('medium:abc123def456');
    expect(post.externalId).toBe('abc123def456');
    expect(post.title).toBe('GraphQL Post');
    expect(post.authorName).toBe('Graph Author');
    expect(post.authorId).toBe('user:u1');
    expect(post.likesCount).toBe(99);
    expect(post.metadata.isLocked).toBe(true);
    expect(post.metadata.visibility).toBe('LOCKED');
    expect(post.content).toBe('This is a preview.');
  });
});
