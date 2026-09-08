import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';

class MockCrawler extends AbstractCrawler {
  constructor(deps = {}) {
    super(deps);
    this.name = 'mock';
  }
}

describe('Story 34.2: AbstractCrawler Telemetry Instrumentation Unit Tests', () => {
  let mockEmitter;
  let crawler;

  beforeEach(() => {
    mockEmitter = {
      emitRun: vi.fn(),
      emitRequest: vi.fn(),
    };
  });

  it('initializes scraperId, category, and telemetryEmitter with sensible defaults', () => {
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });
    expect(crawler.scraperId).toBe('mock-hybrid');
    expect(crawler.category).toBe('social');
    expect(crawler.telemetryEmitter).toBe(mockEmitter);
  });

  it('allows overriding scraperId and category via deps', () => {
    crawler = new MockCrawler({
      scraperId: 'custom-scraper',
      category: 'ecom',
      telemetryEmitter: mockEmitter,
    });
    expect(crawler.scraperId).toBe('custom-scraper');
    expect(crawler.category).toBe('ecom');
  });

  it('correctly resolves item count from various result shapes (AD-33)', () => {
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });

    // 1. Array
    expect(crawler.extractItemCount([1, 2, 3])).toBe(3);

    // 2. Object with array properties
    expect(crawler.extractItemCount({ posts: [{ id: '1' }, { id: '2' }], pageInfo: {} })).toBe(2);
    expect(crawler.extractItemCount({ items: [{ id: '1' }] })).toBe(1);
    expect(crawler.extractItemCount({ data: [1, 2, 3, 4] })).toBe(4);
    expect(crawler.extractItemCount({ records: [1, 2] })).toBe(2);
    expect(crawler.extractItemCount({ results: [1, 2, 3] })).toBe(3);

    // 3. Count / total property
    expect(crawler.extractItemCount({ count: 42 })).toBe(42);
    expect(crawler.extractItemCount({ total: 100 })).toBe(100);

    // 4. Single object
    expect(crawler.extractItemCount({ id: 'post_1', title: 'test' })).toBe(1);

    // 5. Falsy / null / undefined
    expect(crawler.extractItemCount(null)).toBe(0);
    expect(crawler.extractItemCount(undefined)).toBe(0);
    expect(crawler.extractItemCount([])).toBe(0);
  });

  it('emits telemetry:run on success and passes session.telemetry to action handler', async () => {
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });
    let passedSession = null;

    crawler.registerAction('test_action', async (args, session) => {
      passedSession = session;
      session.telemetry.recordRequest({ latencyMs: 120, httpStatus: 200 });
      return { posts: [{ id: 1 }, { id: 2 }] };
    });

    const result = await crawler.start({ action: 'test_action', args: {} });

    expect(result).toEqual({ posts: [{ id: 1 }, { id: 2 }] });
    expect(passedSession).toBeDefined();
    expect(passedSession.telemetry).toBeDefined();

    // Verify emission in finally block
    expect(mockEmitter.emitRun).toHaveBeenCalledTimes(1);
    const runCall = mockEmitter.emitRun.mock.calls[0][0];
    expect(runCall.type).toBe('telemetry:run');
    expect(runCall.scraperId).toBe('mock-hybrid');
    expect(runCall.action).toBe('test_action');
    expect(runCall.itemCount).toBe(2);
    expect(runCall.isSuccess).toBe(true);
    expect(runCall.source).toBe('production');

    expect(mockEmitter.emitRequest).toHaveBeenCalledTimes(1);
    const reqCall = mockEmitter.emitRequest.mock.calls[0][0];
    expect(reqCall.latencyMs).toBe(120);
  });

  it('emits telemetry:run with error details and re-throws original error', async () => {
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });

    crawler.registerAction('failing_action', async (args, session) => {
      session.telemetry.recordRequest({ latencyMs: 50, httpStatus: 500 });
      const err = new Error('Upstream failed');
      err.code = 'XACT_5001';
      throw err;
    });

    await expect(crawler.start({ action: 'failing_action', args: {} })).rejects.toThrow('Upstream failed');

    expect(mockEmitter.emitRun).toHaveBeenCalledTimes(1);
    const runCall = mockEmitter.emitRun.mock.calls[0][0];
    expect(runCall.isSuccess).toBe(false);
    expect(runCall.errorName).toBe('XACT_5001');

    expect(mockEmitter.emitRequest).toHaveBeenCalledTimes(1);
  });

  it('bypasses rate governor velocity and hibernation checks when session.isCanary is true', async () => {
    const mockGovernor = {
      canAccountRequest: vi.fn().mockReturnValue(false), // Should be bypassed
      getMaxThroughput: vi.fn().mockReturnValue(10),
      recordRequest: vi.fn(),
    };

    crawler = new MockCrawler({
      governor: mockGovernor,
      telemetryEmitter: mockEmitter,
      requiresAuth: true,
    });

    crawler.registerAction('canary_action', async () => {
      return [{ id: 'canary-1' }];
    }, { requiresAuth: true });

    const result = await crawler.start({
      action: 'canary_action',
      session: { isCanary: true, accountId: 'acc_123' },
    });

    expect(result).toHaveLength(1);
    expect(mockGovernor.canAccountRequest).not.toHaveBeenCalled();
    expect(mockGovernor.recordRequest).not.toHaveBeenCalled();

    const runCall = mockEmitter.emitRun.mock.calls[0][0];
    expect(runCall.source).toBe('canary');
  });
  it('action descriptor category overrides default category (AD-34)', async () => {
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });
    crawler.registerAction({
      action: 'ecom_scrape',
      category: 'ecom',
      handler: async () => ({ count: 5 }),
    });

    await crawler.start({ action: 'ecom_scrape', args: {} });

    expect(mockEmitter.emitRun).toHaveBeenCalledTimes(1);
    const runCall = mockEmitter.emitRun.mock.calls[0][0];
    expect(runCall.category).toBe('ecom');
  });

  it('automatically threads telemetryContext down to client and store and unsets in finally', async () => {
    const mockClient = { telemetryContext: null, isCanary: false };
    const mockStore = { telemetryContext: null };

    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });
    crawler.client = mockClient;
    crawler.store = mockStore;

    let inFlightClientContext = null;
    let inFlightStoreContext = null;

    crawler.registerAction('check_threading', async (args, session) => {
      inFlightClientContext = crawler.client.telemetryContext;
      inFlightStoreContext = crawler.store.telemetryContext;
      return { ok: true };
    });

    await crawler.start({ action: 'check_threading', args: {} });

    expect(inFlightClientContext).toBeDefined();
    expect(inFlightClientContext.scraperId).toBe('mock-hybrid');
    expect(inFlightStoreContext).toBe(inFlightClientContext);

    // Cleaned up in finally
    expect(crawler.client.telemetryContext).toBeNull();
    expect(crawler.store.telemetryContext).toBeNull();
  });

  it('propagates canary flag to client when session.isCanary is true', async () => {
    const mockClient = { telemetryContext: null, isCanary: false };
    crawler = new MockCrawler({ telemetryEmitter: mockEmitter });
    crawler.client = mockClient;

    let inFlightClientCanary = null;

    crawler.registerAction('canary_prop', async () => {
      inFlightClientCanary = crawler.client.isCanary;
      return 10;
    });

    const res = await crawler.start({
      action: 'canary_prop',
      session: { isCanary: true },
    });

    expect(res).toBe(10);
    expect(inFlightClientCanary).toBe(true);
    expect(crawler.client.isCanary).toBe(false);

    const runCall = mockEmitter.emitRun.mock.calls[0][0];
    expect(runCall.itemCount).toBe(10);
    expect(runCall.source).toBe('canary');
  });

});
