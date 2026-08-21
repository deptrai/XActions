// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { StaticProxyProvider } from '../../src/proxy/providers.js';
import { PlatformError, AuthSessionExpiredError, ProxyDeadError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { AbstractPlatformResponseValidator } from '../../src/core/platform-validator.js';

class MockPlatformValidator extends AbstractPlatformResponseValidator {
  isValidPayload(response) {
    if (response?.data?.error === 'corrupted') return false;
    return true;
  }
  isBotChallenge(response) {
    if (response?.data?.challenge === true) return true;
    return response?.status === 403;
  }
  isRateLimit(response) {
    if (response?.data?.rateLimited === true) return true;
    return response?.status === 429;
  }
}

class TestCrawler extends AbstractCrawler {
  name = 'test-platform';
  requiresAuth = true;

  constructor(deps = {}) {
    super(deps);
    this.registerAction({
      action: 'scrape_profile',
      description: 'Scrapes user profile',
      requiredArgs: ['username'],
      example: { username: 'testuser' },
      outputType: 'Profile',
      handler: async (args, session) => {
        return { success: true, username: args.username, sessionAccountId: session?.accountId };
      },
    });
  }
}

class NoAuthCrawler extends AbstractCrawler {
  name = 'noauth-platform';
  requiresAuth = false;

  constructor(deps = {}) {
    super(deps);
    this.registerAction({
      action: 'scrape_public',
      description: 'Scrapes public feed',
      requiredArgs: [],
      example: {},
      outputType: 'Post[]',
      handler: async () => {
        return { success: true, posts: [] };
      },
    });
  }
}

describe('Story 11.7 — Crawler-Governor Integration & Response Validator Contract (ATDD Green Phase)', () => {
  let proxyPool;
  let governor;
  let accountPool;

  beforeEach(() => {
    proxyPool = new ProxyIpPool({
      proxies: ['http://p1.example.com:8080', 'http://p2.example.com:8080'],
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    accountPool.registerAccounts('test-platform', ['acc_1', 'acc_2']);
  });

  describe('AC-1 & AC-2: AbstractCrawler Governor & Account Admission', () => {
    test('should accept governor and accountPool in constructor or inherit from client', () => {
      const crawler = new TestCrawler({ governor, accountPool });
      expect(crawler.governor).toBe(governor);
      expect(crawler.accountPool).toBe(accountPool);
    });

    test('should throw INVALID_ARGS before governor checks when action is unknown', async () => {
      const crawler = new TestCrawler({ governor, accountPool });
      await expect(
        crawler.start({ action: 'non_existent_action', args: {} })
      ).rejects.toMatchObject({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
      });
    });

    test('should throw HIBERNATION (XACT_4291) when account is hibernating', async () => {
      governor.recordRateLimit('acc_1', 'test-platform', 60000);
      const crawler = new TestCrawler({ governor, accountPool });

      await expect(
        crawler.start({
          action: 'scrape_profile',
          args: { username: 'testuser' },
          session: { accountId: 'acc_1' },
        })
      ).rejects.toMatchObject({
        code: 'XACT_4291',
        type: ErrorTypes.HIBERNATION,
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
      });
    });

    test('should throw AUTH_EXPIRED (401) when auth crawler has no available accounts', async () => {
      const emptyAccountPool = new AccountPool({ governor });
      const crawler = new TestCrawler({ governor, accountPool: emptyAccountPool });

      await expect(
        crawler.start({
          action: 'scrape_profile',
          args: { username: 'testuser' },
        })
      ).rejects.toMatchObject({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        statusCode: 401,
      });
    });

    test('should fallback to accountPool.getNextAvailable when accountId is omitted in auth crawler and inject into session', async () => {
      const crawler = new TestCrawler({ governor, accountPool });
      const result = await crawler.start({
        action: 'scrape_profile',
        args: { username: 'testuser' },
      });

      expect(result.success).toBe(true);
      expect(result.sessionAccountId).toBe('acc_1');
      expect(governor.getAccountVelocity('acc_1', 'test-platform')).toBe(1);
    });

    test('should throw PROXY_EXHAUSTED (XACT_5030) when governor throughput is 0', async () => {
      // Quarantine all proxies
      proxyPool.quarantine('http://p1.example.com:8080', 60000);
      proxyPool.quarantine('http://p2.example.com:8080', 60000);

      const crawler = new TestCrawler({ governor, accountPool });
      await expect(
        crawler.start({
          action: 'scrape_profile',
          args: { username: 'testuser' },
          session: { accountId: 'acc_1' },
        })
      ).rejects.toMatchObject({
        code: 'XACT_5030',
        suggestedAction: SuggestedActions.WAIT,
      });
    });

    test('should record request under synthetic noauth key for no-auth crawler', async () => {
      const crawler = new NoAuthCrawler({ governor });
      const result = await crawler.start({
        action: 'scrape_public',
        args: {},
      });

      expect(result.success).toBe(true);
      expect(governor.getAccountVelocity('noauth', 'noauth-platform')).toBe(1);
    });
  });

  describe('AC-3 & AC-4: AbstractApiClient Response Validator Integration', () => {
    test('should throw RateLimitError when 200 response contains rate-limit payload', async () => {
      const provider = new StaticProxyProvider({ pool: proxyPool });
      const validator = new MockPlatformValidator();

      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
      }

      const client = new CustomApiClient({
        proxyProvider: provider,
        responseValidator: validator,
        requiresAuth: false,
        maxProxyRetries: 1,
        httpClient: async () => {
          return {
            status: 200,
            headers: {},
            data: { rateLimited: true, message: 'Too many requests' },
          };
        },
      });

      await expect(client.request('GET', 'https://example.com/api')).rejects.toMatchObject({
        code: 'XACT_4290',
        statusCode: 429,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
      });
    });

    test('should throw BotChallengeError when 200 response contains hidden challenge', async () => {
      const provider = new StaticProxyProvider({ pool: proxyPool });
      const validator = new MockPlatformValidator();

      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
      }

      const client = new CustomApiClient({
        proxyProvider: provider,
        responseValidator: validator,
        requiresAuth: false,
        maxProxyRetries: 1,
        httpClient: async () => {
          return {
            status: 200,
            headers: {},
            data: { challenge: true, message: 'Please complete captcha' },
          };
        },
      });

      await expect(client.request('GET', 'https://example.com/api')).rejects.toMatchObject({
        code: 'XACT_4030',
        statusCode: 403,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
      });
    });

    test('should throw INVALID_ARGS when response payload is invalid/corrupted', async () => {
      const provider = new StaticProxyProvider({ pool: proxyPool });
      const validator = new MockPlatformValidator();

      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
      }

      const client = new CustomApiClient({
        proxyProvider: provider,
        responseValidator: validator,
        requiresAuth: false,
        maxProxyRetries: 1,
        httpClient: async () => {
          return {
            status: 200,
            headers: {},
            data: { error: 'corrupted' },
          };
        },
      });

      await expect(client.request('GET', 'https://example.com/api')).rejects.toMatchObject({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
      });
    });

    test('should classify 401 as AuthSessionExpiredError and 500 as ProxyDeadError in handleError', () => {
      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
      }
      const client = new CustomApiClient();

      expect(() => client.handleError({ status: 401 }, 'custom-platform')).toThrow(AuthSessionExpiredError);
      expect(() => client.handleError({ status: 502 }, 'custom-platform')).toThrow(ProxyDeadError);
    });

    test('should preserve sticky proxy when using StaticProxyProvider with accountId', async () => {
      const provider = new StaticProxyProvider({ pool: proxyPool });
      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
        requiresAuth = true;
      }
      const client = new CustomApiClient({
        proxyProvider: provider,
        requiresAuth: true,
        httpClient: async ({ proxy }) => ({ status: 200, data: { proxy } }),
      });

      const res1 = await client.request('GET', 'https://example.com/api', { accountId: 'acc_1' });
      const res2 = await client.request('GET', 'https://example.com/api', { accountId: 'acc_1' });

      expect(res1.data.proxy.host).toBe(res2.data.proxy.host);
    });

    test('should record once in governor when AccountPool shares the same governor', async () => {
      const sharedAccountPool = new AccountPool({ governor });
      sharedAccountPool.registerAccounts('test-platform', ['acc_shared']);

      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
        platform = 'test-platform';
        requiresAuth = true;
      }
      const client = new CustomApiClient({
        proxyProvider: new StaticProxyProvider({ pool: proxyPool }),
        governor,
        accountPool: sharedAccountPool,
        httpClient: async () => ({ status: 200, data: { ok: true } }),
      });

      await client.request('GET', 'https://example.com/api', { accountId: 'acc_shared' });

      expect(governor.getAccountVelocity('acc_shared', 'test-platform')).toBe(1);
      expect(sharedAccountPool.getAccountVelocity('acc_shared', 'test-platform')).toBe(1);
    });

    test('should throw AUTH_EXPIRED when auth client has no account and no account pool', async () => {
      class CustomApiClient extends AbstractApiClient {
        name = 'custom-platform';
        platform = 'custom-platform';
        requiresAuth = true;
      }
      const client = new CustomApiClient({
        httpClient: async () => ({ status: 200, data: { ok: true } }),
      });

      await expect(client.request('GET', 'https://example.com/api')).rejects.toMatchObject({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
      });
    });

    test('should not double-count governor velocity when crawler client shares the same governor', async () => {
      class CustomClient extends AbstractApiClient {
        name = 'test-platform';
        platform = 'test-platform';
      }
      const client = new CustomClient({
        proxyProvider: new StaticProxyProvider({ pool: proxyPool }),
        governor,
        httpClient: async () => ({ status: 200, data: { ok: true } }),
      });

      class TestCrawlerWithClient extends AbstractCrawler {
        name = 'test-platform';
        requiresAuth = true;
        constructor(deps) {
          super(deps);
          this.registerAction({
            action: 'scrape_with_client',
            handler: async () => client.request('GET', 'https://example.com', { accountId: 'acc_1' }),
          });
        }
      }

      const crawler = new TestCrawlerWithClient({ client, governor, accountPool });
      await crawler.start({ action: 'scrape_with_client', args: {}, session: { accountId: 'acc_1' } });

      expect(governor.getAccountVelocity('acc_1', 'test-platform')).toBe(1);
    });
  });
});
