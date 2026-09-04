// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin proxies & proxy command group (Story 19.4.2)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';
import { globalProxyPool } from '../../src/proxy/proxy-pool.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('Story 19.4.2: xactions admin proxies management', () => {
  beforeEach(() => {
    // Ensure test proxies exist in globalProxyPool
    globalProxyPool.add('http://1.1.1.1:8080');
    globalProxyPool.add('http://2.2.2.2:8080');
    // Release any lingering quarantine state
    try {
      globalProxyPool.release('http://1.1.1.1:8080');
      globalProxyPool.release('http://2.2.2.2:8080');
    } catch {}
  });

  it('admin proxies --help lists list, quarantine, and release subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    expect(proxiesCmd).toBeDefined();

    const help = stripAnsi(proxiesCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('quarantine');
    expect(help).toContain('release');
  });

  it('admin proxy alias --help lists list, quarantine, and release subcommands', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    expect(adminCmd).toBeDefined();

    const proxyCmd = adminCmd.commands.find((c) => c.name() === 'proxy');
    expect(proxyCmd).toBeDefined();

    const help = stripAnsi(proxyCmd.helpInformation());
    expect(help).toContain('list');
    expect(help).toContain('quarantine');
    expect(help).toContain('release');
  });

  it('quarantine subcommand exposes --duration, --reason, and --json options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const quarantineCmd = proxiesCmd.commands.find((c) => c.name() === 'quarantine');
    expect(quarantineCmd).toBeDefined();

    const help = stripAnsi(quarantineCmd.helpInformation());
    expect(help).toContain('--duration');
    expect(help).toContain('--reason');
    expect(help).toContain('--json');
    expect(help).toContain('--url');
    expect(help).toContain('--token');
  });

  it('release subcommand exposes --json, --url, and --token options', () => {
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const releaseCmd = proxiesCmd.commands.find((c) => c.name() === 'release');
    expect(releaseCmd).toBeDefined();

    const help = stripAnsi(releaseCmd.helpInformation());
    expect(help).toContain('--json');
    expect(help).toContain('--url');
    expect(help).toContain('--token');
  });

  it('executes in-process quarantine fallback and updates proxy status', async () => {
    const testProxy = 'http://1.1.1.1:8080';
    const program = new Command();
    registerAdminCommand(program);

    // Call CLI action directly
    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const quarantineCmd = proxiesCmd.commands.find((c) => c.name() === 'quarantine');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await quarantineCmd.parseAsync(['node', 'test', testProxy, '--reason', 'High rate limit errors']);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('Proxy quarantined: http://1.1.1.1:8080');
    expect(output).toContain('Reason: High rate limit errors');

    // Verify in globalProxyPool that status is quarantined
    const poolList = globalProxyPool.listProxies();
    const found = poolList.find((p) => p.key === testProxy);
    expect(found).toBeDefined();
    expect(found.status).toBe('quarantined');
  });

  it('executes in-process release fallback and restores healthy status', async () => {
    const testProxy = 'http://1.1.1.1:8080';
    globalProxyPool.quarantine(testProxy, 60000);

    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const releaseCmd = proxiesCmd.commands.find((c) => c.name() === 'release');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await releaseCmd.parseAsync(['node', 'test', testProxy]);
    } finally {
      console.log = originalLog;
    }

    const output = stripAnsi(logs.join('\n'));
    expect(output).toContain('Proxy released from quarantine: http://1.1.1.1:8080');

    // Verify in globalProxyPool that status is healthy
    const poolList = globalProxyPool.listProxies();
    const found = poolList.find((p) => p.key === testProxy);
    expect(found).toBeDefined();
    expect(found.status).toBe('healthy');
  });

  it('supports --json output for quarantine and release', async () => {
    const testProxy = 'http://2.2.2.2:8080';
    const program = new Command();
    registerAdminCommand(program);

    const adminCmd = program.commands.find((c) => c.name() === 'admin');
    const proxiesCmd = adminCmd.commands.find((c) => c.name() === 'proxies');
    const quarantineCmd = proxiesCmd.commands.find((c) => c.name() === 'quarantine');
    const releaseCmd = proxiesCmd.commands.find((c) => c.name() === 'release');

    // Test quarantine --json
    let logs = [];
    let originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await quarantineCmd.parseAsync(['node', 'test', testProxy, '--json']);
    } finally {
      console.log = originalLog;
    }

    const qJson = JSON.parse(logs.join('\n'));
    expect(qJson.success).toBe(true);
    expect(qJson.quarantined).toBe(testProxy);

    // Test release --json
    logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    try {
      await releaseCmd.parseAsync(['node', 'test', testProxy, '--json']);
    } finally {
      console.log = originalLog;
    }

    const rJson = JSON.parse(logs.join('\n'));
    expect(rJson.success).toBe(true);
    expect(rJson.released).toBe(true);
    expect(rJson.proxy).toBe(testProxy);
  });
});
