// by nichxbt
import { describe, it, expect } from 'vitest';
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
});
