import { describe, it, expect } from 'vitest';
import {
  normalizeYouTubeVideo,
  normalizeYouTubeChannel,
  normalizeYouTubeCommentThread,
  normalizeYouTubeResults,
} from '../../../../src/scrapers/social/youtube/normalizer.js';
import searchFixture from './fixtures/youtube-search.json';
import trendingFixture from './fixtures/youtube-trending.json';
import channelFixture from './fixtures/youtube-channel.json';
import videoFixture from './fixtures/youtube-video.json';
import commentsFixture from './fixtures/youtube-comments.json';

describe('Story 33.2: YouTube Normalizers', () => {
  it('normalizes single video item to PostItem', () => {
    const raw = trendingFixture.items[0];
    const post = normalizeYouTubeVideo(raw, { regionCode: 'VN' });

    expect(post.id).toBe(`youtube:${raw.id}`);
    expect(post.platform).toBe('youtube');
    expect(post.category).toBe('video');
    expect(post.title).toBe(raw.snippet.title);
    expect(post.authorId).toBe(raw.snippet.channelId);
    expect(post.authorName).toBe(raw.snippet.channelTitle);
    expect(post.authorUrl).toBe(`https://www.youtube.com/channel/${raw.snippet.channelId}`);
    expect(post.postUrl).toBe(`https://www.youtube.com/watch?v=${raw.id}`);
    expect(post.mediaUrls).toHaveLength(1);
    expect(post.viewsCount).toBe(2500000);
    expect(post.likesCount).toBe(120000);
    expect(post.metadata.duration).toBe('PT4M25S');
    expect(post.metadata.durationSeconds).toBe(265);
    expect(post.metadata.tags).toContain('vpop');
    expect(post.publishedAt).toBeInstanceOf(Date);
  });

  it('normalizes single channel item to ProfileItem', () => {
    const raw = channelFixture.items[0];
    const profile = normalizeYouTubeChannel(raw);

    expect(profile.id).toBe(`youtube:${raw.id}`);
    expect(profile.platform).toBe('youtube');
    expect(profile.name).toBe(raw.snippet.title);
    expect(profile.followersCount).toBe(2400000);
    expect(profile.metadata.videoCount).toBe(4500);
    expect(profile.metadata.country).toBe('VN');
    expect(profile.profileUrl).toContain('vtvdigital');
  });

  it('normalizes comment thread with nested replies', () => {
    const thread = commentsFixture.items[0];
    const comments = normalizeYouTubeCommentThread(thread, { videoId: 'vid_single_999' });

    expect(comments).toHaveLength(2);

    const top = comments[0];
    expect(top.id).toBe('youtube:vid_single_999:top_cmt_1');
    expect(top.depth).toBe(0);
    expect(top.parentCommentId).toBeUndefined();
    expect(top.authorName).toBe('Tran Binh Minh');
    expect(top.likesCount).toBe(24);

    const reply = comments[1];
    expect(reply.id).toBe('youtube:vid_single_999:reply_cmt_1_1');
    expect(reply.depth).toBe(1);
    expect(reply.parentCommentId).toBe('youtube:vid_single_999:top_cmt_1');
    expect(reply.authorName).toBe('VTV Digital & Công Nghệ');
  });

  describe('normalizeYouTubeResults action router', () => {
    it('handles search action and returns posts array with pageInfo', () => {
      const res = normalizeYouTubeResults(searchFixture, 'search');
      expect(res.posts).toHaveLength(2);
      expect(res.posts[0].id).toBe('youtube:vid_search_1');
      expect(res.pageInfo.nextPageToken).toBe('CAUQAA');
      expect(res.pageInfo.has_next_page).toBe(true);
    });

    it('handles trending_vn action', () => {
      const res = normalizeYouTubeResults(trendingFixture, 'trending_vn');
      expect(res.posts).toHaveLength(2);
      expect(res.posts[0].viewsCount).toBe(2500000);
    });

    it('handles video_detail action', () => {
      const res = normalizeYouTubeResults(videoFixture, 'video_detail');
      expect(res.post).toBeDefined();
      expect(res.post.id).toBe('youtube:vid_single_999');
      expect(res.post.title).toContain('Trí Tuệ Nhân Tạo');
    });

    it('handles channel_detail action', () => {
      const res = normalizeYouTubeResults(channelFixture, 'channel_detail');
      expect(res.profile).toBeDefined();
      expect(res.profile.name).toBe('VTV Digital & Công Nghệ');
    });

    it('handles video_comments action', () => {
      const res = normalizeYouTubeResults(commentsFixture, 'video_comments');
      expect(res.comments).toHaveLength(3); // 2 from thread 1 + 1 from thread 2
      expect(res.pageInfo.has_next_page).toBe(true);
    });

    it('handles commentsDisabled flag', () => {
      const res = normalizeYouTubeResults({ commentsDisabled: true }, 'video_comments');
      expect(res.comments).toEqual([]);
      expect(res.pageInfo.commentsDisabled).toBe(true);
    });

    it('normalizes item with object id without videoId safely without object Object', () => {
      const res = normalizeYouTubeVideo({ id: { kind: 'youtube#channel' }, snippet: { title: 'No Video Id' } });
      expect(res.id).not.toContain('[object Object]');
      expect(res.id).toContain('youtube:unknown:');
    });
  });
});
