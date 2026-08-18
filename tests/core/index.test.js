// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Unit tests for src/core abstract contracts and error hierarchy.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AbstractCrawler,
  AbstractApiClient,
  AbstractLogin,
  AbstractStore,
  AbstractPlatformResponseValidator,
  PlatformError,
  RateLimitError,
  BotChallengeError,
  AuthSessionExpiredError,
  ProxyDeadError,
  ErrorTypes,
  SuggestedActions,
  StatusApi,
  ActionRegistry,
  globalActionRegistry,
  SessionManager,
  globalSessionManager,
  AccountPool,
  globalAccountPool,
  PreSignedTokenRing,
  SignerWorkerPagePool,
  CATEGORIES,
  generatePostId,
  generateCommentId,
  isValidCategory,
} from '../../src/core/index.js';

describe('Abstract class contracts', () => {
  it('AbstractCrawler cannot be instantiated directly', () => {
    expect(() => new AbstractCrawler()).toThrow(/abstract/i);
  });

  it('AbstractApiClient cannot be instantiated directly', () => {
    expect(() => new AbstractApiClient()).toThrow(/abstract/i);
  });

  it('AbstractLogin cannot be instantiated directly', () => {
    expect(() => new AbstractLogin()).toThrow(/abstract/i);
  });

  it('AbstractStore cannot be instantiated directly', () => {
    expect(() => new AbstractStore()).toThrow(/abstract/i);
  });

  it('AbstractPlatformResponseValidator cannot be instantiated directly', () => {
    expect(() => new AbstractPlatformResponseValidator()).toThrow(/abstract/i);
  });
});

describe('AbstractCrawler action registry', () => {
  class TestCrawler extends AbstractCrawler {
    name = 'test';
  }

  beforeEach(() => {
    globalActionRegistry.listAll().forEach((d) => {
      // No public unregister, so we use a fresh TestCrawler per test.
    });
  });

  it('registers snake_case actions and returns descriptors', () => {
    const crawler = new TestCrawler();
    crawler.registerAction('search', async () => [], { description: 'Search posts' });
    const actions = crawler.listActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('search');
    expect(actions[0].description).toBe('Search posts');
    expect(actions[0].outputType).toBe('PostItem[]');
  });

  it('rejects non-snake_case action names', () => {
    const crawler = new TestCrawler();
    expect(() => crawler.registerAction('Search Posts', async () => [])).toThrow(PlatformError);
    expect(() => crawler.registerAction('search-posts!', async () => [])).toThrow(PlatformError);
  });

  it('dispatches start() to registered handler', async () => {
    const crawler = new TestCrawler();
    crawler.registerAction('search', async (args) => [{ id: 'test:1', ...args }]);
    const result = await crawler.start({ action: 'search', args: { q: 'hello' }, session: {} });
    expect(result).toHaveLength(1);
    expect(result[0].q).toBe('hello');
  });

  it('throws on unknown action', async () => {
    const crawler = new TestCrawler();
    await expect(crawler.start({ action: 'missing', args: {}, session: {} })).rejects.toThrow(PlatformError);
  });
});

describe('Error envelope hierarchy', () => {
  it('PlatformError.toEnvelope() returns required shape', () => {
    const err = new PlatformError({
      code: 'XACT_1234',
      type: ErrorTypes.INTERNAL,
      message: 'Something failed',
      statusCode: 500,
      retryAfterMs: 5000,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      accountId: 'acc-1',
      platform: 'twitter',
    });
    const env = err.toEnvelope();

    expect(env).toHaveProperty('code', 'XACT_1234');
    expect(env).toHaveProperty('type', ErrorTypes.INTERNAL);
    expect(env).toHaveProperty('message', 'Something failed');
    expect(env).toHaveProperty('statusCode', 500);
    expect(env).toHaveProperty('isRetryable', false);
    expect(env).toHaveProperty('retryAfterMs', 5000);
    expect(env).toHaveProperty('retryAfter', 5);
    expect(env).toHaveProperty('suggestedAction', SuggestedActions.RETRY_AFTER_DELAY);
    expect(env).toHaveProperty('accountId', 'acc-1');
    expect(env).toHaveProperty('platform', 'twitter');
  });

  it.each([
    ['RateLimitError', RateLimitError, ErrorTypes.RATE_LIMIT, 429, SuggestedActions.ROTATE_PROXY],
    ['BotChallengeError', BotChallengeError, ErrorTypes.BOT_CHALLENGE, 403, SuggestedActions.ROTATE_PROXY],
    ['AuthSessionExpiredError', AuthSessionExpiredError, ErrorTypes.AUTH_EXPIRED, 401, SuggestedActions.RELOGIN],
    ['ProxyDeadError', ProxyDeadError, ErrorTypes.PROXY_EXHAUSTED, 503, SuggestedActions.WAIT],
  ])('%s has correct type, status and suggested action', (_label, ErrorClass, type, status, action) => {
    const err = new ErrorClass({ platform: 'facebook' });
    const env = err.toEnvelope();
    expect(env.type).toBe(type);
    expect(env.statusCode).toBe(status);
    expect(env.suggestedAction).toBe(action);
    expect(env.isRetryable).toBe(type !== ErrorTypes.AUTH_EXPIRED);
  });
});

describe('StatusApi', () => {
  it('returns default GovernorStatus when no governor is provided', () => {
    const api = new StatusApi();
    const status = api.getGovernorStatus();
    expect(status).toEqual({
      healthyProxyCount: 0,
      totalProxyCount: 0,
      healthyProxyRatio: 0,
      currentReqPerSecond: 0,
      redisConsumerLag: 0,
      hibernatingAccounts: [],
      throttleLevel: 'normal',
    });
  });
});

describe('ActionRegistry', () => {
  it('registers and lists platform actions', () => {
    const registry = new ActionRegistry();
    registry.registerPlatformActions('twitter', [
      { action: 'search', description: 'Search', requiredArgs: [], example: {}, outputType: 'PostItem[]' },
    ]);
    expect(registry.get('twitter', 'search')?.action).toBe('search');
    expect(registry.listByPlatform('twitter')).toHaveLength(1);
    expect(registry.listAll()).toHaveLength(1);
  });
});

describe('SessionManager & AccountPool', () => {
  it('SessionManager stores and retrieves sessions', () => {
    const sm = new SessionManager();
    sm.set('acc-1', { accountId: 'acc-1', cookies: 'x=1', tokens: {}, expiresAt: new Date() });
    expect(sm.has('acc-1')).toBe(true);
    expect(sm.get('acc-1')?.accountId).toBe('acc-1');
  });

  it('AccountPool rotates accounts and skips hibernating ones', () => {
    const ap = new AccountPool();
    ap.registerAccounts('twitter', ['acc-1', 'acc-2']);
    expect(ap.getNextAvailable('twitter')).toBe('acc-1');
    expect(ap.getNextAvailable('twitter')).toBe('acc-2');
    expect(ap.getNextAvailable('twitter')).toBe('acc-1');
    ap.markUnavailable('acc-1');
    expect(ap.getNextAvailable('twitter')).toBe('acc-2');
  });
});

describe('Signer pool', () => {
  it('PreSignedTokenRing rotates tokens up to capacity', () => {
    const ring = new PreSignedTokenRing({ capacity: 3 });
    ring.refill(['a', 'b', 'c', 'd']);
    expect(ring.size).toBe(3);
    expect(ring.next()).toBe('a');
    expect(ring.next()).toBe('b');
    expect(ring.next()).toBe('c');
    expect(ring.next()).toBe('a');
  });

  it('PreSignedTokenRing returns null when empty', () => {
    const ring = new PreSignedTokenRing();
    expect(ring.next()).toBeNull();
  });

  it('SignerWorkerPagePool abstract methods throw', async () => {
    const pool = new SignerWorkerPagePool({ browser: {} });
    await expect(pool.init()).rejects.toThrow(/Method not implemented/i);
    await expect(pool.evaluate('1+1')).rejects.toThrow(/Method not implemented/i);
    await expect(pool.close()).rejects.toThrow(/Method not implemented/i);
  });
});

describe('Types helpers', () => {
  it('generates namespaced post and comment ids', () => {
    expect(generatePostId('twitter', '123')).toBe('twitter:123');
    expect(generateCommentId('twitter', '123', '456')).toBe('twitter:123:456');
  });

  it('validates categories', () => {
    expect(isValidCategory(CATEGORIES.SOCIAL)).toBe(true);
    expect(isValidCategory('unknown')).toBe(false);
  });

  it('AbstractCrawler.validateItem rejects invalid category with allowed list', () => {
    class TestCrawler extends AbstractCrawler {
      name = 'test';
    }
    const crawler = new TestCrawler();
    expect(() => crawler.validateItem({ id: 'test:1', platform: 'test', category: 'unknown' })).toThrow(/Allowed:/);
  });
});
