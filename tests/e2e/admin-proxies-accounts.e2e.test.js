// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 19.2: Dashboard Proxies & Accounts View.
 * Serves instrumented admin.html from a local fixture server and verifies
 * the tab, stat cards, hibernating accounts, and proxy pool tables.
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
    governor: {
      success: true,
      status: {
        healthyProxyCount: 2,
        totalProxyCount: 3,
        healthyProxyRatio: 0.67,
        currentReqPerSecond: 12.5,
        redisConsumerLag: 7,
        throttleLevel: 'normal',
        hibernatingAccounts: [
          { accountId: 'twitter:user-alpha', remainingSeconds: 245, reason: 'RATE_LIMITED_429' },
        ],
      },
    },
    proxies: {
      success: true,
      proxies: [
        { server: 'http://10.0.0.1:8080', protocol: 'http', isQuarantined: false, quarantinedUntil: null, healthy: true, failCount: 0 },
        { server: 'http://10.0.0.2:8080', protocol: 'http', isQuarantined: true, quarantinedUntil: Date.now() + 120000, healthy: false, failCount: 2 },
        { server: 'http://10.0.0.3:8080', protocol: 'http', isQuarantined: false, quarantinedUntil: null, healthy: true, failCount: 0 },
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

    if (pathname === '/api/governor/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtureData.governor));
      return;
    }

    if (pathname === '/api/proxies/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtureData.proxies));
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

test('AC-1: Proxies & Accounts tab is present and navigable', async ({ page }) => {
  await page.goto(`${baseUrl}/admin`);

  const tab = page.locator('#tab-btn-proxies');
  await expect(tab).toBeVisible();
  await expect(tab).toContainText('Proxies & Accounts');

  await tab.click();
  await expect(page.locator('#tab-proxies')).toHaveClass(/active/);
});

test('AC-2: Stat cards render proxy health, request rate, lag, and throttle', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#proxies`);

  const healthyEl = page.locator('#proxies-healthy-count');
  await expect(healthyEl).toContainText('2 / 3');

  const rateEl = page.locator('#governor-req-rate');
  await expect(rateEl).toContainText('12.5 req/s');

  const lagEl = page.locator('#governor-consumer-lag');
  await expect(lagEl).toContainText('7');

  const throttleEl = page.locator('#governor-throttle-level');
  await expect(throttleEl).toContainText('NORMAL');
});

test('AC-3: Hibernating accounts table renders and Wake button is clickable', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#proxies`);

  const tbody = page.locator('#hibernating-accounts-body');
  await expect(tbody).toContainText('twitter');
  await expect(tbody).toContainText('user-alpha');
  await expect(tbody).toContainText('RATE_LIMITED_429');

  const wakeBtn = tbody.locator('button[data-action="wake"]');
  await expect(wakeBtn).toBeVisible();
});

test('AC-4: Proxy pool table renders healthy/quarantined rows and Quarantine/Release buttons', async ({ page }) => {
  await page.goto(`${baseUrl}/admin#proxies`);

  const tbody = page.locator('#proxy-pool-body');
  await expect(tbody).toContainText('10.0.0.1:8080');
  await expect(tbody).toContainText('10.0.0.2:8080');

  const quarantineBtn = tbody.locator('tr[data-proxy-server="http://10.0.0.1:8080"] button[data-action="quarantine"]');
  await expect(quarantineBtn).toBeVisible();

  const releaseBtn = tbody.locator('tr[data-proxy-server="http://10.0.0.2:8080"] button[data-action="release"]');
  await expect(releaseBtn).toBeVisible();
});
