// by nichxbt
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStream,
  stopStream,
  pauseStream,
  resumeStream,
  getStreamStatus,
  getStreamHistory,
  STREAM_TYPES,
  activeAdapters,
} from '../../src/streaming/streamManager.js';

describe('streamManager with Push Adapters', () => {
  const createdStreamIds = [];

  afterEach(async () => {
    while (createdStreamIds.length > 0) {
      const id = createdStreamIds.pop();
      try {
        await stopStream(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('recognizes push adapter stream types', () => {
    expect(STREAM_TYPES).toContain('jetstream');
    expect(STREAM_TYPES).toContain('mastodon_sse');
    expect(STREAM_TYPES).toContain('cdc');
  });

  it('creates and stops a Jetstream push stream without username', async () => {
    const stream = await createStream({
      type: 'jetstream',
      options: {
        wantedCollections: ['app.bsky.feed.post'],
      },
    });

    expect(stream).toBeDefined();
    expect(stream.id).toContain('stream_jetstream_');
    expect(stream.type).toBe('jetstream');
    expect(stream.status).toBe('running');
    createdStreamIds.push(stream.id);

    const adapter = activeAdapters.get(stream.id);
    expect(adapter).toBeDefined();

    // Check pause and resume
    const paused = await pauseStream(stream.id);
    expect(paused.status).toBe('paused');
    expect(adapter.isPaused).toBe(true);

    const resumed = await resumeStream(stream.id);
    expect(resumed.status).toBe('running');
    expect(adapter.isPaused).toBe(false);

    // Stop stream
    const stopResult = await stopStream(stream.id);
    expect(stopResult.success).toBe(true);
    expect(activeAdapters.has(stream.id)).toBe(false);
  });

  it('creates and manages a Mastodon SSE push stream', async () => {
    const stream = await createStream({
      type: 'mastodon_sse',
      options: {
        instance: 'https://mastodon.social',
        streamType: 'public',
      },
    });

    expect(stream.type).toBe('mastodon_sse');
    createdStreamIds.push(stream.id);

    const status = await getStreamStatus(stream.id);
    expect(status).not.toBeNull();
    expect(status.id).toBe(stream.id);
    expect(status.type).toBe('mastodon_sse');
  });

  it('creates and manages a CDC push stream with history', async () => {
    const stream = await createStream({
      type: 'cdc',
      options: {
        sourceStreamKey: 'cdc:test_events',
      },
    });

    expect(stream.type).toBe('cdc');
    createdStreamIds.push(stream.id);

    const history = await getStreamHistory(stream.id);
    expect(Array.isArray(history)).toBe(true);
  });
});
