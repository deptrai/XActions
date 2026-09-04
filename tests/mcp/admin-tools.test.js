// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 19.10 — Admin MCP Tools for AI Agents
 *
 * Tests the admin tool definitions in TOOLS and the executeTool/executeAdminTool
 * dispatcher end-to-end with real singletons and Prisma. No mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import prisma from '../../api/lib/prisma.js';

let mod;
let adminUser;
let nonAdminUser;
let adminToken;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';

async function executeAdminTool(name, args = {}) {
  return mod.executeTool(name, args);
}

describe('Story 19.10 — Admin MCP Tools', () => {
  beforeAll(async () => {
    // Wipe any prior E2E test users
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['e2e_mcp_admin@xactions.test', 'e2e_mcp_user@xactions.test'],
        },
      },
    });

    adminUser = await prisma.user.create({
      data: {
        email: 'e2e_mcp_admin@xactions.test',
        username: 'e2e_mcp_admin',
        password: 'e2e-password',
        isAdmin: true,
      },
    });

    nonAdminUser = await prisma.user.create({
      data: {
        email: 'e2e_mcp_user@xactions.test',
        username: 'e2e_mcp_user',
        password: 'e2e-password',
        isAdmin: false,
      },
    });

    adminToken = jwt.sign({ userId: adminUser.id, isAdmin: true }, JWT_SECRET, { expiresIn: '1h' });

    // Initialize local backend so singletons are loaded without starting stdio.
    process.env.XACTIONS_MODE = 'local';
    mod = await import('../../src/mcp/server.js');
    await mod.initializeBackend();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [adminUser.id, nonAdminUser.id] } },
    });
    if (process.env.XACTIONS_MODE === undefined) delete process.env.XACTIONS_MODE;
  });

  it('TOOLS array includes all 9 x_admin_* tools', () => {
    const expected = [
      'x_admin_status',
      'x_admin_proxies_list',
      'x_admin_proxy_quarantine',
      'x_admin_accounts_list',
      'x_admin_account_wake',
      'x_admin_checkpoints_list',
      'x_admin_checkpoint_action',
      'x_admin_stream_metrics',
      'x_admin_stream_alerts',
    ];
    for (const name of expected) {
      const tool = mod.TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined(`${name} must be in TOOLS`);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('x_admin_status with non-admin token returns XACT_4003', async () => {
    const nonAdminToken = jwt.sign({ userId: nonAdminUser.id, isAdmin: false }, JWT_SECRET, { expiresIn: '1h' });
    await expect(executeAdminTool('x_admin_status', { token: nonAdminToken })).rejects.toMatchObject({
      code: 'XACT_4003',
    });
  });

  it('x_admin_status with missing auth returns XACT_4003', async () => {
    await expect(executeAdminTool('x_admin_status', {})).rejects.toMatchObject({
      code: 'XACT_4003',
    });
  });

  it('x_admin_status with admin token returns governor status', async () => {
    const result = await executeAdminTool('x_admin_status', { token: adminToken });
    expect(typeof result.healthyProxyCount).toBe('number');
    expect(Array.isArray(result.hibernatingAccounts)).toBe(true);
  });

  it('x_admin_proxies_list returns proxy list after seeding', async () => {
    const { globalProxyPool } = await import('../../src/proxy/proxy-pool.js');
    globalProxyPool.add('http://9.9.9.9:8080');

    const result = await executeAdminTool('x_admin_proxies_list', { token: adminToken });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.proxies)).toBe(true);
    const found = result.proxies.find((p) => p.key === 'http://9.9.9.9:8080');
    expect(found).toBeDefined();
    expect(found.status).toBe('healthy');

    globalProxyPool.release('http://9.9.9.9:8080');
  });

  it('x_admin_proxy_quarantine marks proxy as quarantined', async () => {
    const { globalProxyPool } = await import('../../src/proxy/proxy-pool.js');
    globalProxyPool.add('http://9.9.9.10:8080');

    const result = await executeAdminTool('x_admin_proxy_quarantine', {
      token: adminToken,
      proxy: 'http://9.9.9.10:8080',
      durationMs: 60000,
    });
    expect(result.success).toBe(true);
    expect(result.quarantined).toBe('http://9.9.9.10:8080');

    globalProxyPool.release('http://9.9.9.10:8080');
  });

  it('x_admin_accounts_list returns registered accounts', async () => {
    const { globalAccountPool } = await import('../../src/core/account-pool.js');
    globalAccountPool.registerAccounts('twitter', ['e2e_mcp_twitter_01']);

    const result = await executeAdminTool('x_admin_accounts_list', { token: adminToken, platform: 'twitter' });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.accounts)).toBe(true);
    const found = result.accounts.find((a) => a.accountId === 'e2e_mcp_twitter_01');
    expect(found).toBeDefined();
  });

  it('x_admin_account_wake wakes a hibernating account', async () => {
    const { globalAccountPool } = await import('../../src/core/account-pool.js');
    globalAccountPool.registerAccounts('twitter', ['e2e_mcp_twitter_02']);
    globalAccountPool.markUnavailable('e2e_mcp_twitter_02', 'rate_limit', 60 * 60 * 1000, 'twitter');

    const result = await executeAdminTool('x_admin_account_wake', {
      token: adminToken,
      accountId: 'e2e_mcp_twitter_02',
      platform: 'twitter',
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe('active');
  });

  it('x_admin_account_wake on active account returns XACT_4090', async () => {
    const { globalAccountPool } = await import('../../src/core/account-pool.js');
    globalAccountPool.registerAccounts('twitter', ['e2e_mcp_twitter_03']);

    await expect(
      executeAdminTool('x_admin_account_wake', {
        token: adminToken,
        accountId: 'e2e_mcp_twitter_03',
        platform: 'twitter',
      })
    ).rejects.toMatchObject({ code: 'XACT_4090' });
  });

  it('x_admin_checkpoints_list lists checkpoints', async () => {
    const cpId = 'cp_mcp_test_01';
    await prisma.crawlCheckpoint.upsert({
      where: { id: cpId },
      create: {
        id: cpId,
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'mcp_test_user',
        status: 'failed',
      },
      update: { status: 'failed' },
    });

    const result = await executeAdminTool('x_admin_checkpoints_list', { token: adminToken, limit: 50 });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.checkpoints)).toBe(true);
    const found = result.data.checkpoints.find((cp) => cp.id === cpId);
    expect(found).toBeDefined();

    await prisma.crawlCheckpoint.delete({ where: { id: cpId } });
  });

  it('x_admin_checkpoint_action retry transitions failed to running', async () => {
    const cpId = 'cp_mcp_test_02';
    await prisma.crawlCheckpoint.upsert({
      where: { id: cpId },
      create: {
        id: cpId,
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'mcp_test_user2',
        status: 'failed',
      },
      update: { status: 'failed' },
    });

    const result = await executeAdminTool('x_admin_checkpoint_action', {
      token: adminToken,
      id: cpId,
      action: 'retry',
    });
    expect(result.success).toBe(true);
    expect(result.data.checkpoint.status).toBe('running');

    await prisma.crawlCheckpoint.delete({ where: { id: cpId } });
  });

  it('x_admin_stream_metrics returns metrics', async () => {
    const result = await executeAdminTool('x_admin_stream_metrics', { token: adminToken });
    expect(result.success).toBe(true);
    expect(typeof result.metrics.eventsPerSecond).toBe('number');
    expect(typeof result.metrics.pendingMessages).toBe('number');
  });

  it('x_admin_stream_alerts returns alert status', async () => {
    const result = await executeAdminTool('x_admin_stream_alerts', { token: adminToken });
    expect(result.success).toBe(true);
    expect(typeof result.alerts.totalAlertsTriggered).toBe('number');
  });
});
