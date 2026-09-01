import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { StatusApi } from '../../src/core/status-api.js';

describe('Story 19.2: Proxies & Accounts Dashboard Backend API Contracts', () => {
  let proxyPool;
  let accountPool;
  let governor;
  let statusApi;
  let app;

  beforeEach(() => {
    proxyPool = new ProxyIpPool({
      proxies: [
        'http://user1:pass1@10.0.0.1:8080',
        'http://user2:pass2@10.0.0.2:8080',
        'http://user3:pass3@10.0.0.3:8080',
      ],
    });

    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    statusApi = new StatusApi({ governor });

    app = express();
    app.use(express.json());

    // Status endpoint
    app.get('/api/governor/status', (req, res) => {
      res.json({ success: true, status: statusApi.getGovernorStatus() });
    });

    // Proxy endpoints
    app.get('/api/proxies/status', (req, res) => {
      res.json({
        healthyCount: proxyPool.healthyCount,
        totalCount: proxyPool.totalCount,
        antiLeakFlags: proxyPool.antiLeakFlags,
        isAllQuarantined: proxyPool.isAllQuarantined(),
      });
    });

    app.get('/api/proxies/list', (req, res) => {
      res.json({
        success: true,
        proxies: proxyPool.listAll(),
      });
    });

    app.post('/api/proxies/quarantine', (req, res) => {
      const { proxy, durationMs } = req.body || {};
      if (!proxy) return res.status(400).json({ error: 'Proxy is required to quarantine' });
      proxyPool.quarantine(proxy, durationMs);
      res.json({
        success: true,
        quarantined: proxy,
        healthyCount: proxyPool.healthyCount,
        totalCount: proxyPool.totalCount,
      });
    });

    app.post('/api/proxies/release', (req, res) => {
      const { proxy } = req.body || {};
      if (!proxy) return res.status(400).json({ error: 'Proxy is required to release' });
      proxyPool.release(proxy);
      res.json({
        success: true,
        released: proxy,
        healthyCount: proxyPool.healthyCount,
        totalCount: proxyPool.totalCount,
      });
    });

    app.post('/api/proxies/accounts/:id/available', (req, res) => {
      const { id } = req.params;
      accountPool.markAvailable(id);
      res.json({ success: true, accountId: id, available: true });
    });
  });

  it('GET /api/governor/status returns governor status with healthy proxies, rates, and hibernating accounts', async () => {
    accountPool.registerAccounts('twitter', ['tw-acc-1']);
    accountPool.markUnavailable('tw-acc-1', 'RATE_LIMITED_429', 60000);

    const res = await request(app).get('/api/governor/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBeDefined();
    expect(res.body.status.healthyProxyCount).toBe(3);
    expect(res.body.status.totalProxyCount).toBe(3);
    expect(res.body.status.throttleLevel).toBe('normal');
    expect(Array.isArray(res.body.status.hibernatingAccounts)).toBe(true);
    expect(res.body.status.hibernatingAccounts.length).toBe(1);
    expect(res.body.status.hibernatingAccounts[0].accountId).toContain('tw-acc-1');
    expect(res.body.status.hibernatingAccounts[0].reason).toBe('RATE_LIMITED_429');
    expect(res.body.status.hibernatingAccounts[0].remainingSeconds).toBeGreaterThan(0);
  });

  it('allows manual proxy quarantine and manual release via API and ProxyIpPool', async () => {
    const targetProxy = 'http://user1:pass1@10.0.0.1:8080';

    // 1. Check initial list
    let listRes = await request(app).get('/api/proxies/list');
    expect(listRes.status).toBe(200);
    expect(listRes.body.proxies.length).toBe(3);
    const p1 = listRes.body.proxies.find(p => p.server.includes('10.0.0.1'));
    expect(p1.isQuarantined).toBe(false);

    // 2. Quarantine proxy
    const qRes = await request(app)
      .post('/api/proxies/quarantine')
      .send({ proxy: targetProxy, durationMs: 120000 });
    expect(qRes.status).toBe(200);
    expect(qRes.body.healthyCount).toBe(2);

    listRes = await request(app).get('/api/proxies/list');
    const p1Quarantined = listRes.body.proxies.find(p => p.server.includes('10.0.0.1'));
    expect(p1Quarantined.isQuarantined).toBe(true);

    // 3. Release proxy
    const rRes = await request(app)
      .post('/api/proxies/release')
      .send({ proxy: targetProxy });
    expect(rRes.status).toBe(200);
    expect(rRes.body.healthyCount).toBe(3);

    listRes = await request(app).get('/api/proxies/list');
    const p1Released = listRes.body.proxies.find(p => p.server.includes('10.0.0.1'));
    expect(p1Released.isQuarantined).toBe(false);
  });

  it('wakes hibernating account manually via POST /api/proxies/accounts/:id/available', async () => {
    accountPool.registerAccounts('twitter', ['user-alpha']);
    accountPool.markUnavailable('user-alpha', 'BOT_CHALLENGE', 300000);

    let statusRes = await request(app).get('/api/governor/status');
    expect(statusRes.body.status.hibernatingAccounts.length).toBe(1);

    const wakeRes = await request(app)
      .post('/api/proxies/accounts/user-alpha/available')
      .send({});
    expect(wakeRes.status).toBe(200);
    expect(wakeRes.body.success).toBe(true);

    statusRes = await request(app).get('/api/governor/status');
    expect(statusRes.body.status.hibernatingAccounts.length).toBe(0);
  });
});
