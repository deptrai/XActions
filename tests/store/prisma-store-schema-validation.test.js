import { describe, test, expect, beforeEach } from 'vitest';
import { PrismaStore } from '../../src/store/prisma-store.js';
import metadataSchemaRegistry from '../../src/core/metadata-schema-registry.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

describe('PrismaStore Metadata Validation Hook', () => {
  beforeEach(async () => {
    await cleanupTestDatabase();
    metadataSchemaRegistry.registerSchema('dummy', 'social', {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count']
    });
  });

  test('storeContent should throw XACT_4001 if metadata violates schema', async () => {
    const store = new PrismaStore({ prisma });
    const invalidItem = {
      platform: 'dummy',
      category: 'social',
      externalId: '123',
      content: 'test',
      authorId: 'auth_1',
      authorName: 'Test Author',
      metadata: { count: 'not-a-number' }
    };

    await expect(store.storeContent(invalidItem)).rejects.toThrow(PlatformError);

    const err = await store.storeContent(invalidItem).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
    expect(err.code).toBe('XACT_4001');
    expect(err.statusCode).toBe(400);
    expect(err.suggestedAction).toBe(SuggestedActions.USE_ACTIONS_LIST);
    expect(err.details.errors).toBeDefined();
  });

  test('storeBatch should throw XACT_4001 before transaction if any item is invalid', async () => {
    const store = new PrismaStore({ prisma });
    const items = [
      { platform: 'dummy', category: 'social', externalId: '1', content: 'valid', authorId: 'auth_1', authorName: 'Test Author', metadata: { count: 1 } },
      { platform: 'dummy', category: 'social', externalId: '2', content: 'invalid', authorId: 'auth_2', authorName: 'Test Author 2', metadata: { count: 'bad' } }
    ];

    await expect(store.storeBatch(items)).rejects.toThrow(PlatformError);

    const err = await store.storeBatch(items).catch((e) => e);
    expect(err.code).toBe('XACT_4001');
    expect(err.message).toMatch(/index 1/);
    expect(err.details.index).toBe(1);

    const posts = await prisma.post.findMany();
    expect(posts.length).toBe(0);
  });

  test('storeContent should allow insertion if validateSchema bypass is used', async () => {
    const store = new PrismaStore({ prisma });
    const invalidItem = {
      platform: 'dummy',
      category: 'social',
      externalId: 'bypass-123',
      content: 'bypassed metadata',
      authorId: 'auth_bypass',
      authorName: 'Bypass Author',
      metadata: { count: 'not-a-number' }
    };

    await expect(store.storeContent(invalidItem, { validateSchema: false })).resolves.not.toThrow();

    const posts = await prisma.post.findMany();
    expect(posts.length).toBe(1);
    expect(posts[0].metadata).toEqual({ count: 'not-a-number' });
  });
});
