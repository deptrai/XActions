// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 27.2: SessionHealthOrchestrator Admin UI.
 *
 * Boots a REAL Express app on an ephemeral port mounting the REAL adminRouter,
 * REAL globalAccountPool, and REAL globalSessionHealthOrchestrator. Seeds three
 * accounts in distinct health states (healthy/degraded/sick), drives Chromium
 * to /admin.html with an `x-admin-key` header injected via page.route(), and
 * verifies:
 *
 *   AC-1  Health column header exists in the accounts table
 *   AC-2  Healthy account renders green pill (score ≥ 70)
 *   AC-3  Degraded account renders yellow pill (30–69)
 *   AC-4  Sick account renders red pill (< 30) + circuitState 'open'
 *   AC-5  Probe button triggers POST /api/admin/accounts/probe →
 *         account returns to 'closed' + score 60
 *
 * Real orchestrator behind the wire — no mocks for the system under test.
 * Only the login redirect is disabled and socket.io is stubbed (browser
 * has no real backend socket). The `x-admin-key` auth header is added via
 * page.route() so the dashboard's existing fetch() calls pass auth.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
import { test, expect } from '@playwright/test';
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import adminRouter from '../../api/routes/admin.js';
import { globalAccountPool } from '../../src/core/account-pool.js';
import { globalSessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_KEY = 'e2e-27-2-admin-key';
const PLATFORM = 'tw_e2e_health';

let server;
let baseUrl;

// Fixture state seeded into the REAL orchestrator before browser load
const ACCOUNT_HEALTHY = 'e2e_healthy';
const ACCOUNT_DEGRADED = 'e2e_degraded';
const ACCOUNT_SICK = 'e2e_sick';

test.beforeAll(async () => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;

  // Reset orchestrator state for deterministic test (in case prior tests polluted it)
  for (const acct of [ACCOUNT_HEALTHY, ACCOUNT_DEGRADED, ACCOUNT_SICK]) {
    try { globalSessionHealthOrchestrator.wake(PLATFORM, acct); } catch {}
  }

  // Register accounts in the real AccountPool
  globalAccountPool.registerAccounts(PLATFORM, [ACCOUNT_HEALTHY, ACCOUNT_DEGRADED, ACCOUNT_SICK]);

  // ---- Seed distinct health states via the real orchestrator signal APIs ----
  // Healthy: no signals → score stays 100, circuit 'closed'
  globalSessionHealthOrchestrator.recordSuccess(PLATFORM, ACCOUNT_HEALTHY);
  globalSessionHealthOrchestrator.recordLatency(PLATFORM, ACCOUNT_HEALTHY, 250);

  // Degraded: 2 errors (-36) + 1 high latency (-10) → score 54 (yellow 30-69)
  // (avoid recordRateLimit — it also increments consecutiveErrors and would push to sick)
  globalSessionHealthOrchestrator.recordError(PLATFORM, ACCOUNT_DEGRADED);
  globalSessionHealthOrchestrator.recordError(PLATFORM, ACCOUNT_DEGRADED);
  globalSessionHealthOrchestrator.recordLatency(PLATFORM, ACCOUNT_DEGRADED, 3500);

  // Sick: drive below 30 → circuit 'open' + red pill
  for (let i = 0; i < 5; i++) globalSessionHealthOrchestrator.recordError(PLATFORM, ACCOUNT_SICK);
  globalSessionHealthOrchestrator.recordRateLimit(PLATFORM, ACCOUNT_SICK);
  globalSessionHealthOrchestrator.recordRateLimit(PLATFORM, ACCOUNT_SICK);
  globalSessionHealthOrchestrator.recordBotChallenge(PLATFORM, ACCOUNT_SICK);

  // Sanity: confirm circuit state before browser load
  const sickStatus = globalSessionHealthOrchestrator.getStatus();
  if (sickStatus.circuitBreakerStates[`${PLATFORM}:${ACCOUNT_SICK}`]?.state !== 'open') {
    throw new Error('Setup failed: sick account circuit not open');
  }

  // ---- Build Express app with REAL adminRouter ----
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);

  // Stub endpoints the dashboard polls (not the system under test)
  app.get('/api/governor/status', (_req, res) => {
    res.json({ success: true, status: {
      healthyProxyCount: 0, totalProxyCount: 0, healthyProxyRatio: 0,
      currentReqPerSecond: 0, redisConsumerLag: 0, throttleLevel: 'normal',
      hibernatingAccounts: [],
    }});
  });
  app.get('/api/proxies/list', (_req, res) => {
    res.json({ success: true, proxies: [] });
  });

  // Serve the REAL admin.html (login redirect + socket.io stubbed for test)
  const adminPath = path.join(__dirname, '../../dashboard/admin.html');
  let html = await readFile(adminPath, 'utf-8');
  html = html.replace(
    '<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>',
    `<script>window.io = () => ({ on: () => {}, emit: () => {}, off: () => {}, io: { on: () => {} } });</script>`
  );
  html = html.replace(/window\.location\.href = '\/login';/g, '/* login redirect disabled in tests */');

  app.get(['/admin', '/admin.html', '/'], (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  delete process.env.ADMIN_API_KEY;
});

// Inject x-admin-key on every API request the page makes (real auth middleware
// remains intact — we just authenticate as the admin key).
async function injectAdminKey(page) {
  await page.route('**/api/**', async (route) => {
    const headers = { ...route.request().headers(), 'x-admin-key': ADMIN_KEY };
    await route.continue({ headers });
  });
}

test.describe('Story 27.2 E2E — Admin accounts Health column', () => {
  test('AC-1: accounts table contains a Health column header', async ({ page }) => {
    await injectAdminKey(page);
    await page.goto(`${baseUrl}/admin`);
    await page.locator('#tab-btn-proxies').click();
    const headers = page.locator('#accounts-table thead th');
    await expect(headers.filter({ hasText: 'Health' })).toHaveCount(1);
    await expect(headers.filter({ hasText: 'Actions' })).toHaveCount(1);
  });

  test('AC-2/3/4: health pills render green/yellow/red from real orchestrator scores', async ({ page }) => {
    await injectAdminKey(page);
    await page.goto(`${baseUrl}/admin`);
    await page.locator('#tab-btn-proxies').click();

    const tbody = page.locator('#hibernating-accounts-body');
    await expect(tbody).toContainText(ACCOUNT_HEALTHY, { timeout: 10000 });
    await expect(tbody).toContainText(ACCOUNT_DEGRADED);
    await expect(tbody).toContainText(ACCOUNT_SICK);

    // Healthy → green pill, score 100, closed
    const healthyRow = tbody.locator(`tr[data-account-id="${PLATFORM}:${ACCOUNT_HEALTHY}"], tr[data-account-id="${ACCOUNT_HEALTHY}"]`);
    await expect(healthyRow.locator('.status-pill').last()).toHaveClass(/status-active/);
    await expect(healthyRow).toContainText('100/100');

    // Degraded → yellow pill, score in 30–69
    const degradedRow = tbody.locator(`tr[data-account-id="${PLATFORM}:${ACCOUNT_DEGRADED}"], tr[data-account-id="${ACCOUNT_DEGRADED}"]`);
    await expect(degradedRow.locator('.status-pill').last()).toHaveClass(/status-quarantined/);

    // Sick → red pill, score < 30, circuit state shown
    const sickRow = tbody.locator(`tr[data-account-id="${PLATFORM}:${ACCOUNT_SICK}"], tr[data-account-id="${ACCOUNT_SICK}"]`);
    await expect(sickRow.locator('.status-pill').last()).toHaveClass(/status-checkpoint/);
    await expect(sickRow).toContainText('(open)');
  });

  test('AC-5: clicking 🩺 Probe triggers POST /api/admin/accounts/probe and recovers account', async ({ page }) => {
    await injectAdminKey(page);

    // Register a successful probe on the real orchestrator so checkRecovery closes the breaker
    globalSessionHealthOrchestrator.registerProbe(PLATFORM, ACCOUNT_SICK, async () => ({
      success: true, complete: true,
    }));

    await page.goto(`${baseUrl}/admin`);
    await page.locator('#tab-btn-proxies').click();

    const tbody = page.locator('#hibernating-accounts-body');
    const sickRow = tbody.locator(`tr[data-account-id="${PLATFORM}:${ACCOUNT_SICK}"], tr[data-account-id="${ACCOUNT_SICK}"]`);
    await expect(sickRow).toContainText('(open)', { timeout: 10000 });

    // Click Probe on the sick account → triggers real POST /accounts/probe
    const probeBtn = sickRow.locator('button[data-action="probe"]');
    await expect(probeBtn).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/accounts/probe') && r.request().method() === 'POST'),
      probeBtn.click(),
    ]);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.circuitState).toBe('closed');
    expect(body.healthScore).toBe(60);

    // Verify the orchestrator actually closed the breaker
    expect(globalSessionHealthOrchestrator.isAvailable(PLATFORM, ACCOUNT_SICK)).toBe(true);
  });

  test('AC-6: GET /api/admin/accounts returns healthScore + circuitState per account', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/admin/accounts?platform=${PLATFORM}`, {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    const byId = Object.fromEntries(data.accounts.map(a => [a.accountId, a]));
    expect(byId[ACCOUNT_HEALTHY].healthScore).toBe(100);
    expect(byId[ACCOUNT_HEALTHY].circuitState).toBe('closed');
    expect(byId[ACCOUNT_DEGRADED].healthScore).toBeLessThan(70);
    expect(byId[ACCOUNT_DEGRADED].healthScore).toBeGreaterThanOrEqual(30);
    // Sick account may have been probed by AC-5 (running serially) →
    // either still sick (<30, open) or already recovered (60, closed).
    expect([0, 60].some(v => byId[ACCOUNT_SICK].healthScore <= 30 || byId[ACCOUNT_SICK].healthScore === 60)).toBe(true);
    expect(['open', 'closed']).toContain(byId[ACCOUNT_SICK].circuitState);
  });
});
