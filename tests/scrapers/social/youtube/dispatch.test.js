import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scrape,
  getPlatform,
  YouTubeVNCrawler,
  YouTubeClient,
  createYouTubeClient,
  createYouTubeVNCrawler,
  scrapeYouTube,
} from '../../../../src/scrapers/index.js';
import searchFixture from './fixtures/youtube-search.json';
import trendingFixture from './fixtures/youtube-trending.json';
import channelFixture from './fixtures/youtube-channel.json';
import videoFixture from './fixtures/youtube-video.json';
import commentsFixture from './fixtures/youtube-comments.json';

describe('Story 33.2: Unified Dispatcher - YouTube VN', () => {
  beforeEach(() => {
    vi.spyOn(YouTubeClient.prototype, 'searchVideos').mockResolvedValue(searchFixture);
    vi.spyOn(YouTubeClient.prototype, 'getTrending').mockResolvedValue(trendingFixture);
    vi.spyOn(YouTubeClient.prototype, 'getChannelVideos').mockResolvedValue(searchFixture);
    vi.spyOn(YouTubeClient.prototype, 'getChannelDetail').mockResolvedValue(channelFixture);
    vi.spyOn(YouTubeClient.prototype, 'getVideoDetail').mockResolvedValue(videoFixture);
    vi.spyOn(YouTubeClient.prototype, 'getVideoComments').mockResolvedValue(commentsFixture);
    vi.spyOn(YouTubeClient.prototype, 'cleanup').mockResolvedValue(undefined);
  });

  it('resolves platform aliases via getPlatform', () => {
    expect(getPlatform('youtube')).toBeDefined();
    expect(getPlatform('yt')).toBeDefined();
    expect(getPlatform('youtube_vn')).toBeDefined();
  });

  it('exports YouTubeVNCrawler and YouTubeClient from unified scrapers barrel', () => {
    expect(YouTubeVNCrawler).toBeDefined();
    expect(YouTubeClient).toBeDefined();
    expect(createYouTubeClient).toBeDefined();
    expect(createYouTubeVNCrawler).toBeDefined();
    expect(scrapeYouTube).toBeDefined();
  });

  it('dispatches search via scrape(youtube, ...)', async () => {
    const res = await scrape('youtube', 'search', {
      query: 'AI Vietnam',
      apiKey: 'test_key',
    });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].platform).toBe('youtube');
    expect(res.posts[0].category).toBe('video');
  });

  it('dispatches trending_vn via alias scrape(yt, trending, ...)', async () => {
    const res = await scrape('yt', 'trending', {
      maxResults: 20,
    });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].viewsCount).toBe(2500000);
  });

  it('dispatches channel_detail via alias scrape(youtube_vn, channel, ...)', async () => {
    const res = await scrape('youtube_vn', 'channel', {
      channelId: 'UC_channel_vtv',
    });
    expect(res.profile).toBeDefined();
    expect(res.profile.name).toBe('VTV Digital & Công Nghệ');
  });

  it('dispatches channel_videos correctly when passing id parameter', async () => {
    const res = await scrape('youtube', 'channel_videos', {
      id: 'UC_channel_vtv',
      limit: 5,
    });
    expect(res.posts).toHaveLength(2);
    expect(YouTubeClient.prototype.getChannelVideos).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'UC_channel_vtv', maxResults: 5 })
    );
  });

  it('dispatches channel_detail correctly when passing id parameter', async () => {
    const res = await scrape('youtube', 'channel_detail', {
      id: 'UC_channel_vtv',
    });
    expect(res.profile).toBeDefined();
    expect(res.profile.name).toBe('VTV Digital & Công Nghệ');
  });

  it('dispatches video_detail via scrape(youtube, video, ...)', async () => {
    const res = await scrape('youtube', 'video', {
      videoId: 'vid_single_999',
    });
    expect(res.post).toBeDefined();
    expect(res.post.id).toBe('youtube:vid_single_999');
  });

  it('dispatches video_comments via scrape(youtube, comments, ...)', async () => {
    const res = await scrape('youtube', 'comments', {
      videoId: 'vid_single_999',
    });
    expect(res.comments).toHaveLength(3);
    expect(res.comments[0].platform).toBe('youtube');
  });

  it('executes scrapeYouTube convenience helper', async () => {
    const res = await scrapeYouTube('trending_vn');
    expect(res.posts).toHaveLength(2);
  });
});
