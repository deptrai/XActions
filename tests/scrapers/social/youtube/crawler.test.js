import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YouTubeVNCrawler } from '../../../../src/scrapers/social/youtube/crawler.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import searchFixture from './fixtures/youtube-search.json';
import trendingFixture from './fixtures/youtube-trending.json';
import channelFixture from './fixtures/youtube-channel.json';
import videoFixture from './fixtures/youtube-video.json';
import commentsFixture from './fixtures/youtube-comments.json';

describe('Story 33.2: YouTubeVNCrawler', () => {
  let mockClient;
  let mockStore;
  let mockPublisher;
  let mockAccountPool;
  let crawler;

  beforeEach(() => {
    mockClient = {
      requiresAuth: false,
      requiresProxy: false,
      platform: 'youtube',
      setApiKey: vi.fn(),
      searchVideos: vi.fn().mockResolvedValue(searchFixture),
      getTrending: vi.fn().mockResolvedValue(trendingFixture),
      getChannelVideos: vi.fn().mockResolvedValue(searchFixture),
      getChannelDetail: vi.fn().mockResolvedValue(channelFixture),
      getVideoDetail: vi.fn().mockResolvedValue(videoFixture),
      getVideoComments: vi.fn().mockResolvedValue(commentsFixture),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    mockStore = {
      savePost: vi.fn().mockResolvedValue(undefined),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      saveComment: vi.fn().mockResolvedValue(undefined),
      storeBatch: vi.fn().mockResolvedValue(undefined),
    };

    mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockAccountPool = {
      getAccount: vi.fn().mockReturnValue({
        credentials: { apiKey: 'pool_key_123' },
      }),
      listAccounts: vi.fn().mockReturnValue([
        { credentials: { apiKey: 'pool_key_123' } },
      ]),
    };

    crawler = new YouTubeVNCrawler({
      client: mockClient,
      store: mockStore,
      publisher: mockPublisher,
      accountPool: mockAccountPool,
    });
  });

  it('inherits from AbstractCrawler with expected properties', () => {
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('youtube');
    expect(crawler.platform).toBe('youtube');
    expect(crawler.category).toBe('video');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('implements init and cleanup lifecycle cleanly', async () => {
    await expect(crawler.init()).resolves.toBeUndefined();
    await expect(crawler.cleanup()).resolves.toBeUndefined();
    expect(mockClient.cleanup).toHaveBeenCalled();
  });

  it('scrapes search, validates items, persists to store and publishes thin-events', async () => {
    const res = await crawler.start({
      action: 'search',
      args: { query: 'AI Vietnam', regionCode: 'VN' },
    });

    expect(mockClient.searchVideos).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'AI Vietnam', regionCode: 'VN' })
    );
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].platform).toBe('youtube');
    expect(res.posts[0].category).toBe('video');
    expect(mockStore.storeBatch).toHaveBeenCalledWith(res.posts);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(2);
  });

  it('scrapes trending_vn with alias trending', async () => {
    const res1 = await crawler.start({ action: 'trending_vn', args: { maxResults: 10 } });
    expect(res1.posts).toHaveLength(2);

    const res2 = await crawler.start({ action: 'trending', args: { maxResults: 10 } });
    expect(res2.posts).toHaveLength(2);
    expect(mockClient.getTrending).toHaveBeenCalledTimes(2);
  });

  it('scrapes channel_videos', async () => {
    const res = await crawler.start({
      action: 'channel_videos',
      args: { channelId: 'UC_channel_vtv' },
    });
    expect(mockClient.getChannelVideos).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'UC_channel_vtv' })
    );
    expect(res.posts).toHaveLength(2);
  });

  it('scrapes channel_detail with aliases (channel, profile)', async () => {
    const res1 = await crawler.start({
      action: 'channel_detail',
      args: { channelId: 'UC_channel_vtv' },
    });
    expect(res1.profile).toBeDefined();
    expect(res1.profile.name).toBe('VTV Digital & Công Nghệ');
    expect(mockStore.saveProfile).toHaveBeenCalledWith(res1.profile);

    const res2 = await crawler.start({
      action: 'channel',
      args: { channelId: 'UC_channel_vtv' },
    });
    expect(res2.profile.name).toBe('VTV Digital & Công Nghệ');

    const res3 = await crawler.start({
      action: 'profile',
      args: { channelId: 'UC_channel_vtv' },
    });
    expect(res3.profile.name).toBe('VTV Digital & Công Nghệ');
  });

  it('scrapes video_detail with aliases (video, detail)', async () => {
    const res = await crawler.start({
      action: 'video_detail',
      args: { videoId: 'vid_single_999' },
    });
    expect(res.post).toBeDefined();
    expect(res.post.id).toBe('youtube:vid_single_999');
    expect(res.post.title).toContain('Trí Tuệ Nhân Tạo');
    expect(mockStore.storeBatch).toHaveBeenCalledWith([res.post]);

    const resAlias = await crawler.start({
      action: 'video',
      args: { videoId: 'vid_single_999' },
    });
    expect(resAlias.post.id).toBe('youtube:vid_single_999');
  });

  it('scrapes video_comments with alias comments and persists comments', async () => {
    const res = await crawler.start({
      action: 'video_comments',
      args: { videoId: 'vid_single_999' },
    });
    expect(res.comments).toHaveLength(3);
    expect(res.comments[0].platform).toBe('youtube');
    expect(mockStore.saveComment).toHaveBeenCalledTimes(3);

    const resAlias = await crawler.start({
      action: 'comments',
      args: { videoId: 'vid_single_999' },
    });
    expect(resAlias.comments).toHaveLength(3);
  });

  it('resolves apiKey from direct arguments', async () => {
    await crawler.start({
      action: 'search',
      args: { apiKey: 'custom_key_456', query: 'test' },
    });
    expect(mockClient.setApiKey).toHaveBeenCalledWith('custom_key_456');
  });

  it('propagates apiKey from session when passed in start command', async () => {
    await crawler.start({
      action: 'search',
      args: { query: 'test' },
      session: { apiKey: 'session_key_789' },
    });
    expect(mockClient.setApiKey).toHaveBeenCalledWith('session_key_789');
  });

  it('scrapes channel_videos with id alias', async () => {
    const res = await crawler.start({
      action: 'channel_videos',
      args: { id: 'UC_sample_channel' },
    });
    expect(res.posts).toHaveLength(2);
    expect(mockClient.getChannelVideos).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'UC_sample_channel' })
    );
  });

  it('resolves apiKey from accountPool when available', async () => {
    await crawler.start({
      action: 'search',
      args: { accountId: 'acc_yt_1', query: 'test' },
    });
    expect(mockClient.setApiKey).toHaveBeenCalledWith('pool_key_123');
  });
});
