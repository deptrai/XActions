// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin checkpoints & checkpoint command group (Story 19.4.4)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';
import prisma from '../../api/lib/prisma.js';
import { getCheckpoint } from '../../src/store/checkpoint-manager.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('Story 19.4.4: xactions admin checkpoints management', () => {
  let testCheckpointId = 'cp_cli_test_19_4_4';

  beforeEach(async () => {
    // Upsert a test checkpoint in prisma
    await prisma.crawlCheckpoint.upsert({
      where: { id: testCheckpointId },
      create: {
        id: testCheckpointId,
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'test_user_cp',
        status: 'running',
      },
      update: {
        status: 'running',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.crawlCheckpoint.deleteMany({
        where: { id: testCheckpointId },
      });
    } catch {}
  });

  it('admin checkpoints --help lists list, resume, pause, and retry subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    expect(checkpointsCmd).toBeDefined();

    const help = stripAnsi(checkpointsCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('resume');
    expect(help).toContain('pause');
    expect(help).toContain('retry');
  });

  it('admin checkpoint alias --help lists list, resume, pause, and retry subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const checkpointCmd = adminCmd.commands.find((c) => c.name() === 'checkpoint');
    expect(checkpointCmd).toBeDefined();

    const help = stripAnsi(checkpointCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('resume');
    expect(help).toContain('pause');
    expect(help).toContain('retry');
  });

  it('resume subcommand exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const resumeCmd = checkpointsCmd.commands.find((c) => c.name() === 'resume');
    expect(resumeCmd).toBeDefined();

    const help = stripAnsi(resumeCmd.helpInformation());
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('pause subcommand exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const pauseCmd = checkpointsCmd.commands.find((c) => c.name() === 'pause');
    expect(pauseCmd).toBeDefined();

    const help = stripAnsi(pauseCmd.helpInformation());
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('retry subcommand exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const retryCmd = checkpointsCmd.commands.find((c) => c.name() === 'retry');
    expect(retryCmd).toBeDefined();

    const help = stripAnsi(retryCmd.helpInformation());
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('executes in-process pause fallback on a running checkpoint', async () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const pauseCmd = checkpointsCmd.commands.find((c) => c.name() === 'pause');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await pauseCmd.parseAsync(['node', 'test', testCheckpointId]);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain(`Checkpoint paused: ${testCheckpointId}`);
    expect(output).toContain('Status: paused');

    const updated = await getCheckpoint(testCheckpointId, { prisma });
    expect(updated.status).toBe('paused');
  });

  it('executes in-process resume fallback on a paused checkpoint', async () => {
    // First pause it
    await prisma.crawlCheckpoint.update({
      where: { id: testCheckpointId },
      data: { status: 'paused' },
    });

    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const resumeCmd = checkpointsCmd.commands.find((c) => c.name() === 'resume');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await resumeCmd.parseAsync(['node', 'test', testCheckpointId]);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain(`Checkpoint resumed: ${testCheckpointId}`);
    expect(output).toContain('Status: running');

    const updated = await getCheckpoint(testCheckpointId, { prisma });
    expect(updated.status).toBe('running');
  });

  it('executes in-process retry fallback on a failed checkpoint', async () => {
    // Set to failed
    await prisma.crawlCheckpoint.update({
      where: { id: testCheckpointId },
      data: { status: 'failed' },
    });

    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const retryCmd = checkpointsCmd.commands.find((c) => c.name() === 'retry');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await retryCmd.parseAsync(['node', 'test', testCheckpointId]);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain(`Checkpoint retried: ${testCheckpointId}`);
    expect(output).toContain('Status: running');

    const updated = await getCheckpoint(testCheckpointId, { prisma });
    expect(updated.status).toBe('running');
  });

  it('supports --json output for pause, resume, and retry', async () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const pauseCmd = checkpointsCmd.commands.find((c) => c.name() === 'pause');

    let logs = [];
    let originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await pauseCmd.parseAsync(['node', 'test', testCheckpointId, '--json']);
    } finally {
      console.log = originalLog;
    }

    const pJson = JSON.parse(logs.join('\n'));
    expect(pJson.success).toBe(true);
    expect(pJson.data?.checkpoint?.status).toBe('paused');
  });
});
