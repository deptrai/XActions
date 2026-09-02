// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * E2E CLI Tests — Story 10.6: xactions retention CLI.
 * Spawns the real `xactions retention` binary and asserts stdout + DB state.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';

const execFileAsync = promisify(execFile);

const CLI = new URL('../../src/cli/index.js', import.meta.url).pathname;

function runCli(args) {
  return execFileAsync('node', [CLI, 'retention', ...args], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://luisphan@localhost:5432/xactions_test?schema=public',
    },
    timeout: 30000,
  });
}

describe('E2E CLI: xactions retention (Story 10.6)', () => {
  beforeAll(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  it('status --json returns retention statistics', async () => {
    const { stdout, stderr } = await runCli(['status', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.posts).toBeDefined();
    expect(parsed.data.comments).toBeDefined();
    expect(parsed.data.checkpoints).toBeDefined();
    expect(stderr).toBe('');
  });

  it('run --dry-run --json returns eligible counts without deleting', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_cli_1',
        platform: 'twitter',
        externalId: 'ret_cli_1',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const { stdout } = await runCli(['run', '--days', '30', '--dry-run', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.postsEligible).toBe(1);
    expect(parsed.data.commentsEligible).toBe(0);
    expect(parsed.data.checkpointsEligible).toBe(0);
    expect(await prisma.post.count()).toBe(1);
  });

  it('run --days 30 --json deletes expired records', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_cli_2',
        platform: 'twitter',
        externalId: 'ret_cli_2',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const { stdout } = await runCli(['run', '--days', '30', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.dryRun).toBe(false);
    expect(parsed.data.postsDeleted).toBe(1);
    expect(await prisma.post.count()).toBe(0);
  });

  it('run --platform <invalid> --json fails with validation error and exit code 1', async () => {
    let error;
    try {
      await runCli(['run', '--platform', 'twiter', '--json']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    const parsed = JSON.parse(error.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.error.message).toContain('Unsupported platform filter');
    expect(error.code).toBeGreaterThan(0);
  });

  it('run with negative --days fails with validation error', async () => {
    let error;
    try {
      await runCli(['run', '--days', '-5', '--json']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    const parsed = JSON.parse(error.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.error.message).toContain('days must be a positive integer');
  });

  it('run --no-checkpoints --json skips checkpoint cleanup', async () => {
    const oldDate = new Date(Date.now() - 95 * 86400000);
    await prisma.crawlCheckpoint.create({
      data: {
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'ret_cli_ckpt_1',
        status: 'completed',
        lastCrawledAt: oldDate,
      },
    });

    const { stdout } = await runCli(['run', '--days', '30', '--no-checkpoints', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.checkpointsDeleted).toBe(0);
    expect(await prisma.crawlCheckpoint.count()).toBe(1);
  });

  it('run --checkpoint-days 30 --json purges old checkpoints', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.crawlCheckpoint.create({
      data: {
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'ret_cli_ckpt_2',
        status: 'completed',
        lastCrawledAt: oldDate,
      },
    });

    const { stdout } = await runCli(['run', '--days', '90', '--checkpoint-days', '30', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.checkpointsDeleted).toBe(1);
    expect(await prisma.crawlCheckpoint.count()).toBe(0);
  });

  it('status --platform facebook --json filters by platform', async () => {
    await prisma.post.create({
      data: {
        id: 'facebook:ret_cli_3',
        platform: 'facebook',
        externalId: 'ret_cli_3',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Facebook post',
        crawledAt: new Date(),
      },
    });
    await prisma.post.create({
      data: {
        id: 'twitter:ret_cli_4',
        platform: 'twitter',
        externalId: 'ret_cli_4',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Twitter post',
        crawledAt: new Date(),
      },
    });

    const { stdout } = await runCli(['status', '--platform', 'facebook', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data.posts.total).toBe(1);
  });
});
