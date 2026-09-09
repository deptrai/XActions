// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { ShopeeCrawler } from '../../../../src/scrapers/ecom/shopee/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';

const createCrawler = () => new ShopeeCrawler({
  client: {},
  store: null,
});

const getResolver = (crawler, action) => {
  const desc = crawler.listActions().find((a) => a.action === action);
  expect(desc).toBeDefined();
  expect(typeof desc.checkpointResolver).toBe('function');
  return desc.checkpointResolver;
};

describe('ShopeeCrawler — checkpointResolver', () => {
  const crawler = createCrawler();

  it('registers search_products resolver with keyword targetKey and page cursorField', () => {
    const resolver = getResolver(crawler, 'search_products');
    const resolution = resolver({ keyword: 'phone' });
    expect(resolution).toEqual({
      targetType: 'search',
      targetKey: 'phone',
      cursorField: 'page',
      fallbackCursorFields: ['offset'],
    });
  });

  it('returns null for search_products when keyword missing', () => {
    const resolver = getResolver(crawler, 'search_products');
    expect(resolver({})).toBeNull();
  });
});
