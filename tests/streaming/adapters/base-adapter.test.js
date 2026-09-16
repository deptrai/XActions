// by nichxbt
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BasePushAdapter } from '../../../src/streaming/adapters/base-adapter.js';

class TestPushAdapter extends BasePushAdapter {
  connectCalled = false;
  disconnectCalled = false;

  async connect() {
    this.connectCalled = true;
    this._connected = true;
    this._resetReconnect();
    this._emitStatus('running');
  }

  async disconnect() {
    this.disconnectCalled = true;
    await super.disconnect();
  }

  testEmit(item) {
    return this._emitEvent(item);
  }

  testError(err) {
    this._emitError(err);
  }
}

describe('BasePushAdapter', () => {
  it('instantiates with streamId and options', () => {
    const adapter = new TestPushAdapter('test-stream-1', { cursor: '100' });
    expect(adapter.streamId).toBe('test-stream-1');
    expect(adapter.isConnected).toBe(false);
    expect(adapter.isPaused).toBe(false);
    expect(adapter.cursorKey).toBe('xactions:adapter_cursor:test-stream-1');
  });

  it('throws error when streamId is omitted', () => {
    expect(() => new TestPushAdapter('')).toThrow('streamId is required');
  });

  it('manages cursor locally and saves/retrieves cursor', async () => {
    const adapter = new TestPushAdapter('test-stream-2');
    await adapter.saveCursor('12345');
    const cursor = await adapter.getCursor();
    expect(cursor).toBe('12345');
  });

  it('supports connect and status emission', async () => {
    const adapter = new TestPushAdapter('test-stream-3');
    const statuses = [];
    adapter.on('status', (s) => statuses.push(s.status));

    await adapter.connect();
    expect(adapter.connectCalled).toBe(true);
    expect(adapter.isConnected).toBe(true);
    expect(statuses).toContain('running');
  });

  it('supports pause, resume, and disconnect lifecycle', async () => {
    const adapter = new TestPushAdapter('test-stream-4');
    const statuses = [];
    adapter.on('status', (s) => statuses.push(s.status));

    await adapter.connect();
    expect(adapter.isPaused).toBe(false);

    adapter.pause();
    expect(adapter.isPaused).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('paused');

    adapter.resume();
    expect(adapter.isPaused).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('running');

    await adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.disconnectCalled).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('stopped');
  });

  it('emits events to listeners and drops events when paused', async () => {
    const adapter = new TestPushAdapter('test-stream-5');
    const received = [];
    adapter.on('event', (item) => received.push(item));

    await adapter.testEmit({ id: 'item-1', content: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('item-1');

    adapter.pause();
    await adapter.testEmit({ id: 'item-2', content: 'dropped' });
    expect(received).toHaveLength(1);

    adapter.resume();
    await adapter.testEmit({ id: 'item-3', content: 'resumed' });
    expect(received).toHaveLength(2);
    expect(received[1].id).toBe('item-3');
  });

  it('emits errors to error listener', () => {
    const adapter = new TestPushAdapter('test-stream-6');
    let capturedErr = null;
    adapter.on('error', (err) => {
      capturedErr = err;
    });

    adapter.testError(new Error('Test failure'));
    expect(capturedErr).not.toBeNull();
    expect(capturedErr.message).toBe('Test failure');
  });

  it('calls publisher.publish with normalized ThinEvent fields', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish: async (item) => { publishCalls.push(item); },
      ensureClient: async () => null,
    };
    const adapter = new TestPushAdapter('test-stream-pub', {}, mockPublisher);

    // Simulate a PostItem (content/postUrl) — should be mapped to content_snippet/post_url
    await adapter.testEmit({ id: 'post-1', content: 'Hello world', postUrl: 'https://example.com/1', platform: 'test' });

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0].content_snippet).toBe('Hello world');
    expect(publishCalls[0].post_url).toBe('https://example.com/1');
    // Original fields preserved
    expect(publishCalls[0].content).toBe('Hello world');
    expect(publishCalls[0].postUrl).toBe('https://example.com/1');
  });

  it('preserves existing content_snippet/post_url on already-normalized events', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish: async (item) => { publishCalls.push(item); },
      ensureClient: async () => null,
    };
    const adapter = new TestPushAdapter('test-stream-pub2', {}, mockPublisher);

    // CDC-style ThinEvent — already has content_snippet/post_url
    await adapter.testEmit({ id: 'cdc:1', content_snippet: 'CDC text', post_url: 'https://cdc.example.com/1' });

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0].content_snippet).toBe('CDC text');
    expect(publishCalls[0].post_url).toBe('https://cdc.example.com/1');
  });

  it('schedules reconnect with exponential backoff', async () => {
    vi.useFakeTimers();
    const adapter = new TestPushAdapter('test-stream-reconnect');

    // Stub connect to fail
    let connectCount = 0;
    adapter.connect = async () => {
      connectCount++;
      throw new Error('connection failed');
    };

    const statuses = [];
    adapter.on('status', (s) => statuses.push(s.status));

    // Trigger first reconnect
    adapter._scheduleReconnect();
    expect(statuses).toContain('reconnecting');
    expect(adapter.reconnectAttempts).toBe(1);

    // Advance past first delay (1s)
    await vi.advanceTimersByTimeAsync(1100);
    expect(connectCount).toBe(1);

    // Should have scheduled second reconnect
    expect(adapter.reconnectAttempts).toBe(2);

    // Advance past second delay (2s)
    await vi.advanceTimersByTimeAsync(2100);
    expect(connectCount).toBe(2);
    expect(adapter.reconnectAttempts).toBe(3);

    adapter._closing = true;
    vi.useRealTimers();
  });

  it('emits error status when max reconnect attempts reached', () => {
    vi.useFakeTimers();
    const adapter = new TestPushAdapter('test-stream-maxreconnect', {
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 100,
    });

    const errors = [];
    adapter.on('error', (e) => errors.push(e));

    const statuses = [];
    adapter.on('status', (s) => statuses.push(s.status));

    adapter.reconnectAttempts = 2;
    adapter._scheduleReconnect();

    expect(errors.length).toBeGreaterThan(0);
    expect(statuses).toContain('error');

    adapter._closing = true;
    vi.useRealTimers();
  });

  it('cursor persists across adapter instances via Redis', async () => {
    // Use a mock Redis client to simulate persistence
    const store = {};
    const mockRedis = {
      get: async (key) => store[key] || null,
      set: async (key, val) => { store[key] = val; },
    };
    const mockPublisher = {
      publish: async () => {},
      ensureClient: async () => mockRedis,
    };

    // First instance saves cursor
    const adapter1 = new TestPushAdapter('test-cursor-persist', {}, mockPublisher);
    await adapter1.saveCursor('99999');

    // Second instance with same streamId loads cursor from Redis
    const adapter2 = new TestPushAdapter('test-cursor-persist', {}, mockPublisher);
    const cursor = await adapter2.getCursor();
    expect(cursor).toBe('99999');
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
