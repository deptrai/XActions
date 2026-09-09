// tests/core/base-crawler.checkpoint.test.js
// Tests for Story 25.5: Auto Checkpoint Lookup & Early Termination in AbstractCrawler.

import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractStore } from '../../src/core/base-store.js';
import { globalActionRegistry } from '../../src/core/action-registry.js';

class TestCrawler extends AbstractCrawler {
  name = 'test-platform';
}

class StubStore extends AbstractStore {
  constructor(checkpoint = null, existingIds = []) {
    super();
    this.checkpoint = checkpoint;
    this.existingIds = existingIds;
  }
  async init() {}
  async storeContent() {}
  async storeBatch() { return { insertedCount: 0, duplicateCount: 0, totalCount: 0, schemaValid: true }; }
  async storeComment() {}
  async storeCommentBatch() {}
  async findExistingIds(ids) { return ids.filter(id => this.existingIds.includes(id)); }
  async getCheckpoint() { return this.checkpoint; }
  async close() {}
}

describe('AbstractCrawler — Auto Checkpoint Lookup (Story 25.5)', () => {
  beforeEach(() => {
    globalActionRegistry.clear();
  });

  it('injects lastCursor into args when checkpoint exists and resolver registered', async () => {
    const store = new StubStore({ lastCursor: 'CURSOR_123', status: 'idle' });
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('group_posts', async (args) => {
      receivedArgs = args;
      return [];
    }, {
      checkpointResolver: (args) => ({
        targetType: 'group',
        targetKey: args.groupId,
        cursorField: 'cursor',
        fallbackCursorFields: ['after', 'cursor'],
      }),
    });

    await crawler.start({ action: 'group_posts', args: { groupId: 'g_456' } });
    expect(receivedArgs.cursor).toBe('CURSOR_123');
  });

  it('does not override caller-supplied cursor', async () => {
    const store = new StubStore({ lastCursor: 'CURSOR_123', status: 'idle' });
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('group_posts', async (args) => {
      receivedArgs = args;
      return [];
    }, {
      checkpointResolver: (args) => ({ targetType: 'group', targetKey: args.groupId }),
    });

    await crawler.start({ action: 'group_posts', args: { groupId: 'g_456', cursor: 'CALLER_CURSOR' } });
    expect(receivedArgs.cursor).toBe('CALLER_CURSOR');
  });

  it('skips checkpoint lookup when args.resume === false', async () => {
    const store = new StubStore({ lastCursor: 'CURSOR_123', status: 'idle' });
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('group_posts', async (args) => {
      receivedArgs = args;
      return [];
    }, {
      checkpointResolver: (args) => ({ targetType: 'group', targetKey: args.groupId }),
    });

    await crawler.start({ action: 'group_posts', args: { groupId: 'g_456', resume: false } });
    expect(receivedArgs.cursor).toBeUndefined();
  });

  it('does nothing when action has no checkpointResolver', async () => {
    const store = new StubStore({ lastCursor: 'CURSOR_123', status: 'idle' });
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('profile', async (args) => {
      receivedArgs = args;
      return {};
    });

    await crawler.start({ action: 'profile', args: { username: 'alice' } });
    expect(receivedArgs.cursor).toBeUndefined();
  });

  it('handles missing checkpoint gracefully without throwing', async () => {
    const store = new StubStore(null);
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('group_posts', async (args) => {
      receivedArgs = args;
      return [];
    }, {
      checkpointResolver: (args) => ({ targetType: 'group', targetKey: args.groupId }),
    });

    await expect(
      crawler.start({ action: 'group_posts', args: { groupId: 'g_456' } })
    ).resolves.not.toThrow();
    expect(receivedArgs.cursor).toBeUndefined();
  });

  it('injects cursor into correct field when cursorField is not "cursor"', async () => {
    const store = new StubStore({ lastCursor: 'CURSOR_XYZ', status: 'idle' });
    const crawler = new TestCrawler({ store });
    let receivedArgs = null;

    crawler.registerAction('feed', async (args) => {
      receivedArgs = args;
      return [];
    }, {
      checkpointResolver: () => ({
        targetType: 'feed',
        targetKey: 'main',
        cursorField: 'after',
        fallbackCursorFields: ['after'],
      }),
    });

    await crawler.start({ action: 'feed', args: {} });
    expect(receivedArgs.after).toBe('CURSOR_XYZ');
  });
});

describe('AbstractCrawler — Early Termination (shouldStopPagination)', () => {
  beforeEach(() => {
    globalActionRegistry.clear();
  });

  it('returns true when all items already exist in store', async () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const store = new StubStore(null, ['a', 'b']);
    const crawler = new TestCrawler({ store });

    const shouldStop = await crawler.shouldStopPagination(items);
    expect(shouldStop).toBe(true);
  });

  it('returns false when some items are new', async () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const store = new StubStore(null, ['a']);
    const crawler = new TestCrawler({ store });

    const shouldStop = await crawler.shouldStopPagination(items);
    expect(shouldStop).toBe(false);
  });

  it('returns false when no store is configured', async () => {
    const crawler = new TestCrawler({ store: null });
    const shouldStop = await crawler.shouldStopPagination([{ id: 'a' }]);
    expect(shouldStop).toBe(false);
  });

  it('returns false for empty items array', async () => {
    const store = new StubStore(null, ['a']);
    const crawler = new TestCrawler({ store });
    const shouldStop = await crawler.shouldStopPagination([]);
    expect(shouldStop).toBe(false);
  });

  it('returns false when store.findExistingIds is not implemented', async () => {
    const items = [{ id: 'a' }];
    const store = new StubStore(null);
    store.findExistingIds = undefined; // Simulate legacy store
    const crawler = new TestCrawler({ store });

    const shouldStop = await crawler.shouldStopPagination(items);
    expect(shouldStop).toBe(false);
  });
});
