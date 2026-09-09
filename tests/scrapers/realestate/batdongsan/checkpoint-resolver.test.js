// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { BatdongsanCrawler } from '../../../../src/scrapers/realestate/batdongsan/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new BatdongsanCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('BatdongsanCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers search_listings resolver with city:cate:ptype targetKey and page cursorField', () => {
    const resolver = getResolver(crawler, 'search_listings');
    const resolution = resolver({ city: 'hanoi', category: 'can-ho' });
    expect(resolution).toEqual({
      targetType: 'listings',
      targetKey: 'HN:41:38',
      cursorField: 'page',
      fallbackCursorFields: ['offset'],
    });
  });

  it('resolves city alias and listingType rent', () => {
    const resolver = getResolver(crawler, 'search_listings');
    const resolution = resolver({ city: 'ha-noi', category: 'nha-o', listingType: 'rent' });
    expect(resolution).not.toBeNull();
    expect(resolution.targetType).toBe('listings');
    expect(resolution.cursorField).toBe('page');
    expect(resolution.fallbackCursorFields).toContain('offset');
  });
});
