// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 19.10 — Extended Edge-Case & Contract Tests for Admin MCP Tools
 *
 * Mở rộng kiểm thử:
 * 1. x_admin_status với dual pool partition
 * 2. x_admin_proxy_quarantine: validation failure (thiếu proxy, proxy không thuộc pool)
 * 3. x_admin_account_wake: account not found (XACT_4041)
 * 4. x_admin_checkpoint_action: invalid action type, pause running checkpoint, invalid state resume
 * 5. x_admin_stream_alerts: test trigger flag
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import prisma from '../../api/lib/prisma.js';

let mod;
let adminUser;
let adminToken;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';

async function executeAdminTool(name, args = {}) {
  return mod.executeTool(name, args);
}

describe('Story 19.10 — Admin MCP Tools (Extended Test Suite)', () => {
  beforeAll(async () => {
    // Tạo admin user cho extended test suite
    adminUser = await prisma.user.upsert({
      where: { email: 'e2e_mcp_admin_ext@xactions.test' },
      create: {
        email: 'e2e_mcp_admin_ext@xactions.test',
        username: 'e2e_mcp_admin_ext',
        password: 'e2e-password',
        isAdmin: true,
      },
      update: { isAdmin: true },
    });

    adminToken = jwt.sign({ userId: adminUser.id, isAdmin: true }, JWT_SECRET, { expiresIn: '1h' });

    process.env.XACTIONS_MODE = 'local';
    mod = await import('../../src/mcp/server.js');
    await mod.initializeBackend();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: 'e2e_mcp_admin_ext@xactions.test' },
    });
  });

  it('[P0] x_admin_status includes dualPool breakdown and throttle level', async () => {
    const result = await executeAdminTool('x_admin_status', { token: adminToken });
    expect(result.throttleLevel).toBeDefined();
    expect(result.dualPool).toBeDefined();
    expect(result.dualPool.realtime).toBeDefined();
    expect(result.dualPool.bulk).toBeDefined();
  });

  it('[P1] x_admin_proxy_quarantine fails with XACT_4001 when proxy is not in pool', async () => {
    await expect(
      executeAdminTool('x_admin_proxy_quarantine', {
        token: adminToken,
        proxy: 'http://non-existent-proxy:9999',
      })
    ).rejects.toMatchObject({ code: 'XACT_4001' });
  });

  it('[P1] x_admin_proxy_quarantine fails with XACT_4001 when proxy arg is missing', async () => {
    await expect(
      executeAdminTool('x_admin_proxy_quarantine', {
        token: adminToken,
      })
    ).rejects.toMatchObject({ code: 'XACT_4001' });
  });

  it('[P0] x_admin_account_wake fails with XACT_4041 when account does not exist', async () => {
    await expect(
      executeAdminTool('x_admin_account_wake', {
        token: adminToken,
        accountId: 'totally_unknown_account_xyz',
      })
    ).rejects.toMatchObject({ code: 'XACT_4041' });
  });

  it('[P0] x_admin_checkpoint_action rejects invalid action with XACT_4002', async () => {
    await expect(
      executeAdminTool('x_admin_checkpoint_action', {
        token: adminToken,
        id: 'some_cp_id',
        action: 'invalid_action_name',
      })
    ).rejects.toMatchObject({ code: 'XACT_4002' });
  });

  it('[P1] x_admin_checkpoint_action pause pauses a running checkpoint', async () => {
    const cpId = 'cp_ext_pause_test';
    await prisma.crawlCheckpoint.upsert({
      where: { id: cpId },
      create: {
        id: cpId,
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'user_pause_target',
        status: 'running',
      },
      update: { status: 'running' },
    });

    const result = await executeAdminTool('x_admin_checkpoint_action', {
      token: adminToken,
      id: cpId,
      action: 'pause',
    });

    expect(result.success).toBe(true);
    expect(result.data.checkpoint.status).toBe('paused');

    await prisma.crawlCheckpoint.delete({ where: { id: cpId } });
  });

  it('[P1] x_admin_checkpoint_action resume fails with XACT_4002 on completed checkpoint', async () => {
    const cpId = 'cp_ext_completed_test';
    await prisma.crawlCheckpoint.upsert({
      where: { id: cpId },
      create: {
        id: cpId,
        platform: 'twitter',
        targetType: 'profile',
        targetKey: 'user_completed_target',
        status: 'completed',
      },
      update: { status: 'completed' },
    });

    await expect(
      executeAdminTool('x_admin_checkpoint_action', {
        token: adminToken,
        id: cpId,
        action: 'resume',
      })
    ).rejects.toMatchObject({ code: 'XACT_4002' });

    await prisma.crawlCheckpoint.delete({ where: { id: cpId } });
  });

  it('[P2] x_admin_stream_alerts test triggers synthetic alert', async () => {
    const result = await executeAdminTool('x_admin_stream_alerts', {
      token: adminToken,
      test: true,
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('Test alert sent');
  });
});
