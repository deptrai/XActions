// by nichxbt — Story 13.12: GraphQL Replay Engine tests (FR-112)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InMemoryReplayStore,
  RedisReplayStore,
  GraphQLCaptureHook,
  GraphQLReplayEngine,
} from '../../../../src/scrapers/social/facebook/graphql-replay.js';

// ---------------------------------------------------------------------------
// InMemoryReplayStore
// ---------------------------------------------------------------------------
describe('Story 13.12 — InMemoryReplayStore', () => {
  let store;

  beforeEach(() => {
    store = new InMemoryReplayStore(1000); // 1s TTL for tests
  });

  it('stores and retrieves a doc_id entry', async () => {
    await store.set('doc123', { tokens: { fb_dtsg: 'abc', lsd: 'xyz' }, friendlyName: 'CometUFI' });
    const entry = await store.get('doc123');
    expect(entry).not.toBeNull();
    expect(entry.docId).toBe('doc123');
    expect(entry.tokens.fb_dtsg).toBe('abc');
    expect(entry.friendlyName).toBe('CometUFI');
  });

  it('returns null for missing doc_id', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('invalidates a doc_id entry', async () => {
    await store.set('doc456', { tokens: {} });
    await store.invalidate('doc456');
    expect(await store.get('doc456')).toBeNull();
  });

  it('evicts oldest entries when full', async () => {
    const smallStore = new InMemoryReplayStore(60000);
    // Fill beyond MAX_REPLAY_ENTRIES
    for (let i = 0; i < 1001; i++) {
      await smallStore.set(`doc${i}`, { tokens: { index: i } });
    }
    expect(await smallStore.size()).toBeLessThanOrEqual(1000);
  });

  it('expires entries after TTL', async () => {
    const shortStore = new InMemoryReplayStore(50); // 50ms TTL
    await shortStore.set('doc_ttl', { tokens: {} });
    await new Promise(r => setTimeout(r, 60));
    expect(await shortStore.get('doc_ttl')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RedisReplayStore — mock redis client
// ---------------------------------------------------------------------------
describe('Story 13.12 — RedisReplayStore', () => {
  let redisClient;
  let store;

  beforeEach(() => {
    const data = new Map();
    redisClient = {
      get: vi.fn(async (k) => data.get(k) || null),
      set: vi.fn(async (k, v, mode, ttl) => { data.set(k, v); }),
      del: vi.fn(async (k) => { data.delete(k); }),
      keys: vi.fn(async (pattern) => [...data.keys()]),
    };
    store = new RedisReplayStore(redisClient, 'test:', 60000);
  });

  it('stores and retrieves via redis', async () => {
    await store.set('redis_doc', { tokens: { fb_dtsg: 'redis123' } });
    const entry = await store.get('redis_doc');
    expect(entry.tokens.fb_dtsg).toBe('redis123');
  });

  it('returns null for missing key', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('invalidates via redis del', async () => {
    await store.set('del_doc', { tokens: {} });
    await store.invalidate('del_doc');
    expect(await store.get('del_doc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GraphQLCaptureHook
// ---------------------------------------------------------------------------
describe('Story 13.12 — GraphQLCaptureHook', () => {
  it('captures GraphQL POST requests', () => {
    const store = new InMemoryReplayStore();
    const hook = new GraphQLCaptureHook(store);

    const captured = [];
    hook.attach({
      on: (event, fn) => captured.push(fn),
    });

    // Simulate a captured request
    const mockRequest = {
      url: () => 'https://www.facebook.com/api/graphql/',
      method: () => 'POST',
      postData: () => 'doc_id=12345&fb_dtsg=abc&lsd=xyz&variables=%7B%22id%22%3A%221%22%7D&fb_api_req_friendly_name=CometUFI',
    };

    // Manually trigger handler
    const handler = captured[0];
    handler(mockRequest);

    expect(hook.getCapturedDocIds()).toContain('12345');
  });

  it('ignores non-GraphQL requests', () => {
    const hook = new GraphQLCaptureHook();
    const captured = [];
    hook.attach({ on: (e, fn) => captured.push(fn) });

    const handler = captured[0];
    handler({
      url: () => 'https://www.facebook.com/other/path',
      method: () => 'GET',
      postData: () => null,
    });

    expect(hook.getCapturedDocIds()).toHaveLength(0);
  });

  it('persists captured doc_id to store', async () => {
    const store = new InMemoryReplayStore();
    const hook = new GraphQLCaptureHook(store);

    const captured = [];
    hook.attach({ on: (e, fn) => captured.push(fn) });

    const handler = captured[0];
    handler({
      url: () => 'https://www.facebook.com/api/graphql/',
      method: () => 'POST',
      postData: () => 'doc_id=999&fb_dtsg=test_token&lsd=lsd_val&__dyn=dyn_val&fb_api_req_friendly_name=Search',
    });

    // Wait for async store write
    await new Promise(r => setTimeout(r, 10));

    const entry = await store.get('999');
    expect(entry).not.toBeNull();
    expect(entry.tokens.fb_dtsg).toBe('test_token');
    expect(entry.friendlyName).toBe('Search');
  });
});

// ---------------------------------------------------------------------------
// GraphQLReplayEngine
// ---------------------------------------------------------------------------
describe('Story 13.12 — GraphQLReplayEngine', () => {
  let store;
  let engine;
  let mockClient;

  beforeEach(() => {
    store = new InMemoryReplayStore();
    mockClient = {
      requestGraphQl: vi.fn(async (docId, variables, opts) => ({
        docId,
        variables,
        tokens: opts.tokens,
        result: 'mocked_response',
      })),
    };
    engine = new GraphQLReplayEngine({ store, client: mockClient });
  });

  it('replays with cached tokens on hit', async () => {
    await store.set('cached_doc', { tokens: { fb_dtsg: 'cached_token' } });
    const result = await engine.replay('cached_doc', { postId: '1' });
    expect(result.replayed).toBe(true);
    expect(result.rotated).toBe(false);
    expect(mockClient.requestGraphQl).toHaveBeenCalledWith(
      'cached_doc',
      { postId: '1' },
      expect.objectContaining({ tokens: { fb_dtsg: 'cached_token' } }),
    );
  });

  it('throws on cache miss without capture hook', async () => {
    await expect(engine.replay('missing_doc')).rejects.toThrow(
      'no capture hook configured',
    );
  });

  it('detects rotation and invalidates cache', async () => {
    await store.set('rotated_doc', { tokens: { fb_dtsg: 'old' } });
    mockClient.requestGraphQl.mockRejectedValueOnce(new Error('Invalid doc_id'));
    const result = await engine.replay('rotated_doc');
    expect(result.rotated).toBe(true);
    expect(await store.get('rotated_doc')).toBeNull();
  });

  it('re-captures on rotation when page provided', async () => {
    const hook = new GraphQLCaptureHook(store);
    engine = new GraphQLReplayEngine({ store, captureHook: hook, client: mockClient });

    // Pre-seed rotated doc
    await store.set('rotated_doc2', { tokens: { fb_dtsg: 'old' } });
    // First call (cached) fails with rotation; retry call succeeds
    mockClient.requestGraphQl
      .mockRejectedValueOnce(new Error('doc_id rotated'))
      .mockResolvedValue({ data: 'fresh_result' });

    // Simulate page that will trigger capture
    const mockPage = {
      on: (e, fn) => {
        // Simulate a request being captured after attach
        setTimeout(() => {
          fn({
            url: () => 'https://www.facebook.com/api/graphql/',
            method: () => 'POST',
            postData: () => 'doc_id=rotated_doc2&fb_dtsg=new_token',
          });
        }, 50);
      },
    };

    const result = await engine.replay('rotated_doc2', {}, { page: mockPage, timeoutMs: 2000 });
    expect(result.replayed).toBe(false);
    expect(result.data).toEqual({ data: 'fresh_result' });
  });
});

// ---------------------------------------------------------------------------
// FacebookClient integration (Story 13.12, FR-112)
// ---------------------------------------------------------------------------
describe('Story 13.12 — FacebookClient.replayGraphQl', () => {
  it('exposes replayGraphQl and attachGraphQLCapture methods', async () => {
    const { FacebookClient } = await import('../../../../src/scrapers/social/facebook/client.js');
    const client = new FacebookClient({ requiresProxy: false });
    expect(typeof client.replayGraphQl).toBe('function');
    expect(typeof client.attachGraphQLCapture).toBe('function');
  });

  it('replayGraphQl succeeds on cached doc_id', async () => {
    const { FacebookClient } = await import('../../../../src/scrapers/social/facebook/client.js');
    const client = new FacebookClient({ requiresProxy: false });
    const store = new InMemoryReplayStore();
    await store.set('test_doc_123', { tokens: { fb_dtsg: 'tok123' } });
    client.replayStore = store;

    // Mock internal requestGraphQlSingle
    vi.spyOn(client, 'requestGraphQl').mockResolvedValueOnce({ success: true, data: 'replayed_data' });

    const res = await client.replayGraphQl('test_doc_123', { id: 'post1' });
    expect(res.replayed).toBe(true);
    expect(res.data).toEqual({ success: true, data: 'replayed_data' });
  });
});
