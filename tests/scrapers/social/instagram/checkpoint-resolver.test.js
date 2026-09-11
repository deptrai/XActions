// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt — InstagramCrawler checkpointResolver unit tests.
import { describe, it, expect } from 'vitest';
import { InstagramCrawler } from '../../../../src/scrapers/social/instagram/crawler.js';
import { InstagramClient } from '../../../../src/scrapers/social/instagram/client.js';

const createCrawler = () => new InstagramCrawler({
  client: new InstagramClient({ transport: 'http', requiresAuth: false, requiresProxy: false }),
  requiresAuth: false,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('InstagramCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('user resolver → targetType user, lowercased targetKey, cursor fallbacks', () => {
    const resolver = getResolver(crawler, 'user');
    expect(resolver({ username: 'NatGeo' })).toEqual({
      targetType: 'user',
      targetKey: 'natgeo',
      cursorField: 'cursor',
      fallbackCursorFields: ['max_id', 'end_cursor'],
    });
  });

  it('user resolver accepts user / handle aliases', () => {
    const resolver = getResolver(crawler, 'user');
    expect(resolver({ user: 'Alice' }).targetKey).toBe('alice');
    expect(resolver({ handle: 'Bob' }).targetKey).toBe('bob');
  });

  it('user resolver returns null for missing / non-string username', () => {
    const resolver = getResolver(crawler, 'user');
    expect(resolver({})).toBeNull();
    expect(resolver({ username: 42 })).toBeNull();
    expect(resolver({ username: '' })).toBeNull();
  });

  it('hashtag resolver → targetType tag, strips leading #, lowercases', () => {
    const resolver = getResolver(crawler, 'hashtag');
    expect(resolver({ tag: '#Travel' })).toEqual({
      targetType: 'tag',
      targetKey: 'travel',
      cursorField: 'cursor',
      fallbackCursorFields: ['max_id', 'end_cursor'],
    });
  });

  it('hashtag resolver accepts hashtag / topic aliases', () => {
    const resolver = getResolver(crawler, 'hashtag');
    expect(resolver({ hashtag: 'Food' }).targetKey).toBe('food');
    expect(resolver({ topic: '#Art' }).targetKey).toBe('art');
  });

  it('hashtag resolver returns null for missing / non-string tag', () => {
    const resolver = getResolver(crawler, 'hashtag');
    expect(resolver({})).toBeNull();
    expect(resolver({ tag: 7 })).toBeNull();
  });
});
