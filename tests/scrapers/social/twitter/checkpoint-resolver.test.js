// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { TwitterCrawler } from '../../../../src/scrapers/social/twitter/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new TwitterCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('TwitterCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers search resolver with query targetKey', () => {
    const resolver = getResolver(crawler, 'search');
    const resolution = resolver({ query: 'AI', type: 'Latest' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: 'ai',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers hashtag resolver stripping # and lowercasing', () => {
    const resolver = getResolver(crawler, 'hashtag');
    const resolution = resolver({ tag: '#AI' });
    expect(resolution).toEqual({
      targetType: 'hashtag',
      targetKey: 'ai',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers followers resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'followers');
    const resolution = resolver({ username: 'elonmusk' });
    expect(resolution).toEqual({
      targetType: 'followers',
      targetKey: 'elonmusk',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers following resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'following');
    const resolution = resolver({ username: 'elonmusk' });
    expect(resolution).toEqual({
      targetType: 'following',
      targetKey: 'elonmusk',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers likes resolver with tweetId targetKey', () => {
    const resolver = getResolver(crawler, 'likes');
    const resolution = resolver({ tweetId: '1234567890' });
    expect(resolution).toEqual({
      targetType: 'likes',
      targetKey: '1234567890',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers bookmarks resolver with accountId fallback self', () => {
    const resolver = getResolver(crawler, 'bookmarks');
    const resolution = resolver({});
    expect(resolution).toEqual({
      targetType: 'bookmarks',
      targetKey: 'self',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers list_members resolver extracting listId from URL', () => {
    const resolver = getResolver(crawler, 'list_members');
    const resolution = resolver({ listUrl: 'https://x.com/i/lists/1234567890123456789' });
    expect(resolution).toEqual({
      targetType: 'list_members',
      targetKey: 'twitter:list:1234567890123456789',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('registers media resolver with username targetKey', () => {
    const resolver = getResolver(crawler, 'media');
    const resolution = resolver({ username: 'elonmusk' });
    expect(resolution).toEqual({
      targetType: 'media',
      targetKey: 'twitter:user:elonmusk',
      cursorField: 'cursor',
      fallbackCursorFields: ['after'],
    });
  });

  it('returns null for search when query missing', () => {
    const resolver = getResolver(crawler, 'search');
    expect(resolver({})).toBeNull();
  });
});
