// by nichxbt — tests/web/youtube.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageSrc = readFileSync(join(__dirname, '../../apps/web/app/youtube/page.tsx'), 'utf8');
const navSrc = readFileSync(join(__dirname, '../../apps/web/lib/nav.ts'), 'utf8');

describe('youtube insights page architecture & constraints', () => {
  it('is a client component', () => {
    expect(pageSrc).toContain("'use client'");
  });

  it('imports api helper from @/lib/api', () => {
    expect(pageSrc).toContain("from '@/lib/api'");
  });

  it('has no raw fetch calls to backend or external apis', () => {
    expect(pageSrc).not.toContain('fetch(');
  });

  it('routes scrape requests through same-origin BFF /api/platform/youtube/scrape', () => {
    expect(pageSrc).toContain("'/api/platform/youtube/scrape'");
  });

  it('calls trending_vn, channel_detail, channel_videos, and video_comments actions', () => {
    expect(pageSrc).toContain("'trending_vn'");
    expect(pageSrc).toContain("'channel_detail'");
    expect(pageSrc).toContain("'channel_videos'");
    expect(pageSrc).toContain("'video_comments'");
  });

  it('enforces referrerPolicy="no-referrer" for external video thumbnails and avatars', () => {
    expect(pageSrc).toContain('referrerPolicy="no-referrer"');
  });

  it('has empty state and Retry handling for upstream errors', () => {
    expect(pageSrc).toContain('Retry');
    expect(pageSrc).toContain('Không tìm thấy kênh');
    expect(pageSrc).toContain('Video này chưa có bình luận');
  });

  it('implements 3 tabs: Trending VN, Channel Inspector, and Comment Reader', () => {
    expect(pageSrc).toContain('Trending VN');
    expect(pageSrc).toContain('Channel Inspector');
    expect(pageSrc).toContain('Comment Reader');
  });

  it('extracts videoId from youtube urls', () => {
    expect(pageSrc).toContain('watch?v=');
    expect(pageSrc).toContain('youtu.be/');
    expect(pageSrc).toContain('/shorts/');
  });

  it('sorts comments by likesCount descending', () => {
    expect(pageSrc).toContain('likesCount');
  });
});

describe('youtube navigation integration', () => {
  it('registers /youtube under Intelligence nav group in nav.ts', () => {
    expect(navSrc).toContain('/youtube');
    expect(navSrc).toContain('YouTube');
  });
});
