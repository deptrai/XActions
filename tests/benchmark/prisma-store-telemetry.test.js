import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaStore } from '../../src/store/prisma-store.js';
import { TelemetryContext } from '../../src/core/telemetry-context.js';

describe('Story 34.2: PrismaStore Telemetry & Persistence Hooks Unit Tests', () => {
  let mockPrisma;
  let store;

  beforeEach(() => {
    mockPrisma = {
      post: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    store = new PrismaStore({
      prisma: mockPrisma,
      validateSchema: false,
    });
  });

  it('records store metrics with correct item counts and zero duplicates when count matches (AC 6)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    mockPrisma.post.createMany.mockResolvedValueOnce({ count: 2 });

    const posts = [
      { id: 't-1', platform: 'twitter', externalId: 'ext-1', category: 'social' },
      { id: 't-2', platform: 'twitter', externalId: 'ext-2', category: 'social' },
    ];

    await store.storeBatch(posts, {
      telemetryContext: telemetry,
    });

    expect(telemetry.storeMetrics).toBeDefined();
    expect(telemetry.storeMetrics.totalItems).toBe(2);
    expect(telemetry.storeMetrics.duplicates).toBe(0);
    expect(telemetry.storeMetrics.schemaValid).toBe(true);
    expect(telemetry.storeMetrics.fieldFillRate).toBe(1.0);
  });

  it('calculates duplicates delta from createMany skipDuplicates (AC 6)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    // 5 items, only 2 newly created => 3 duplicates
    mockPrisma.post.createMany.mockResolvedValueOnce({ count: 2 });

    const posts = [
      { id: 't-1', platform: 'twitter', externalId: 'ext-1', category: 'social' },
      { id: 't-2', platform: 'twitter', externalId: 'ext-2', category: 'social' },
      { id: 't-3', platform: 'twitter', externalId: 'ext-3', category: 'social' },
      { id: 't-4', platform: 'twitter', externalId: 'ext-4', category: 'social' },
      { id: 't-5', platform: 'twitter', externalId: 'ext-5', category: 'social' },
    ];

    await store.storeBatch(posts, {
      session: { telemetry },
    });

    expect(telemetry.storeMetrics).toBeDefined();
    expect(telemetry.storeMetrics.totalItems).toBe(5);
    expect(telemetry.storeMetrics.duplicates).toBe(3);
  });

  it('resolves telemetryContext from this.telemetryContext if not in opts (AC 6)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'facebook-hybrid',
      platform: 'facebook',
      action: 'posts',
    });

    store.telemetryContext = telemetry;
    mockPrisma.post.createMany.mockResolvedValueOnce({ count: 1 });

    const posts = [
      { id: 'fb-1', platform: 'facebook', externalId: 'ext-fb-1', category: 'social' },
    ];

    await store.storeBatch(posts);

    expect(telemetry.storeMetrics).toBeDefined();
    expect(telemetry.storeMetrics.totalItems).toBe(1);
    expect(telemetry.storeMetrics.duplicates).toBe(0);
  });

  it('gracefully completes without error when telemetry is absent (AC 6)', async () => {
    mockPrisma.post.createMany.mockResolvedValueOnce({ count: 1 });

    const posts = [
      { id: 'fb-1', platform: 'facebook', externalId: 'ext-fb-1', category: 'social' },
    ];

    await expect(store.storeBatch(posts)).resolves.not.toThrow();
  });
  it('accumulates store metrics across multiple storeBatch calls in TelemetryContext', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    mockPrisma.post.createMany
      .mockResolvedValueOnce({ count: 2 }) // Batch 1: 2 items, 0 dupes
      .mockResolvedValueOnce({ count: 1 }); // Batch 2: 3 items, 2 dupes

    const batch1 = [
      { id: 't-1', platform: 'twitter', externalId: 'ext-1', category: 'social' },
      { id: 't-2', platform: 'twitter', externalId: 'ext-2', category: 'social' },
    ];
    const batch2 = [
      { id: 't-3', platform: 'twitter', externalId: 'ext-3', category: 'social' },
      { id: 't-4', platform: 'twitter', externalId: 'ext-4', category: 'social' },
      { id: 't-5', platform: 'twitter', externalId: 'ext-5', category: 'social' },
    ];

    await store.storeBatch(batch1, { telemetryContext: telemetry });
    await store.storeBatch(batch2, { telemetryContext: telemetry });

    expect(telemetry.storeMetrics).toBeDefined();
    expect(telemetry.storeMetrics.totalItems).toBe(5);
    expect(telemetry.storeMetrics.duplicates).toBe(2);
    expect(telemetry.storeMetrics.schemaValid).toBe(true);
    expect(telemetry.storeMetrics.fieldFillRate).toBe(1.0);
  });

  it('records failure store metrics when category validation fails', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    const invalidPosts = [
      { id: 't-1', platform: 'twitter', externalId: 'ext-1', category: 'invalid_cat' },
    ];

    await expect(
      store.storeBatch(invalidPosts, { telemetryContext: telemetry })
    ).rejects.toThrow();

    expect(telemetry.storeMetrics).toBeDefined();
    expect(telemetry.storeMetrics.schemaValid).toBe(false);
    expect(telemetry.storeMetrics.totalItems).toBe(1);
  });

});
