// tests/core/base-crawler.test.js
// Dedicated tests for AbstractCrawler contract beyond what index.test.js covers.

import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { globalActionRegistry } from '../../src/core/action-registry.js';

class TestCrawler extends AbstractCrawler {
  name = 'test-platform';
}

class TestClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'test-platform';
}

describe('AbstractCrawler contract', () => {
  beforeEach(() => {
    globalActionRegistry.clear();
  });

  it('cannot be instantiated directly', () => {
    expect(() => new AbstractCrawler()).toThrow(/abstract/i);
  });

  it('inherits governor and accountPool from client when not passed directly', () => {
    const proxyPool = new ProxyIpPool({ proxies: [] });
    const governor = new AdaptiveRateGovernor({ proxyPool });
    const accountPool = new AccountPool({ governor });
    const client = new TestClient({ governor, accountPool });

    const crawler = new TestCrawler({ client });

    expect(crawler.governor).toBe(governor);
    expect(crawler.accountPool).toBe(accountPool);
  });

  it('start() throws HIBERNATION when account is hibernating', async () => {
    const proxyPool = new ProxyIpPool({ proxies: ['http://localhost:8080'] });
    const governor = new AdaptiveRateGovernor({ proxyPool });
    const accountPool = new AccountPool({ governor });
    accountPool.registerAccounts('test-platform', ['acc_1']);
    governor.hibernateAccount('acc_1', 'rate_limit', 60000, 'test-platform');

    const crawler = new TestCrawler({ governor, accountPool, requiresAuth: true });
    crawler.registerAction('scrape', async () => [], { description: 'Scrape' });

    await expect(
      crawler.start({ action: 'scrape', args: {}, session: {} })
    ).rejects.toThrow(PlatformError);
  });

  it('start() throws AUTH_EXPIRED when no account is available', async () => {
    const crawler = new TestCrawler({ requiresAuth: true });
    crawler.registerAction('scrape', async () => [], { description: 'Scrape' });

    await expect(
      crawler.start({ action: 'scrape', args: {}, session: {} })
    ).rejects.toThrow(/No available account/);
  });

  it('validateItem() rejects missing id or platform', () => {
    const crawler = new TestCrawler();

    expect(() => crawler.validateItem({})).toThrow(PlatformError);
    expect(() => crawler.validateItem({ id: '', platform: 'test' })).toThrow(PlatformError);
    expect(() => crawler.validateItem({ id: 'test:1', platform: '' })).toThrow(PlatformError);
  });

  it('validateItem() rejects invalid category', () => {
    const crawler = new TestCrawler();

    expect(() =>
      crawler.validateItem({ id: 'test:1', platform: 'test', category: 'nope' })
    ).toThrow(PlatformError);
  });

  it('init(), search(), getPostDetail(), getComments(), cleanup() are abstract', async () => {
    const crawler = new TestCrawler();

    await expect(crawler.init()).rejects.toThrow(/not implemented/);
    await expect(crawler.search({})).rejects.toThrow(/not implemented/);
    await expect(crawler.getPostDetail({})).rejects.toThrow(/not implemented/);
    await expect(crawler.getComments({})).rejects.toThrow(/not implemented/);
    await expect(crawler.cleanup()).rejects.toThrow(/not implemented/);
  });

  it('start() records request in governor for no-auth crawler', async () => {
    const proxyPool = new ProxyIpPool({ proxies: [] });
    const governor = new AdaptiveRateGovernor({ proxyPool });
    const crawler = new TestCrawler({ governor, requiresAuth: false });
    crawler.registerAction('scrape', async () => [], { description: 'Scrape' });

    await crawler.start({ action: 'scrape', args: {}, session: {} });

    expect(governor.getAccountVelocity('test-platform:noauth')).toBe(1);
  });

  it('accepts cdpUrl in constructor and supports delayWithJitter', async () => {
    const crawler = new TestCrawler({ cdpUrl: 'http://localhost:9222' });
    expect(crawler.cdpUrl).toBe('http://localhost:9222');

    const delay = await crawler.delayWithJitter(10, 20);
    expect(delay).toBeGreaterThanOrEqual(10);
    expect(delay).toBeLessThanOrEqual(20);
  });

  it('launchBrowserWithCdp throws PlatformError if cdpUrl is not set', async () => {
    const crawler = new TestCrawler();
    await expect(crawler.launchBrowserWithCdp()).rejects.toThrow(PlatformError);
  });

  describe('Action-Level Granular Auth & Proxy Strategy', () => {
    it('listActions() returns resolved requiresAuth', () => {
      const crawler = new TestCrawler({ requiresAuth: true });
      crawler.registerAction('public_action', async () => [], { description: 'Public', requiresAuth: false });
      crawler.registerAction('private_action', async () => [], { description: 'Private' });
      crawler.registerAction('explicit_private', async () => [], { description: 'Explicit Private', requiresAuth: true });

      const actions = crawler.listActions();
      const publicAct = actions.find(a => a.action === 'public_action');
      const privateAct = actions.find(a => a.action === 'private_action');
      const explicitAct = actions.find(a => a.action === 'explicit_private');

      expect(publicAct?.requiresAuth).toBe(false);
      expect(privateAct?.requiresAuth).toBe(true);
      expect(explicitAct?.requiresAuth).toBe(true);
    });

    it('start() executes requiresAuth:false action without accountPool on authenticated platform', async () => {
      let receivedSession = null;
      const crawler = new TestCrawler({ requiresAuth: true }); // Platform is auth-required
      crawler.registerAction('marketplace', async (args, session) => {
        receivedSession = session;
        return [{ id: 'test-platform:item1', platform: 'test-platform', category: 'social' }];
      }, { requiresAuth: false });

      // No accountPool, no account in session -> should NOT throw AUTH_EXPIRED
      const res = await crawler.start({ action: 'marketplace', args: { query: 'laptop' } });
      expect(res).toHaveLength(1);
      expect(receivedSession.accountId).toBeNull();
      expect(receivedSession.requiresAuth).toBe(false);
    });

    it('start() throws AUTH_EXPIRED for requiresAuth:true action on no-auth platform when pool is empty', async () => {
      const crawler = new TestCrawler({ requiresAuth: false }); // Platform is no-auth by default
      crawler.registerAction('private_group', async () => [], { requiresAuth: true });

      await expect(
        crawler.start({ action: 'private_group', args: {} })
      ).rejects.toThrow(/No available account/);
    });

    it('start() with opt-in accountId on requiresAuth:false action checks governor', async () => {
      const proxyPool = new ProxyIpPool({ proxies: ['http://localhost:8080'] });
      const governor = new AdaptiveRateGovernor({ proxyPool });
      const accountPool = new AccountPool({ governor });
      accountPool.registerAccounts('test-platform', ['opt_in_acc']);
      governor.hibernateAccount('opt_in_acc', 'rate_limit', 60000, 'test-platform');

      const crawler = new TestCrawler({ governor, accountPool, requiresAuth: false });
      crawler.registerAction('search', async () => [], { requiresAuth: false });

      // Opt-in account is hibernating -> must throw HIBERNATION
      await expect(
        crawler.start({
          action: 'search',
          args: {},
          session: { accountId: 'opt_in_acc' }
        })
      ).rejects.toThrow(PlatformError);
    });
  });
});
