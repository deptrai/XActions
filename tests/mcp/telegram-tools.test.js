// @ts-nocheck
// tests/mcp/telegram-tools.test.js
// Story 54.6 — Telegram MCP dedicated tools tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { TOOLS, executeTool } from '../../src/mcp/server.js';

describe('Story 54.6 — Telegram MCP Tools', () => {
  it('T-1: x_telegram_channels and x_telegram_search are registered in TOOLS', () => {
    const channelTool = TOOLS.find((t) => t.name === 'x_telegram_channels');
    const searchTool = TOOLS.find((t) => t.name === 'x_telegram_search');

    expect(channelTool).toBeDefined();
    expect(channelTool.inputSchema.required).toEqual(['channel']);

    expect(searchTool).toBeDefined();
    expect(searchTool.inputSchema.required).toEqual(['query']);
  });

  it('T-2: executeTool(x_telegram_channels) with dryRun returns preview envelope', async () => {
    const res = await executeTool('x_telegram_channels', {
      channel: 'durov',
      limit: 10,
      dryRun: true,
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    // Envelope contract (x_scrape precedent): data = records array, dryRun
    // payload lives in the first record.
    expect(res.data[0].dryRun).toBe(true);
    expect(res.data[0].channel).toBe('durov');
    // Envelope meta (wrapToolResult): {tool, durationMs, totalRecords};
    // platform/action live on meta.platform + record _metadata.
    expect(res.meta.platform ?? res.platform).toBe('telegram');
    expect(res.data[0]._metadata.platform).toBe('telegram');
    expect(res.data[0]._metadata.action).toBe('channel_messages');
  });

  it('T-3: executeTool(x_telegram_search) with dryRun returns preview envelope', async () => {
    const res = await executeTool('x_telegram_search', {
      query: 'crypto signals',
      limit: 5,
      dryRun: true,
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data[0].dryRun).toBe(true);
    expect(res.data[0].query).toBe('crypto signals');
    expect(res.meta.platform ?? res.platform).toBe('telegram');
    expect(res.data[0]._metadata.platform).toBe('telegram');
    expect(res.data[0]._metadata.action).toBe('search_channels');
  });

  it('T-4: executeTool(x_telegram_channels) throws XACT_4002 when channel is missing', async () => {
    await expect(executeTool('x_telegram_channels', {})).rejects.toMatchObject({
      code: 'XACT_4002',
    });
  });

  it('T-5: executeTool(x_telegram_search) throws XACT_4002 when query is missing', async () => {
    await expect(executeTool('x_telegram_search', {})).rejects.toMatchObject({
      code: 'XACT_4002',
    });
  });
});
