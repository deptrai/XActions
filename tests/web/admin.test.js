// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 48.4 — Next.js Admin & Infrastructure Control Console Tests (/admin)
 *
 * Verifies that:
 *   - apps/web/app/admin/page.tsx exists and is a client component ('use client')
 *   - Displays all 5 system control tabs:
 *       1. Jobs & Checkpoints
 *       2. Proxies & Accounts
 *       3. Stream Metrics & Alerts
 *       4. x402 Micropayments
 *       5. Live Sessions
 *   - Checkpoint table with pagination and pause/resume/retry actions via /api/checkpoints
 *   - Rate Budget & Quota Allocation (Story 32.1): throttle levels, consumer priorities, panic stop/resume
 *   - Platform DOM Drift Canary (Story 28.2)
 *   - Proxy Budget & Tier allocation (Epic 40)
 *   - Proxy pool health table with quarantine/release controls
 *   - Scraper accounts & hibernation with wake/probe/rotate actions
 *   - Stream throughput SVG chart, metric cards, active alerts, and alert channels configuration
 *   - x402 payments ledger, breakdown by operation, recent payments, and webhook test triggers
 *   - Live sessions cards with progress bars and activity logs
 *   - Enforces zero raw fetch to backend and routes all requests through api() helper
 *   - Realtime integration with lib/realtime.ts and polling fallback
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'admin', 'page.tsx');

describe('Story 48.4 — Modern Admin Console Parity (/admin)', () => {
  it('admin page component exists as a client component', () => {
    expect(existsSync(pagePath)).toBe(true);
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain("'use client'");
  });

  it('page provides all 5 core infrastructure tabs matching legacy admin.html', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Jobs & Checkpoints');
    expect(src).toContain('Proxies & Accounts');
    expect(src).toContain('Stream Metrics & Alerts');
    expect(src).toContain('x402 Micropayments');
    expect(src).toContain('Live Sessions');
  });

  it('page defines crawler jobs and proxy nodes table structures and initial datasets', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('INITIAL_CHECKPOINTS');
    expect(src).toContain('INITIAL_PROXIES');
    expect(src).toContain('crawler');
    expect(src).toContain('latency');
    expect(src).toContain('successRate');
  });

  it('page interacts with backend checkpoint endpoints with pause, resume, and retry actions', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('/api/checkpoints');
    expect(src).toContain('handleAction');
    expect(src).toContain('pause');
    expect(src).toContain('resume');
    expect(src).toContain('retry');
  });

  it('implements Rate Budget & Quota Allocation (Story 32.1) and Panic Stop/Resume', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Rate Budget & Quota Allocation');
    expect(src).toContain('System Throttle Level');
    expect(src).toContain('/api/governor/panic-stop');
    expect(src).toContain('/api/governor/panic-resume');
    expect(src).toContain('NORMAL');
    expect(src).toContain('REDUCED');
    expect(src).toContain('BACKPRESSURE');
    expect(src).toContain('CRITICAL');
  });

  it('implements Platform DOM Selector Drift Canary (Story 28.2)', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Platform DOM Selector Drift Canary');
    expect(src).toContain('twitter');
    expect(src).toContain('threads');
    expect(src).toContain('tiktok');
    expect(src).toContain('facebook');
  });

  it('implements Multi-Tier Proxy Budget Governor (Epic 40)', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Proxy Budget & Tier Allocation (Epic 40)');
    expect(src).toContain('dailyBudget');
    expect(src).toContain('costPerGb');
    expect(src).toContain('residential');
    expect(src).toContain('datacenter');
    expect(src).toContain('mobile_4g');
  });

  it('implements Proxy Pool quarantine and release controls', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Proxy Pool & Quarantine Table');
    expect(src).toContain('/api/admin/proxies/quarantine');
    expect(src).toContain('/api/admin/proxies/release');
    expect(src).toContain('handleProxyToggleQuarantine');
  });

  it('implements Scraper Accounts & Hibernation circuit breaker table', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Scraper Accounts & Hibernation Table');
    expect(src).toContain('circuitState');
    expect(src).toContain('healthScore');
    expect(src).toContain('handleAccountAction');
    expect(src).toContain('/api/admin/accounts/');
  });

  it('implements Stream Throughput SVG chart and telemetry metrics', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Stream Throughput & Ingestion Velocity');
    expect(src).toContain('<svg');
    expect(src).toContain('<polyline');
    expect(src).toContain('Events / Sec');
    expect(src).toContain('Pending Msgs');
    expect(src).toContain('Consumer Lag');
    expect(src).toContain('Dropped Events');
    expect(src).toContain('Last Ack Latency');
  });

  it('implements Active Stream Alerts and Alert Channels Configuration', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Active Stream Alerts');
    expect(src).toContain('/api/streams/alerts');
    expect(src).toContain('Alert Channels Configuration');
    expect(src).toContain('/api/admin/stream/alerts/config');
    expect(src).toContain('/api/admin/stream/alerts/test');
  });

  it('implements x402 Micropayments ledger, operation breakdown, and webhook tests', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('x402 Micropayments');
    expect(src).toContain('Total Settled Payments');
    expect(src).toContain('Total Revenue (USDC)');
    expect(src).toContain('Payments by Operation');
    expect(src).toContain('Recent Payment Transactions');
    expect(src).toContain('Payment Webhook & Dispatch Targets');
    expect(src).toContain('/api/admin/x402/webhooks/test');
  });

  it('implements Live Sessions monitoring cards with progress and log feed', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Total Active Sessions');
    expect(src).toContain('Executing Automation');
    expect(src).toContain('progress.message');
    expect(src).toContain('sess.logs');
  });

  it('enforces zero raw fetch to backend and utilizes typed api helper and realtime client', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).not.toContain('http://localhost:3001');
    expect(src).not.toContain('fetch(');
    expect(src).toContain("import { api } from '@/lib/api'");
    expect(src).toContain("import { getRealtimeClient");
  });
});
