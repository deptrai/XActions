// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin accounts & account command group (Story 19.4.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';
import { globalAccountPool } from '../../src/core/account-pool.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('Story 19.4.3: xactions admin accounts management', () => {
  beforeEach(() => {
    // Add test accounts
    globalAccountPool.registerAccounts('twitter', ['test_acc_01', 'test_acc_02']);
    // Ensure test accounts are active
    globalAccountPool.markAvailable('test_acc_01', 'twitter');
    globalAccountPool.markAvailable('test_acc_02', 'twitter');
  });

  it('admin accounts --help lists list, wake, and rotate subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    expect(accountsCmd).toBeDefined();

    const help = stripAnsi(accountsCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('wake');
    expect(help).toContain('rotate');
  });

  it('admin account alias --help lists list, wake, and rotate subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const accountCmd = adminCmd.commands.find((c) => c.name() === 'account');
    expect(accountCmd).toBeDefined();

    const help = stripAnsi(accountCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('wake');
    expect(help).toContain('rotate');
  });

  it('wake subcommand exposes --platform, --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const wakeCmd = accountsCmd.commands.find((c) => c.name() === 'wake');
    expect(wakeCmd).toBeDefined();

    const help = stripAnsi(wakeCmd.helpInformation());
    expect(help).toContain('--platform');
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('rotate subcommand exposes --platform, --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const rotateCmd = accountsCmd.commands.find((c) => c.name() === 'rotate');
    expect(rotateCmd).toBeDefined();

    const help = stripAnsi(rotateCmd.helpInformation());
    expect(help).toContain('--platform');
    expect(help).toContain('--url');
    expect(help).toContain('--token');
    expect(help).toContain('--json');
  });

  it('executes in-process wake fallback for a hibernating account', async () => {
    // Put test_acc_01 into hibernation
    globalAccountPool.markUnavailable('test_acc_01', 'twitter', 60000);

    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const wakeCmd = accountsCmd.commands.find((c) => c.name() === 'wake');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await wakeCmd.parseAsync(['node', 'test', 'test_acc_01', '--platform', 'twitter']);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('Account awakened: test_acc_01');

    // Verify account is now available
    const account = globalAccountPool.getAccount('test_acc_01', 'twitter');
    expect(account.hibernatingUntil).toBeNull();
  });

  it('warns when waking an account that is not in hibernation', async () => {
    // test_acc_02 is active
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const wakeCmd = accountsCmd.commands.find((c) => c.name() === 'wake');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await wakeCmd.parseAsync(['node', 'test', 'test_acc_02', '--platform', 'twitter']);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('is not currently in hibernation');
  });

  it('executes in-process rotate fallback and returns next available account', async () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const rotateCmd = accountsCmd.commands.find((c) => c.name() === 'rotate');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await rotateCmd.parseAsync(['node', 'test', 'test_acc_01', 'twitter']);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('Account rotated:');
    expect(output).toContain('Previous: test_acc_01');
    expect(output).toContain('Next:');
  });

  it('supports --json output for wake and rotate', async () => {
    globalAccountPool.markUnavailable('test_acc_01', 'twitter', 60000);

    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const wakeCmd = accountsCmd.commands.find((c) => c.name() === 'wake');
    const rotateCmd = accountsCmd.commands.find((c) => c.name() === 'rotate');

    // Wake JSON
    let logs = [];
    let originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await wakeCmd.parseAsync(['node', 'test', 'test_acc_01', '--platform', 'twitter', '--json']);
    } finally {
      console.log = originalLog;
    }

    const wJson = JSON.parse(logs.join('\n'));
    expect(wJson.success).toBe(true);
    expect(wJson.accountId).toBe('test_acc_01');
    expect(wJson.status).toBe('active');

    // Rotate JSON
    logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await rotateCmd.parseAsync(['node', 'test', 'test_acc_01', 'twitter', '--json']);
    } finally {
      console.log = originalLog;
    }

    const rJson = JSON.parse(logs.join('\n'));
    expect(rJson.success).toBe(true);
    expect(rJson.previousAccountId).toBe('test_acc_01');
    expect(rJson.nextAccountId).toBeDefined();
    expect(rJson.platform).toBe('twitter');
  });
});
