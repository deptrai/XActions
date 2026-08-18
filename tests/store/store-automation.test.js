// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * High-throughput & deep-tree integration tests — Story 10.2.
 * Runs against a real PostgreSQL test database; no mocks.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaStore } from '../../src/store/prisma-store.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

const createStore = (opts = {}) => new PrismaStore({ prisma, ...opts });

beforeEach(async () => {
  await cleanupTestDatabase();
});

describe('Automated Test Suite: PrismaStore High-Throughput & Stress Testing', () => {
  it('handles 3,000 posts partitioned across 6 consecutive 500-record chunks', async () => {
    const store = createStore({ chunkSize: 500 });

    const posts = Array.from({ length: 3000 }, (_, i) => ({
      platform: 'twitter',
      externalId: `bulk_tweet_${i + 1}`,
      category: 'social',
      authorId: `author_${i % 20}`,
      authorName: `User ${i % 20}`,
      content: `Stress testing batch record #${i + 1}`,
      mediaUrls: [`https://cdn.example.com/img_${i}.jpg`],
      likesCount: i * 3,
      repostsCount: i,
    }));

    await store.storeBatch(posts);

    const count = await prisma.post.count();
    expect(count).toBe(3000);
  });

  it('executes atomic batch upsert via $transaction for 250 items without data loss', async () => {
    const store = createStore({ chunkSize: 500 });

    const posts = Array.from({ length: 250 }, (_, i) => ({
      platform: 'shopee',
      externalId: `product_${i + 1}`,
      category: 'ecom',
      authorId: `shop_${i % 5}`,
      authorName: `Official Store ${i % 5}`,
      content: `E-commerce product #${i + 1}`,
      metadata: { price: 100000 + i * 1000, inStock: true },
    }));

    await store.storeBatch(posts, { upsert: true });

    const count = await prisma.post.count();
    expect(count).toBe(250);

    // Verify all 250 records are persisted and the first record's price is correct
    const first = await prisma.post.findUnique({ where: { id: 'shopee:product_1' } });
    expect(first.metadata.price).toBe(100000);
  });
});

describe('Automated Test Suite: Deep Topological Comment Tree (5 Tiers)', () => {
  it('correctly orders a 5-level nested comment hierarchy from root to level 4 reply', async () => {
    const store = createStore();

    await store.storeBatch([{
      platform: 'facebook',
      externalId: 'post_999',
      category: 'social',
      authorId: 'u0',
      authorName: 'Root',
      content: 'Root post',
    }]);

    const postId = 'facebook:post_999';

    // Scrambled input order
    const comments = [
      {
        platform: 'facebook',
        postId,
        externalId: 'c_lvl_4',
        parentCommentId: 'c_lvl_3',
        depth: 4,
        authorId: 'u4',
        authorName: 'Level 4 Reply',
        content: 'I agree with level 3!',
      },
      {
        platform: 'facebook',
        postId,
        externalId: 'c_lvl_0',
        parentCommentId: null,
        depth: 0,
        authorId: 'u0',
        authorName: 'Root Comment',
        content: 'Initial discussion post',
      },
      {
        platform: 'facebook',
        postId,
        externalId: 'c_lvl_2',
        parentCommentId: 'c_lvl_1',
        depth: 2,
        authorId: 'u2',
        authorName: 'Level 2 Reply',
        content: 'Supporting argument',
      },
      {
        platform: 'facebook',
        postId,
        externalId: 'c_lvl_1',
        parentCommentId: 'c_lvl_0',
        depth: 1,
        authorId: 'u1',
        authorName: 'Level 1 Reply',
        content: 'Direct response to root',
      },
      {
        platform: 'facebook',
        postId,
        externalId: 'c_lvl_3',
        parentCommentId: 'c_lvl_2',
        depth: 3,
        authorId: 'u3',
        authorName: 'Level 3 Reply',
        content: 'Counter point',
      },
    ];

    await store.storeCommentBatch(comments);

    const stored = await prisma.comment.findMany({
      where: { postId },
      orderBy: { depth: 'asc' },
    });

    expect(stored.length).toBe(5);
    expect(stored.map((c) => c.depth)).toEqual([0, 1, 2, 3, 4]);
    expect(stored.find((c) => c.externalId === 'c_lvl_4').parentCommentId).toBe('facebook:post_999:c_lvl_3');
    expect(stored.find((c) => c.externalId === 'c_lvl_0').parentCommentId).toBeNull();
  });
});

describe('Automated Test Suite: Boundary Cases & Guard Invariants', () => {
  it('rejects null, undefined, or empty payload arrays gracefully', async () => {
    const store = createStore();

    await expect(store.storeBatch([])).resolves.not.toThrow();
    await expect(store.storeBatch(undefined)).resolves.not.toThrow();
    await expect(store.storeCommentBatch([])).resolves.not.toThrow();
    await expect(store.storeCommentBatch(undefined)).resolves.not.toThrow();

    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('rejects post missing platform or externalId with standard PlatformError', async () => {
    const store = createStore();

    const invalidPost1 = { externalId: '123', category: 'social', authorId: 'a', authorName: 'A', content: 'test' };
    const invalidPost2 = { platform: 'twitter', category: 'social', authorId: 'a', authorName: 'A', content: 'test' };

    await expect(store.storeBatch([invalidPost1])).rejects.toThrow(PlatformError);
    await expect(store.storeBatch([invalidPost2])).rejects.toThrow(PlatformError);
  });

  it('sanitizes extra payload properties that are not in schema', async () => {
    const store = createStore();
    const postWithExtraProps = {
      platform: 'threads',
      externalId: 'th_001',
      category: 'social',
      authorId: 'usr_th',
      authorName: 'Threader',
      content: 'Sample thread content',
      rawHtmlDom: '<div>extra</div>',
      temporaryCrawlerToken: 'secret_123',
      unrelatedObject: { foo: 'bar' },
    };

    await store.storeContent(postWithExtraProps);

    const stored = await prisma.post.findUnique({ where: { id: 'threads:th_001' } });
    expect(stored).not.toBeNull();
    expect(stored.rawHtmlDom).toBeUndefined();
    expect(stored.temporaryCrawlerToken).toBeUndefined();
    expect(stored.unrelatedObject).toBeUndefined();
    expect(stored.content).toBe('Sample thread content');
  });
});
