import { describe, it, expect } from 'vitest';
import {
  namespacedYouTubeId,
  namespacedCommentId,
  parseIsoDuration,
  extractBestThumbnail,
  parseYouTubeDate,
} from '../../../../src/scrapers/social/youtube/schema.js';

describe('Story 33.2: YouTube Schema Helpers', () => {
  it('namespacedYouTubeId formats IDs with prefix', () => {
    expect(namespacedYouTubeId('vid123')).toBe('youtube:vid123');
    expect(namespacedYouTubeId('c123', 'channel')).toBe('youtube:channel:c123');
  });

  it('namespacedCommentId creates video:comment ID', () => {
    expect(namespacedCommentId('v1', 'c1')).toBe('youtube:v1:c1');
  });

  it('parseIsoDuration parses ISO 8601 durations correctly', () => {
    expect(parseIsoDuration('PT4M25S')).toBe(265);
    expect(parseIsoDuration('PT1H2M10S')).toBe(3730);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT1H')).toBe(3600);
    expect(parseIsoDuration('P1DT2H3M4S')).toBe(93784);
    expect(parseIsoDuration('P2D')).toBe(172800);
    expect(parseIsoDuration('invalid')).toBeNull();
    expect(parseIsoDuration('P')).toBeNull();
    expect(parseIsoDuration('')).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });

  it('extractBestThumbnail picks highest quality available', () => {
    const thumbnails = {
      default: { url: 'https://img/default.jpg' },
      medium: { url: 'https://img/medium.jpg' },
      high: { url: 'https://img/high.jpg' },
      maxres: { url: 'https://img/maxres.jpg' },
    };
    expect(extractBestThumbnail(thumbnails)).toBe('https://img/maxres.jpg');

    const partial = {
      default: { url: 'https://img/default.jpg' },
      high: { url: 'https://img/high.jpg' },
    };
    expect(extractBestThumbnail(partial)).toBe('https://img/high.jpg');
    expect(extractBestThumbnail({})).toBeNull();
  });

  it('parseYouTubeDate parses valid ISO strings', () => {
    const d = parseYouTubeDate('2026-09-08T08:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-09-08T08:00:00.000Z');
    expect(parseYouTubeDate(null)).toBeNull();
  });
});
