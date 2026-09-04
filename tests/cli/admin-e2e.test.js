// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * E2E CLI Tests — Story 19.4: xactions admin unified command group.
 * Spawns the real `xactions admin` binary and asserts stdout.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI = new URL('../../src/cli/index.js', import.meta.url).pathname;

function runAdmin(args) {
  return execFileAsync('node', [CLI, 'admin', ...args], {
    env: { ...process.env },
    timeout: 30000,
  });
}

describe('E2E CLI: xactions admin (Story 19.4)', () => {
  it('proxies list --json returns a success envelope from the in-process pool', async () => {
    const { stdout, stderr } = await runAdmin(['proxies', 'list', '--json']);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.proxies)).toBe(true);
    expect(typeof parsed.totalCount).toBe('number');
    expect(typeof parsed.healthyCount).toBe('number');
  });

  it('accounts list --json returns a success envelope from the in-process pool', async () => {
    const { stdout, stderr } = await runAdmin(['accounts', 'list', '--json']);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.accounts)).toBe(true);
    expect(typeof parsed.total).toBe('number');
  });

  it('accounts list --platform twitter --json filters accounts by platform', async () => {
    const { stdout, stderr } = await runAdmin(['accounts', 'list', '--platform', 'twitter', '--json']);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.accounts)).toBe(true);
    parsed.accounts.forEach((a) => {
      expect(a.platform).toBe('twitter');
    });
  });

  it('checkpoints list --json returns a success envelope from the in-process pool', async () => {
    const { stdout, stderr } = await runAdmin(['checkpoints', 'list', '--json']);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(Array.isArray(parsed.data.checkpoints)).toBe(true);
    expect(typeof parsed.data.total).toBe('number');
    expect(typeof parsed.data.limit).toBe('number');
    expect(typeof parsed.data.offset).toBe('number');
  });

  it('checkpoints list rejects invalid limit with JSON error envelope', async () => {
    try {
      await runAdmin(['checkpoints', 'list', '--limit', '-5', '--json']);
      expect.fail('should have exited non-zero');
    } catch (err) {
      const stdout = String(err.stdout || '');
      const parsed = JSON.parse(stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('limit must be a positive integer');
    }
  });

  it('checkpoints list rejects invalid offset with JSON error envelope', async () => {
    try {
      await runAdmin(['checkpoints', 'list', '--offset', '-1', '--json']);
      expect.fail('should have exited non-zero');
    } catch (err) {
      const stdout = String(err.stdout || '');
      const parsed = JSON.parse(stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('offset must be a non-negative integer');
    }
  });

  it('admin --help lists all planned subcommands', async () => {
    const { stdout, stderr } = await runAdmin(['--help']);
    expect(stderr).toBe('');
    expect(stdout).toContain('status');
    expect(stdout).toContain('stream');
    expect(stdout).toContain('proxies');
    expect(stdout).toContain('accounts');
    expect(stdout).toContain('checkpoints');
  });

  it('admin proxies --help lists the list action', async () => {
    const { stdout, stderr } = await runAdmin(['proxies', '--help']);
    expect(stderr).toBe('');
    expect(stdout).toContain('list');
  });
});
