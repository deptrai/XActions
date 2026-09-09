// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { TikTokCrawler } from '../../../../src/scrapers/social/tiktok/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new TikTokCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('TikTokCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers search resolver with query targetKey', () => {
    const resolver = getResolver(crawler, 'search');
    const resolution = resolver({ query: 'viral' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: 'viral',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers hashtag_feed resolver stripping # and lowercasing', () => {
    const resolver = getResolver(crawler, 'hashtag_feed');
    const resolution = resolver({ tag: '#ForYou' });
    expect(resolution).toEqual({
      targetType: 'hashtag_feed',
      targetKey: 'foryou',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers get_post_comments resolver with cursorField after', () => {
    const resolver = getResolver(crawler, 'get_post_comments');
    const resolution = resolver({ videoId: '7325759242735676680' });
    expect(resolution).toEqual({
      targetType: 'post_comments',
      targetKey: '7325759242735676680',
      cursorField: 'after',
      fallbackCursorFields: ['cursor'],
    });
  });

  it('returns null for search when query missing', () => {
    const resolver = getResolver(crawler, 'search');
    expect(resolver({})).toBeNull();
  });
});
