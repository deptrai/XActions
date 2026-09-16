// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for RedisStreamPublisher.formatPayload snake_case mapping (Story 20.2).
 */

import { describe, it, expect } from 'vitest';
import { RedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';

describe('RedisStreamPublisher.formatPayload — snake_case schema', () => {
  const publisher = new RedisStreamPublisher({ enabled: false });

  it('maps snake_case fields correctly', () => {
    const item = {
      id: 'chotot:123',
      platform: 'chotot',
      external_post_id: '123',
      category: 'realestate',
      author_id: 'seller1',
      author_name: 'Seller One',
      post_url: 'https://chotot.com/listing/123',
      crawled_at: '2024-01-01T00:00:00.000Z',
      storage_ref: 'ref-123',
      scraper_id: 'chotot-hybrid',
      content_snippet: 'Căn hộ 2PN Q7',
      target_id: 'target-1',
      workspace_id: 'ws-456',
      schema_version: 1,
    };

    const payload = publisher.formatPayload(item);

    expect(payload.external_post_id).toBe('123');
    expect(payload.author_id).toBe('seller1');
    expect(payload.author_name).toBe('Seller One');
    expect(payload.post_url).toBe('https://chotot.com/listing/123');
    expect(payload.crawled_at).toBe('2024-01-01T00:00:00.000Z');
    expect(payload.storage_ref).toBe('ref-123');
    expect(payload.scraper_id).toBe('chotot-hybrid');
    expect(payload.content_snippet).toBe('Căn hộ 2PN Q7');
    expect(payload.target_id).toBe('target-1');
    expect(payload.workspace_id).toBe('ws-456');
    expect(payload.schema_version).toBe('1');
  });

  it('dual-emits camelCase fields for backward compatibility', () => {
    const item = {
      id: 'facebook:456',
      platform: 'facebook',
      external_post_id: '456',
      category: 'social',
      author_id: 'user1',
      crawled_at: '2024-01-01T00:00:00.000Z',
      storage_ref: 'ref-456',
      scraper_id: 'facebook-hybrid',
      content_snippet: 'Post content',
      schema_version: 1,
    };

    const payload = publisher.formatPayload(item);

    // snake_case canonical fields
    expect(payload.external_post_id).toBe('456');
    expect(payload.author_id).toBe('user1');
    expect(payload.crawled_at).toBe('2024-01-01T00:00:00.000Z');
    expect(payload.storage_ref).toBe('ref-456');
    expect(payload.scraper_id).toBe('facebook-hybrid');
    expect(payload.content_snippet).toBe('Post content');
    expect(payload.schema_version).toBe('1');

    // camelCase dual-emit fields
    expect(payload.externalId).toBe('456');
    expect(payload.authorId).toBe('user1');
    expect(payload.crawledAt).toBe('2024-01-01T00:00:00.000Z');
    expect(payload.storageRef).toBe('ref-456');
    expect(payload.scraperId).toBe('facebook-hybrid');
  });

  it('accepts legacy camelCase input (backward compatibility)', () => {
    const item = {
      id: 'facebook:789',
      platform: 'facebook',
      externalId: '789',
      category: 'social',
      authorId: 'user2',
      crawledAt: '2024-01-01T00:00:00.000Z',
      storageRef: 'ref-789',
      scraperId: 'facebook-hybrid',
    };

    const payload = publisher.formatPayload(item);

    expect(payload.external_post_id).toBe('789');
    expect(payload.externalId).toBe('789');
    expect(payload.author_id).toBe('user2');
    expect(payload.authorId).toBe('user2');
  });

  it('includes benchmark fields', () => {
    const item = {
      id: 'test:1',
      platform: 'test',
      external_post_id: '1',
      benchmark_health: 'A',
      benchmark_alert: false,
      content_snippet: 'test',
    };

    const payload = publisher.formatPayload(item);

    expect(payload.benchmark_health).toBe('A');
    expect(payload.benchmark_alert).toBe('false');
  });

  it('handles missing optional fields gracefully', () => {
    const item = {
      id: 'test:1',
      platform: 'test',
      external_post_id: '1',
      content_snippet: 'minimal',
    };

    const payload = publisher.formatPayload(item);

    expect(payload.id).toBe('test:1');
    expect(payload.platform).toBe('test');
    expect(payload.content_snippet).toBe('minimal');
    expect(payload.author_name).toBe('');
    expect(payload.post_url).toBe('');
    expect(payload.target_id).toBe('');
    expect(payload.workspace_id).toBe('');
  });
});
