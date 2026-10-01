// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP Server — Tool Definition Tests
 *
 * Tests the TOOLS array structure without starting the stdio transport.
 * Follows the same no-mock pattern as the rest of the test suite.
 */

// This suite must use Vitest's runner, not `node:test`. Importing `describe`/
// `it` from `node:test` registers the suite with Node's own runner, which
// Vitest never executes — the file reported "No test suite found" and all 144
// tool definitions went unchecked for months. Assertions stay on
// `node:assert/strict`, which works under either runner.
import { describe, it, beforeAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

// The server guards main() behind an explicit call, so importing it does not
// start the stdio transport and does not block on stdin.
let TOOLS;
let DOMAIN_TOOLS;
let DOMAIN_DISPATCH_MAP;
let getToolMode;
let setToolMode;
let resetToolMode;
let getActiveTools;
let getDomainTools;
let getAllTools;

describe('MCP Tool Definitions & Dual-Mode Surface (Story 52.3)', () => {
  const originalEnvMode = process.env.MCP_TOOL_MODE;

  beforeAll(async () => {
    const mod = await import('../../src/mcp/server.js');
    TOOLS = mod.TOOLS;
    DOMAIN_TOOLS = mod.DOMAIN_TOOLS;
    DOMAIN_DISPATCH_MAP = mod.DOMAIN_DISPATCH_MAP;
    getToolMode = mod.getToolMode;
    setToolMode = mod.setToolMode;
    resetToolMode = mod.resetToolMode;
    getActiveTools = mod.getActiveTools;
    getDomainTools = mod.getDomainTools;
    getAllTools = mod.getAllTools;
  });

  beforeEach(() => {
    resetToolMode();
    delete process.env.MCP_TOOL_MODE;
  });

  afterEach(() => {
    resetToolMode();
    if (originalEnvMode !== undefined) {
      process.env.MCP_TOOL_MODE = originalEnvMode;
    } else {
      delete process.env.MCP_TOOL_MODE;
    }
  });

  describe('Legacy Tool Catalog (Full Mode - TOOLS)', () => {
    it('exports a TOOLS array', () => {
      assert.ok(Array.isArray(TOOLS), 'TOOLS should be an array');
      assert.ok(TOOLS.length > 0, 'TOOLS should not be empty');
      assert.ok(TOOLS.length >= 200, 'TOOLS should retain all 200+ legacy tools');
    });

    it('every tool has name, description, and inputSchema', () => {
      for (const tool of TOOLS) {
        assert.equal(typeof tool.name, 'string', `${tool.name}: name must be string`);
        assert.ok(tool.name.length > 0, 'name must not be empty');
        assert.equal(typeof tool.description, 'string', `${tool.name}: description must be string`);
        assert.ok(tool.description.length > 0, `${tool.name}: description must not be empty`);
        assert.ok(tool.inputSchema, `${tool.name}: inputSchema is required`);
        assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type must be 'object'`);
      }
    });

    it('all tool names follow x_ prefix convention', () => {
      const nonConforming = TOOLS.filter(t => !t.name.startsWith('x_'));
      assert.equal(
        nonConforming.length,
        0,
        `Non-conforming tool names: ${nonConforming.map(t => t.name).join(', ')}`
      );
    });

    it('tool names are unique', () => {
      const names = TOOLS.map(t => t.name);
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      assert.equal(dupes.length, 0, `Duplicate tool names: ${dupes.join(', ')}`);
    });

    it('x_get_profile requires username', () => {
      const tool = TOOLS.find(t => t.name === 'x_get_profile');
      assert.ok(tool, 'x_get_profile must be defined');
      assert.ok(
        tool.inputSchema.required?.includes('username'),
        'x_get_profile must require username'
      );
    });

    it('x_post_tweet requires text', () => {
      const tool = TOOLS.find(t => t.name === 'x_post_tweet');
      assert.ok(tool, 'x_post_tweet must be defined');
      assert.ok(
        tool.inputSchema.required?.includes('text'),
        'x_post_tweet must require text'
      );
    });

    it('required fields are declared in properties', () => {
      for (const tool of TOOLS) {
        const required = tool.inputSchema.required || [];
        const properties = tool.inputSchema.properties || {};
        for (const field of required) {
          assert.ok(
            properties[field],
            `${tool.name}: required field "${field}" not in properties`
          );
        }
      }
    });
  });

  describe('Compact Mode Domain Dispatchers (DOMAIN_TOOLS)', () => {
    it('exports DOMAIN_TOOLS with exactly 10 domain dispatchers', () => {
      assert.ok(Array.isArray(DOMAIN_TOOLS), 'DOMAIN_TOOLS should be an array');
      assert.equal(DOMAIN_TOOLS.length, 10, 'DOMAIN_TOOLS must contain exactly 10 domain tools');
    });

    it('all domain tool names follow x_ prefix and expected 10 domain names', () => {
      const expectedDomains = [
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
      const actualNames = DOMAIN_TOOLS.map(t => t.name);
      assert.deepEqual(actualNames.sort(), expectedDomains.sort(), 'Domain tools must match the 10 defined domains');
    });

    it('every domain tool has name, description, and valid inputSchema with action property', () => {
      for (const tool of DOMAIN_TOOLS) {
        assert.equal(typeof tool.name, 'string', `${tool.name}: name must be string`);
        assert.ok(tool.name.length > 0, `${tool.name}: name must not be empty`);
        assert.equal(typeof tool.description, 'string', `${tool.name}: description must be string`);
        assert.ok(tool.description.length > 0, `${tool.name}: description must not be empty`);
        assert.ok(tool.inputSchema, `${tool.name}: inputSchema is required`);
        assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type must be 'object'`);

        // Check action requirement for dispatchers (except x_scrape which is a platform crawler facade)
        if (tool.name !== 'x_scrape') {
          assert.ok(
            tool.inputSchema.required?.includes('action'),
            `${tool.name} must require action in inputSchema`
          );
          assert.ok(
            tool.inputSchema.properties?.action,
            `${tool.name} must declare action in properties`
          );
        } else {
          assert.deepEqual(
            tool.inputSchema.required,
            ['platform', 'action', 'args'],
            'x_scrape must require platform, action, and args'
          );
        }
      }
    });

    it('all required fields in DOMAIN_TOOLS are declared in properties', () => {
      for (const tool of DOMAIN_TOOLS) {
        const required = tool.inputSchema.required || [];
        const properties = tool.inputSchema.properties || {};
        for (const field of required) {
          assert.ok(
            properties[field],
            `${tool.name}: required field "${field}" not in properties`
          );
        }
      }
    });

    it('DOMAIN_DISPATCH_MAP covers all 9 non-scrape domain dispatchers with action handlers', () => {
      assert.ok(DOMAIN_DISPATCH_MAP && typeof DOMAIN_DISPATCH_MAP === 'object');
      const mappedDomains = Object.keys(DOMAIN_DISPATCH_MAP);
      assert.ok(mappedDomains.includes('x_post'), 'mappedDomains includes x_post');
      assert.ok(mappedDomains.includes('x_user'), 'mappedDomains includes x_user');
      assert.ok(mappedDomains.includes('x_read'), 'mappedDomains includes x_read');
      assert.ok(mappedDomains.includes('x_dm'), 'mappedDomains includes x_dm');
      assert.ok(mappedDomains.includes('x_facebook'), 'mappedDomains includes x_facebook');
      assert.ok(mappedDomains.includes('x_crypto'), 'mappedDomains includes x_crypto');
      assert.ok(mappedDomains.includes('x_persona'), 'mappedDomains includes x_persona');
      assert.ok(mappedDomains.includes('x_analytics'), 'mappedDomains includes x_analytics');
      assert.ok(mappedDomains.includes('x_system'), 'mappedDomains includes x_system');

      for (const [domainName, actions] of Object.entries(DOMAIN_DISPATCH_MAP)) {
        assert.ok(Object.keys(actions).length > 0, `${domainName} should have registered actions`);
        for (const [actionName, config] of Object.entries(actions)) {
          assert.ok(
            config.targetTool || config.legacyTool || config.handler || config.platform,
            `${domainName}.${actionName} must have targetTool, legacyTool, handler, or platform dispatch config`
          );
          assert.ok(
            Array.isArray(config.requiredArgs),
            `${domainName}.${actionName} requiredArgs must be an array`
          );
        }
      }
    });
  });

  describe('Runtime Mode Helpers & Compatibility Surface', () => {
    it('getDomainTools returns identical array to DOMAIN_TOOLS', () => {
      const domainTools = getDomainTools();
      assert.equal(domainTools.length, 10);
      assert.deepEqual(domainTools, DOMAIN_TOOLS);
    });

    it('getAllTools returns identical array to TOOLS', () => {
      const allTools = getAllTools();
      assert.equal(allTools.length, TOOLS.length);
      assert.deepEqual(allTools, TOOLS);
    });

    it('getActiveTools reflects current mode correctly and supports explicit mode argument', () => {
      try {
        setToolMode('compact');
        assert.equal(getToolMode(), 'compact');
        assert.equal(getActiveTools().length, 10);
        assert.deepEqual(getActiveTools(), DOMAIN_TOOLS);

        setToolMode('full');
        assert.equal(getToolMode(), 'full');
        assert.equal(getActiveTools().length, TOOLS.length);
        assert.deepEqual(getActiveTools(), TOOLS);

        // Parameter override
        assert.equal(getActiveTools('compact').length, 10);
        assert.equal(getActiveTools('full').length, TOOLS.length);
      } finally {
        resetToolMode();
      }
    });
  });
});
