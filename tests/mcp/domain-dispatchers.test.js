// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP Domain Dispatchers Test Suite (Story 52.1 / Epic 52)
 *
 * Verifies the 10 Domain Dispatcher tools:
 * x_post, x_user, x_read, x_dm, x_facebook, x_crypto, x_scrape, x_persona, x_analytics, x_system
 *
 * Checks:
 * - DOMAIN_TOOLS registry (10 tools, schema validity, unique x_ names)
 * - DOMAIN_DISPATCH_MAP routing
 * - Missing action error (XACT_4001 + availableActions)
 * - Invalid action error (XACT_4001 + availableActions)
 * - Missing requiredArgs error (XACT_4002 + missing)
 * - Happy path dispatching returning unified ToolEnvelope
 * - Legacy call passthrough compatibility
 */

import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  DOMAIN_TOOLS,
  DOMAIN_DISPATCH_MAP,
  getDomainTools,
  getAllTools,
  executeTool,
  initializeBackend,
  setLocalTools,
} from '../../src/mcp/server.js';
import { PlatformError, ErrorCodes } from '../../src/core/error-envelope.js';

describe('Story 52.1: Domain Dispatcher Schemas', () => {
  beforeAll(async () => {
    process.env.XACTIONS_MODE = 'local';
    await initializeBackend();
  });

  it('exports DOMAIN_TOOLS array with exactly 10 tools', () => {
    assert.ok(Array.isArray(DOMAIN_TOOLS), 'DOMAIN_TOOLS should be an array');
    assert.equal(DOMAIN_TOOLS.length, 10, 'DOMAIN_TOOLS should contain exactly 10 domain dispatchers');
    assert.equal(getDomainTools().length, 10, 'getDomainTools() should return 10 tools');
  });

  it('contains all 10 canonical domain dispatcher names', () => {
    const expectedTools = [
      'x_post',
      'x_user',
      'x_read',
      'x_dm',
      'x_facebook',
      'x_crypto',
      'x_scrape',
      'x_persona',
      'x_analytics',
      'x_system',
    ];
    const actualNames = DOMAIN_TOOLS.map((t) => t.name);
    for (const expected of expectedTools) {
      assert.ok(actualNames.includes(expected), `Missing domain tool: ${expected}`);
    }
  });

  it('every domain tool has name, description, and valid inputSchema', () => {
    for (const tool of DOMAIN_TOOLS) {
      assert.equal(typeof tool.name, 'string', `${tool.name}: name must be a string`);
      assert.ok(tool.name.startsWith('x_'), `${tool.name}: must start with x_ prefix`);
      assert.equal(typeof tool.description, 'string', `${tool.name}: description must be a string`);
      assert.ok(tool.description.length > 0, `${tool.name}: description must not be empty`);
      assert.ok(tool.inputSchema, `${tool.name}: inputSchema is required`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type must be 'object'`);
    }
  });

  it('tool names are unique in DOMAIN_TOOLS', () => {
    const names = DOMAIN_TOOLS.map((t) => t.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    assert.equal(duplicates.length, 0, `Duplicate domain tool names: ${duplicates.join(', ')}`);
  });

  it('all required fields are declared in inputSchema.properties', () => {
    for (const tool of DOMAIN_TOOLS) {
      const required = tool.inputSchema.required || [];
      const properties = tool.inputSchema.properties || {};
      for (const field of required) {
        assert.ok(
          properties[field],
          `${tool.name}: required field "${field}" must be declared in properties`
        );
      }
    }
  });

  it('getAllTools() returns full catalog containing legacy tools', () => {
    const all = getAllTools();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 200, `getAllTools() should return full catalog, got ${all.length}`);
    assert.ok(all.find((t) => t.name === 'x_post_tweet'));
    assert.ok(all.find((t) => t.name === 'x_get_profile'));
  });
});

describe('Story 52.1: Domain Dispatcher Error Handling', () => {
  it('throws XACT_4001 when action is missing (MISSING_ACTION)', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_post', {});
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('action is required'));
        assert.ok(Array.isArray(err.availableActions));
        assert.ok(err.availableActions.includes('tweet'));
        assert.ok(err.availableActions.includes('reply'));
        return true;
      }
    );
  });

  it('throws XACT_4001 when action is not supported (INVALID_ACTION)', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_post', { action: 'invalid_action' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4001');
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('not supported'));
        assert.ok(Array.isArray(err.availableActions));
        assert.ok(err.availableActions.includes('tweet'));
        return true;
      }
    );
  });

  it('throws XACT_4002 when required argument is missing (MISSING_REQUIRED_ARG)', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_post', { action: 'tweet' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.equal(err.statusCode, 400);
        assert.deepEqual(err.missing, ['text']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_user profile is missing username', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_user', { action: 'profile' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.equal(err.statusCode, 400);
        assert.deepEqual(err.missing, ['username']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_read search is missing query', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_read', { action: 'search' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['query']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_dm send is missing username or message', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_dm', { action: 'send', username: 'testuser' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['message']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_crypto dexscreener token_lookup is missing arguments', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_crypto', { platform: 'dexscreener', action: 'token_lookup', args: {} });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.ok(err.missing.includes('chainId'));
        assert.ok(err.missing.includes('tokenAddress'));
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_persona status is missing personaId', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_persona', { action: 'status' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['personaId']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_analytics post is missing url', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_analytics', { action: 'post' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['url']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_user unfollow_non_followers is missing username', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_user', { action: 'unfollow_non_followers' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['username']);
        return true;
      }
    );
  });

  it('throws XACT_4002 when x_facebook automate is missing automateAction', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_facebook', { action: 'automate' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.deepEqual(err.missing, ['automateAction']);
        return true;
      }
    );
  });

  it('PlatformError.toEnvelope() serializes availableActions, missing, and example', () => {
    const err = new PlatformError({
      code: 'XACT_4001',
      message: 'Action test',
      availableActions: ['action1', 'action2'],
      missing: ['field1'],
      example: { field1: 'val1' },
    });
    const env = err.toEnvelope();
    assert.deepEqual(env.availableActions, ['action1', 'action2']);
    assert.deepEqual(env.missing, ['field1']);
    assert.deepEqual(env.example, { field1: 'val1' });
  });

  it('throws XACT_4002 when x_system stream_start is missing arguments', async () => {
    await assert.rejects(
      async () => {
        await executeTool('x_system', { action: 'stream_start' });
      },
      (err) => {
        assert.ok(err instanceof PlatformError);
        assert.equal(err.code, 'XACT_4002');
        assert.ok(err.missing.includes('type'));
        assert.ok(err.missing.includes('username'));
        return true;
      }
    );
  });
});

describe('Story 52.1: Domain Dispatcher Routing & Execution', () => {
  beforeAll(async () => {
    process.env.XACTIONS_MODE = 'local';
    await initializeBackend();
  });

  it('HAPPY_PATH: x_post tweet executes via handler and returns ToolEnvelope', async () => {
    const res = await executeTool('x_post', { action: 'tweet', text: 'Hello World', dryRun: true });
    assert.ok(res, 'Response must exist');
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_post');
    assert.ok(Array.isArray(res.data));
  });

  it('HAPPY_PATH: x_crypto dexscreener token_lookup delegates to executeScrapeTool with ToolEnvelope', async () => {
    const res = await executeTool('x_crypto', {
      platform: 'dexscreener',
      action: 'token_lookup',
      args: { chainId: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112' },
      dryRun: true,
    });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_crypto');
  });

  it('HAPPY_PATH: x_crypto pumpfun mint_social delegates to executeScrapeTool with ToolEnvelope', async () => {
    const res = await executeTool('x_crypto', {
      platform: 'pumpfun',
      action: 'mint_social',
      mintAddress: 'So11111111111111111111111111111111111111112',
      dryRun: true,
    });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
  });

  it('HAPPY_PATH: x_user profile delegates to x_get_profile and returns ToolEnvelope', async () => {
    // Inject mock for x_get_profile in localTools
    setLocalTools({
      x_get_profile: async (args) => ({
        username: args.username,
        displayName: 'Nicholas',
        bio: 'XActions Developer',
        followersCount: 1337,
      }),
    });

    const res = await executeTool('x_user', { action: 'profile', username: 'nichxbt' });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_user');
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data[0]?.username, 'nichxbt');
  });

  it('HAPPY_PATH: x_persona presets returns available persona presets', async () => {
    const res = await executeTool('x_persona', { action: 'presets' });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_persona');
  });

  it('HAPPY_PATH: x_system governor_status returns governor state', async () => {
    const res = await executeTool('x_system', { action: 'governor_status' });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.mode, 'direct');
    assert.ok(res.meta);
    assert.equal(res.meta.tool, 'x_system');
  });

  it('HAPPY_PATH: x_facebook search executes and returns facebook platform in envelope', async () => {
    const res = await executeTool('x_facebook', {
      action: 'search',
      query: 'developer groups',
      dryRun: true,
      authCookie: { c_user: '12345', xs: 'secret_xs' },
    });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.platform, 'facebook');
    assert.equal(res.meta?.tool, 'x_facebook');
  });

  it('HAPPY_PATH: x_read lists executes without requiring username', async () => {
    setLocalTools({
      x_get_lists: async () => [{ id: 'list1', name: 'Tech Leaders' }],
    });
    const res = await executeTool('x_read', { action: 'lists' });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.meta?.tool, 'x_read');
  });

  it('HAPPY_PATH: x_dm conversations executes and returns ToolEnvelope', async () => {
    setLocalTools({
      x_get_conversations: async () => [{ name: 'Alice', preview: 'Hey there' }],
    });
    const res = await executeTool('x_dm', { action: 'conversations' });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.meta?.tool, 'x_dm');
  });

  it('HAPPY_PATH: x_analytics reputation maps username and returns ToolEnvelope', async () => {
    const res = await executeTool('x_analytics', {
      action: 'reputation',
      username: 'nichxbt',
    });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.meta?.tool, 'x_analytics');
  });

  it('HAPPY_PATH: x_follow and x_unfollow support dryRun without opening browser', async () => {
    await initializeBackend();
    const followRes = await executeTool('x_user', { action: 'follow', username: 'nichxbt', dryRun: true });
    assert.ok(followRes);
    assert.equal(followRes.success, true);

    const unfollowRes = await executeTool('x_user', { action: 'unfollow', username: 'nichxbt', dryRun: true });
    assert.ok(unfollowRes);
    assert.equal(unfollowRes.success, true);
  });

  it('LEGACY_CALL_DIRECT: direct call to x_post_tweet executes without disruption', async () => {
    // Reset localTools to default implementation
    await initializeBackend();

    const res = await executeTool('x_post_tweet', { text: 'Hello legacy call', dryRun: true });
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.dryRun, true);
  });
});
