import { describe, it, expect } from 'vitest';
import {
  ContentTransformer,
  PLATFORM_LIMITS,
  PLATFORM_MEDIA_LIMITS,
  splitText,
  chunkMedia,
  normalizePlatform,
} from '../../../src/scrapers/social/content-transformer.js';
import {
  UniversalActionDispatcher,
  dispatchAction,
} from '../../../src/scrapers/social/dispatcher.js';

describe('Story 30.2 — ContentTransformer (Thread Splitter, Media Adapter, Character Limits)', () => {
  describe('Constants & Platform Normalization', () => {
    it('defines standard character limits for all target platforms', () => {
      expect(PLATFORM_LIMITS.twitter).toBe(280);
      expect(PLATFORM_LIMITS.x).toBe(280);
      expect(PLATFORM_LIMITS.bluesky).toBe(300);
      expect(PLATFORM_LIMITS.bsky).toBe(300);
      expect(PLATFORM_LIMITS.mastodon).toBe(500);
      expect(PLATFORM_LIMITS.threads).toBe(500);
    });

    it('defines media attachment limits per platform', () => {
      expect(PLATFORM_MEDIA_LIMITS.twitter).toBe(4);
      expect(PLATFORM_MEDIA_LIMITS.bluesky).toBe(4);
      expect(PLATFORM_MEDIA_LIMITS.mastodon).toBe(4);
      expect(PLATFORM_MEDIA_LIMITS.threads).toBe(10);
    });

    it('normalizes platform aliases accurately', () => {
      expect(normalizePlatform('X')).toBe('twitter');
      expect(normalizePlatform('  bsky ')).toBe('bluesky');
      expect(normalizePlatform('MASTO')).toBe('mastodon');
      expect(normalizePlatform('threads')).toBe('threads');
    });
  });

  describe('splitText', () => {
    it('returns single chunk without numbering when text fits platform limit', () => {
      const text = 'Hello world, this is a short update.';
      const result = splitText(text, { platform: 'twitter' });
      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(1);
      expect(result[0].total).toBe(1);
      expect(result[0].text).toBe(text);
      expect(result[0].text).not.toContain('1/1');
    });

    it('splits long text exceeding Twitter limit (280) into numbered chunks', () => {
      const sentence = 'The quick brown fox jumps over the lazy dog. Artificial intelligence is evolving rapidly every day. ';
      const longText = sentence.repeat(5); // ~500 chars
      const result = splitText(longText, { platform: 'twitter' });

      expect(result.length).toBeGreaterThanOrEqual(2);
      result.forEach((chunk, i) => {
        expect(chunk.charCount).toBeLessThanOrEqual(280);
        expect(chunk.index).toBe(i + 1);
        expect(chunk.total).toBe(result.length);
        expect(chunk.text.startsWith(`${i + 1}/${result.length} `)).toBe(true);
      });
    });

    it('splits text with higher limit on Mastodon (500) into fewer chunks than Twitter', () => {
      const text = 'This is an insightful paragraph about distributed protocols and federation. '.repeat(10); // ~760 chars
      const twitterResult = splitText(text, { platform: 'twitter' });
      const mastodonResult = splitText(text, { platform: 'mastodon' });

      expect(mastodonResult.length).toBeLessThan(twitterResult.length);
      mastodonResult.forEach((chunk) => {
        expect(chunk.charCount).toBeLessThanOrEqual(500);
      });
    });

    it('preserves URLs intact without splitting across boundaries', () => {
      const url = 'https://github.com/nirholas/XActions/blob/main/docs/architecture-decision-records/ADR-001.md';
      const text = 'Check out this important documentation about the core architecture: ' + url + '. ' + 'More extra content that extends past the character limit to force a split. '.repeat(4);
      const result = splitText(text, { platform: 'twitter' });

      const urlFound = result.some((chunk) => chunk.text.includes(url));
      expect(urlFound).toBe(true);
    });

    it('preserves @mentions and #hashtags intact without breaking them', () => {
      const mention = '@elonmusk_and_friends';
      const hashtag = '#MachineLearningInProduction2026';
      const text = `Hey ${mention}, what do you think about ${hashtag}? ` + 'Extra padding content to force the thread to split into multiple tweets. '.repeat(4);
      const result = splitText(text, { platform: 'twitter' });

      const mentionFound = result.some((chunk) => chunk.text.includes(mention));
      const hashtagFound = result.some((chunk) => chunk.text.includes(hashtag));
      expect(mentionFound).toBe(true);
      expect(hashtagFound).toBe(true);
    });

    it('throws XACT_4001 when a single atomic token exceeds the platform budget', () => {
      const giantToken = 'https://example.com/' + 'a'.repeat(300);
      expect(() => {
        splitText(giantToken, { platform: 'twitter' });
      }).toThrowError(/exceeds platform limit/);
    });
  });

  describe('chunkMedia', () => {
    it('returns empty array when media is empty', () => {
      expect(chunkMedia([], 'twitter')).toEqual([]);
      expect(chunkMedia(null, 'twitter')).toEqual([]);
    });

    it('chunks 8 images into 2 batches of 4 for Twitter/Bluesky/Mastodon', () => {
      const media = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'];
      const chunks = chunkMedia(media, 'twitter');
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(4);
      expect(chunks[1]).toHaveLength(4);
    });

    it('chunks 12 images into batches of 10 and 2 for Threads', () => {
      const media = Array.from({ length: 12 }, (_, i) => `img_${i}.jpg`);
      const chunks = chunkMedia(media, 'threads');
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(10);
      expect(chunks[1]).toHaveLength(2);
    });
  });

  describe('ContentTransformer.transform & transformForAll', () => {
    it('transforms source content into TransformedPost[] with metadata', () => {
      const source = {
        text: 'A great announcement! ' + 'More details will be shared soon in the upcoming days. '.repeat(6),
        media: ['photo1.png', 'photo2.png'],
        altText: 'Diagram of architecture',
      };

      const transformed = ContentTransformer.transform(source, 'twitter');
      expect(transformed.length).toBeGreaterThanOrEqual(2);
      expect(transformed[0].platform).toBe('twitter');
      expect(transformed[0].media).toHaveLength(2);
      expect(transformed[0].altText).toBe('Diagram of architecture');
      expect(transformed[0].metadata.isThreadPart).toBe(true);
    });

    it('transforms for multiple platforms with different limits via transformForAll', () => {
      const source = {
        text: 'Multi-platform update across decentralized and traditional social networks. '.repeat(5),
      };

      const allTransformed = ContentTransformer.transformForAll(source, ['twitter', 'mastodon']);
      expect(allTransformed.twitter).toBeDefined();
      expect(allTransformed.mastodon).toBeDefined();
      expect(allTransformed.twitter.length).toBeGreaterThanOrEqual(allTransformed.mastodon.length);
    });
  });

  describe('UniversalActionDispatcher integration with ContentTransformer', () => {
    it('automatically splits long posts into a thread when autoThread is true', async () => {
      const longPost = '🚀 Big Announcement: We are launching cross-platform syndication! ' +
        'Every post will now reach X, Bluesky, Mastodon, and Threads seamlessly without extra work. '.repeat(5);

      const res = await dispatchAction({
        platform: ['bluesky', 'mastodon'],
        action: 'post',
        args: {
          text: longPost,
          autoThread: true,
          dryRun: true,
        },
      });

      expect(res.success).toBe(true);
      expect(res.results.bluesky).toBeDefined();
      expect(res.results.mastodon).toBeDefined();

      // Verify Bluesky received thread parts
      expect(res.results.bluesky.thread).toBeDefined();
      expect(res.results.bluesky.total).toBeGreaterThan(1);

      // Verify Mastodon received thread parts
      expect(res.results.mastodon.thread).toBeDefined();
      expect(res.results.mastodon.total).toBeGreaterThan(1);
    });

    it('does not split text when autoThread is false', async () => {
      const postText = 'Single standard post.';
      const res = await dispatchAction({
        platform: ['bluesky'],
        action: 'post',
        args: {
          text: postText,
          autoThread: false,
          dryRun: true,
        },
      });

      expect(res.success).toBe(true);
      expect(res.results.bluesky.thread).toBeUndefined();
      expect(res.results.bluesky.dryRun).toBe(true);
    });
  });
});
