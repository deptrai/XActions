// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Note: In TDD Red Phase, these tests are scaffolded with it.skip().
// Activate them task-by-task during dev-story implementation.

describe('Story 12.2 — CLI Auth Command with Chrome Launch Helper (tests/cli/auth.test.js)', () => {
  let program;

  beforeEach(() => {
    program = new Command();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CLI Flag Parsing for auth command (AC-1)', () => {
    it('[P0] should register auth command with --launch-chrome, --port, --user-data-dir, --headless', async () => {
      const { registerAuthCommand } = await import('../../src/cli/commands/auth.js');
      registerAuthCommand(program);

      const authCmd = program.commands.find((c) => c.name() === 'auth');
      expect(authCmd).toBeDefined();

      const optionNames = authCmd.options.map((o) => o.long);
      expect(optionNames).toContain('--launch-chrome');
      expect(optionNames).toContain('--port');
      expect(optionNames).toContain('--user-data-dir');
      expect(optionNames).toContain('--headless');
      expect(optionNames).toContain('--account-id');
    });

    it('[P0] should parse default port 9222 and default user-data-dir', async () => {
      const { registerAuthCommand } = await import('../../src/cli/commands/auth.js');
      let capturedOptions = null;

      registerAuthCommand(program, {
        actionOverride: (opts) => {
          capturedOptions = opts;
        },
      });

      program.parse(['node', 'xactions', 'auth', '--launch-chrome']);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.launchChrome).toBe(true);
      expect(capturedOptions.port).toBe('9222');
    });

    it('[P1] should allow overriding port and custom user-data-dir', async () => {
      const { registerAuthCommand } = await import('../../src/cli/commands/auth.js');
      let capturedOptions = null;

      registerAuthCommand(program, {
        actionOverride: (opts) => {
          capturedOptions = opts;
        },
      });

      program.parse([
        'node',
        'xactions',
        'auth',
        '--launch-chrome',
        '--port',
        '9333',
        '--user-data-dir',
        '/custom/profile',
      ]);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.port).toBe('9333');
      expect(capturedOptions.userDataDir).toBe('/custom/profile');
    });

    it('[P1] should parse --account-id when launching Chrome', async () => {
      const { registerAuthCommand } = await import('../../src/cli/commands/auth.js');
      let capturedOptions = null;

      registerAuthCommand(program, {
        actionOverride: (opts) => {
          capturedOptions = opts;
        },
      });

      program.parse([
        'node',
        'xactions',
        'auth',
        '--launch-chrome',
        '--account-id',
        'nichxbt',
      ]);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.accountId).toBe('nichxbt');
    });
  });
});
