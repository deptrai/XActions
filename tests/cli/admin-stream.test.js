// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for xactions admin stream metrics/alerts CLI commands (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerAdminCommand } from '../../src/cli/commands/admin.js';

describe('Story 14.3: CLI xactions admin stream commands', () => {
  it('registers admin stream command tree with metrics and alerts subcommands', () => {
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
  });
});
