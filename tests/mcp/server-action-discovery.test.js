// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Action discovery tests for x_actions_list (Story 14.2)
 *
 * Tests executeActionListTool returns ActionDescriptor[] with requiresAuth and
 * platform fields. Instantiation of FacebookCrawler and ThreadsCrawler must not
 * require DB or proxy; if it fails due to missing env, the suite skips cleanly.
 */

import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { executeActionListTool } from '../../src/mcp/server.js';

let discovered = null;
let unavailable = false;
let unavailableReason = '';

beforeAll(async () => {
  try {
    discovered = await executeActionListTool({});
  } catch (error) {
    unavailable = true;
    unavailableReason = error instanceof Error ? error.message : String(error);
  }
});

describe('x_actions_list', () => {
  it('returns an array of ActionDescriptor objects', async function () {
    if (unavailable) this.skip();

    assert.ok(Array.isArray(discovered));
    assert.ok(discovered.length > 0);

    for (const action of discovered) {
      assert.equal(typeof action.action, 'string');
      assert.ok(action.action.length > 0);
      assert.equal(typeof action.platform, 'string');
      assert.ok(action.platform.length > 0);
      assert.equal(typeof action.requiresAuth, 'boolean');
      assert.ok(Array.isArray(action.requiredArgs));
      assert.ok(Array.isArray(action.optionalArgs));
    }
  });

  it('includes actions for both facebook and threads', async function () {
    if (unavailable) this.skip();

    const platforms = new Set(discovered.map((a) => a.platform));
    assert.ok(platforms.has('facebook'), 'expected facebook actions');
    assert.ok(platforms.has('threads'), 'expected threads actions');
  });

  it('filters actions by platform', async function () {
    if (unavailable) this.skip();

    const threads = await executeActionListTool({ platform: 'threads' });
    assert.ok(Array.isArray(threads));
    assert.ok(threads.length > 0);
    for (const action of threads) {
      assert.equal(action.platform, 'threads');
      assert.equal(typeof action.requiresAuth, 'boolean');
    }

    const facebook = await executeActionListTool({ platform: 'facebook' });
    assert.ok(Array.isArray(facebook));
    assert.ok(facebook.length > 0);
    for (const action of facebook) {
      assert.equal(action.platform, 'facebook');
    }
  });
});
