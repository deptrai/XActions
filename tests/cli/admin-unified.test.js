// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin unified command group (Story 19.4)
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

describe('Story 19.4: xactions admin unified command group', () => {
  it('registers admin command group on the program', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();
  });

  it('admin --help lists all planned subcommands: status, stream, proxies, accounts, checkpoints', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const help = adminCmd.helpInformation();
    const plain = stripAnsi(help);

    expect(plain).toContain('status');
    expect(plain).toContain('stream');
    expect(plain).toContain('proxies');
    expect(plain).toContain('accounts');
    expect(plain).toContain('checkpoints');
  });

  it('proxies subcommand exposes its own --help with a list action', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    expect(proxiesCmd).toBeDefined();

    const listCmd = proxiesCmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();

    const help = proxiesCmd.helpInformation();
    const plain = stripAnsi(help);
    expect(plain).toContain('list');
  });

  it('accounts subcommand exposes its own --help with a list action', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    expect(accountsCmd).toBeDefined();

    const listCmd = accountsCmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();

    const help = accountsCmd.helpInformation();
    const plain = stripAnsi(help);
    expect(plain).toContain('list');
  });

  it('checkpoints subcommand exposes its own --help with a list action', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    expect(checkpointsCmd).toBeDefined();

    const listCmd = checkpointsCmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();

    const help = checkpointsCmd.helpInformation();
    const plain = stripAnsi(help);
    expect(plain).toContain('list');
  });

  it('proxies list exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const listCmd = proxiesCmd.commands.find((c) => c.name() === 'list');

    const optionNames = listCmd.options.map((o) => o.name());
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('token');
    expect(optionNames).toContain('json');
  });

  it('accounts list exposes --url, --token, --platform, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const accountsCmd = adminCmd.commands.find((c) => c.name() === 'accounts');
    const listCmd = accountsCmd.commands.find((c) => c.name() === 'list');

    const optionNames = listCmd.options.map((o) => o.name());
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('token');
    expect(optionNames).toContain('platform');
    expect(optionNames).toContain('json');
  });

  it('checkpoints list exposes --url, --token, --platform, --target-type, --status, --limit, --offset, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const checkpointsCmd = adminCmd.commands.find((c) => c.name() === 'checkpoints');
    const listCmd = checkpointsCmd.commands.find((c) => c.name() === 'list');

    const optionNames = listCmd.options.map((o) => o.name());
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('token');
    expect(optionNames).toContain('platform');
    expect(optionNames).toContain('target-type');
    expect(optionNames).toContain('status');
    expect(optionNames).toContain('limit');
    expect(optionNames).toContain('offset');
    expect(optionNames).toContain('json');
  });

  it('existing admin status command is preserved and reachable', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const statusCmd = adminCmd.commands.find((c) => c.name() === 'status');
    expect(statusCmd).toBeDefined();

    const optionNames = statusCmd.options.map((o) => o.name());
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('token');
    expect(optionNames).toContain('json');
  });

  it('existing admin stream metrics/alerts commands are preserved and reachable', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const streamCmd = adminCmd.commands.find((c) => c.name() === 'stream');
    expect(streamCmd).toBeDefined();

    const metricsCmd = streamCmd.commands.find((c) => c.name() === 'metrics');
    const alertsCmd = streamCmd.commands.find((c) => c.name() === 'alerts');
    expect(metricsCmd).toBeDefined();
    expect(alertsCmd).toBeDefined();
  });
});
