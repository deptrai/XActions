// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin status command (Story 19.4.1)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';
import { printGovernorStatus } from '../../src/cli/shared.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\[[0-9;]*m/g, '');
}

describe('Story 19.4.1: xactions admin status', () => {
  it('registers admin status subcommand under the admin group', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const statusSubCmd = adminCmd.commands.find((c) => c.name() === 'status');
    expect(statusSubCmd).toBeDefined();
  });

  it('status subcommand exposes --url, --token, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const statusSubCmd = adminCmd.commands.find((c) => c.name() === 'status');

    const optionNames = statusSubCmd.options.map((o) => o.name());
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('token');
    expect(optionNames).toContain('json');
  });

  it('printGovernorStatus outputs raw JSON with all GovernorStatus fields when json=true', () => {
    const status = {
      healthyProxyCount: 5,
      totalProxyCount: 10,
      healthyProxyRatio: 0.5,
      currentReqPerSecond: 42,
      redisConsumerLag: 1234,
      hibernatingAccounts: [{ accountId: 'foo', remainingSeconds: 99, reason: 'rate_limit' }],
      throttleLevel: 'normal',
      dualPool: {
        realtime: { total: 6, healthy: 3, quarantined: 1 },
        bulk: { total: 4, healthy: 2, quarantined: 1 },
        yieldedCount: 0,
      },
      consumerQuotas: {},
    };

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      printGovernorStatus(status, { json: true });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.healthyProxyCount).toBe(5);
    expect(parsed.totalProxyCount).toBe(10);
    expect(parsed.throttleLevel).toBe('normal');
    expect(parsed.hibernatingAccounts).toHaveLength(1);
    expect(parsed.hibernatingAccounts[0].accountId).toBe('foo');
  });

  it('printGovernorStatus prints human-readable terminal summary when json=false', () => {
    const status = {
      healthyProxyCount: 5,
      totalProxyCount: 10,
      healthyProxyRatio: 0.5,
      currentReqPerSecond: 42,
      redisConsumerLag: 1234,
      hibernatingAccounts: [{ accountId: 'foo', remainingSeconds: 99, reason: 'rate_limit' }],
      throttleLevel: 'normal',
      dualPool: null,
      consumerQuotas: {},
    };

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      printGovernorStatus(status, { json: false });
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('XActions System & Governor Status');
    expect(output).toContain('normal');
    expect(output).toContain('5 / 10');
    expect(output).toContain('42');
    expect(output).toContain('foo');
    expect(output).toContain('rate_limit');
  });

  it('printGovernorStatus prints "No accounts hibernating" when hibernatingAccounts is empty', () => {
    const status = {
      healthyProxyCount: 0,
      totalProxyCount: 0,
      healthyProxyRatio: 0,
      currentReqPerSecond: 0,
      redisConsumerLag: 0,
      hibernatingAccounts: [],
      throttleLevel: 'normal',
      dualPool: null,
      consumerQuotas: {},
    };

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      printGovernorStatus(status, { json: false });
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('Hibernating Accounts: 0');
  });
});
