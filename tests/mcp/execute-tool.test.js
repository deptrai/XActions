// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP executeTool — graceful error handling tests (Story 8.2)
 */

import { describe, it, beforeAll, vi } from 'vitest';
import assert from 'node:assert/strict';

describe('executeTool — graceful error handling (Story 8.2)', () => {
  it('returns an MCP error result when localTools is not initialized (AC1)', async () => {
    vi.resetModules();
    const mod = await import('../../src/mcp/server.js');

    const result = await mod.executeTool('x_unknown_tool_before_init', {});

    assert.equal(result.isError, true, 'result should be an error');
    assert.equal(Array.isArray(result.content), true, 'result.content should be an array');
    assert.equal(result.content[0]?.type, 'text', 'first content item should be text');
    assert.ok(
      result.content[0]?.text?.toLowerCase().includes('not initialized'),
      `error text should indicate uninitialized localTools, got: ${result.content[0]?.text}`
    );
  });

  it('returns an MCP error result for an unknown tool after init (AC2)', async () => {
    vi.resetModules();
    const mod = await import('../../src/mcp/server.js');
    process.env.XACTIONS_MODE = 'local';
    await mod.initializeBackend();

    const unknownName = 'x_tool_that_does_not_exist_99999';
    const result = await mod.executeTool(unknownName, {});

    assert.equal(result.isError, true, 'result should be an error');
    assert.equal(result.content[0]?.type, 'text', 'first content item should be text');
    assert.ok(
      result.content[0]?.text?.includes(unknownName),
      `error text should include the unknown tool name, got: ${result.content[0]?.text}`
    );
  });

  it('still executes a known tool successfully after init (AC3)', async () => {
    vi.resetModules();
    const mod = await import('../../src/mcp/server.js');
    process.env.XACTIONS_MODE = 'local';
    await mod.initializeBackend();

    const result = await mod.executeTool('x_list_platforms', {});

    assert.equal(result.isError, undefined, 'successful result should not set isError');
    assert.ok(result.platforms, 'x_list_platforms should return a platforms object');
    assert.ok(Array.isArray(result.platforms), 'result.platforms should be an array');
  });
});
