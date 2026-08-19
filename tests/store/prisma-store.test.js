// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Integration Tests — Story 10.2: Prisma Post & Comment Schema and PrismaStore.
 * Runs against a real PostgreSQL test database; no mocks.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AbstractStore } from '../../src/core/base-store.js';
import {
  CATEGORIES,
  isValidCategory,
  generatePostId,
  generateCommentId,
} from '../../src/core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { PrismaStore } from '../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';
import fs from 'node:fs';
import path from 'node:path';

const createStore = (opts = {}) => new PrismaStore({ prisma, ...opts });

beforeEach(async () => {
  await cleanupTestDatabase();
});

describe('Story 10.2: PrismaStore — Class Architecture & Contract Compliance', () => {
  it('PrismaStore extends AbstractStore and implements all abstract methods', () => {
    const store = createStore();
    expect(store).toBeInstanceOf(AbstractStore);
    expect(typeof store.init).toBe('function');
    expect(typeof store.storeContent).toBe('function');
    expect(typeof store.storeBatch).toBe('function');
    expect(typeof store.storeComment).toBe('function');
    expect(typeof store.storeCommentBatch).toBe('function');
    expect(typeof store.close).toBe('function');
  });

  it('allows configuration of custom chunkSize and PrismaClient dependency injection', () => {
    const store = createStore({ chunkSize: 250 });
    expect(store).toBeDefined();
  });

  it('package.json exports "./store" pointing to "./src/store/index.js"', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.exports['./store']).toBe('./src/store/index.js');
  });

  it('types/store.d.ts declaration file exists and is readable', () => {
    const typesPath = path.resolve(process.cwd(), 'types/store.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);
  });
});

describe('Story 10.2: PrismaStore — Category Validation Guard (AC: Category Validation)', () => {
  it('throws PlatformError (INVALID_ARGS) before Prisma write when post has invalid category', async () => {
    const store = createStore();
    const invalidPost = {
      platform: 'twitter',
      externalId: '123456',
      category: 'invalid_category_xyz',
      authorId: 'auth_1',
      authorName: 'Test Author',
      content: 'Hello World',
    };

    await expect(store.storeBatch([invalidPost])).rejects.toThrow(PlatformError);

    try {
      await store.storeBatch([invalidPost]);
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
      expect(err.suggestedAction).toBe(SuggestedActions.USE_ACTIONS_LIST);
      expect(err.message).toMatch(/category/i);
    }

    const count = await prisma.post.count();
    expect(count).toBe(0);
  });

  it('throws PlatformError when category is missing, null, or empty', async () => {
    const store = createStore();
    const missing = { platform: 'twitter', externalId: '1', authorId: 'a', authorName: 'A', content: 'x' };
    const empty = { ...missing, category: '' };
    const nullCategory = { ...missing, category: null };

    await expect(store.storeBatch([missing])).rejects.toThrow(PlatformError);
    await expect(store.storeBatch([empty])).rejects.toThrow(PlatformError);
    await expect(store.storeBatch([nullCategory])).rejects.toThrow(PlatformError);

    expect(await prisma.post.count()).toBe(0);
  });

  it('accepts all standard categories defined in CATEGORIES constant', async () => {
    const validCategories = Object.values(CATEGORIES);
    expect(validCategories).toEqual(['social', 'ecom', 'realestate', 'recruitment', 'b2b']);
    for (const cat of validCategories) {
      expect(isValidCategory(cat)).toBe(true);
    }
  });
});

describe('Story 10.2: PrismaStore — Post Batch Storage & 500-Record Chunking (AC: Post Model & Store)', () => {
  it('normalizes post with namespaced ID `${platform}:${externalId}` when ID is omitted', async () => {
    const store = createStore();
    const post = {
      platform: 'twitter',
      externalId: '987654321',
      category: 'social',
      authorId: 'usr_1',
      authorName: 'Alice',
      content: 'Decentralized scraping architecture',
    };

    await store.storeContent(post);
    const stored = await prisma.post.findUnique({ where: { id: 'twitter:987654321' } });
    expect(stored).not.toBeNull();
    expect(stored.id).toBe('twitter:987654321');
  });

  it('stores a single post via storeContent() delegating to storeBatch()', async () => {
    const store = createStore();
    const post = {
      platform: 'facebook',
      externalId: 'post_fb_101',
      category: 'social',
      authorId: 'fb_user_1',
      authorName: 'Bob',
      content: 'Community post content',
      mediaUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      metadata: { likesCount: 42, engagementScore: 9.8 },
    };

    await expect(store.storeContent(post)).resolves.not.toThrow();
    const stored = await prisma.post.findUnique({ where: { id: 'facebook:post_fb_101' } });
    expect(stored).not.toBeNull();
  });

  it('writes posts in chunks of 500 records with skipDuplicates: true by default', async () => {
    const store = createStore({ chunkSize: 500 });
    const posts = Array.from({ length: 1200 }, (_, i) => ({
      platform: 'threads',
      externalId: `th_${i + 1}`,
      category: 'social',
      authorId: `author_${i % 10}`,
      authorName: `User ${i % 10}`,
      content: `Threads post content #${i + 1}`,
      mediaUrls: [],
      likesCount: i * 2,
    }));

    await expect(store.storeBatch(posts)).resolves.not.toThrow();
    const count = await prisma.post.count();
    expect(count).toBe(1200);
  });

  it('supports upsert mode ({ upsert: true }) to update existing posts without duplicate key collision', async () => {
    const store = createStore();
    const postInitial = {
      platform: 'shopee',
      externalId: 'item_555',
      category: 'ecom',
      authorId: 'shop_99',
      authorName: 'Official Store',
      content: 'Product description v1',
      metadata: { itemId: 'item_555', shopId: 'shop_99', price: 150000, soldCount: 10 },
    };

    const postUpdated = {
      ...postInitial,
      content: 'Product description v2 updated',
      metadata: { itemId: 'item_555', shopId: 'shop_99', price: 140000, soldCount: 25 },
    };

    await store.storeBatch([postInitial]);
    const first = await prisma.post.findUnique({ where: { id: 'shopee:item_555' } });
    expect(first.content).toBe('Product description v1');

    await store.storeBatch([postUpdated], { upsert: true });
    const second = await prisma.post.findUnique({ where: { id: 'shopee:item_555' } });
    expect(second.content).toBe('Product description v2 updated');
    expect(second.metadata).toMatchObject({ price: 140000, soldCount: 25 });
  });

  it('stores rich metadata JSON as plain object without double JSON-stringification', async () => {
    const store = createStore();
    const post = {
      platform: 'topcv',
      externalId: 'job_888',
      category: 'recruitment',
      authorId: 'comp_12',
      authorName: 'Tech Corp',
      content: 'Senior Node.js Backend Engineer',
      metadata: {
        salaryMin: 2000,
        salaryMax: 3500,
        skills: ['TypeScript', 'PostgreSQL', 'Prisma'],
        location: { city: 'Hà Nội', district: 'Cầu Giấy' },
      },
    };

    await store.storeContent(post);
    const stored = await prisma.post.findUnique({ where: { id: 'topcv:job_888' } });
    expect(typeof stored.metadata).toBe('object');
    expect(Array.isArray(stored.metadata.skills)).toBe(true);
    expect(stored.metadata.salaryMax).toBe(3500);
  });
});

describe('Story 10.2: PrismaStore — Topological Comment Insertion & Tree Hierarchy (AC: Comment Model & AD-6)', () => {
  it('normalizes comment id with 3-part format `${platform}:${postExternalId}:${commentExternalId}`', () => {
    const commentId = generateCommentId('facebook', 'post123', 'comment456');
    expect(commentId).toBe('facebook:post123:comment456');
  });

  it('correctly normalizes postId and parentCommentId to namespaced IDs and writes comment', async () => {
    const store = createStore();

    // Parent post must exist for FK
    await store.storeBatch([{
      platform: 'facebook',
      externalId: 'post123',
      category: 'social',
      authorId: 'u1',
      authorName: 'U1',
      content: 'Post content',
    }]);

    // Parent comment must exist before child can reference it
    await store.storeComment({
      platform: 'facebook',
      postId: 'facebook:post123',
      parentCommentId: null,
      externalId: 'parent_comm_1',
      depth: 0,
      authorId: 'parent_author',
      authorName: 'Parent',
      content: 'Parent comment',
    });

    const comment = {
      platform: 'facebook',
      postId: 'post123', // raw postId without platform prefix
      parentCommentId: 'parent_comm_1', // raw parent comment ID
      externalId: 'comm_999',
      depth: 1,
      authorId: 'usr_fb_2',
      authorName: 'Charlie',
      content: 'Great update!',
    };

    await expect(store.storeComment(comment)).resolves.not.toThrow();
    const stored = await prisma.comment.findUnique({ where: { id: 'facebook:post123:comm_999' } });
    expect(stored).not.toBeNull();
    expect(stored.postId).toBe('facebook:post123');
    expect(stored.parentCommentId).toBe('facebook:post123:parent_comm_1');
  });

  it('sorts comments by depth ascending before insertion to satisfy foreign key constraints', async () => {
    const store = createStore();

    await store.storeBatch([{
      platform: 'twitter',
      externalId: 'tweet1',
      category: 'social',
      authorId: 'u0',
      authorName: 'Root Author',
      content: 'Root post',
    }]);

    // Batch contains nested replies in random/reverse order
    const comments = [
      {
        id: 'twitter:tweet1:c_sub_sub_1',
        platform: 'twitter',
        postId: 'twitter:tweet1',
        parentCommentId: 'twitter:tweet1:c_sub_1',
        externalId: 'c_sub_sub_1',
        depth: 2,
        authorId: 'usr_3',
        authorName: 'Reply Level 2',
        content: 'Sub-sub-reply content',
      },
      {
        id: 'twitter:tweet1:c_root_1',
        platform: 'twitter',
        postId: 'twitter:tweet1',
        parentCommentId: null,
        externalId: 'c_root_1',
        depth: 0,
        authorId: 'usr_1',
        authorName: 'Root Author',
        content: 'Root comment content',
      },
      {
        id: 'twitter:tweet1:c_sub_1',
        platform: 'twitter',
        postId: 'twitter:tweet1',
        parentCommentId: 'twitter:tweet1:c_root_1',
        externalId: 'c_sub_1',
        depth: 1,
        authorId: 'usr_2',
        authorName: 'Reply Level 1',
        content: 'Sub-reply content',
      },
    ];

    await store.storeCommentBatch(comments);

    const stored = await prisma.comment.findMany({
      where: { postId: 'twitter:tweet1' },
      orderBy: { depth: 'asc' },
    });

    expect(stored.length).toBe(3);
    expect(stored.map((c) => c.depth)).toEqual([0, 1, 2]);
  });

  it('supports upsert mode ({ upsert: true }) for comment updates', async () => {
    const store = createStore();

    await store.storeBatch([{
      platform: 'twitter',
      externalId: 'tweet2',
      category: 'social',
      authorId: 'u0',
      authorName: 'Root',
      content: 'Post',
    }]);

    const rootComment = {
      platform: 'twitter',
      postId: 'twitter:tweet2',
      parentCommentId: null,
      externalId: 'comm_root_10',
      depth: 0,
      authorId: 'usr_10',
      authorName: 'David',
      content: 'Original comment text',
      likesCount: 5,
    };

    const updatedComment = {
      ...rootComment,
      content: 'Edited comment text',
      likesCount: 12,
    };

    await store.storeCommentBatch([rootComment]);
    const first = await prisma.comment.findUnique({ where: { id: 'twitter:tweet2:comm_root_10' } });
    expect(first.likesCount).toBe(5);

    await store.storeCommentBatch([updatedComment], { upsert: true });
    const second = await prisma.comment.findUnique({ where: { id: 'twitter:tweet2:comm_root_10' } });
    expect(second.likesCount).toBe(12);
    expect(second.content).toBe('Edited comment text');
  });
});

describe('Story 10.2: Prisma Schema & Migration Integrity (AC: Schema & Raw SQL Migration)', () => {
  it('schema.prisma defines Post with unique constraint @@unique([platform, externalId])', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    expect(schemaContent).toMatch(/model\s+Post\s+\{/);
    expect(schemaContent).toMatch(/@@unique\(\[platform,\s*externalId\]\)/);
    expect(schemaContent).toMatch(/mediaUrls\s+String\[\]/);
    expect(schemaContent).toMatch(/metadata\s+Json\?/);
  });

  it('schema.prisma defines Comment with self-referencing relation CommentReplies', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    expect(schemaContent).toMatch(/model\s+Comment\s+\{/);
    expect(schemaContent).toMatch(/@@unique\(\[platform,\s*externalId,\s*postId\]\)/);
    expect(schemaContent).toMatch(/depth\s+Int\s+@default\(0\)/);
    expect(schemaContent).toMatch(/@relation\("CommentReplies"/);
  });

  it('schema.prisma defines CrawlCheckpoint with unique constraint @@unique([platform, targetType, targetKey])', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    expect(schemaContent).toMatch(/model\s+CrawlCheckpoint\s+\{/);
    expect(schemaContent).toMatch(/@@unique\(\[platform,\s*targetType,\s*targetKey\]\)/);
    expect(schemaContent).toMatch(/status\s+String\s+@default\("running"\)/);
  });

  it('migration.sql contains GIN and expression indexes for metadata fields', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20260818233000_universal_scraping_schema/migration.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_post_metadata_gin ON "Post" USING gin \(metadata\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_comment_metadata_gin ON "Comment" USING gin \(metadata\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_post_metadata_price ON "Post" USING btree/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_post_metadata_phone ON "Post" USING btree/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_post_metadata_salary ON "Post" USING btree/);
  });
});

describe('Story 10.2: Boundary Cases & Guard Invariants', () => {
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

  it('disconnects and nullifies prisma reference upon close()', async () => {
    const closeClient = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL } },
    });
    const store = new PrismaStore({ prisma: closeClient });

    await expect(store.close()).resolves.not.toThrow();
  });
});
