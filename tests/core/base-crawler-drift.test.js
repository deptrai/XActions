// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractStore } from '../../src/core/base-store.js';
import { SchemaDriftGuard } from '../../src/core/schema-drift-guard.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { globalActionRegistry } from '../../src/core/action-registry.js';

class InMemoryStore extends AbstractStore {
  constructor() {
    super();
    /** @type {any[]} */
    this.items = [];
  }

  async storeContent(item) {
    this.items.push(item);
    return { insertedCount: 1, duplicateCount: 0, totalCount: this.items.length, schemaValid: true };
  }

  async storeBatch(items) {
    this.items.push(...items);
    return { insertedCount: items.length, duplicateCount: 0, totalCount: this.items.length, schemaValid: true };
  }

  async findExistingIds(ids) {
    return ids.filter((id) => this.items.some((it) => it.id === id));
  }
}

class SampleCrawler extends AbstractCrawler {
  name = 'twitter';

  async init() {}
  async search() { return []; }
  async getPostDetail() { return /** @type {any} */ ({}); }
  async getComments() { return []; }
  async cleanup() {}

  async processAndPersist(items) {
    for (const item of items) {
      this.validateItem(item);
    }
    if (this.store) {
      await this.store.storeBatch(items);
    }
    return items;
  }
}

class CustomTypeCrawler extends SampleCrawler {
  getItemSchemaType(item) {
    return 'profile-item';
  }
}

describe('Story 28.1 — BaseCrawler DriftGuard Integration Tests', () => {
  beforeEach(() => {
    globalActionRegistry.clear();
  });

  const fullValidPost = {
    id: 'twitter:12345',
    platform: 'twitter',
    externalId: '12345',
    category: 'social',
    authorId: 'auth_1',
    authorName: 'Test Author',
    authorAvatar: 'https://example.com/avatar.png',
    authorUrl: 'https://twitter.com/test',
    postUrl: 'https://twitter.com/test/status/12345',
    content: 'Full valid post content',
    title: 'Valid Post',
    mediaUrls: [],
    likesCount: 10,
    repostsCount: 1,
    repliesCount: 0,
    viewsCount: 50,
    metadata: { sample: true },
    publishedAt: new Date('2026-09-13T00:00:00.000Z'),
    crawledAt: new Date('2026-09-13T00:01:00.000Z'),
  };

  it('validates a complete PostItem with score 100, no dataQuality set, persists to store', async () => {
    const store = new InMemoryStore();
    const crawler = new SampleCrawler({ store });

    const post = { ...fullValidPost };
    crawler.validateItem(post);

    expect(post.dataQuality).toBeUndefined();

    await crawler.processAndPersist([post]);
    expect(store.items).toHaveLength(1);
    expect(store.items[0].id).toBe('twitter:12345');
  });

  it('attaches item.dataQuality on degraded PostItem (missing optional fields) and persists', async () => {
    const store = new InMemoryStore();
    const crawler = new SampleCrawler({ store });

    const degradedPost = {
      id: 'twitter:12345',
      platform: 'twitter',
      externalId: '12345',
      category: 'social',
      authorId: 'auth_1',
      content: 'Minimal content missing 8+ optional fields',
    };

    crawler.validateItem(degradedPost);

    expect(degradedPost.dataQuality).toBeDefined();
    expect(degradedPost.dataQuality?.classification).toBe('degraded');
    expect(degradedPost.dataQuality?.score).toBe(80); // 100 - min(20, 5 * 8+) = 80
    expect(degradedPost.dataQuality?.missingFields).toContain('authorAvatar');
    expect(degradedPost.dataQuality?.missingFields).toContain('postUrl');

    await crawler.processAndPersist([degradedPost]);
    expect(store.items).toHaveLength(1);
    expect(store.items[0].dataQuality?.classification).toBe('degraded');
  });

  it('persists item.dataQuality through a JSON store round-trip (serialization survives)', async () => {
    // Simulates a JSON-backed store (e.g. Prisma/Redis) where the item is
    // serialized on write and deserialized on read — dataQuality must survive.
    class JsonStore extends InMemoryStore {
      async storeBatch(items) {
        const serialized = JSON.parse(JSON.stringify(items));
        this.items.push(...serialized);
        return { insertedCount: serialized.length, duplicateCount: 0, totalCount: this.items.length, schemaValid: true };
      }
    }

    const store = new JsonStore();
    const crawler = new SampleCrawler({ store });

    const degradedPost = {
      id: 'twitter:777',
      platform: 'twitter',
      externalId: '777',
      category: 'social',
      authorId: 'auth_7',
      content: 'Degraded post to verify dataQuality JSON persistence',
    };

    crawler.validateItem(degradedPost);
    expect(degradedPost.dataQuality?.classification).toBe('degraded');

    await crawler.processAndPersist([degradedPost]);

    expect(store.items).toHaveLength(1);
    const persisted = store.items[0];
    expect(persisted.dataQuality).toBeDefined();
    expect(persisted.dataQuality?.classification).toBe('degraded');
    expect(persisted.dataQuality?.score).toBe(80);
    expect(Array.isArray(persisted.dataQuality?.missingFields)).toBe(true);
    expect(persisted.dataQuality?.missingFields).toContain('authorAvatar');
  });

  it('throws PlatformError(DEGRADED_DATA) and prevents corrupted item from persisting when required field is missing', async () => {
    const store = new InMemoryStore();
    const crawler = new SampleCrawler({ store });

    const corruptedPost = {
      id: 'twitter:12345',
      platform: 'twitter',
      externalId: '12345',
      category: 'social',
      // authorId is MISSING
      content: 'Post with missing authorId',
    };

    let thrownError;
    try {
      crawler.validateItem(corruptedPost);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(PlatformError);
    const pErr = /** @type {PlatformError} */ (thrownError);
    expect(pErr.type).toBe(ErrorTypes.DEGRADED_DATA);
    expect(pErr.suggestedAction).toBe(SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT);
    expect(pErr.platform).toBe('twitter');
    expect(pErr.details).toBeDefined();
    const details = /** @type {any} */ (pErr.details);
    expect(details.missingFields).toContain('authorId');

    // Verify batch aborts and store receives nothing
    await expect(crawler.processAndPersist([corruptedPost])).rejects.toThrow(PlatformError);
    expect(store.items).toHaveLength(0);
  });

  it('throws PlatformError(DEGRADED_DATA) when an item has a typeError (e.g. likesCount is string)', async () => {
    const store = new InMemoryStore();
    const crawler = new SampleCrawler({ store });

    const corruptedPost = {
      ...fullValidPost,
      likesCount: 'one hundred', // invalid type
    };

    await expect(crawler.processAndPersist([corruptedPost])).rejects.toThrow(PlatformError);
    expect(store.items).toHaveLength(0);
  });

  it('correctly infers post-item when content is empty string but authorId + category are present', () => {
    const crawler = new SampleCrawler();

    const mediaOnlyPost = {
      id: 'twitter:media1',
      platform: 'twitter',
      externalId: 'media1',
      category: 'social',
      authorId: 'auth_media',
      content: '', // empty content
    };

    // Should infer post-item and validate successfully (since content is string)
    expect(() => crawler.validateItem(mediaOnlyPost)).not.toThrow();
    expect(mediaOnlyPost.dataQuality?.classification).toBe('degraded');
  });

  it('validates against comment-item schema when postId is present', () => {
    const crawler = new SampleCrawler();

    const validComment = {
      id: 'twitter:123:c1',
      platform: 'twitter',
      externalId: 'c1',
      postId: '123',
      authorId: 'auth_commenter',
      content: 'Great comment!',
      crawledAt: new Date(),
    };

    expect(() => crawler.validateItem(validComment)).not.toThrow();

    const corruptedComment = {
      id: 'twitter:123:c2',
      platform: 'twitter',
      externalId: 'c2',
      postId: '123',
      // missing authorId
      content: 'Comment without author',
    };

    expect(() => crawler.validateItem(corruptedComment)).toThrow(PlatformError);
  });

  it('accepts Date instances and nullables without type errors', () => {
    const crawler = new SampleCrawler();

    const item = {
      id: 'twitter:123',
      platform: 'twitter',
      externalId: '123',
      category: 'social',
      authorId: 'auth_1',
      content: 'Post with null avatar and Date crawledAt',
      authorAvatar: null,
      publishedAt: null,
      crawledAt: new Date(),
    };

    expect(() => crawler.validateItem(item)).not.toThrow();
  });

  it('no-ops complete when schema does not exist for unknown entity type', () => {
    const crawler = new SampleCrawler();
    const item = {
      id: 'twitter:unk1',
      platform: 'twitter',
      externalId: 'unk1',
    };

    // driftGuard with no matching schema
    const customGuard = new SchemaDriftGuard({ registry: /** @type {any} */ ({ getSchema: () => null }) });
    crawler.driftGuard = customGuard;

    expect(() => crawler.validateItem(item)).not.toThrow();
  });

  it('allows subclass override of getItemSchemaType', () => {
    const crawler = new CustomTypeCrawler();

    // A profile item without authorId or category
    const profileItem = {
      id: 'twitter:u1',
      platform: 'twitter',
      externalId: 'u1',
      username: 'nich',
      name: 'Nich',
    };

    expect(crawler.getItemSchemaType(profileItem)).toBe('profile-item');
    expect(() => crawler.validateItem(profileItem)).not.toThrow();
  });

  it('aborts whole batch if any item is corrupted, persisting no items', async () => {
    const store = new InMemoryStore();
    const crawler = new SampleCrawler({ store });

    const batch = [
      { ...fullValidPost, id: 'twitter:post1', externalId: 'post1' },
      {
        id: 'twitter:post2',
        platform: 'twitter',
        externalId: 'post2',
        category: 'social',
        // missing authorId and content
      },
      { ...fullValidPost, id: 'twitter:post3', externalId: 'post3' },
    ];

    await expect(crawler.processAndPersist(batch)).rejects.toThrow(PlatformError);
    expect(store.items).toHaveLength(0);
  });
  describe('AbstractCrawler.filterValidItems', () => {
    it('returns empty array when input is null, undefined, or not an array', () => {
      const crawler = new SampleCrawler();
      expect(crawler.filterValidItems(null)).toEqual([]);
      expect(crawler.filterValidItems(undefined)).toEqual([]);
      expect(crawler.filterValidItems(/** @type {any} */ ({ not: 'an array' }))).toEqual([]);
    });

    it('filters out corrupted items, logs warning, and retains complete and degraded items', () => {
      const crawler = new SampleCrawler();

      const completeItem = { ...fullValidPost, id: 'twitter:good1' };
      const degradedItem = {
        id: 'twitter:degraded1',
        platform: 'twitter',
        externalId: 'degraded1',
        category: 'social',
        authorId: 'auth_deg',
        content: 'Degraded post with missing optional fields',
      };
      const corruptedItem = {
        id: 'twitter:corrupted1',
        platform: 'twitter',
        externalId: 'corrupted1',
        category: 'social',
        // missing required authorId
        content: 'Corrupted post',
      };

      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));

      try {
        const result = crawler.filterValidItems([completeItem, corruptedItem, degradedItem]);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('twitter:good1');
        expect(result[0].dataQuality).toBeUndefined();

        expect(result[1].id).toBe('twitter:degraded1');
        expect(result[1].dataQuality?.classification).toBe('degraded');
        expect(result[1].dataQuality?.score).toBe(80);

        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings[0]).toContain('[twitter] item dropped by validation (degraded_data)');
      } finally {
        console.warn = origWarn;
      }
    });
  });
});
