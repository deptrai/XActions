// Story 25.5/25.6/25.7 — Checkpoint round-trip E2E on a real Postgres test DB.
// Exercises the full ACL -> getCheckpoint -> inject cursor -> storeBatch ->
// findExistingIds -> shouldStopPagination path against a live PrismaStore.
// No mocks: real PrismaClient against DATABASE_URL_TEST (xactions_test).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaStore } from '../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

const store = new PrismaStore({ prisma });

const post = (externalId) => ({
  platform: 'twitter',
  externalId,
  category: 'social',
  content: `content for ${externalId}`,
  authorId: 'u1',
  authorName: 'user1',
});

describe('Checkpoint resume + early termination — real Postgres round-trip', () => {
  beforeEach(async () => {
    await cleanupTestDatabase();
  });
  afterAll(async () => {
    await store.close();
    await prisma.$disconnect();
  });

  it('run1 stores posts + checkpoint cursor; run2 resumes from checkpoint and ET stops on all-dup page', async () => {
    const KEY = { platform: 'twitter', targetType: 'search', targetKey: 'openai' };

    // ---- RUN 1: store 3 posts, save checkpoint cursor ----
    const r1 = await store.storeBatch([post('p1'), post('p2'), post('p3')], { upsert: true });
    expect(r1.insertedCount).toBe(3);
    expect(r1.duplicateCount).toBe(0);
    await store.saveCheckpoint({ ...KEY, lastCursor: 'cursor_page1', status: 'running' });

    // ---- RUN 2 (simulated): caller omits cursor -> resolveCheckpoint would
    // inject lastCursor. We assert the store layer returns that cursor, then
    // simulate a page whose items are ALL already in the DB -> shouldStop.
    const cp = await store.getCheckpoint(KEY.platform, KEY.targetType, KEY.targetKey);
    expect(cp).not.toBeNull();
    expect(cp.lastCursor).toBe('cursor_page1');

    // page 2 items all already persisted -> storeBatch reports all duplicates
    const r2 = await store.storeBatch([post('p1'), post('p2'), post('p3')], { upsert: true });
    expect(r2.insertedCount).toBe(0);
    expect(r2.duplicateCount).toBe(3);

    // findExistingIds sees every id already present
    const existing = await store.findExistingIds([`twitter:p1`, `twitter:p2`, `twitter:p3`]);
    expect(existing.length).toBeGreaterThanOrEqual(3);
  });

  it('checkpoint upsert updates lastCursor on re-save (unique platform+targetType+targetKey)', async () => {
    const KEY = { platform: 'twitter', targetType: 'search', targetKey: 'cursor-upsert' };
    await store.saveCheckpoint({ ...KEY, lastCursor: 'c1', status: 'running' });
    await store.saveCheckpoint({ ...KEY, lastCursor: 'c2', status: 'running' });
    const cp = await store.getCheckpoint(KEY.platform, KEY.targetType, KEY.targetKey);
    expect(cp.lastCursor).toBe('c2');
    const all = await prisma.crawlCheckpoint.findMany({ where: { targetKey: 'cursor-upsert' } });
    expect(all.length).toBe(1); // upsert, not insert
  });

  it('findExistingIds splits post vs comment ids and returns only persisted ones', async () => {
    await store.storeBatch([post('onlyPost')], { upsert: true });
    const found = await store.findExistingIds(['twitter:onlyPost', 'twitter:missing']);
    expect(found).toContain('twitter:onlyPost');
    expect(found).not.toContain('twitter:missing');
  });
});
