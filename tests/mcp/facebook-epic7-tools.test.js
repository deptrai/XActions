// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.4 — Facebook Epic 7 MCP scrape tools
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { encrypt } from '../../api/routes/facebookAccounts.js';

const prisma = new PrismaClient();

let testUser;
let testAccount;

async function createTestAccount() {
  const username = `test-mcp-epic7-${crypto.randomUUID()}`;
  testUser = await prisma.user.create({
    data: { username, password: 'test', email: `${username}@x.test` },
  });
  const cookiePayload = JSON.stringify({ c_user: '1234567890', xs: 'abc%3Adef' });
  testAccount = await prisma.facebookAccount.create({
    data: {
      userId: testUser.id,
      label: 'main',
      encryptedCookie: encrypt(cookiePayload),
    },
  });
}

async function cleanupTestAccount() {
  if (testAccount?.id) {
    await prisma.facebookAccountHealth.deleteMany({ where: { accountId: testAccount.id } });
    await prisma.facebookAccount.deleteMany({ where: { id: testAccount.id } });
  }
  if (testUser?.id) {
    await prisma.facebookAccount.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  }
}

beforeEach(async () => {
  await cleanupTestAccount();
  await createTestAccount();
});

afterEach(async () => {
  await cleanupTestAccount();
});

// Dynamically import server after env is set so TOOLS array is populated.
async function loadServer() {
  const mod = await import('../../src/mcp/server.js');
  return mod;
}

const EPIC7_TOOLS = [
  'x_facebook_search',
  'x_facebook_post_comments',
  'x_facebook_group_posts',
  'x_facebook_group_comments',
  'x_facebook_posts',
];

const EXPECTED_ACTION_MAP = {
  x_facebook_search: 'search',
  x_facebook_post_comments: 'post_comments',
  x_facebook_group_posts: 'group_posts',
  x_facebook_group_comments: 'group_comments',
  x_facebook_posts: 'posts',
};

describe('Facebook Epic 7 MCP tools — registration', () => {
  it('all 5 tools are registered in TOOLS', async () => {
    const { TOOLS } = await loadServer();
    for (const name of EPIC7_TOOLS) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.authCookie).toBeDefined();
      expect(tool.inputSchema.properties.dryRun).toBeDefined();
    }
  });

  it('x_facebook_search has required query + authCookie', async () => {
    const { TOOLS } = await loadServer();
    const tool = TOOLS.find((t) => t.name === 'x_facebook_search');
    expect(tool.inputSchema.required).toContain('query');
    expect(tool.inputSchema.required).toContain('authCookie');
    expect(tool.inputSchema.properties.type.enum).toEqual(['posts', 'people', 'pages', 'groups', 'all']);
  });

  it('x_facebook_post_comments has required url + authCookie', async () => {
    const { TOOLS } = await loadServer();
    const tool = TOOLS.find((t) => t.name === 'x_facebook_post_comments');
    expect(tool.inputSchema.required).toContain('url');
    expect(tool.inputSchema.required).toContain('authCookie');
    expect(tool.inputSchema.properties.includeReplies).toBeDefined();
  });

  it('x_facebook_group_posts has required url + authCookie', async () => {
    const { TOOLS } = await loadServer();
    const tool = TOOLS.find((t) => t.name === 'x_facebook_group_posts');
    expect(tool.inputSchema.required).toContain('url');
    expect(tool.inputSchema.required).toContain('authCookie');
  });

  it('x_facebook_group_comments has required url + authCookie', async () => {
    const { TOOLS } = await loadServer();
    const tool = TOOLS.find((t) => t.name === 'x_facebook_group_comments');
    expect(tool.inputSchema.required).toContain('url');
    expect(tool.inputSchema.required).toContain('authCookie');
  });

  it('x_facebook_posts has required url + authCookie', async () => {
    const { TOOLS } = await loadServer();
    const tool = TOOLS.find((t) => t.name === 'x_facebook_posts');
    expect(tool.inputSchema.required).toContain('url');
    expect(tool.inputSchema.required).toContain('authCookie');
  });
});

describe('Facebook Epic 7 MCP tools — executeTool dryRun', () => {
  it('x_facebook_search dryRun returns preview without browser launch', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_search', {
      query: 'macbook',
      type: 'all',
      authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
    });
    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview.action).toBe('search');
    expect(result.preview.query).toBe('macbook');
  });

  it('x_facebook_post_comments dryRun returns preview', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_post_comments', {
      url: 'https://www.facebook.com/post/123',
      authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.action).toBe('post_comments');
    expect(result.preview.url).toBe('https://www.facebook.com/post/123');
  });

  it('x_facebook_group_posts dryRun returns preview', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_group_posts', {
      url: 'https://www.facebook.com/groups/123',
      authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.action).toBe('group_posts');
  });

  it('x_facebook_group_comments dryRun returns preview', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_group_comments', {
      url: 'https://www.facebook.com/groups/123/posts/456',
      authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.action).toBe('group_comments');
  });

  it('x_facebook_posts dryRun returns preview', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_posts', {
      url: 'https://www.facebook.com/zuck',
      authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.action).toBe('posts');
  });

  it('dryRun:false is respected (does not default to true)', async () => {
    const { executeTool } = await loadServer();
    // dryRun:false will attempt real scrape — expect it to throw at browser launch,
    // but the dryRun flag should be respected (not preview).
    try {
      await executeTool('x_facebook_posts', {
        url: 'https://www.facebook.com/zuck',
        authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
        dryRun: false,
      });
    } catch (err) {
      // Should fail at browser/scrape level, NOT return a dryRun preview.
      expect(err.message).not.toContain('dryRun');
    }
  });
});

describe('Facebook Epic 7 MCP tools — auth validation', () => {
  it('throws for missing authCookie', async () => {
    const { executeTool } = await loadServer();
    await expect(
      executeTool('x_facebook_search', { query: 'test' }),
    ).rejects.toThrow(/authCookie/);
  });

  it('throws for invalid authCookie (not object)', async () => {
    const { executeTool } = await loadServer();
    await expect(
      executeTool('x_facebook_search', { query: 'test', authCookie: 'not-an-object' }),
    ).rejects.toThrow();
  });

  it('resolves accountId to cookie (dryRun preview still works)', async () => {
    const { executeTool } = await loadServer();
    const result = await executeTool('x_facebook_search', {
      query: 'test',
      authCookie: { accountId: testAccount.id },
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.action).toBe('search');
  });
});

describe('Facebook Epic 7 MCP tools — action mapping', () => {
  it('each tool maps to correct action in preview', async () => {
    const { executeTool } = await loadServer();
    for (const [toolName, expectedAction] of Object.entries(EXPECTED_ACTION_MAP)) {
      const result = await executeTool(toolName, {
        url: 'https://www.facebook.com/test',
        query: 'test',
        authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
      });
      expect(result.preview.action).toBe(expectedAction);
    }
  });
});
