// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E CLI Tests — Story 10.4: CrawlCheckpoint Operational CLI.
 * Spawns the real `xactions checkpoints` binary and asserts stdout + DB state.
 * by nichxbt
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../store/test-prisma-client.js';

const execFileAsync = promisify(execFile);

const CLI = new URL('../../src/cli/index.js', import.meta.url).pathname;

function runCli(args) {
  return execFileAsync('node', [CLI, 'checkpoints', ...args], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://luisphan@localhost:5432/xactions_test?schema=public',
    },
    timeout: 30000,
  });
}

let checkpointCounter = 0;
async function seedCheckpoint(overrides = {}) {
  checkpointCounter += 1;
  return prisma.crawlCheckpoint.create({
    data: {
      platform: 'twitter',
      targetType: 'profile',
      targetKey: `cli_e2e_${checkpointCounter}`,
      status: 'running',
      errorCount: 0,
      ...overrides,
    },
  });
}

async function cleanupCheckpoints() {
  await prisma.crawlCheckpoint.deleteMany({
    where: { targetKey: { startsWith: 'cli_e2e_' } },
  });
}

describe('E2E CLI: xactions checkpoints (Story 10.4)', () => {
  beforeAll(async () => {
    await cleanupCheckpoints();
  });

  afterAll(async () => {
    await cleanupCheckpoints();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupCheckpoints();
    checkpointCounter = 0;
  });

  it('list --json returns an empty array when no checkpoints exist', async () => {
    const { stdout, stderr } = await runCli(['list', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.checkpoints).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(stderr).toBe('');
  });

  it('list --json returns seeded checkpoints with filter', async () => {
    await seedCheckpoint({ platform: 'twitter', status: 'running' });
    await seedCheckpoint({ platform: 'facebook', status: 'paused' });

    const { stdout } = await runCli(['list', '--platform', 'twitter', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.checkpoints).toHaveLength(1);
    expect(parsed.checkpoints[0].platform).toBe('twitter');
    expect(parsed.total).toBe(1);
  });

  it('list --json fails with invalid limit', async () => {
    await expect(runCli(['list', '--limit', 'abc', '--json'])).rejects.toThrow();
  });

  it('show <id> --json returns checkpoint details', async () => {
    const checkpoint = await seedCheckpoint({ status: 'running' });
    const { stdout } = await runCli(['show', checkpoint.id, '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.id).toBe(checkpoint.id);
    expect(parsed.status).toBe('running');
  });

  it('show <id> --json returns error envelope for unknown id', async () => {
    let error;
    try {
      await runCli(['show', 'non_existent_cuid_999', '--json']);
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    const parsed = JSON.parse(error.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('XACT_4041');
  });

  it('resume <id> transitions paused checkpoint to running', async () => {
    const checkpoint = await seedCheckpoint({ status: 'paused' });
    const { stdout } = await runCli(['resume', checkpoint.id, '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('running');

    const refreshed = await prisma.crawlCheckpoint.findUnique({ where: { id: checkpoint.id } });
    expect(refreshed.status).toBe('running');
    expect(refreshed.nextScheduledAt).not.toBeNull();
  });

  it('pause <id> transitions running checkpoint to paused and clears schedule', async () => {
    const checkpoint = await seedCheckpoint({ status: 'running', nextScheduledAt: new Date() });
    const { stdout } = await runCli(['pause', checkpoint.id, '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('paused');
    expect(parsed.nextScheduledAt).toBeNull();

    const refreshed = await prisma.crawlCheckpoint.findUnique({ where: { id: checkpoint.id } });
    expect(refreshed.status).toBe('paused');
    expect(refreshed.nextScheduledAt).toBeNull();
  });

  it('retry <id> resets errorCount and transitions to running', async () => {
    const checkpoint = await seedCheckpoint({ status: 'failed', errorCount: 5 });
    const { stdout } = await runCli(['retry', checkpoint.id, '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('running');
    expect(parsed.errorCount).toBe(0);

    const refreshed = await prisma.crawlCheckpoint.findUnique({ where: { id: checkpoint.id } });
    expect(refreshed.status).toBe('running');
    expect(refreshed.errorCount).toBe(0);
  });
});
