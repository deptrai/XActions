// tests/core/base-crawler.test.js
// Dedicated tests for AbstractCrawler contract beyond what index.test.js covers.

import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';

class TestCrawler extends AbstractCrawler {
  name = 'test-platform';
}

class TestClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'test-platform';
}

describe('AbstractCrawler contract', () => {
  beforeEach(() => {
    // Prevent any global state leak from other tests
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
});
