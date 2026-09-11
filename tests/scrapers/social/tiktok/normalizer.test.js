import { describe, it, expect } from 'vitest';
import { parseTimestamp, normalizeTikTokPost } from '../../../../src/scrapers/social/tiktok/normalizer.js';

describe('TikTok normalizer enhancements', () => {
  it('correctly handles microsecond timestamps (> 1e14)', () => {
    const microTs = 1690000000000000; // 16 digits, microseconds
    const date = parseTimestamp(microTs);
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(1690000000000);
  });

  it('correctly handles millisecond timestamps (> 1e11)', () => {
    const milliTs = 1690000000000;
    const date = parseTimestamp(milliTs);
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(1690000000000);
  });

  it('correctly handles second timestamps', () => {
    const secTs = 1690000000;
    const date = parseTimestamp(secTs);
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(1690000000000);
  });

  it('extracts photo carousel images from imagePost struct', () => {
    const item = {
      id: '7123456789',
      desc: 'Photo carousel test',
      imagePost: {
        images: [
          { imageURL: { urlList: ['https://p16.tiktokcdn.com/img1.jpg'] } },
          { imageURL: { urlList: ['https://p16.tiktokcdn.com/img2.jpg'] } }
        ]
      }
    };
    const post = normalizeTikTokPost(item);
    expect(post).toBeDefined();
    expect(post.mediaUrls).toHaveLength(2);
    expect(post.mediaUrls[0]).toBe('https://p16.tiktokcdn.com/img1.jpg');
    expect(post.metadata.isImagePost).toBe(true);
    expect(post.metadata.imageCount).toBe(2);
  });
});
