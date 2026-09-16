// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for universal stream-publish hook (Story 20.2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { RedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';

// Concrete subclass for testing
class TestCrawler extends AbstractCrawler {
  name = 'test';
  category = 'social';
  
  constructor(deps = {}) {
    super(deps);
    this.registerAction('test_action', async (args, session) => {
      return {
        posts: [
          { id: 'test:1', externalId: '1', text: 'Hello world', authorId: 'user1', url: 'https://example.com/1' },
          { id: 'test:2', externalId: '2', text: 'Test post', authorId: 'user2', url: 'https://example.com/2' },
        ]
      };
    }, { action: 'test_action', description: 'Test action' });
  }
}

// Fake Redis client that captures xAdd calls
class FakeRedisClient {
  constructor() {
    this.calls = [];
  }
  async xAdd(key, id, fields, options) {
    this.calls.push({ key, id, fields, options });
    return 'test-id';
  }
  async xadd(key, ...args) {
    this.calls.push({ key, args });
    return 'test-id';
  }
}

describe('AbstractCrawler stream publish hook', () => {
  let crawler;
  let fakeClient;
  let publisher;
  
  beforeEach(() => {
    fakeClient = new FakeRedisClient();
    publisher = new RedisStreamPublisher({ redisClient: fakeClient, enabled: true });
    crawler = new TestCrawler({
      store: { publisher },
    });
  });

  it('emits stream events for PostItem after handler', async () => {
    process.env.REDIS_STREAM_ENABLED = 'true';
    
    const result = await crawler.start({ action: 'test_action', args: {} });
    
    expect(fakeClient.calls.length).toBe(2);
    const call = fakeClient.calls[0];
    expect(call.fields.platform).toBe('test');
    expect(call.fields.external_post_id).toBe('1');
    expect(call.fields.content_snippet).toBe('Hello world');
    expect(call.fields.schema_version).toBe('1');
  });

  it('skips emit when REDIS_STREAM_ENABLED=false', async () => {
    delete process.env.REDIS_STREAM_ENABLED;
    
    await crawler.start({ action: 'test_action', args: {} });
    
    expect(fakeClient.calls.length).toBe(0);
  });

  it('skips emit when dryRun=true', async () => {
    process.env.REDIS_STREAM_ENABLED = 'true';
    
    await crawler.start({ action: 'test_action', args: { dryRun: true } });
    
    expect(fakeClient.calls.length).toBe(0);
  });
});

describe('mapToThinEvent', () => {
  let crawler;
  
  beforeEach(() => {
    crawler = new TestCrawler({});
  });

  it('maps PostItem to ThinEvent', () => {
    const item = {
      id: 'test:1',
      externalId: '123',
      text: 'Post content here',
      authorId: 'user1',
      authorName: 'Test User',
      url: 'https://example.com/post/123',
      crawledAt: new Date('2024-01-01'),
      storageRef: 'ref-1',
    };
    
    const event = crawler.mapToThinEvent(item, { targetId: 't1', workspaceId: 'w1' });
    
    expect(event.platform).toBe('test');
    expect(event.external_post_id).toBe('123');
    expect(event.externalId).toBe('123'); // dual-emit
    expect(event.content_snippet).toBe('Post content here');
    expect(event.author_id).toBe('user1');
    expect(event.authorId).toBe('user1'); // dual-emit
    expect(event.author_name).toBe('Test User');
    expect(event.post_url).toBe('https://example.com/post/123');
    expect(event.target_id).toBe('t1');
    expect(event.workspace_id).toBe('w1');
    expect(event.schema_version).toBe(1);
  });

  it('maps ProductItem to ThinEvent', () => {
    const item = {
      id: 'prod:1',
      externalId: 'p1',
      title: 'iPhone 15',
      description: 'Latest model',
      shop_id: 'shop1',
      productUrl: 'https://shopee.com/product/1',
      price: '1000',
    };
    
    const event = crawler.mapToThinEvent(item, {});
    
    expect(event.content_snippet).toBe('iPhone 15 Latest model');
    expect(event.author_id).toBe('shop1');
    expect(event.post_url).toBe('https://shopee.com/product/1');
  });

  it('maps CompanyItem to ThinEvent', () => {
    const item = {
      id: 'comp:1',
      externalId: 'c1',
      name: 'Acme Corp',
      industry: 'Technology',
      address: '123 Main St',
      taxCode: 'TAX123',
      detailUrl: 'https://masothue.com/company/1',
    };
    
    const event = crawler.mapToThinEvent(item, {});
    
    expect(event.content_snippet).toBe('Acme Corp Technology 123 Main St');
    expect(event.author_id).toBe('TAX123');
    expect(event.post_url).toBe('https://masothue.com/company/1');
  });

  it('truncates content_snippet to 4000 chars', () => {
    const longText = 'x'.repeat(5000);
    const item = {
      id: 'test:1',
      externalId: '1',
      text: longText,
      authorId: 'user1',
    };
    
    const event = crawler.mapToThinEvent(item, {});
    
    expect(event.content_snippet.length).toBe(4000);
  });

  it('handles missing content_snippet', () => {
    const item = {
      id: 'test:1',
      externalId: '1',
      // no text, title, description, etc.
    };
    
    const event = crawler.mapToThinEvent(item, {});
    
    expect(event.content_snippet).toBe('');
  });
});
