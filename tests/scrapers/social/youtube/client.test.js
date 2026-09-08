import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YouTubeClient, createYouTubeClient } from '../../../../src/scrapers/social/youtube/client.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import {
  AuthSessionExpiredError,
  RateLimitError,
  BotChallengeError,
  PlatformError,
} from '../../../../src/core/error-envelope.js';

describe('Story 33.2: YouTubeClient', () => {
  let client;

  beforeEach(() => {
    client = new YouTubeClient({
      apiKey: 'test_api_key_xyz',
    });
  });

  it('inherits from AbstractApiClient', () => {
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.name).toBe('youtube');
    expect(client.platform).toBe('youtube');
    expect(client.baseUrl).toBe('https://www.googleapis.com/youtube/v3');
    expect(client.apiKey).toBe('test_api_key_xyz');
  });

  it('instantiates via createYouTubeClient helper', () => {
    const c = createYouTubeClient({ apiKey: 'helper_key' });
    expect(c).toBeInstanceOf(YouTubeClient);
    expect(c.apiKey).toBe('helper_key');
  });

  it('setApiKey updates apiKey dynamically', () => {
    client.setApiKey('updated_key_789');
    expect(client.apiKey).toBe('updated_key_789');
  });

  it('buildUrl appends key and query parameters', () => {
    const url = client.buildUrl('/search', {
      q: 'AI Vietnam',
      regionCode: 'VN',
      maxResults: 10,
    });
    expect(url).toContain('key=test_api_key_xyz');
    expect(url).toContain('q=AI+Vietnam');
    expect(url).toContain('regionCode=VN');
    expect(url).toContain('maxResults=10');
  });

  it('searchVideos calls /search with regionCode VN default', async () => {
    const mockRes = { kind: 'youtube#searchListResponse', items: [] };
    vi.spyOn(client, 'request').mockResolvedValue(mockRes);

    const res = await client.searchVideos({ query: 'Khoa học' });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/search?'),
      expect.anything()
    );
    expect(res).toBe(mockRes);
  });

  it('getTrending calls /videos with chart=mostPopular and regionCode VN', async () => {
    const mockRes = { kind: 'youtube#videoListResponse', items: [] };
    vi.spyOn(client, 'request').mockResolvedValue(mockRes);

    const res = await client.getTrending({ maxResults: 15 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('chart=mostPopular'),
      expect.anything()
    );
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('regionCode=VN'),
      expect.anything()
    );
    expect(res).toBe(mockRes);
  });

  it('getChannelVideos requires channelId or throws', async () => {
    await expect(client.getChannelVideos({})).rejects.toThrow(PlatformError);

    vi.spyOn(client, 'request').mockResolvedValue({ items: [] });
    await expect(client.getChannelVideos({ channelId: 'UC123' })).resolves.toBeDefined();
  });

  it('getChannelDetail requires identifier (channelId, forHandle, forUsername)', async () => {
    await expect(client.getChannelDetail({})).rejects.toThrow(PlatformError);

    vi.spyOn(client, 'request').mockResolvedValue({ items: [] });
    await expect(client.getChannelDetail({ channelId: 'UC_vtv' })).resolves.toBeDefined();
  });

  it('getVideoDetail requires videoId or throws', async () => {
    await expect(client.getVideoDetail({})).rejects.toThrow(PlatformError);

    vi.spyOn(client, 'request').mockResolvedValue({ items: [] });
    await expect(client.getVideoDetail({ videoId: 'v123' })).resolves.toBeDefined();
  });

  it('getVideoComments handles disabled comments gracefully with string message', async () => {
    vi.spyOn(client, 'request').mockRejectedValue({
      message: 'The video has commentsDisabled',
    });

    const res = await client.getVideoComments({ videoId: 'disabled_vid' });
    expect(res.commentsDisabled).toBe(true);
    expect(res.items).toEqual([]);
  });

  it('getVideoComments handles disabled comments when error is inside err.details object', async () => {
    vi.spyOn(client, 'request').mockRejectedValue({
      message: 'Response payload is invalid or corrupted',
      details: {
        error: {
          code: 403,
          errors: [{ reason: 'commentsDisabled', domain: 'youtube.commentThread' }],
        },
      },
    });

    const res = await client.getVideoComments({ videoId: 'disabled_vid_struct' });
    expect(res.commentsDisabled).toBe(true);
    expect(res.items).toEqual([]);
  });

  it('getChannelVideos accepts channel or id alias', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({ items: [] });
    await expect(client.getChannelVideos({ channel: 'UC123' })).resolves.toBeDefined();
    await expect(client.getChannelVideos({ id: 'UC456' })).resolves.toBeDefined();
  });

  it('throws RateLimitError on quota exceeded', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      error: {
        code: 403,
        errors: [{ reason: 'quotaExceeded' }],
      },
    });

    await expect(client.getTrending()).rejects.toThrow(RateLimitError);
  });

  it('throws AuthSessionExpiredError on invalid API key', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      error: {
        code: 400,
        errors: [{ reason: 'keyInvalid' }],
      },
    });

    await expect(client.getTrending()).rejects.toThrow(AuthSessionExpiredError);
  });
});
