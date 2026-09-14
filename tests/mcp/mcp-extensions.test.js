// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP Extensions Test Suite
 * Validates expanded platforms, action discovery, high-value tools, MCP Resources, and MCP Prompts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { x_list_platforms } from '../../src/mcp/local-tools.js';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';
import {
  createMcpServer,
  TOOLS,
  executeTool,
  initializeBackend,
} from '../../src/mcp/server.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

beforeAll(async () => {
  process.env.XACTIONS_MODE = 'local';
  await initializeBackend();
});

describe('MCP Extensions — Platform & Action Discovery', () => {
  it('x_list_platforms enumerates extended social, marketplace, and niche platforms', async () => {
    const res = await x_list_platforms();
    expect(res).toBeDefined();
    expect(Array.isArray(res.platforms)).toBe(true);

    const names = res.platforms.map((p) => p.name);
    // Core platforms
    expect(names).toContain('twitter');
    expect(names).toContain('facebook');
    expect(names).toContain('reddit');
    expect(names).toContain('threads');
    // Extended platforms
    expect(names).toContain('instagram');
    expect(names).toContain('tiktok');
    expect(names).toContain('youtube');
    expect(names).toContain('zalo');
    expect(names).toContain('linkedin');
    expect(names).toContain('batdongsan');
    expect(names).toContain('chotot');
    expect(names).toContain('shopee');
  });

  it('executeActionListTool discovers actions from extended crawlers including twitter', async () => {
    const actions = await executeActionListTool();
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(100);

    const platforms = new Set(actions.map((a) => a.platform));
    expect(platforms.has('twitter')).toBe(true);
    expect(platforms.has('facebook')).toBe(true);
    expect(platforms.has('zalo')).toBe(true);
    expect(platforms.has('youtube')).toBe(true);
    expect(platforms.has('instagram')).toBe(true);
    expect(platforms.has('batdongsan')).toBe(true);
    expect(platforms.has('chotot')).toBe(true);
    expect(platforms.has('shopee')).toBe(true);
  });

  it('executeActionListTool safely handles options = null', async () => {
    const actions = await executeActionListTool(null);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });
});

describe('MCP Extensions — High-Value Tools', () => {
  it('registers x_shadowban_check, x_backup_account, x_viral_tweet_detector in TOOLS', () => {
    const toolNames = TOOLS.map((t) => t.name);
    expect(toolNames).toContain('x_shadowban_check');
    expect(toolNames).toContain('x_backup_account');
    expect(toolNames).toContain('x_viral_tweet_detector');
  });

  it('x_shadowban_check throws when username is missing', async () => {
    const oldEnv = process.env.XACTIONS_DEFAULT_USERNAME;
    delete process.env.XACTIONS_DEFAULT_USERNAME;
    try {
      await expect(executeTool('x_shadowban_check', {})).rejects.toThrow(
        /username is required/
      );
    } finally {
      if (oldEnv) process.env.XACTIONS_DEFAULT_USERNAME = oldEnv;
    }
  });

  it('x_backup_account throws when username is missing', async () => {
    const oldEnv = process.env.XACTIONS_DEFAULT_USERNAME;
    delete process.env.XACTIONS_DEFAULT_USERNAME;
    try {
      await expect(executeTool('x_backup_account', {})).rejects.toThrow(
        /username is required/
      );
    } finally {
      if (oldEnv) process.env.XACTIONS_DEFAULT_USERNAME = oldEnv;
    }
  });

  it('x_viral_tweet_detector throws when query is missing', async () => {
    await expect(executeTool('x_viral_tweet_detector', {})).rejects.toThrow(
      /query is required/
    );
  });

  it('x_smart_unfollow dryRun analyzes accounts', async () => {
    const result = await executeTool('x_smart_unfollow', { dryRun: true, criteria: 'test' });
    expect(result).toBeDefined();
    expect(result.message).toContain('Dry run');
    expect(result.criteria).toBe('test');
  });
});

describe('MCP Extensions — Resources & Prompts Handlers', () => {
  it('lists MCP resources via ListResourcesRequestSchema', async () => {
    const srv = createMcpServer();
    const listHandler = srv._requestHandlers?.get(ListResourcesRequestSchema.shape.method.value);
    expect(listHandler).toBeDefined();

    const result = await listHandler({ method: 'resources/list', params: {} });
    expect(result.resources).toBeDefined();
    expect(result.resources.length).toBeGreaterThanOrEqual(3);

    const uris = result.resources.map((r) => r.uri);
    expect(uris).toContain('xactions://platforms');
    expect(uris).toContain('xactions://actions');
    expect(uris).toContain('xactions://system/status');
  });

  it('reads xactions://platforms resource', async () => {
    const srv = createMcpServer();
    const readHandler = srv._requestHandlers?.get(ReadResourceRequestSchema.shape.method.value);
    expect(readHandler).toBeDefined();

    const result = await readHandler({
      method: 'resources/read',
      params: { uri: 'xactions://platforms' },
    });
    expect(result.contents).toBeDefined();
    expect(result.contents[0].uri).toBe('xactions://platforms');
    expect(result.contents[0].mimeType).toBe('application/json');

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.platforms).toBeDefined();
    expect(Array.isArray(parsed.platforms)).toBe(true);
  });

  it('reads xactions://system/status resource', async () => {
    const srv = createMcpServer();
    const readHandler = srv._requestHandlers?.get(ReadResourceRequestSchema.shape.method.value);
    expect(readHandler).toBeDefined();

    const result = await readHandler({
      method: 'resources/read',
      params: { uri: 'xactions://system/status' },
    });
    expect(result.contents).toBeDefined();
    expect(result.contents[0].uri).toBe('xactions://system/status');
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.version).toBeDefined();
    expect(parsed.mode).toBeDefined();
  });

  it('read resource throws PlatformError when uri is not found', async () => {
    const srv = createMcpServer();
    const readHandler = srv._requestHandlers?.get(ReadResourceRequestSchema.shape.method.value);
    expect(readHandler).toBeDefined();

    await expect(
      readHandler({ method: 'resources/read', params: { uri: 'xactions://unknown/uri' } })
    ).rejects.toThrow(/Resource not found/);
  });

  it('lists MCP prompts via ListPromptsRequestSchema', async () => {
    const srv = createMcpServer();
    const promptHandler = srv._requestHandlers?.get(ListPromptsRequestSchema.shape.method.value);
    expect(promptHandler).toBeDefined();

    const result = await promptHandler({ method: 'prompts/list', params: {} });
    expect(result.prompts).toBeDefined();
    const names = result.prompts.map((p) => p.name);
    expect(names).toContain('x_growth_strategy');
    expect(names).toContain('x_viral_thread');
    expect(names).toContain('x_reputation_audit');
  });

  it('gets x_viral_thread prompt message', async () => {
    const srv = createMcpServer();
    const getPromptHandler = srv._requestHandlers?.get(GetPromptRequestSchema.shape.method.value);
    expect(getPromptHandler).toBeDefined();

    const result = await getPromptHandler({
      method: 'prompts/get',
      params: {
        name: 'x_viral_thread',
        arguments: { topic: 'Artificial Intelligence in 2026', tone: 'visionary' },
      },
    });

    expect(result.messages).toBeDefined();
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.text).toContain('Artificial Intelligence in 2026');
    expect(result.messages[0].content.text).toContain('visionary');
  });

  it('get prompt throws PlatformError when prompt name is not found', async () => {
    const srv = createMcpServer();
    const getPromptHandler = srv._requestHandlers?.get(GetPromptRequestSchema.shape.method.value);
    expect(getPromptHandler).toBeDefined();

    await expect(
      getPromptHandler({ method: 'prompts/get', params: { name: 'non_existent_prompt' } })
    ).rejects.toThrow(/Prompt not found/);
  });
});
