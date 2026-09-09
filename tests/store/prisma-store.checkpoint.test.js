// tests/store/prisma-store.checkpoint.test.js
// Tests for Story 25.5: PrismaStore.findExistingIds() and storeBatch() metadata.

import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaStore } from '../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

const createStore = (opts = {}) => new PrismaStore({ prisma, ...opts });

beforeEach(async () => {
  await cleanupTestDatabase();
});

describe('PrismaStore — findExistingIds()', () => {
  it('returns empty array for empty input', async () => {
    const store = createStore();
    await expect(store.findExistingIds([])).resolves.toEqual([]);
    await expect(store.findExistingIds(undefined)).resolves.toEqual([]);
  });

  it('returns only existing IDs', async () => {
    const store = createStore();
    await store.storeBatch([
      {
        platform: 'twitter',
        externalId: 'post_1',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'test',
      },
      {
        platform: 'twitter',
        externalId: 'post_2',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'test',
      },
    ]);

    const existing = await store.findExistingIds([
      'twitter:post_1',
      'twitter:post_2',
      'twitter:post_999',
    ]);
    expect(existing).toEqual(['twitter:post_1', 'twitter:post_2']);
  });
});

describe('PrismaStore — storeBatch() metadata (StoreBatchResult)', () => {
  it('returns { insertedCount, duplicateCount, totalCount, schemaValid } for new batch', async () => {
    const store = createStore();
    const posts = [
      {
        platform: 'twitter',
        externalId: 'new_1',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'test',
      },
      {
        platform: 'twitter',
        externalId: 'new_2',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'test',
      },
    ];

    const result = await store.storeBatch(posts);
    expect(result).toEqual({
      insertedCount: 2,
      duplicateCount: 0,
      totalCount: 2,
      schemaValid: true,
    });
  });

  it('returns duplicateCount > 0 when batch contains existing records', async () => {
    const store = createStore();
    const post = {
      platform: 'twitter',
      externalId: 'dup_1',
      category: 'social',
      authorId: 'a',
      authorName: 'A',
      content: 'test',
    };

    await store.storeBatch([post]);
    const result = await store.storeBatch([post]);

    expect(result.insertedCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(result.schemaValid).toBe(true);
  });

  it('returns empty metadata for empty batch', async () => {
    const store = createStore();
    const result = await store.storeBatch([]);
    expect(result).toEqual({
      insertedCount: 0,
      duplicateCount: 0,
      totalCount: 0,
      schemaValid: true,
    });
  });
});
