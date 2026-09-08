// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for YouTube VN Channel & Video Crawler (Story 33.2).
// by nichxbt

import { describe, it, expect, vi } from 'vitest';
import { scrape, scrapeYouTube, YouTubeClient } from '../../src/scrapers/index.js';
import { RateLimitError, AuthSessionExpiredError } from '../../src/core/error-envelope.js';
import searchFixture from '../scrapers/social/youtube/fixtures/youtube-search.json';
import trendingFixture from '../scrapers/social/youtube/fixtures/youtube-trending.json';
import channelFixture from '../scrapers/social/youtube/fixtures/youtube-channel.json';
import videoFixture from '../scrapers/social/youtube/fixtures/youtube-video.json';
import commentsFixture from '../scrapers/social/youtube/fixtures/youtube-comments.json';

describe('Story 33.2 — YouTube VN Channel & Video Crawler E2E Pipeline', () => {
  it('executes full pipeline for video search with PostItem normalization', async () => {
    vi.spyOn(YouTubeClient.prototype, 'searchVideos').mockResolvedValueOnce(searchFixture);

    const result = await scrape('youtube', 'search', {
      query: 'AI Vietnam',
      regionCode: 'VN',
      apiKey: 'test_api_key_2026',
    });

    expect(result).toHaveProperty('posts');
    expect(result.posts).toHaveLength(2);

    const firstPost = result.posts[0];
    expect(firstPost.id).toMatch(/^youtube:vid_search_\d+/);
    expect(firstPost.platform).toBe('youtube');
    expect(firstPost.category).toBe('video');
    expect(firstPost.authorId).toBe('UC_channel_101');
    expect(firstPost.authorName).toBe('Kênh Kinh Tế & Công Nghệ VN');
    expect(firstPost.mediaUrls).toHaveLength(1);
    expect(firstPost.metadata.regionCode).toBe('VN');

    expect(result.pageInfo.has_next_page).toBe(true);
    expect(result.pageInfo.nextPageToken).toBe('CAUQAA');
  });

  it('executes full pipeline for trending_vn with view/like metrics', async () => {
    vi.spyOn(YouTubeClient.prototype, 'getTrending').mockResolvedValueOnce(trendingFixture);

    const result = await scrape('yt', 'trending_vn', {
      maxResults: 20,
      apiKey: 'test_api_key_2026',
    });

    expect(result).toHaveProperty('posts');
    expect(result.posts).toHaveLength(2);

    const firstPost = result.posts[0];
    expect(firstPost.id).toBe('youtube:vid_trending_1');
    expect(firstPost.viewsCount).toBe(2500000);
    expect(firstPost.likesCount).toBe(120000);
    expect(firstPost.repliesCount).toBe(5400);
    expect(firstPost.metadata.duration).toBe('PT4M25S');
    expect(firstPost.metadata.durationSeconds).toBe(265);
    expect(firstPost.metadata.tags).toContain('vpop');
  });

  it('executes full pipeline for channel_detail with subscriber and video count', async () => {
    vi.spyOn(YouTubeClient.prototype, 'getChannelDetail').mockResolvedValueOnce(channelFixture);

    const result = await scrapeYouTube('channel_detail', {
      channelId: 'UC_channel_vtv',
    });

    expect(result).toHaveProperty('profile');
    const profile = result.profile;
    expect(profile.id).toBe('youtube:UC_channel_vtv');
    expect(profile.name).toBe('VTV Digital & Công Nghệ');
    expect(profile.followersCount).toBe(2400000);
    expect(profile.metadata.videoCount).toBe(4500);
    expect(profile.metadata.viewCount).toBe(680000000);
    expect(profile.metadata.country).toBe('VN');
  });

  it('executes full pipeline for video_detail single item extraction', async () => {
    vi.spyOn(YouTubeClient.prototype, 'getVideoDetail').mockResolvedValueOnce(videoFixture);

    const result = await scrape('youtube', 'video_detail', {
      videoId: 'vid_single_999',
    });

    expect(result).toHaveProperty('post');
    const post = result.post;
    expect(post.id).toBe('youtube:vid_single_999');
    expect(post.title).toContain('Trí Tuệ Nhân Tạo');
    expect(post.viewsCount).toBe(154000);
    expect(post.metadata.durationSeconds).toBe(1092);
  });

  it('executes full pipeline for video_comments with parent-child threading', async () => {
    vi.spyOn(YouTubeClient.prototype, 'getVideoComments').mockResolvedValueOnce(commentsFixture);

    const result = await scrape('youtube', 'video_comments', {
      videoId: 'vid_single_999',
    });

    expect(result).toHaveProperty('comments');
    expect(result.comments).toHaveLength(3);

    const topComment = result.comments[0];
    expect(topComment.depth).toBe(0);
    expect(topComment.parentCommentId).toBeUndefined();
    expect(topComment.likesCount).toBe(24);

    const reply = result.comments[1];
    expect(reply.depth).toBe(1);
    expect(reply.parentCommentId).toBe(topComment.id);
  });

  it('gracefully handles commentsDisabled error', async () => {
    vi.spyOn(YouTubeClient.prototype, 'request').mockRejectedValueOnce({
      message: 'The video has commentsDisabled',
    });

    const result = await scrape('youtube', 'video_comments', {
      videoId: 'disabled_vid',
    });

    expect(result.comments).toEqual([]);
    expect(result.pageInfo.commentsDisabled).toBe(true);
  });

  it('properly triggers RateLimitError on quotaExceeded (XACT_4029)', async () => {
    vi.spyOn(YouTubeClient.prototype, 'request').mockResolvedValueOnce({
      error: {
        code: 403,
        errors: [{ reason: 'quotaExceeded' }],
      },
    });

    await expect(
      scrape('youtube', 'trending_vn')
    ).rejects.toThrow(RateLimitError);
  });

  it('properly triggers AuthSessionExpiredError on invalid API key (XACT_4003)', async () => {
    vi.spyOn(YouTubeClient.prototype, 'request').mockResolvedValueOnce({
      error: {
        code: 400,
        errors: [{ reason: 'keyInvalid' }],
      },
    });

    await expect(
      scrape('youtube', 'search', { query: 'test' })
    ).rejects.toThrow(AuthSessionExpiredError);
  });
});
