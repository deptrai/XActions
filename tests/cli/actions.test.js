// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CLI action discovery tests (Story 14.2)
 *
 * Spawns the real `xactions actions` command and validates the JSON output.
 * No mocks — the CLI runs end-to-end through executeActionListTool.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI = new URL('../../src/cli/index.js', import.meta.url).pathname;

describe('xactions actions', () => {
  it('lists actions for a specific platform', async () => {
    const { stdout, stderr } = await execFileAsync('node', [CLI, 'actions', '--platform', 'threads']);
    assert.equal(stderr, '');

    const actions = JSON.parse(stdout);
    assert.ok(Array.isArray(actions));
    assert.ok(actions.length > 0);

    for (const action of actions) {
      assert.equal(typeof action.action, 'string');
      assert.equal(action.platform, 'threads');
      assert.equal(typeof action.requiresAuth, 'boolean');
      assert.ok(Array.isArray(action.requiredArgs));
      assert.ok(Array.isArray(action.optionalArgs));
    }
  });

  it('lists actions across platforms', async () => {
    const { stdout, stderr } = await execFileAsync('node', [CLI, 'actions']);
    assert.equal(stderr, '');

    const actions = JSON.parse(stdout);
    assert.ok(Array.isArray(actions));
    assert.ok(actions.length > 0);

    const platforms = new Set(actions.map((a) => a.platform));
    assert.ok(platforms.has('facebook'), 'expected facebook actions');
    assert.ok(platforms.has('threads'), 'expected threads actions');

    for (const action of actions) {
      assert.equal(typeof action.action, 'string');
      assert.equal(typeof action.platform, 'string');
      assert.equal(typeof action.requiresAuth, 'boolean');
    }
  });
});
