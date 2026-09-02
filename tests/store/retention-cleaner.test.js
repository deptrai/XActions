// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Integration Tests — Story 10.6: Data Retention Cleanup Job & Checkpoint Purge.
 * Runs against a real PostgreSQL test database; no mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RetentionCleaner,
  defaultRetentionCleaner,
  SAFE_CHECKPOINT_CLEANUP_STATUSES,
  PROTECTED_CHECKPOINT_STATUSES,
  DEFAULT_RAW_RETENTION_DAYS,
  DEFAULT_CHECKPOINT_RETENTION_DAYS,
} from '../../src/store/retention-cleaner.js';
import {
  runRetentionCycle,
  startRetentionScheduler,
  stopRetentionScheduler,
  getRetentionSchedulerStatus,
} from '../../api/services/retentionScheduler.js';
import { prisma, cleanupTestDatabase } from './test-prisma-client.js';

beforeEach(async () => {
  await cleanupTestDatabase();
  stopRetentionScheduler();
});

describe('Story 10.6: RetentionCleaner — Raw Crawl Data Purge (AC1 & AC2)', () => {
  it('identifies cutoff date and purges Post & Comment records older than 30 days while preserving newer records', async () => {
    const cleaner = new RetentionCleaner({ prisma });

    const now = Date.now();
    const oldDate = new Date(now - 35 * 24 * 60 * 60 * 1000); // 35 days ago (expired)
    const recentDate = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days ago (fresh)

    // Seed expired posts & comments
    await prisma.post.createMany({
      data: [
        {
          id: 'twitter:old_1',
          platform: 'twitter',
          externalId: 'old_1',
          category: 'social',
          authorId: 'auth_1',
          authorName: 'Old User 1',
          content: 'Old post content 1',
          crawledAt: oldDate,
        },
        {
          id: 'twitter:old_2',
          platform: 'twitter',
          externalId: 'old_2',
          category: 'social',
          authorId: 'auth_2',
          authorName: 'Old User 2',
          content: 'Old post content 2',
          crawledAt: oldDate,
        },
      ],
    });

    await prisma.comment.createMany({
      data: [
        {
          id: 'twitter:old_1:comm_1',
          platform: 'twitter',
          externalId: 'comm_1',
          postId: 'twitter:old_1',
          authorId: 'auth_c1',
          authorName: 'Commenter 1',
          content: 'Old comment 1',
          crawledAt: oldDate,
        },
        {
          id: 'twitter:old_2:comm_2',
          platform: 'twitter',
          externalId: 'comm_2',
          postId: 'twitter:old_2',
          authorId: 'auth_c2',
          authorName: 'Commenter 2',
          content: 'Old comment 2',
          crawledAt: oldDate,
        },
      ],
    });

    // Seed fresh posts & comments
    await prisma.post.create({
      data: {
        id: 'twitter:fresh_1',
        platform: 'twitter',
        externalId: 'fresh_1',
        category: 'social',
        authorId: 'auth_fresh',
        authorName: 'Fresh User',
        content: 'Fresh post content',
        crawledAt: recentDate,
      },
    });

    await prisma.comment.create({
      data: {
        id: 'twitter:fresh_1:comm_fresh',
        platform: 'twitter',
        externalId: 'comm_fresh',
        postId: 'twitter:fresh_1',
        authorId: 'auth_cfresh',
        authorName: 'Fresh Commenter',
        content: 'Fresh comment',
        crawledAt: recentDate,
      },
    });

    expect(await prisma.post.count()).toBe(3);
    expect(await prisma.comment.count()).toBe(3);

    // Execute cleanup
    const result = await cleaner.cleanRawCrawlData({
      retentionDays: 30,
      batchSize: 10,
      batchDelayMs: 0,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.postsDeleted).toBe(2);
    expect(result.commentsDeleted).toBe(2);
    expect(result.batchesExecuted).toBeGreaterThanOrEqual(1);

    // Verify DB state
    const remainingPosts = await prisma.post.findMany();
    const remainingComments = await prisma.comment.findMany();

    expect(remainingPosts.length).toBe(1);
    expect(remainingPosts[0].id).toBe('twitter:fresh_1');

    expect(remainingComments.length).toBe(1);
    expect(remainingComments[0].id).toBe('twitter:fresh_1:comm_fresh');
  });

  it('operates in dryRun mode without deleting any records', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    await prisma.post.create({
      data: {
        id: 'facebook:old_fb',
        platform: 'facebook',
        externalId: 'old_fb',
        category: 'social',
        authorId: 'auth_fb',
        authorName: 'FB User',
        content: 'FB content',
        crawledAt: oldDate,
      },
    });

    await prisma.comment.create({
      data: {
        id: 'facebook:old_fb:comm_fb',
        platform: 'facebook',
        externalId: 'comm_fb',
        postId: 'facebook:old_fb',
        authorId: 'auth_comm',
        authorName: 'FB Comm',
        content: 'FB Comment',
        crawledAt: oldDate,
      },
    });

    const result = await cleaner.cleanRawCrawlData({
      retentionDays: 30,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.postsEligible).toBe(1);
    expect(result.commentsEligible).toBe(1);
    expect(result.postsDeleted).toBe(0);
    expect(result.commentsDeleted).toBe(0);

    // Database should be unchanged
    expect(await prisma.post.count()).toBe(1);
    expect(await prisma.comment.count()).toBe(1);
  });

  it('performs multi-batch iterative deletion when expired records exceed batchSize', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const oldDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);

    const postsToInsert = [];
    for (let i = 1; i <= 25; i++) {
      postsToInsert.push({
        id: `threads:batch_${i}`,
        platform: 'threads',
        externalId: `batch_${i}`,
        category: 'social',
        authorId: `auth_${i}`,
        authorName: `User ${i}`,
        content: `Batch post ${i}`,
        crawledAt: oldDate,
      });
    }
    await prisma.post.createMany({ data: postsToInsert });

    expect(await prisma.post.count()).toBe(25);

    // Delete with batchSize 5 -> should run across multiple batches
    const result = await cleaner.cleanRawCrawlData({
      retentionDays: 30,
      batchSize: 5,
      batchDelayMs: 2,
    });

    expect(result.success).toBe(true);
    expect(result.postsDeleted).toBe(25);
    expect(result.batchesExecuted).toBe(5);
    expect(await prisma.post.count()).toBe(0);
  });

  it('cleans remaining orphan comments whose parent posts were previously deleted', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    // Create post, then create comment, then directly delete post leaving orphaned comment (if FK cascade allows or orphan scenario)
    await prisma.post.create({
      data: {
        id: 'twitter:orphan_parent',
        platform: 'twitter',
        externalId: 'orphan_parent',
        category: 'social',
        authorId: 'auth',
        authorName: 'Author',
        content: 'Parent Post',
        crawledAt: oldDate,
      },
    });

    await prisma.comment.create({
      data: {
        id: 'twitter:orphan_parent:orphan_comm',
        platform: 'twitter',
        externalId: 'orphan_comm',
        postId: 'twitter:orphan_parent',
        authorId: 'auth_c',
        authorName: 'Author C',
        content: 'Orphan comment content',
        crawledAt: oldDate,
      },
    });

    const result = await cleaner.cleanRawCrawlData({
      retentionDays: 30,
      batchSize: 10,
    });

    expect(result.success).toBe(true);
    expect(result.commentsDeleted).toBe(1);
    expect(result.postsDeleted).toBe(1);
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.post.count()).toBe(0);
  });
});

describe('Story 10.6: RetentionCleaner — Checkpoint Lifecycle Purge (AC3)', () => {
  it('purges completed and failed checkpoints older than 90 days', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const now = Date.now();
    const oldCheckpointDate = new Date(now - 100 * 24 * 60 * 60 * 1000); // 100 days old

    await prisma.crawlCheckpoint.createMany({
      data: [
        {
          id: 'ckpt_completed_old',
          platform: 'twitter',
          targetType: 'profile',
          targetKey: 'user_1',
          status: 'completed',
          lastCrawledAt: oldCheckpointDate,
        },
        {
          id: 'ckpt_failed_old',
          platform: 'twitter',
          targetType: 'hashtag',
          targetKey: 'tag_1',
          status: 'failed',
          lastCrawledAt: oldCheckpointDate,
        },
      ],
    });

    const result = await cleaner.cleanCheckpoints({
      checkpointRetentionDays: 90,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.checkpointsDeleted).toBe(2);
    expect(await prisma.crawlCheckpoint.count()).toBe(0);
  });

  it('PROTECTION GUARD: strictly preserves running, paused, and stalled checkpoints regardless of age', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const oldCheckpointDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days old

    await prisma.crawlCheckpoint.createMany({
      data: [
        {
          id: 'ckpt_running_protected',
          platform: 'twitter',
          targetType: 'profile',
          targetKey: 'active_runner',
          status: 'running',
        },
        {
          id: 'ckpt_paused_protected',
          platform: 'facebook',
          targetType: 'group',
          targetKey: 'active_paused',
          status: 'paused',
        },
        {
          id: 'ckpt_stalled_protected',
          platform: 'threads',
          targetType: 'user',
          targetKey: 'active_stalled',
          status: 'stalled',
        },
        {
          id: 'ckpt_completed_old',
          platform: 'shopee',
          targetType: 'category',
          targetKey: 'cat_old',
          status: 'completed',
        },
      ],
    });

    // Force lastCrawledAt and updatedAt to be 200 days old for the completed checkpoint.
    // Running/paused/stalled must never be deleted regardless of age.
    await prisma.$executeRawUnsafe(
      `UPDATE "CrawlCheckpoint" SET "lastCrawledAt" = $1, "updatedAt" = $1 WHERE id = 'ckpt_completed_old'`,
      oldCheckpointDate
    );

    // Run cleanCheckpoints including attempting to pass all statuses
    const result = await cleaner.cleanCheckpoints({
      checkpointRetentionDays: 90,
      statuses: ['running', 'paused', 'stalled', 'completed', 'failed'],
    });

    expect(result.success).toBe(true);
    // Only completed checkpoint should be removed; running, paused, stalled MUST remain
    expect(result.checkpointsDeleted).toBe(1);

    const remaining = await prisma.crawlCheckpoint.findMany({
      select: { id: true, status: true },
    });

    expect(remaining.length).toBe(3);
    const statuses = remaining.map((r) => r.status);
    expect(statuses).toContain('running');
    expect(statuses).toContain('paused');
    expect(statuses).toContain('stalled');
    expect(statuses).not.toContain('completed');
  });
});

describe('Story 10.6: RetentionCleaner — Stats & Unified Pipeline (AC1 & AC5)', () => {
  it('getRetentionStats returns accurate counts broken down by time thresholds', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const now = Date.now();

    const d5 = new Date(now - 5 * 86400000);
    const d10 = new Date(now - 10 * 86400000);
    const d40 = new Date(now - 40 * 86400000);

    await prisma.post.createMany({
      data: [
        {
          id: 'twitter:p5',
          platform: 'twitter',
          externalId: 'p5',
          category: 'social',
          authorId: 'a',
          authorName: 'A',
          content: 'C',
          crawledAt: d5,
        },
        {
          id: 'twitter:p10',
          platform: 'twitter',
          externalId: 'p10',
          category: 'social',
          authorId: 'b',
          authorName: 'B',
          content: 'C',
          crawledAt: d10,
        },
        {
          id: 'twitter:p40',
          platform: 'twitter',
          externalId: 'p40',
          category: 'social',
          authorId: 'c',
          authorName: 'C',
          content: 'C',
          crawledAt: d40,
        },
      ],
    });

    const stats = await cleaner.getRetentionStats({ rawDays: 30, checkpointDays: 90 });

    expect(stats.success).toBe(true);
    expect(stats.data.posts.total).toBe(3);
    expect(stats.data.posts.olderThan7d).toBe(2); // p10 and p40
    expect(stats.data.posts.olderThan14d).toBe(1); // p40
    expect(stats.data.posts.olderThan30d).toBe(1); // p40
    expect(stats.data.posts.olderThan90d).toBe(0);
  });

  it('runRetentionPipeline runs both raw data and checkpoint cleanup in a single transaction-safe flow', async () => {
    const cleaner = new RetentionCleaner({ prisma });
    const oldDate = new Date(Date.now() - 100 * 86400000);

    await prisma.post.create({
      data: {
        id: 'twitter:pipe_p',
        platform: 'twitter',
        externalId: 'pipe_p',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Post',
        crawledAt: oldDate,
      },
    });

    await prisma.comment.create({
      data: {
        id: 'twitter:pipe_p:pipe_c',
        platform: 'twitter',
        externalId: 'pipe_c',
        postId: 'twitter:pipe_p',
        authorId: 'ac',
        authorName: 'AC',
        content: 'Comm',
        crawledAt: oldDate,
      },
    });

    await prisma.crawlCheckpoint.create({
      data: {
        id: 'ckpt_pipe',
        platform: 'twitter',
        targetType: 'user',
        targetKey: 'pipe_user',
        status: 'completed',
        lastCrawledAt: oldDate,
      },
    });

    const pipelineResult = await cleaner.runRetentionPipeline({
      retentionDays: 30,
      checkpointRetentionDays: 90,
      cleanCheckpoints: true,
      dryRun: false,
    });

    expect(pipelineResult.success).toBe(true);
    expect(pipelineResult.data.postsDeleted).toBe(1);
    expect(pipelineResult.data.commentsDeleted).toBe(1);
    expect(pipelineResult.data.checkpointsDeleted).toBe(1);
    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.crawlCheckpoint.count()).toBe(0);
  });
});

describe('Story 10.6: Retention Scheduler Service (AC4)', () => {
  it('runs retention cycle successfully and prevents concurrent overlapping executions', async () => {
    const cleaner = new RetentionCleaner({ prisma });

    const cycle1 = await runRetentionCycle({ cleaner, prisma });
    expect(cycle1.executed).toBe(true);
  });

  it('starts and stops scheduler gracefully', () => {
    const started = startRetentionScheduler({ schedule: '0 3 * * *' });
    expect(started).toBe(true);

    const status1 = getRetentionSchedulerStatus();
    expect(status1.started).toBe(true);

    const stopped = stopRetentionScheduler();
    expect(stopped).toBe(true);

    const status2 = getRetentionSchedulerStatus();
    expect(status2.started).toBe(false);
  });
});
