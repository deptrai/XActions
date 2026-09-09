// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { ThreadsCrawler } from '../../../../src/scrapers/social/threads/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new ThreadsCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('ThreadsCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers get_user_feed resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'get_user_feed');
    const resolution = resolver({ username: 'zuck' });
    expect(resolution).toEqual({
      targetType: 'user_feed',
      targetKey: 'zuck',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers search resolver with query targetKey', () => {
    const resolver = getResolver(crawler, 'search');
    const resolution = resolver({ query: 'artificial intelligence' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: 'artificial intelligence',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers get_post_comments resolver with cursorField after', () => {
    const resolver = getResolver(crawler, 'get_post_comments');
    const resolution = resolver({ postId: 'CuZ7X9_sF9y' });
    expect(resolution).toEqual({
      targetType: 'post_comments',
      targetKey: 'CuZ7X9_sF9y',
      cursorField: 'after',
      fallbackCursorFields: ['cursor'],
    });
  });

  it('returns null for get_user_feed when username missing', () => {
    const resolver = getResolver(crawler, 'get_user_feed');
    expect(resolver({})).toBeNull();
  });
});
