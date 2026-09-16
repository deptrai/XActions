// by nichxbt
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';

// Mock streamManager before importing routes
const mockCreateStream = vi.fn();
const mockStopStream = vi.fn();
const mockGetStreamStatus = vi.fn();
const mockListStreams = vi.fn();
const mockUpdateStream = vi.fn();
const mockPauseStream = vi.fn();
const mockResumeStream = vi.fn();
const mockGetStreamHistory = vi.fn();
const mockGetStreamStats = vi.fn();
const mockStopAllStreams = vi.fn();

vi.mock('../../src/streaming/streamManager.js', () => ({
  createStream: mockCreateStream,
  stopStream: mockStopStream,
  getStreamStatus: mockGetStreamStatus,
  listStreams: mockListStreams,
  updateStream: mockUpdateStream,
  pauseStream: mockPauseStream,
  resumeStream: mockResumeStream,
  getStreamHistory: mockGetStreamHistory,
  getStreamStats: mockGetStreamStats,
  stopAllStreams: mockStopAllStreams,
  STREAM_TYPES: ['tweet', 'follower', 'mention', 'jetstream', 'mastodon_sse', 'cdc'],
  setIO: vi.fn(),
  activeAdapters: new Map(),
}));

// Import routes after mocking
const { default: streamsRouter } = await import('../../api/routes/streams.js');

const app = express();
app.use(express.json());
// Mock auth middleware — inject user
app.use((req, _res, next) => {
  req.user = { id: 'test-user-1', sessionCookie: 'test-cookie' };
  next();
});
app.use('/api/streams', streamsRouter);

const request = supertest(app);

describe('POST /api/streams — push stream types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateStream.mockResolvedValue({
      id: 'stream_jetstream_all_abc123',
      type: 'jetstream',
      username: '*',
      status: 'running',
    });
  });

  it('creates a jetstream stream without username', async () => {
    const res = await request
      .post('/api/streams')
      .send({
        type: 'jetstream',
        options: { wantedCollections: ['app.bsky.feed.post'] },
      });

    expect(res.status).toBe(201);
    expect(mockCreateStream).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'jetstream',
        username: undefined,
        options: { wantedCollections: ['app.bsky.feed.post'] },
      })
    );
  });

  it('creates a mastodon_sse stream without username', async () => {
    mockCreateStream.mockResolvedValue({
      id: 'stream_mastodon_sse_all_def456',
      type: 'mastodon_sse',
      username: '*',
      status: 'running',
    });

    const res = await request
      .post('/api/streams')
      .send({
        type: 'mastodon_sse',
        options: { instance: 'mastodon.social', streamType: 'public' },
      });

    expect(res.status).toBe(201);
    expect(mockCreateStream).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mastodon_sse',
        options: { instance: 'mastodon.social', streamType: 'public' },
      })
    );
  });

  it('creates a cdc stream without username', async () => {
    mockCreateStream.mockResolvedValue({
      id: 'stream_cdc_all_ghi789',
      type: 'cdc',
      username: '*',
      status: 'running',
    });

    const res = await request
      .post('/api/streams')
      .send({
        type: 'cdc',
        options: { sourceStreamKey: 'cdc:events' },
      });

    expect(res.status).toBe(201);
    expect(mockCreateStream).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cdc',
        options: { sourceStreamKey: 'cdc:events' },
      })
    );
  });

  it('rejects polling stream types without username', async () => {
    const res = await request
      .post('/api/streams')
      .send({ type: 'tweet' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username');
  });

  it('rejects invalid stream type', async () => {
    const res = await request
      .post('/api/streams')
      .send({ type: 'invalid_type' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or missing "type"');
  });

  it('passes options through to createStream', async () => {
    const res = await request
      .post('/api/streams')
      .send({
        type: 'jetstream',
        options: {
          wantedCollections: ['app.bsky.feed.post'],
          wantedDids: ['did:plc:abc123'],
          jetstreamHost: 'jetstream2.us-west.bsky.network',
        },
      });

    expect(res.status).toBe(201);
    expect(mockCreateStream).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          wantedCollections: ['app.bsky.feed.post'],
          wantedDids: ['did:plc:abc123'],
          jetstreamHost: 'jetstream2.us-west.bsky.network',
        },
      })
    );
  });
});
