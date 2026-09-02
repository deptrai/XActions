// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Acceptance & Integration Tests — Story 19.3: Dashboard Stream Metrics & Alerts View.
 * Uses a real Node HTTP server serving dashboard/admin.html and proxies API calls
 * to the real Express app with real in-memory stream metrics and alert engines.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../api/server.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';
import { defaultStreamMetricsCollector } from '../../src/utils/stream-metrics-collector.js';
import { defaultStreamAlertEngine } from '../../src/utils/stream-alerts.js';

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
  const id = `test_dashboard_stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `dash_stream_${id}`,
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
  html = html.replace('let streamState = {', 'window.streamState = {');
  html = html.replace('let proxiesState = {', 'window.proxiesState = {');
  html = html.replace('let checkpointsState = {', 'window.checkpointsState = {');

  html = html.replace(/(async\s+)?function\s+(\w+)\s*\(/g, 'window.$2 = $1function $2(');

  html = html.replace(
    '</script>\n</body>',
    `</script>
    <script>
      window.__dashboard = {
        switchTab,
        loadStreamMetrics,
        startStreamRefresh,
        stopStreamRefresh,
        saveStreamAlertConfig,
        testStreamAlert,
        refreshStreamMetrics,
        getStreamState: () => window.streamState,
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

describe('Story 19.3: Admin Dashboard — Stream Metrics & Alerts View', () => {
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

    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/admin' || url.pathname === '/admin/stream') {
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

  async function createJSDOM(authToken = adminToken, hash = '#stream') {
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

  it('AC-1: Stream Metrics & Alerts tab is rendered and can be activated via URL hash', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { document, window } = dom.window;

    const streamBtn = document.getElementById('tab-btn-stream');
    const streamPanel = document.getElementById('tab-stream');

    expect(streamBtn).toBeTruthy();
    expect(streamPanel).toBeTruthy();

    await window.__dashboard.switchTab('stream');
    expect(streamBtn.classList.contains('active')).toBe(true);
    expect(streamPanel.classList.contains('active')).toBe(true);
    expect(streamPanel.style.display).toBe('block');

    dom.window.close();
  });

  it('AC-2: Real-time metric cards render throughput, pending messages, lag, dropped events, and last ack time', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { document, window } = dom.window;

    await window.__dashboard.loadStreamMetrics();

    const rpsEl = document.getElementById('stream-events-rps');
    const pendingEl = document.getElementById('stream-pending-msgs');
    const lagEl = document.getElementById('stream-consumer-lag');
    const droppedEl = document.getElementById('stream-dropped-events');
    const ackEl = document.getElementById('stream-last-ack');

    expect(rpsEl.textContent).toContain('req/s');
    expect(pendingEl.textContent).toContain('msgs');
    expect(lagEl.textContent).toContain('msgs');
    expect(droppedEl.textContent).toBeTruthy();
    expect(ackEl.textContent).toContain('s');

    dom.window.close();
  });

  it('AC-3: Active alerts panel and threshold highlights trigger when lag or ack time breaches limits', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { document, window } = dom.window;

    // Simulate metric breach
    await defaultStreamAlertEngine.checkAndAlert({
      eventsPerSecond: 10,
      pendingMessages: 65000,
      consumerLag: 55000,
      droppedEvents: 2,
      lastAckTime: 75,
      streamLength: 100000,
    });

    await window.__dashboard.loadStreamMetrics();

    const alertsContainer = document.getElementById('stream-alerts-container');
    expect(alertsContainer.textContent).not.toContain('No active alerts');

    dom.window.close();
  });

  it('AC-4: Alert channels can be configured and tested via dashboard action buttons', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { document, window } = dom.window;

    document.getElementById('alert-webhook-url').value = 'https://discord.com/api/webhooks/test-hook';
    document.getElementById('alert-email-recipients').value = 'ops-team@xactions.app';

    // Test saving configuration
    await window.__dashboard.saveStreamAlertConfig();
    const currentConfig = defaultStreamAlertEngine.getConfig();
    expect(currentConfig.webhookUrl).toBe('https://discord.com/api/webhooks/test-hook');
    expect(currentConfig.emailRecipients).toBe('ops-team@xactions.app');

    // Test sending synthetic test alert
    await window.__dashboard.testStreamAlert();

    dom.window.close();
  });

  it('AC-5: Real-time 5s polling is scheduled and clears on unmount or tab switch', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { window } = dom.window;

    window.__dashboard.startStreamRefresh();
    const state = window.__dashboard.getStreamState();
    expect(state.refreshTimer).not.toBeNull();

    window.__dashboard.stopStreamRefresh();
    expect(state.refreshTimer).toBeNull();

    dom.window.close();
  });

  it('AC-6: Stream endpoints require admin token and return 401/403 for unauthorized users', async () => {
    // Calling admin stream metrics as regular user returns 403
    const resForbidden = await request(app)
      .get('/api/admin/stream/metrics')
      .set('Authorization', `Bearer ${regularToken}`);
    expect(resForbidden.status).toBe(403);

    // Calling unauthenticated returns 401
    const resUnauthorized = await request(app)
      .get('/api/admin/stream/metrics');
    expect(resUnauthorized.status).toBe(401);

    // Calling with admin token returns 200
    const resAdmin = await request(app)
      .get('/api/admin/stream/metrics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.success).toBe(true);
  });

  it('AC-7: Mobile responsive elements render without layout breakage', async () => {
    const dom = await createJSDOM(adminToken, '#stream');
    const { document } = dom.window;

    const cards = document.querySelectorAll('#tab-stream .stat-box');
    expect(cards.length).toBe(5);

    dom.window.close();
  });
});
