// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 19.3: Dashboard Stream Metrics & Alerts View.
 * Serves instrumented admin.html from a local fixture server and verifies
 * the tab, stat cards, SVG chart, and alerts list.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 0;

let server;
let baseUrl;

test.beforeAll(async () => {
  const adminPath = path.join(__dirname, '../../dashboard/admin.html');
  let html = await readFile(adminPath, 'utf-8');

  // Stub socket.io to prevent real WebSocket connections in tests.
  html = html.replace(
    '<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>',
    `<script>
      window.io = () => ({ on: () => {}, emit: () => {}, off: () => {}, io: { on: () => {} } });
    </script>`
  );

  // Disable login redirect.
  html = html.replace(/window\.location\.href = '\/login';/g, '/* login redirect disabled in tests */');

  const fixtureData = {
    metrics: {
      success: true,
      metrics: {
        eventsPerSecond: 1234.56,
        pendingMessages: 75000,
        consumerLag: 2500,
        droppedEvents: 1000,
        lastAckTime: 120,
        maxLen: 1000000,
        minId: '1725000000000-0',
      },
    },
    alerts: {
      success: true,
      alerts: {
        activeAlerts: [
          { alert: 'redis_stream_lag', threshold: 50000, value: 75000, timestamp: new Date().toISOString(), metrics: {} },
          { alert: 'redis_stream_ack', threshold: 60, value: 120, timestamp: new Date().toISOString(), metrics: {} },
        ],
        lastAlertTimestamp: new Date().toISOString(),
        totalAlertsTriggered: 2,
      },
    },
    testAlert: {
      success: true,
      triggered: true,
      alerts: [
        { alert: 'redis_stream_lag', threshold: 50000, value: 75000, timestamp: new Date().toISOString(), metrics: {} },
      ],
    },
  };

  server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/admin' || pathname === '/admin.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (pathname === '/api/admin/stream/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtureData.metrics));
      return;
    }

    if (pathname === '/api/admin/stream/alerts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtureData.alerts));
      return;
    }

    if (pathname === '/api/admin/stream/alerts/test' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtureData.testAlert));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AC-1: Stream Metrics & Alerts tab is present and navigable', async ({ page }) => {
  await page.goto(`${baseUrl}/admin`);

  const tab = page.locator('#tab-btn-streams');
  await expect(tab).toBeVisible();
  await expect(tab).toContainText('Stream Metrics & Alerts');

  await tab.click();
  await expect(page.locator('#tab-streams')).toHaveClass(/active/);
});

test('AC-1: /admin#streams activates the tab automatically', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#streams`);

  const tab = page.locator('#tab-btn-streams');
  await expect(tab).toHaveClass(/active/);
  await expect(page.locator('#tab-streams')).toHaveClass(/active/);
});

test('AC-2: Stat cards render stream metrics', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#streams`);

  await expect(page.locator('#stream-events-per-second')).toContainText('1.2K');
  await expect(page.locator('#stream-pending-messages')).toContainText('75.0K');
  await expect(page.locator('#stream-consumer-lag')).toContainText('2.5K');
  await expect(page.locator('#stream-dropped-events')).toContainText('1.0K');
  await expect(page.locator('#stream-last-ack-time')).toContainText('2m');
  await expect(page.locator('#stream-max-len')).toContainText('1.0M');
});

test('AC-3: SVG chart and time range toggles are present', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#streams`);

  const svg = page.locator('#stream-chart');
  await expect(svg).toBeVisible();

  await expect(page.locator('#stream-range-5m')).toBeVisible();
  await expect(page.locator('#stream-range-1h')).toBeVisible();
  await expect(page.locator('#stream-range-24h')).toBeVisible();

  await page.locator('#stream-range-1h').click();
  await expect(page.locator('#stream-range-1h')).toHaveClass(/active/);
});

test('AC-4: Active alerts list renders with severity badges', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#streams`);

  const alertsBody = page.locator('#stream-alerts-body');
  await expect(alertsBody).toContainText('redis_stream_lag');
  await expect(alertsBody).toContainText('redis_stream_ack');
  await expect(alertsBody).toContainText('WARNING');

  const testBtn = page.locator('#stream-test-alert-btn');
  await expect(testBtn).toBeVisible();
  await testBtn.click();
  await expect(alertsBody).toContainText('redis_stream_lag');
});
