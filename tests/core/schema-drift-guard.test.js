// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import {
  SchemaDriftGuard,
  globalSchemaDriftGuard,
} from '../../src/core/schema-drift-guard.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';

describe('Story 28.1 — SchemaDriftGuard Unit Tests', () => {
  const guard = globalSchemaDriftGuard;

  const validCompletePost = {
    id: 'twitter:123456',
    platform: 'twitter',
    externalId: '123456',
    category: 'social',
    authorId: 'auth_999',
    authorName: 'Alice',
    authorAvatar: 'https://cdn.example.com/avatar.jpg',
    authorUrl: 'https://twitter.com/alice',
    postUrl: 'https://twitter.com/alice/status/123456',
    content: 'Hello world from SchemaDriftGuard test!',
    title: 'Test Title',
    mediaUrls: ['https://cdn.example.com/media1.jpg'],
    likesCount: 42,
    repostsCount: 7,
    repliesCount: 3,
    viewsCount: 1000,
    metadata: { verified: true },
    publishedAt: new Date('2026-09-13T10:00:00.000Z'),
    crawledAt: new Date('2026-09-13T10:05:00.000Z'),
  };

  describe('Completeness score formula & classification', () => {
    it('returns score 100 and complete classification for a fully populated valid post', () => {
      const result = guard.validate('twitter', validCompletePost);
      expect(result.classification).toBe('complete');
      expect(result.score).toBe(100);
      expect(result.missingFields).toHaveLength(0);
      expect(result.typeErrors).toHaveLength(0);
    });

    it('classifies as degraded and deducts 5 points per missing optional field (e.g. 2 missing -> 90)', () => {
      const postMissing2Optional = { ...validCompletePost };
      delete postMissing2Optional.authorAvatar;
      delete postMissing2Optional.postUrl;

      const result = guard.validate('twitter', postMissing2Optional);
      expect(result.classification).toBe('degraded');
      expect(result.score).toBe(90);
      expect(result.missingFields).toContain('authorAvatar');
      expect(result.missingFields).toContain('postUrl');
      expect(result.missingFields).toHaveLength(2);
      expect(result.typeErrors).toHaveLength(0);
    });

    it('caps missing optional deduction at 20 points, ensuring score >= 80 and not corrupted', () => {
      // Post with only required fields and NO optional fields
      const minimalPost = {
        id: 'twitter:123456',
        platform: 'twitter',
        externalId: '123456',
        category: 'social',
        authorId: 'auth_999',
        content: 'Minimal post content',
      };

      const result = guard.validate('twitter', minimalPost);
      expect(result.classification).toBe('degraded');
      // 13 optional fields missing -> 13 * 5 = 65 -> capped at 20 -> score = 100 - 20 = 80
      expect(result.score).toBe(80);
      expect(result.typeErrors).toHaveLength(0);
      expect(result.missingFields.length).toBeGreaterThanOrEqual(8);
    });

    it('classifies as corrupted when a required field is missing (score drops by 35)', () => {
      const postMissingAuthorId = { ...validCompletePost };
      delete postMissingAuthorId.authorId;

      const result = guard.validate('twitter', postMissingAuthorId);
      expect(result.classification).toBe('corrupted');
      // 100 - 35 = 65
      expect(result.score).toBe(65);
      expect(result.missingFields).toContain('authorId');
      expect(result.typeErrors).toHaveLength(0);
    });

    it('classifies as corrupted when a type error occurs (score drops by 15 per type error)', () => {
      const postWithBadType = {
        ...validCompletePost,
        likesCount: '42', // string instead of number
      };

      const result = guard.validate('twitter', postWithBadType);
      expect(result.classification).toBe('corrupted');
      // 100 - 15 = 85, but typeErrors > 0 forces corrupted
      expect(result.score).toBe(85);
      expect(result.typeErrors).toHaveLength(1);
      expect(result.typeErrors[0]).toMatch(/likesCount must be of type number/);
    });

    it('classifies as corrupted when multiple errors drag score below 70', () => {
      const corruptedPost = {
        ...validCompletePost,
        likesCount: 'not_a_number',
        repostsCount: 'not_a_number',
        viewsCount: 'not_a_number',
      };
      // delete 8 optional fields
      delete corruptedPost.authorAvatar;
      delete corruptedPost.authorUrl;
      delete corruptedPost.postUrl;
      delete corruptedPost.title;
      delete corruptedPost.metadata;

      const result = guard.validate('twitter', corruptedPost);
      expect(result.classification).toBe('corrupted');
      expect(result.score).toBeLessThan(70);
    });
  });

  describe('Item type inference', () => {
    it('infers comment-item when postId is present', () => {
      const commentItem = {
        id: 'twitter:123:c1',
        platform: 'twitter',
        externalId: 'c1',
        postId: '123',
        authorId: 'auth1',
        content: 'Nice comment',
      };
      expect(guard.inferItemType(commentItem)).toBe('comment-item');
    });

    it('infers post-item when authorId is present', () => {
      const item = {
        id: 'twitter:123',
        platform: 'twitter',
        externalId: '123',
        authorId: 'auth1',
        content: 'A post',
      };
      expect(guard.inferItemType(item)).toBe('post-item');
    });

    it('infers post-item when category is present', () => {
      const item = {
        id: 'twitter:123',
        platform: 'twitter',
        externalId: '123',
        category: 'social',
        content: 'A post',
      };
      expect(guard.inferItemType(item)).toBe('post-item');
    });

    it('infers post-item even when content is empty string (media-only post)', () => {
      const mediaOnlyPost = {
        id: 'twitter:123',
        platform: 'twitter',
        externalId: '123',
        category: 'social',
        authorId: 'auth1',
        content: '',
      };
      expect(guard.inferItemType(mediaOnlyPost)).toBe('post-item');
    });

    it('infers profile-item when neither postId, authorId, nor category are present', () => {
      const profile = {
        id: 'twitter:u1',
        platform: 'twitter',
        externalId: 'u1',
        username: 'alice',
      };
      expect(guard.inferItemType(profile)).toBe('profile-item');
    });

    it('infers profile-item (not post) for a profile-shaped item carrying category:"profile"', () => {
      const profileWithCategory = {
        id: 'twitter:u2',
        platform: 'twitter',
        externalId: 'u2',
        username: 'bob',
        category: 'profile', // CATEGORY.PROFILE — must not force post-item
      };
      expect(guard.inferItemType(profileWithCategory)).toBe('profile-item');
    });

    it('does not infer comment-item from a postId that is present but undefined', () => {
      const item = {
        id: 'twitter:p9',
        platform: 'twitter',
        externalId: 'p9',
        authorId: 'a1',
        postId: undefined, // present-but-undefined must not trigger comment inference
      };
      expect(guard.inferItemType(item)).toBe('post-item');
    });
  });

  describe('Non-object item handling', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'not-an-object'],
      ['an array', []],
      ['a number', 42],
    ])('classifies %s item as corrupted with score 0', (_label, bad) => {
      const res = guard.validate('twitter', bad);
      expect(res.classification).toBe('corrupted');
      expect(res.score).toBe(0);
    });
  });

  describe('Union types and nullable fields', () => {
    it('accepts Date instance and ISO string for crawledAt and publishedAt', () => {
      const itemWithDates = {
        ...validCompletePost,
        crawledAt: new Date(),
        publishedAt: new Date(),
      };
      const res1 = guard.validate('twitter', itemWithDates);
      expect(res1.typeErrors).toHaveLength(0);

      const itemWithIsoStrings = {
        ...validCompletePost,
        crawledAt: '2026-09-13T10:00:00.000Z',
        publishedAt: '2026-09-13T10:00:00.000Z',
      };
      const res2 = guard.validate('twitter', itemWithIsoStrings);
      expect(res2.typeErrors).toHaveLength(0);
    });

    it('accepts null for authorAvatar and publishedAt', () => {
      const itemWithNulls = {
        ...validCompletePost,
        authorAvatar: null,
        publishedAt: null,
      };
      const res = guard.validate('twitter', itemWithNulls);
      expect(res.typeErrors).toHaveLength(0);
      expect(res.missingFields).not.toContain('authorAvatar');
      expect(res.missingFields).not.toContain('publishedAt');
    });
  });

  describe('Schema lookup resolution & fallback', () => {
    it('falls back to items:post-item when platform has no specific override', () => {
      const schema = guard.getSchema('any_platform', 'post-item');
      expect(schema).not.toBeNull();
      expect(schema?.title).toBe('Canonical PostItem Contract');
    });

    it('no-ops complete with score 100 when schemaType does not exist in platform or items', () => {
      const item = { id: 'test:1', platform: 'custom', externalId: '1' };
      const res = guard.validate('custom', item, { schemaType: 'unknown-entity-type' });
      expect(res.classification).toBe('complete');
      expect(res.score).toBe(100);
      expect(res.missingFields).toHaveLength(0);
      expect(res.typeErrors).toHaveLength(0);
    });

    it('allows registering custom schema overrides', () => {
      const customGuard = new SchemaDriftGuard();
      customGuard.registerItemSchema('custom-item', {
        type: 'object',
        required: ['customField'],
        properties: {
          customField: { type: 'string' },
        },
      });

      const validCustom = { customField: 'hello' };
      const res1 = customGuard.validate('test', validCustom, { schemaType: 'custom-item' });
      expect(res1.classification).toBe('complete');

      const invalidCustom = {};
      const res2 = customGuard.validate('test', invalidCustom, { schemaType: 'custom-item' });
      expect(res2.classification).toBe('corrupted');
      expect(res2.missingFields).toContain('customField');
    });
  });

  describe('validateOrThrow behavior', () => {
    it('returns validation result when complete or degraded without throwing', () => {
      const completeRes = guard.validateOrThrow('twitter', validCompletePost);
      expect(completeRes.classification).toBe('complete');

      const degradedPost = { ...validCompletePost };
      delete degradedPost.authorAvatar;
      const degradedRes = guard.validateOrThrow('twitter', degradedPost);
      expect(degradedRes.classification).toBe('degraded');
    });

    it('throws PlatformError with DEGRADED_DATA when item is corrupted', () => {
      const corruptedPost = { ...validCompletePost };
      delete corruptedPost.content; // required field missing

      try {
        guard.validateOrThrow('twitter', corruptedPost);
        expect.unreachable('Should have thrown PlatformError');
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformError);
        const pErr = /** @type {PlatformError} */ (err);
        expect(pErr.type).toBe(ErrorTypes.DEGRADED_DATA);
        expect(pErr.code).toBe('XACT_4220');
        expect(pErr.suggestedAction).toBe(SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT);
        expect(pErr.platform).toBe('twitter');
        expect(pErr.details).toBeDefined();
        const details = /** @type {any} */ (pErr.details);
        expect(details.score).toBeLessThan(100);
        expect(details.missingFields).toContain('content');
      }
    });
  });
});
