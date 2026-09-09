// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new FacebookCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

const hasResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  return Boolean(desc?.checkpointResolver);
};

describe('FacebookCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers group_posts resolver with targetType group and groupId key', () => {
    const resolver = getResolver(crawler, 'group_posts');
    const resolution = resolver({ groupId: '123' });
    expect(resolution).toEqual({
      targetType: 'group',
      targetKey: '123',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('returns null for group_posts when groupId is missing', () => {
    const resolver = getResolver(crawler, 'group_posts');
    expect(resolver({})).toBeNull();
  });

  it('registers page_posts resolver with targetType page and pageId key', () => {
    const resolver = getResolver(crawler, 'page_posts');
    const resolution = resolver({ pageId: '456' });
    expect(resolution).toEqual({
      targetType: 'page',
      targetKey: '456',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers search resolver with query:type key', () => {
    const resolver = getResolver(crawler, 'search');
    const resolution = resolver({ query: 'AI', type: 'posts' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: 'ai:posts',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers group_search resolver with groupId:query key', () => {
    const resolver = getResolver(crawler, 'group_search');
    const resolution = resolver({ groupUrl: 'https://www.facebook.com/groups/123456', query: 'ai' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: '123456:ai',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers marketplace resolver matching saveCheckpoint format', () => {
    const resolver = getResolver(crawler, 'marketplace');
    const resolution = resolver({ query: 'laptop', location: 'HCMC', minPrice: 100 });
    expect(resolution).toEqual({
      targetType: 'marketplace',
      targetKey: 'laptop:HCMC:100',
      cursorField: 'after',
      fallbackCursorFields: ['cursor'],
    });
  });

  it('registers get_comments resolver with cursorField after', () => {
    const resolver = getResolver(crawler, 'get_comments');
    const resolution = resolver({ postId: 'post_123' });
    expect(resolution).toEqual({
      targetType: 'post_comments',
      targetKey: 'post_123',
      cursorField: 'after',
      fallbackCursorFields: ['cursor'],
    });
  });

  it('registers post_comments resolver using extracted postExternalId', () => {
    const resolver = getResolver(crawler, 'post_comments');
    const resolution = resolver({ url: 'https://www.facebook.com/123/posts/456' });
    expect(resolution).not.toBeNull();
    expect(resolution.targetType).toBe('post_comments');
    expect(resolution.cursorField).toBe('after');
    expect(resolution.fallbackCursorFields).toContain('cursor');
  });

  it('registers group_comments resolver using extracted postExternalId', () => {
    const resolver = getResolver(crawler, 'group_comments');
    const resolution = resolver({ url: 'https://www.facebook.com/groups/789/posts/101' });
    expect(resolution).not.toBeNull();
    expect(resolution.targetType).toBe('group_comments');
    expect(resolution.cursorField).toBe('after');
  });

  it('registers group_members resolver resolving groupId', () => {
    const resolver = getResolver(crawler, 'group_members');
    const resolution = resolver({ groupUrl: 'https://www.facebook.com/groups/123456' });
    expect(resolution).toEqual({
      targetType: 'group_members',
      targetKey: '123456',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers followers resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'followers');
    const resolution = resolver({ username: 'zuck' });
    expect(resolution).toEqual({
      targetType: 'followers',
      targetKey: 'zuck',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers following resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'following');
    const resolution = resolver({ username: 'zuck' });
    expect(resolution).toEqual({
      targetType: 'following',
      targetKey: 'zuck',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('does not register resolver for non-paginated action profile', () => {
    expect(hasResolver(crawler, 'profile')).toBe(false);
  });
});
