// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.2 — Admin accounts healthScore and probe endpoint tests.
 * Real Express app + real router handlers + real AccountPool + real SessionHealthOrchestrator.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import adminRouter from '../../api/routes/admin.js';
import { globalAccountPool } from '../../src/core/account-pool.js';
import { globalSessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';

describe('Story 27.2 — Admin accounts health & probe API', () => {
  let server;
  let baseUrl;

  const adminKey = 'test-admin-key-for-accounts-health';

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = adminKey;

    // Register test accounts in globalAccountPool
    globalAccountPool.registerAccounts('tw_health', ['alice_h', 'bob_h']);

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('[P0] GET /api/admin/accounts includes healthScore and circuitState', async () => {
    // Feed one error to bob_h so score differs
    globalSessionHealthOrchestrator.recordError('tw_health', 'bob_h');

    const res = await fetch(`${baseUrl}/api/admin/accounts?platform=tw_health`, { headers: { 'x-admin-key': adminKey } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.accounts)).toBe(true);
    expect(data.accounts.length).toBeGreaterThanOrEqual(2);

    const alice = data.accounts.find((a) => a.accountId === 'alice_h');
    const bob = data.accounts.find((a) => a.accountId === 'bob_h');
    expect(alice).toBeDefined();
    expect(alice.healthScore).toBe(100);
    expect(alice.circuitState).toBe('closed');

    expect(bob).toBeDefined();
    expect(bob.healthScore).toBe(82);
    expect(bob.circuitState).toBe('closed');
  });

  it('[P0] POST /api/admin/accounts/probe triggers recovery check', async () => {
    // Drive an account to sick (<30)
    for (let i = 0; i < 5; i++) globalSessionHealthOrchestrator.recordError('tw_health', 'probe_target');
    globalSessionHealthOrchestrator.recordRateLimit('tw_health', 'probe_target');
    globalSessionHealthOrchestrator.recordRateLimit('tw_health', 'probe_target');
    globalSessionHealthOrchestrator.recordBotChallenge('tw_health', 'probe_target');
    globalAccountPool.registerAccounts('tw_health', ['probe_target']);
    expect(globalSessionHealthOrchestrator.isAvailable('tw_health', 'probe_target')).toBe(false);

    // Register a successful probe
    globalSessionHealthOrchestrator.registerProbe('tw_health', 'probe_target', async () => ({
      success: true, complete: true,
    }));

    // Cooldown: probe immediately (half-open will be forced by probe endpoint)
    const res = await fetch(`${baseUrl}/api/admin/accounts/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ accountId: 'probe_target', platform: 'tw_health' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.accountId).toBe('probe_target');
    expect(data.circuitState).toBe('closed');
    expect(data.healthScore).toBe(60);
  });

  it('[P1] POST /api/admin/accounts/probe validates missing accountId', async () => {
    const res = await fetch(`${baseUrl}/api/admin/accounts/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
