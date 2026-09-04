// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin stream metrics/alerts/test CLI commands (Stories 14.3 & 19.4.5)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('Story 14.3 & 19.4.5: CLI xactions admin stream commands', () => {
  it('registers admin stream command tree with metrics, alerts, and test subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const streamCmd = adminCmd.commands.find((c) => c.name() === 'stream');
    expect(streamCmd).toBeDefined();

    const metricsSubCmd = streamCmd.commands.find((c) => c.name() === 'metrics');
    expect(metricsSubCmd).toBeDefined();

    const alertsSubCmd = streamCmd.commands.find((c) => c.name() === 'alerts');
    expect(alertsSubCmd).toBeDefined();

    const testSubCmd = streamCmd.commands.find((c) => c.name() === 'test');
    expect(testSubCmd).toBeDefined();
  });

  it('admin stream --help lists metrics, alerts, and test subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const streamCmd = adminCmd.commands.find((c) => c.name() === 'stream');
    expect(streamCmd).toBeDefined();

    const help = stripAnsi(streamCmd.helpInformation());
    expect(help).toContain('metrics');
    expect(help).toContain('alerts');
    expect(help).toContain('test');
  });

  it('stream test subcommand exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const streamCmd = adminCmd.commands.find((c) => c.name() === 'stream');
    const testCmd = streamCmd.commands.find((c) => c.name() === 'test');
    expect(testCmd).toBeDefined();

    const help = stripAnsi(testCmd.helpInformation());
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('executes in-process stream test fallback and returns delivery fields', async () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const streamCmd = adminCmd.commands.find((c) => c.name() === 'stream');
    const testCmd = streamCmd.commands.find((c) => c.name() === 'test');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await testCmd.parseAsync(['node', 'test', '--json']);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    const json = JSON.parse(output);
    expect(json.success).toBe(true);
    expect(json.message).toBe('Test alert sent');
    expect(json.result).toBeDefined();
    const delivered = json.result.delivered || json.result;
    expect(typeof delivered.webhook).toBe('boolean');
    expect(typeof delivered.email).toBe('boolean');
  });
});
