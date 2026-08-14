// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — MCP Facebook account management tools contract tests.
// by nichxbt

import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TOOLS, executeFacebookListAccounts } from '../../src/mcp/server.js';

const findTool = (name) => TOOLS.find((t) => t.name === name);

describe('x_facebook_list_accounts tool schema', () => {
  it('tool is registered in TOOLS array', () => {
    expect(findTool('x_facebook_list_accounts')).toBeDefined();
  });

  it('has userId string field', () => {
    const userId = findTool('x_facebook_list_accounts')?.inputSchema?.properties?.userId;
    expect(userId).toBeDefined();
    expect(userId.type).toBe('string');
  });

  it('has authCookie object field with accountId', () => {
    const authCookie = findTool('x_facebook_list_accounts')?.inputSchema?.properties?.authCookie;
    expect(authCookie).toBeDefined();
    expect(authCookie.type).toBe('object');
    expect(authCookie.properties).toHaveProperty('accountId');
    expect(authCookie.required).toContain('accountId');
  });

  it('requires either userId or authCookie', () => {
    const anyOf = findTool('x_facebook_list_accounts')?.inputSchema?.anyOf ?? [];
    const requiredSets = anyOf.map((o) => o.required?.sort());
    expect(requiredSets).toContainEqual(['authCookie']);
    expect(requiredSets).toContainEqual(['userId']);
  });
});

describe('executeFacebookListAccounts', () => {
  it('throws when neither userId nor authCookie.accountId is provided', async () => {
    await expect(executeFacebookListAccounts({})).rejects.toThrow('userId or authCookie.accountId');
  });

  it('throws for unknown accountId', async () => {
    await expect(
      executeFacebookListAccounts({ authCookie: { accountId: 'does-not-exist' } }),
    ).rejects.toThrow('does-not-exist');
  });

  it('returns empty array for unknown userId', async () => {
    const result = await executeFacebookListAccounts({ userId: 'does-not-exist' });
    expect(result.accounts).toEqual([]);
  });
});
