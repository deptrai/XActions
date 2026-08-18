// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Acceptance Tests — Story 10.4: Checkpoint Manager Service.
 * Runs against the real xactions_test PostgreSQL database via tests/store/test-prisma-client.js.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  CHECKPOINT_STATUSES,
  listCheckpoints,
  getCheckpoint,
  resumeCheckpoint,
  pauseCheckpoint,
  retryCheckpoint,
} from '../../src/store/checkpoint-manager.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let checkpointCounter = 0;
async function seedCheckpoint(overrides = {}) {
  checkpointCounter += 1;
  return prisma.crawlCheckpoint.create({
    data: {
      platform: 'twitter',
      targetType: 'profile',
      targetKey: `nichxbt_${checkpointCounter}`,
      status: 'running',
      errorCount: 0,
      ...overrides,
    },
  });
}

describe('Story 10.4: CheckpointManager Service — Constants & Contract Compliance (AC8)', () => {
  it('exports CHECKPOINT_STATUSES constant containing all 5 allowed status strings', () => {
    expect(CHECKPOINT_STATUSES).toEqual([
      'running',
      'paused',
      'failed',
      'completed',
      'stalled',
    ]);
  });
});

describe('Story 10.4: CheckpointManager Service — CRUD & Listing (AC1 & AC2)', () => {
  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  it('returns paginated checkpoints with total count, limit, and offset', async () => {
    for (let i = 0; i < 3; i++) {
      await seedCheckpoint({ targetKey: `seed_${i}` });
    }

    const result = await listCheckpoints({ limit: 2, offset: 0, prisma });
    expect(result.checkpoints).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(0);

    const page2 = await listCheckpoints({ limit: 2, offset: 2, prisma });
    expect(page2.checkpoints).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('filters checkpoints by platform, targetType, targetKey (substring), and status', async () => {
    await seedCheckpoint({ platform: 'twitter', targetType: 'profile', targetKey: 'nichxbt', status: 'running' });
    await seedCheckpoint({ platform: 'facebook', targetType: 'group', targetKey: 'AntigravityClub', status: 'failed' });

    const result = await listCheckpoints({
      platform: 'facebook',
      targetType: 'group',
      targetKey: 'gravity',
      status: 'failed',
      prisma,
    });
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].platform).toBe('facebook');
    expect(result.checkpoints[0].targetKey).toBe('AntigravityClub');
  });

  it('caps limit at 500 and sorts by updatedAt desc by default', async () => {
    for (let i = 0; i < 3; i++) {
      await seedCheckpoint({ targetKey: `sort_${i}` });
      await sleep(20);
    }

    const result = await listCheckpoints({ limit: 1000, prisma });
    expect(result.limit).toBe(500);
    expect(result.checkpoints).toHaveLength(3);
    // updatedAt desc: last created first
    expect(result.checkpoints[0].targetKey).toBe('sort_2');
    expect(result.checkpoints[2].targetKey).toBe('sort_0');
  });

  it('returns an empty array with total 0 when no checkpoints match', async () => {
    await seedCheckpoint({ platform: 'twitter' });
    const result = await listCheckpoints({ platform: 'nonexistent', prisma });
    expect(result.checkpoints).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns single checkpoint by ID', async () => {
    const created = await seedCheckpoint({ targetKey: 'by_id' });
    const ckpt = await getCheckpoint(created.id, { prisma });
    expect(ckpt.id).toBe(created.id);
    expect(ckpt.platform).toBe('twitter');
    expect(ckpt.targetKey).toBe('by_id');
  });

  it('throws PlatformError 404 (XACT_4041) when checkpoint ID is not found', async () => {
    await expect(getCheckpoint('non_existent_cuid_999', { prisma })).rejects.toThrow(PlatformError);
    try {
      await getCheckpoint('non_existent_cuid_999', { prisma });
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('XACT_4041');
    }
  });

  it('throws PlatformError 400 (XACT_4001) when checkpoint ID is empty or null', async () => {
    await expect(getCheckpoint('', { prisma })).rejects.toThrow(PlatformError);
    await expect(getCheckpoint(null, { prisma })).rejects.toThrow(PlatformError);
    await expect(getCheckpoint(undefined, { prisma })).rejects.toThrow(PlatformError);
  });
});

describe('Story 10.4: CheckpointManager Service — State Transitions (AC3, AC4, AC5)', () => {
  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  it('resumes a paused or failed checkpoint to running and sets nextScheduledAt', async () => {
    const paused = await seedCheckpoint({ status: 'paused', nextScheduledAt: null });
    const result = await resumeCheckpoint(paused.id, { prisma });
    expect(result.status).toBe('running');
    expect(result.nextScheduledAt).toBeInstanceOf(Date);

    const failed = await seedCheckpoint({ status: 'failed', nextScheduledAt: null });
    const failedResult = await resumeCheckpoint(failed.id, { prisma });
    expect(failedResult.status).toBe('running');
  });

  it('rejects resuming an already running or completed checkpoint with PlatformError (XACT_4002)', async () => {
    const running = await seedCheckpoint({ status: 'running' });
    await expect(resumeCheckpoint(running.id, { prisma })).rejects.toThrow(PlatformError);

    const completed = await seedCheckpoint({ status: 'completed' });
    await expect(resumeCheckpoint(completed.id, { prisma })).rejects.toThrow(PlatformError);
  });

  it('pauses a running or stalled checkpoint to paused and clears nextScheduledAt', async () => {
    const running = await seedCheckpoint({ status: 'running', nextScheduledAt: new Date() });
    const result = await pauseCheckpoint(running.id, { prisma });
    expect(result.status).toBe('paused');
    expect(result.nextScheduledAt).toBeNull();

    const stalled = await seedCheckpoint({ status: 'stalled', nextScheduledAt: new Date() });
    const stalledResult = await pauseCheckpoint(stalled.id, { prisma });
    expect(stalledResult.status).toBe('paused');
  });

  it('rejects pausing a paused, failed, or completed checkpoint with PlatformError (XACT_4002)', async () => {
    const failed = await seedCheckpoint({ status: 'failed' });
    await expect(pauseCheckpoint(failed.id, { prisma })).rejects.toThrow(PlatformError);

    const paused = await seedCheckpoint({ status: 'paused' });
    await expect(pauseCheckpoint(paused.id, { prisma })).rejects.toThrow(PlatformError);

    const completed = await seedCheckpoint({ status: 'completed' });
    await expect(pauseCheckpoint(completed.id, { prisma })).rejects.toThrow(PlatformError);
  });

  it('retries a failed or stalled checkpoint to running, resets errorCount, preserves lastCursor, and sets nextScheduledAt', async () => {
    const failed = await seedCheckpoint({
      status: 'failed',
      errorCount: 5,
      lastCursor: 'preserved_cursor_xyz',
      nextScheduledAt: null,
    });

    const result = await retryCheckpoint(failed.id, { prisma });
    const updated = await prisma.crawlCheckpoint.findUnique({ where: { id: failed.id } });

    expect(result.status).toBe('running');
    expect(updated.errorCount).toBe(0);
    expect(updated.lastCursor).toBe('preserved_cursor_xyz');
    expect(updated.nextScheduledAt).toBeInstanceOf(Date);
  });

  it('retries a paused checkpoint to running (spec transition table)', async () => {
    const paused = await seedCheckpoint({ status: 'paused', errorCount: 2, nextScheduledAt: null });
    const result = await retryCheckpoint(paused.id, { prisma });
    expect(result.status).toBe('running');
    const updated = await prisma.crawlCheckpoint.findUnique({ where: { id: paused.id } });
    expect(updated.errorCount).toBe(0);
  });

  it('rejects retrying a running or completed checkpoint with PlatformError (XACT_4002)', async () => {
    const running = await seedCheckpoint({ status: 'running' });
    await expect(retryCheckpoint(running.id, { prisma })).rejects.toThrow(PlatformError);

    const completed = await seedCheckpoint({ status: 'completed' });
    await expect(retryCheckpoint(completed.id, { prisma })).rejects.toThrow(PlatformError);
  });
});
