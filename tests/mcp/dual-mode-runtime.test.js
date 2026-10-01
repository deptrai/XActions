// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Dual-Mode Runtime Engine & CLI Flags Tests (Story 52.2 / Epic 52)
 *
 * Validates mode resolution (CLI flags, env vars, dynamic switcher),
 * tool catalog filtering, and ListToolsRequestSchema responses.
 * Follows the no-mock pattern of the XActions test suite.
 */

import { describe, it, beforeAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOLS,
  DOMAIN_TOOLS,
  getDomainTools,
  getAllTools,
  getToolMode,
  setToolMode,
  resetToolMode,
  getActiveTools,
  resolveCliToolMode,
  resolveEnvToolMode,
  createMcpServer,
  executeTool,
  initializeBackend,
} from '../../src/mcp/server.js';

describe('Story 52.2: Dual-Mode Runtime Engine & CLI Flags', () => {
  const originalArgv = [...process.argv];
  const originalEnvMode = process.env.MCP_TOOL_MODE;

  beforeAll(async () => {
    process.env.XACTIONS_MODE = 'local';
    await initializeBackend();
  });

  beforeEach(() => {
    resetToolMode();
    delete process.env.MCP_TOOL_MODE;
    process.argv = [...originalArgv.slice(0, 2)];
  });

  afterEach(() => {
    resetToolMode();
    if (originalEnvMode !== undefined) {
      process.env.MCP_TOOL_MODE = originalEnvMode;
    } else {
      delete process.env.MCP_TOOL_MODE;
    }
    process.argv = [...originalArgv];
  });

  describe('Mode Resolution Hierarchy', () => {
    it('DEFAULT_MODE: returns "compact" when no env or CLI flag is provided', () => {
      assert.equal(getToolMode(), 'compact', 'Default mode should be compact');
      const activeTools = getActiveTools();
      assert.equal(activeTools.length, 10, 'Compact mode should return 10 domain tools');
      assert.deepEqual(activeTools.map((t) => t.name), DOMAIN_TOOLS.map((t) => t.name));
    });

    it('ENV_MODE_FULL: returns "full" when MCP_TOOL_MODE=full', () => {
      process.env.MCP_TOOL_MODE = 'full';
      assert.equal(getToolMode(), 'full');
      const activeTools = getActiveTools();
      assert.equal(activeTools.length, TOOLS.length, 'Full mode should return all legacy tools');
      assert.ok(activeTools.length >= 200);
    });

    it('ENV_MODE_FULL (case-insensitive): parses "FULL" and "Compact" safely', () => {
      process.env.MCP_TOOL_MODE = 'FULL';
      assert.equal(getToolMode(), 'full');

      process.env.MCP_TOOL_MODE = 'Compact';
      assert.equal(getToolMode(), 'compact');
    });

    it('ENV_MODE_FALLBACK: falls back to "compact" when MCP_TOOL_MODE is invalid', () => {
      process.env.MCP_TOOL_MODE = 'invalid-mode-xyz';
      assert.equal(getToolMode(), 'compact');
    });

    it('CLI_FLAG_MODE_FULL: --mode=full takes priority over default', () => {
      process.argv = ['node', 'server.js', '--mode=full'];
      assert.equal(getToolMode(), 'full');
      assert.equal(getActiveTools().length, TOOLS.length);
    });

    it('CLI_FLAG_MODE_FULL: --full flag takes priority over default', () => {
      process.argv = ['node', 'server.js', '--full'];
      assert.equal(getToolMode(), 'full');
    });

    it('CLI_FLAG_MODE_FULL: space-separated "--mode full" works', () => {
      process.argv = ['node', 'server.js', '--mode', 'full'];
      assert.equal(getToolMode(), 'full');
    });

    it('CLI_FLAG_MODE_FULL: CLI flag overrides MCP_TOOL_MODE=compact', () => {
      process.env.MCP_TOOL_MODE = 'compact';
      process.argv = ['node', 'server.js', '--full'];
      assert.equal(getToolMode(), 'full', 'CLI flag should take precedence over env var');
    });

    it('CLI_FLAG_MODE_COMPACT: --mode=compact takes priority over MCP_TOOL_MODE=full', () => {
      process.env.MCP_TOOL_MODE = 'full';
      process.argv = ['node', 'server.js', '--mode=compact'];
      assert.equal(getToolMode(), 'compact', 'CLI compact flag should override env full');
    });

    it('CLI_FLAG_MODE_COMPACT: --compact flag takes priority over MCP_TOOL_MODE=full', () => {
      process.env.MCP_TOOL_MODE = 'full';
      process.argv = ['node', 'server.js', '--compact'];
      assert.equal(getToolMode(), 'compact');
    });

    it('CLI_FLAG_MODE_COMPACT: space-separated "--mode compact" works', () => {
      process.env.MCP_TOOL_MODE = 'full';
      process.argv = ['node', 'server.js', '--mode', 'compact'];
      assert.equal(getToolMode(), 'compact');
    });

    it('CLI_FLAG_MODE_FULL: strips quotes from --mode="full" and --mode=\'compact\'', () => {
      process.argv = ['node', 'server.js', '--mode="full"'];
      assert.equal(getToolMode(), 'full');

      process.argv = ['node', 'server.js', "--mode='compact'"];
      assert.equal(getToolMode(), 'compact');

      process.argv = ['node', 'server.js', '--mode', '"full"'];
      assert.equal(getToolMode(), 'full');
    });

    it('CLI flags are case-insensitive (--mode=FULL, --FULL)', () => {
      process.argv = ['node', 'server.js', '--mode=FULL'];
      assert.equal(getToolMode(), 'full');

      process.argv = ['node', 'server.js', '--FULL'];
      assert.equal(getToolMode(), 'full');

      process.argv = ['node', 'server.js', '--COMPACT'];
      assert.equal(getToolMode(), 'compact');
    });

    it('later CLI flag takes precedence over earlier CLI flag', () => {
      process.argv = ['node', 'server.js', '--compact', '--full'];
      assert.equal(getToolMode(), 'full');

      process.argv = ['node', 'server.js', '--full', '--compact'];
      assert.equal(getToolMode(), 'compact');
    });
  });

  describe('Dynamic Switcher (setToolMode / resetToolMode)', () => {
    it('DYNAMIC_SET_MODE: setToolMode("full") dynamically updates mode and active tools', () => {
      setToolMode('full');
      assert.equal(getToolMode(), 'full');
      assert.equal(getActiveTools().length, TOOLS.length);
    });

    it('DYNAMIC_SET_MODE: setToolMode("compact") dynamically updates mode and active tools', () => {
      process.env.MCP_TOOL_MODE = 'full';
      setToolMode('compact');
      assert.equal(getToolMode(), 'compact', 'setToolMode overrides env var');
      assert.equal(getActiveTools().length, 10);
    });

    it('DYNAMIC_SET_MODE: setToolMode is case-insensitive', () => {
      setToolMode('FULL');
      assert.equal(getToolMode(), 'full');

      setToolMode('Compact');
      assert.equal(getToolMode(), 'compact');
    });

    it('DYNAMIC_SET_MODE: throws Error when mode is invalid', () => {
      assert.throws(() => setToolMode('super-mode'), {
        message: /Invalid tool mode/,
      });
      assert.throws(() => setToolMode(''), {
        message: /Invalid tool mode/,
      });
      assert.throws(() => setToolMode(123), {
        message: /Invalid tool mode/,
      });
    });

    it('resetToolMode() and setToolMode(null) restore auto-resolution', () => {
      process.env.MCP_TOOL_MODE = 'full';
      setToolMode('compact');
      assert.equal(getToolMode(), 'compact');

      resetToolMode();
      assert.equal(getToolMode(), 'full', 'After reset, env var should take effect');

      setToolMode('compact');
      assert.equal(getToolMode(), 'compact');

      setToolMode(null);
      assert.equal(getToolMode(), 'full', 'setToolMode(null) should reset explicit override');
    });
  });

  describe('getActiveTools(mode?) Parametric Resolution', () => {
    it('getActiveTools("compact") explicitly returns domain tools', () => {
      const tools = getActiveTools('compact');
      assert.equal(tools.length, 10);
      assert.equal(tools[0].name, 'x_post');
    });

    it('getActiveTools("full") explicitly returns full legacy catalog', () => {
      const tools = getActiveTools('full');
      assert.equal(tools.length, TOOLS.length);
      assert.ok(tools.some((t) => t.name === 'x_post_tweet'));
    });

    it('getActiveTools("unknown") falls back to compact domain tools', () => {
      const tools = getActiveTools('unknown');
      assert.equal(tools.length, 10);
    });

    it('getDomainTools() and getAllTools() accessors remain constant', () => {
      assert.equal(getDomainTools().length, 10);
      assert.equal(getAllTools().length, TOOLS.length);
    });
  });

  describe('Parser Utilities (resolveCliToolMode & resolveEnvToolMode)', () => {
    it('resolveCliToolMode handles various argv configurations', () => {
      assert.equal(resolveCliToolMode(['--mode=compact']), 'compact');
      assert.equal(resolveCliToolMode(['--mode=full']), 'full');
      assert.equal(resolveCliToolMode(['--compact']), 'compact');
      assert.equal(resolveCliToolMode(['--full']), 'full');
      assert.equal(resolveCliToolMode(['--mode', 'full']), 'full');
      assert.equal(resolveCliToolMode(['--mode', 'compact']), 'compact');
      assert.equal(resolveCliToolMode(['--other-arg', 'value']), null);
      assert.equal(resolveCliToolMode([]), null);
      assert.equal(resolveCliToolMode(null), null);
    });

    it('resolveEnvToolMode handles env configurations', () => {
      assert.equal(resolveEnvToolMode({ MCP_TOOL_MODE: 'full' }), 'full');
      assert.equal(resolveEnvToolMode({ MCP_TOOL_MODE: 'compact' }), 'compact');
      assert.equal(resolveEnvToolMode({ MCP_TOOL_MODE: 'FULL' }), 'full');
      assert.equal(resolveEnvToolMode({ MCP_TOOL_MODE: '  compact  ' }), 'compact');
      assert.equal(resolveEnvToolMode({ MCP_TOOL_MODE: 'invalid' }), null);
      assert.equal(resolveEnvToolMode({}), null);
      assert.equal(resolveEnvToolMode(null), null);
    });
  });

  describe('MCP Protocol: ListToolsRequestSchema Integration', () => {
    it('LIST_TOOLS_COMPACT: createMcpServer() in compact mode advertises exactly 10 domain tools', async () => {
      setToolMode('compact');
      const srv = createMcpServer();
      const listHandler = srv._requestHandlers?.get(ListToolsRequestSchema.shape.method.value);
      assert.ok(listHandler, 'ListToolsRequestSchema handler must be registered');

      const response = await listHandler({ method: 'tools/list', params: {} });
      assert.ok(response && Array.isArray(response.tools), 'Response must have tools array');

      // Filter core tools (tools starting with 'x_')
      const coreTools = response.tools.filter((t) => !t._plugin);
      assert.equal(coreTools.length, 10, 'Compact mode must advertise exactly 10 core domain tools');

      const toolNames = coreTools.map((t) => t.name);
      assert.ok(toolNames.includes('x_post'));
      assert.ok(toolNames.includes('x_user'));
      assert.ok(toolNames.includes('x_read'));
      assert.ok(toolNames.includes('x_dm'));
      assert.ok(toolNames.includes('x_facebook'));
      assert.ok(toolNames.includes('x_crypto'));
      assert.ok(toolNames.includes('x_scrape'));
      assert.ok(toolNames.includes('x_persona'));
      assert.ok(toolNames.includes('x_analytics'));
      assert.ok(toolNames.includes('x_system'));

      // Legacy tools should not be in the advertised list
      assert.equal(toolNames.includes('x_post_tweet'), false);
      assert.equal(toolNames.includes('x_get_profile'), false);
    });

    it('LIST_TOOLS_FULL: createMcpServer() in full mode advertises 224 legacy tools', async () => {
      setToolMode('full');
      const srv = createMcpServer();
      const listHandler = srv._requestHandlers?.get(ListToolsRequestSchema.shape.method.value);
      assert.ok(listHandler, 'ListToolsRequestSchema handler must be registered');

      const response = await listHandler({ method: 'tools/list', params: {} });
      assert.ok(response && Array.isArray(response.tools));

      const coreTools = response.tools.filter((t) => !t._plugin);
      assert.equal(coreTools.length, TOOLS.length, `Full mode must advertise all ${TOOLS.length} legacy tools`);

      const toolNames = coreTools.map((t) => t.name);
      assert.ok(toolNames.includes('x_post_tweet'));
      assert.ok(toolNames.includes('x_get_profile'));
      assert.ok(toolNames.includes('x_facebook_posts'));
    });

    it('dynamic mode switch is reflected immediately in ListToolsRequestSchema handler', async () => {
      const srv = createMcpServer();
      const listHandler = srv._requestHandlers?.get(ListToolsRequestSchema.shape.method.value);

      // Start in compact mode
      setToolMode('compact');
      let response = await listHandler({ method: 'tools/list', params: {} });
      let coreTools = response.tools.filter((t) => !t._plugin);
      assert.equal(coreTools.length, 10);

      // Switch to full mode dynamically
      setToolMode('full');
      response = await listHandler({ method: 'tools/list', params: {} });
      coreTools = response.tools.filter((t) => !t._plugin);
      assert.equal(coreTools.length, TOOLS.length);

      // Switch back to compact
      setToolMode('compact');
      response = await listHandler({ method: 'tools/list', params: {} });
      coreTools = response.tools.filter((t) => !t._plugin);
      assert.equal(coreTools.length, 10);
    });
  });

  describe('Execution Compatibility Across Modes', () => {
    it('executeTool handles both domain tools and legacy tools in compact mode', async () => {
      setToolMode('compact');

      // Domain tool execution
      const domainRes = await executeTool('x_post', { action: 'tweet', text: 'Compact mode test', dryRun: true });
      assert.equal(domainRes.success, true);
      assert.equal(domainRes.meta?.tool, 'x_post');

      // Direct legacy tool execution
      const legacyRes = await executeTool('x_post_tweet', { text: 'Direct legacy test', dryRun: true });
      assert.equal(legacyRes.success, true);
      assert.equal(legacyRes.text, 'Direct legacy test');
    });

    it('executeTool handles both domain tools and legacy tools in full mode', async () => {
      setToolMode('full');

      // Domain tool execution
      const domainRes = await executeTool('x_post', { action: 'tweet', text: 'Full mode test', dryRun: true });
      assert.equal(domainRes.success, true);
      assert.equal(domainRes.meta?.tool, 'x_post');

      // Direct legacy tool execution
      const legacyRes = await executeTool('x_post_tweet', { text: 'Direct legacy test full', dryRun: true });
      assert.equal(legacyRes.success, true);
      assert.equal(legacyRes.text, 'Direct legacy test full');
    });
  });

  describe('MCP Protocol: Resource Integration', () => {
    it('xactions://system/status resource returns toolMode and activeToolCount', async () => {
      setToolMode('compact');
      const srv = createMcpServer();
      const readHandler = srv._requestHandlers?.get(ReadResourceRequestSchema.shape.method.value);
      assert.ok(readHandler, 'ReadResourceRequestSchema handler must be registered');

      const result = await readHandler({
        method: 'resources/read',
        params: { uri: 'xactions://system/status' },
      });
      assert.ok(result.contents && result.contents[0]);
      const statusData = JSON.parse(result.contents[0].text);
      assert.equal(statusData.toolMode, 'compact');
      assert.equal(statusData.activeToolCount, 10);
      assert.equal(statusData.mode, 'local');

      // Switch to full mode and read again
      setToolMode('full');
      const resultFull = await readHandler({
        method: 'resources/read',
        params: { uri: 'xactions://system/status' },
      });
      const statusDataFull = JSON.parse(resultFull.contents[0].text);
      assert.equal(statusDataFull.toolMode, 'full');
      assert.equal(statusDataFull.activeToolCount, TOOLS.length);
    });
  });
});
