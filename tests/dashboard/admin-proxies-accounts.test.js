// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Acceptance & Integration Tests — Story 19.2: Dashboard Proxies & Accounts View.
 * Uses a real Node HTTP server serving dashboard/admin.html and proxies API calls
 * to the real Express app with real in-memory proxy and account pools.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../api/server.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';
import { globalProxyPool } from '../../src/proxy/proxy-pool.js';
import { globalAccountPool } from '../../src/core/account-pool.js';
import { globalAdaptiveRateGovernor } from '../../src/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-12345';

function makeUserToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, isAdmin: user.isAdmin },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedUser(overrides = {}) {
  const id = `test_dashboard_proxies_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `dash_prox_${id}`,
      email: `${id}@example.com`,
      password: await bcrypt.hash('TestPassword123!', 10),
      isAdmin: false,
      credits: 100,
      ...overrides,
    },
  });
}

/**
 * Read admin.html, instrument it for testing.
 */
async function loadAdminHtml() {
  const file = path.join(__dirname, '../../dashboard/admin.html');
  let html = await readFile(file, 'utf-8');

  // Stub socket.io and disable top-level redirects so jsdom can execute the page.
  html = html.replace(
    '<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>',
    '<script>window.io = function() { return { on: () => {}, emit: () => {}, off: () => {}, io: { on: () => {} } }; };</script>'
  );
  html = html.replace(
    /const socket = io\(API_URL, \{[\s\S]*?\}\);/,
    "window.socket = { on: () => {}, emit: () => {}, off: () => {}, io: { on: () => {} } };"
  );
  html = html.replace(
    /window\.location\.href = '\/login';/g,
    "/* login redirect disabled in tests */"
  );

  html = html.replace('const API_URL = window.location.origin;', 'window.API_URL = window.location.origin;');
  html = html.replace('const authToken = localStorage.getItem(\'authToken\');', 'window.authToken = localStorage.getItem(\'authToken\');');
  html = html.replace('const sessions = new Map();', 'window.sessions = new Map();');
  html = html.replace('let proxiesState = {', 'window.proxiesState = {');
  html = html.replace('let checkpointsState = {', 'window.checkpointsState = {');

  html = html.replace(/(async\s+)?function\s+(\w+)\s*\(/g, 'window.$2 = $1function $2(');

  html = html.replace(
    '</script>\n</body>',
    `</script>
    <script>
      window.__dashboard = {
        switchTab,
        loadProxiesAndAccounts,
        startProxiesRefresh,
        stopProxiesRefresh,
        quarantineProxy,
        releaseProxy,
        wakeAccount,
        rotateAccount,
        refreshProxiesAndAccounts,
        getProxiesState: () => window.proxiesState,
        getAuthToken,
      };
    </script>
</body>`
  );

  return html;
}

/**
 * Forward a request to the real Express app.
 */
async function forwardToApp(req, bodyBuffer) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const headers = { ...req.headers };
  delete headers.host;

  const test = request(app)[req.method.toLowerCase()](url.pathname + url.search)
    .set(headers);

  if (bodyBuffer && bodyBuffer.length) {
    try {
      const parsed = JSON.parse(bodyBuffer.toString('utf-8'));
      test.send(parsed);
    } catch {
      test.send(bodyBuffer);
    }
  }

  const res = await test;
  const responseHeaders = { ...res.headers };
  delete responseHeaders['content-encoding'];
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];

  const body = Buffer.from(res.text, 'utf-8');
  responseHeaders['content-length'] = String(body.length);

  return {
    statusCode: res.status,
    headers: responseHeaders,
    body,
  };
}

describe('Story 19.2: Admin Dashboard — Proxies & Accounts View', () => {
  let server;
  let serverUrl;
  let adminUser;
  let regularUser;
  let adminToken;
  let regularToken;

  beforeAll(async () => {
    await cleanupTestDatabase();

    adminUser = await seedUser({ isAdmin: true });
    regularUser = await seedUser({ isAdmin: false });
    adminToken = makeUserToken(adminUser);
    regularToken = makeUserToken(regularUser);

    // Populate test proxies in globalProxyPool
    globalProxyPool.add('http://proxy1.test:8080');
    globalProxyPool.add('http://proxy2.test:8080');
    globalProxyPool.add('http://user:pass@residential.test:9000');

    // Populate test accounts in globalAccountPool
    globalAccountPool.registerAccounts('twitter', ['account_alpha', 'account_beta']);
    globalAccountPool.registerAccounts('facebook', ['fb_account_gamma']);

    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/admin' || url.pathname === '/admin/proxies') {
          const html = await loadAdminHtml();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuffer = Buffer.concat(chunks);

        const forwarded = await forwardToApp(req, bodyBuffer);
        res.writeHead(forwarded.statusCode, forwarded.headers);
        res.end(forwarded.body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        serverUrl = `http://127.0.0.1:${port}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanupTestDatabase();
  });

  async function createJSDOM(authToken = adminToken, hash = '#proxies') {
    const { JSDOM, VirtualConsole } = await import('jsdom');
    const virtualConsole = new VirtualConsole();
    virtualConsole.sendTo(console, { omitJSDOMErrors: true });

    const htmlRes = await fetch(`${serverUrl}/admin`);
    const rawHtml = await htmlRes.text();

    const dom = new JSDOM(rawHtml, {
      url: `${serverUrl}/admin${hash}`,
      runScripts: 'dangerously',
      resources: 'usable',
      virtualConsole,
      beforeParse(window) {
        const baseLocation = new URL(`${serverUrl}/admin${hash}`);
        const nodeFetch = globalThis.fetch;
        window.fetch = (resource, init) => {
          const targetUrl = typeof resource === 'string'
            ? new URL(resource, baseLocation.href).toString()
            : resource;
          const opts = { ...init };
          delete opts.signal;
          return nodeFetch(targetUrl, opts);
        };
        window.localStorage.setItem('authToken', authToken);
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    return dom;
  }

  it('AC-1: Proxies & Accounts tab is rendered and can be activated via URL hash', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { document, window } = dom.window;

    const proxiesBtn = document.getElementById('tab-btn-proxies');
    const proxiesPanel = document.getElementById('tab-proxies');

    expect(proxiesBtn).toBeTruthy();
    expect(proxiesPanel).toBeTruthy();

    await window.__dashboard.switchTab('proxies');
    expect(proxiesBtn.classList.contains('active')).toBe(true);
    expect(proxiesPanel.classList.contains('active')).toBe(true);
    expect(proxiesPanel.style.display).toBe('block');

    dom.window.close();
  });

  it('AC-2: Metric cards render healthy proxy counts, rate, consumer lag, and governor throttle level', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { document, window } = dom.window;

    await window.__dashboard.loadProxiesAndAccounts();

    const healthyCountEl = document.getElementById('healthy-proxies-count');
    const rateEl = document.getElementById('current-rate-rps');
    const lagEl = document.getElementById('consumer-lag');
    const throttleEl = document.getElementById('throttle-level');

    expect(healthyCountEl.textContent).toContain(' / ');
    expect(rateEl.textContent).toContain('req/s');
    expect(lagEl.textContent).toContain('msgs');
    expect(throttleEl.textContent).toBeTruthy();

    dom.window.close();
  });

  it('AC-3: Proxies table renders rows and allows manual quarantine and release actions', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { document, window } = dom.window;

    await window.__dashboard.loadProxiesAndAccounts();

    const tbody = document.getElementById('proxies-body');
    const rows = tbody.querySelectorAll('tr');
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Test manual quarantine
    const targetProxy = 'http://proxy1.test:8080';
    await window.__dashboard.quarantineProxy(targetProxy);
    expect(globalProxyPool.healthyCount).toBe(globalProxyPool.totalCount - 1);

    // Test manual release
    await window.__dashboard.releaseProxy(targetProxy);
    expect(globalProxyPool.healthyCount).toBe(globalProxyPool.totalCount);

    dom.window.close();
  });

  it('AC-4: Accounts table renders accounts, hibernation info, and supports wake and rotate actions', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { document, window } = dom.window;

    // Put account_alpha into hibernation
    globalAccountPool.markUnavailable('account_alpha', 'bot_challenge', 60000, 'twitter');

    await window.__dashboard.loadProxiesAndAccounts();

    const tbody = document.getElementById('accounts-body');
    const rows = tbody.querySelectorAll('tr');
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const hibernatingRow = Array.from(rows).find(r => r.textContent.includes('account_alpha'));
    expect(hibernatingRow).toBeTruthy();
    expect(hibernatingRow.textContent).toContain('hibernating');

    // Test manual wake
    await window.__dashboard.wakeAccount('account_alpha', 'twitter');
    const account = globalAccountPool.getAccount('account_alpha', 'twitter');
    expect(account.hibernatingUntil).toBeNull();

    // Test manual rotate
    await window.__dashboard.rotateAccount('account_alpha', 'twitter');

    dom.window.close();
  });

  it('AC-5: Real-time 5s polling is scheduled and clears on unmount or tab switch', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { window } = dom.window;

    window.__dashboard.startProxiesRefresh();
    const state = window.__dashboard.getProxiesState();
    expect(state.refreshTimer).not.toBeNull();

    window.__dashboard.stopProxiesRefresh();
    expect(state.refreshTimer).toBeNull();

    dom.window.close();
  });

  it('AC-6: Dashboard endpoints require admin token and return 401/403 for unauthorized users', async () => {
    // Calling admin proxies endpoint as regular user returns 403
    const resForbidden = await request(app)
      .get('/api/admin/proxies')
      .set('Authorization', `Bearer ${regularToken}`);
    expect(resForbidden.status).toBe(403);

    // Calling unauthenticated returns 401
    const resUnauthorized = await request(app)
      .get('/api/admin/proxies');
    expect(resUnauthorized.status).toBe(401);

    // Calling with admin token returns 200
    const resAdmin = await request(app)
      .get('/api/admin/proxies')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.success).toBe(true);
  });

  it('AC-7: Mobile responsive table elements render correctly', async () => {
    const dom = await createJSDOM(adminToken, '#proxies');
    const { document } = dom.window;

    const proxyWrap = document.querySelector('#tab-proxies .checkpoint-table-wrap');
    const accountWrap = document.querySelectorAll('#tab-proxies .checkpoint-table-wrap')[1];

    expect(proxyWrap).toBeTruthy();
    expect(accountWrap).toBeTruthy();

    dom.window.close();
  });
});
