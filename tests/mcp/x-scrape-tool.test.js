// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for x_scrape MCP tool registration, validation, and dispatch (Story 20.1).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { TOOLS, executeTool, executeScrapeTool } from '../../src/mcp/server.js';
import { PlatformError } from '../../src/core/error-envelope.js';

describe('x_scrape tool registration and schema', () => {
  it('registers x_scrape in TOOLS array with required schema fields', () => {
    const tool = TOOLS.find((t) => t.name === 'x_scrape');
    assert.ok(tool, 'x_scrape tool should be registered');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.deepEqual(tool.inputSchema.required, ['platform', 'action', 'args']);

    const props = tool.inputSchema.properties;
    assert.ok(props.platform, 'platform prop required');
    assert.ok(props.action, 'action prop required');
    assert.ok(props.args, 'args prop required');
    assert.ok(props.context, 'context prop required');
    assert.ok(props.accountId, 'accountId prop required');
    assert.ok(props.proxyUrl, 'proxyUrl prop required');
    assert.ok(props.dryRun, 'dryRun prop required');
    assert.ok(props.artifactFormat, 'artifactFormat prop required');
  });

  it('updates x_actions_list schema with category and detailLevel', () => {
    const tool = TOOLS.find((t) => t.name === 'x_actions_list');
    assert.ok(tool, 'x_actions_list tool should be registered');
    const props = tool.inputSchema.properties;
    assert.ok(props.category, 'category property should be added to x_actions_list');
    assert.ok(props.detailLevel, 'detailLevel property should be added to x_actions_list');
    assert.deepEqual(props.detailLevel.enum, ['summary', 'full']);
  });
});

describe('x_scrape validation & error handling', () => {
  it('throws XACT_4001 when platform argument is missing', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({});
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.ok(err.message.includes('platform'));
        return true;
      }
    );
  });

  it('throws XACT_4001 when platform is not a string', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 123, action: 'search' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        return true;
      }
    );
  });

  it('throws XACT_4001 when action argument is missing', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 'chotot' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.ok(err.message.includes('action'));
        return true;
      }
    );
  });

  it('throws XACT_4001 when args is not an object', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 'chotot', action: 'search_listings', args: 'invalid' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.ok(err.message.includes('args must be an object'));
        return true;
      }
    );
  });

  it('throws XACT_4001 when platform is not in DESCRIPTORS', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 'nonexistent_platform', action: 'search', args: {} });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.ok(err.message.includes('not supported'));
        assert.ok(Array.isArray(err.details?.available));
        return true;
      }
    );
  });

  it('throws XACT_4001 with availableActions when action does not exist on platform', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 'chotot', action: 'posts', args: {} });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.equal(err.statusCode, 400);
        assert.ok(Array.isArray(err.availableActions));
        assert.ok(err.availableActions.includes('search_listings'));
        assert.ok(err.availableActions.includes('listing_detail'));
        return true;
      }
    );
  });

  it('throws XACT_4002 with missing and example when requiredArgs are missing', async () => {
    await assert.rejects(
      async () => {
        await executeScrapeTool({ platform: 'chotot', action: 'listing_detail', args: {} });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.equal(err.statusCode, 400);
        assert.deepEqual(err.missing, ['listId']);
        assert.ok(err.example);
        assert.equal(err.example.listId, '11223344');
        return true;
      }
    );
  });

  it('dispatches through executeTool correctly', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_scrape', { platform: 'chotot', action: 'posts', args: {} });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        return true;
      }
    );
  });

  it('emits warning when REDIS_STREAM_ENABLED is true and workspaceId is missing', async () => {
    const originalEnv = process.env.REDIS_STREAM_ENABLED;
    process.env.REDIS_STREAM_ENABLED = 'true';
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...msg) => {
      warnings.push(msg.join(' '));
    };

    try {
      // listing_detail with missing args will fail at requiredArgs check after workspace check
      await assert.rejects(async () => {
        await executeScrapeTool({
          platform: 'chotot',
          action: 'listing_detail',
          args: {},
          context: { targetId: 't123' },
        });
      });

      assert.ok(
        warnings.some((w) => w.includes('[StreamPublisher:MissingWorkspaceId]')),
        'Expected missing workspaceId warning to be logged'
      );
    } finally {
      console.warn = originalWarn;
      if (originalEnv === undefined) {
        delete process.env.REDIS_STREAM_ENABLED;
      } else {
        process.env.REDIS_STREAM_ENABLED = originalEnv;
      }
    }
  });
});
