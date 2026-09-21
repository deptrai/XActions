import { describe, it, expect } from 'vitest';
import {
  UniversalMediaPipeline,
  extractMedia,
  detectPlatformFromUrl,
  extractTwitterMedia,
  extractBlueskyMedia,
  extractMastodonMedia,
  extractThreadsMedia,
  extractFacebookMedia,
  extractTikTokMedia,
} from '../../../src/scrapers/social/media-pipeline.js';
import { downloadMedia } from '../../../src/scrapers/videoDownloader.js';
import { toolMap } from '../../../src/mcp/local-tools.js';

describe('Story 31.1 — UniversalMediaPipeline (Audio, Carousel, HLS on All Platforms)', () => {
  describe('detectPlatformFromUrl', () => {
    it('detects platform correctly from various social media URLs', () => {
      expect(detectPlatformFromUrl('https://x.com/user/status/123')).toBe('twitter');
      expect(detectPlatformFromUrl('https://twitter.com/user/status/123')).toBe('twitter');
      expect(detectPlatformFromUrl('https://bsky.app/profile/alice.bsky.social/post/3k2v')).toBe('bluesky');
      expect(detectPlatformFromUrl('https://mastodon.social/@user/12345')).toBe('mastodon');
      expect(detectPlatformFromUrl('https://threads.net/@user/post/CuZ7X9')).toBe('threads');
      expect(detectPlatformFromUrl('https://facebook.com/watch?v=123')).toBe('facebook');
      expect(detectPlatformFromUrl('https://www.tiktok.com/@user/video/123')).toBe('tiktok');
    });
  });

  describe('extractTwitterMedia', () => {
    it('extracts highest bitrate MP4 for Twitter video and lists all variants', () => {
      const payload = {
        extended_entities: {
          media: [
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
              video_info: {
                variants: [
                  { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
                  { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
                  { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/med.mp4' },
                  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/master.m3u8' },
                ],
              },
            },
          ],
        },
      };

      const media = extractTwitterMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('video');
      expect(media[0].url).toBe('https://video.twimg.com/high.mp4');
      expect(media[0].bitrate).toBe(2176000);
      expect(media[0].variants.length).toBeGreaterThanOrEqual(3);
    });

    it('extracts Twitter audio space', () => {
      const payload = {
        space: {
          id: '123-space-id',
          title: 'AI Engineering Discussion',
          streamUrl: 'https://audio.twimg.com/space.m3u8',
          durationMs: 3600000,
        },
      };

      const media = extractTwitterMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('audio');
      expect(media[0].url).toBe('https://audio.twimg.com/space.m3u8');
      expect(media[0].title).toBe('AI Engineering Discussion');
    });
  });

  describe('extractBlueskyMedia', () => {
    it('extracts photos from app.bsky.embed.images', () => {
      const payload = {
        authorDid: 'did:plc:test1234',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            {
              thumb: 'https://cdn.bsky.app/thumb1.jpg',
              fullsize: 'https://cdn.bsky.app/full1.jpg',
              alt: 'Architecture diagram',
              aspectRatio: { width: 1200, height: 800 },
            },
          ],
        },
      };

      const media = extractBlueskyMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('photo');
      expect(media[0].url).toBe('https://cdn.bsky.app/full1.jpg');
      expect(media[0].altText).toBe('Architecture diagram');
      expect(media[0].width).toBe(1200);
    });

    it('extracts video playlist from app.bsky.embed.video', () => {
      const payload = {
        embed: {
          $type: 'app.bsky.embed.video',
          playlist: 'https://video.bsky.app/watch/playlist.m3u8',
          thumbnail: 'https://video.bsky.app/thumb.jpg',
        },
      };

      const media = extractBlueskyMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('video');
      expect(media[0].url).toBe('https://video.bsky.app/watch/playlist.m3u8');
      expect(media[0].contentType).toBe('application/x-mpegURL');
    });
  });

  describe('extractMastodonMedia', () => {
    it('extracts multiple media types including audio and gifv', () => {
      const payload = {
        media_attachments: [
          {
            id: 'att_1',
            type: 'audio',
            url: 'https://mastodon.social/system/media/audio.mp3',
            preview_url: 'https://mastodon.social/system/media/poster.jpg',
            meta: { original: { duration: 120.5 } },
          },
          {
            id: 'att_2',
            type: 'gifv',
            url: 'https://mastodon.social/system/media/anim.mp4',
            preview_url: 'https://mastodon.social/system/media/preview.jpg',
          },
        ],
      };

      const media = extractMastodonMedia(payload);
      expect(media).toHaveLength(2);
      expect(media[0].type).toBe('audio');
      expect(media[0].url).toBe('https://mastodon.social/system/media/audio.mp3');
      expect(media[0].durationMs).toBe(120500);

      expect(media[1].type).toBe('animated_gif');
      expect(media[1].url).toBe('https://mastodon.social/system/media/anim.mp4');
    });
  });

  describe('extractThreadsMedia', () => {
    it('extracts carousel media with child items', () => {
      const payload = {
        carousel_media: [
          { image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/p1.jpg', width: 1080 }] } },
          { image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/p2.jpg', width: 1080 }] } },
        ],
      };

      const media = extractThreadsMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('carousel');
      expect(media[0].items).toHaveLength(2);
      expect(media[0].items[0].url).toBe('https://scontent.cdninstagram.com/p1.jpg');
    });

    it('extracts best quality video version', () => {
      const payload = {
        video_versions: [
          { url: 'https://video.threads.net/low.mp4', width: 480 },
          { url: 'https://video.threads.net/high.mp4', width: 1080 },
        ],
        image_versions2: { candidates: [{ url: 'https://thumb.threads.net/thumb.jpg' }] },
      };

      const media = extractThreadsMedia(payload);
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('video');
      expect(media[0].url).toBe('https://video.threads.net/high.mp4');
      expect(media[0].width).toBe(1080);
    });
  });

  describe('extractTikTokMedia', () => {
    it('extracts both video and background sound track', () => {
      const payload = {
        video: {
          playAddr: 'https://v16-webapp.tiktok.com/video.mp4',
          cover: 'https://p16-tiktok.com/cover.jpg',
          duration: 45,
          bitrate: 1500000,
        },
        music: {
          playUrl: 'https://sf16.tiktokcdn.com/music.mp3',
          title: 'Trending Sound #1',
          authorName: 'Creator',
        },
      };

      const media = extractTikTokMedia(payload);
      expect(media).toHaveLength(2);
      expect(media[0].type).toBe('video');
      expect(media[0].url).toBe('https://v16-webapp.tiktok.com/video.mp4');

      expect(media[1].type).toBe('audio');
      expect(media[1].url).toBe('https://sf16.tiktokcdn.com/music.mp3');
      expect(media[1].title).toBe('Trending Sound #1');
    });
  });

  describe('UniversalMediaPipeline & downloadMedia module', () => {
    it('UniversalMediaPipeline.extractMedia dispatches correctly based on payload and platform', async () => {
      const post = {
        media_attachments: [{ type: 'image', url: 'https://mastodon.social/img.png' }],
      };

      const media = await UniversalMediaPipeline.extractMedia({ platform: 'mastodon', post });
      expect(media).toHaveLength(1);
      expect(media[0].type).toBe('photo');
      expect(media[0].url).toBe('https://mastodon.social/img.png');
    });

    it('downloadMedia extracts bestUrl and media list', async () => {
      const post = {
        extended_entities: {
          media: [
            {
              type: 'video',
              video_info: {
                variants: [
                  { bitrate: 1000, content_type: 'video/mp4', url: 'https://video.twimg.com/v.mp4' },
                ],
              },
            },
          ],
        },
      };

      const result = await downloadMedia('https://x.com/user/status/12345', { platform: 'twitter', post });
      expect(result.success).toBe(true);
      expect(result.bestUrl).toBe('https://video.twimg.com/v.mp4');
      expect(result.media).toHaveLength(1);
    });
  });

  describe('MCP Tool x_download_media', () => {
    it('is registered in local-tools toolMap', async () => {
      expect(typeof toolMap.x_download_media).toBe('function');
    });

    it('executes via toolMap and extracts media', async () => {
      const post = {
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ fullsize: 'https://cdn.bsky.app/photo.jpg' }],
        },
      };

      const res = await toolMap.x_download_media({
        postUrl: 'https://bsky.app/profile/alice/post/123',
        post,
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(res.media[0].url).toBe('https://cdn.bsky.app/photo.jpg');
    });

    it('is declared in server.js TOOLS array', async () => {
      const { TOOLS } = await import('../../../src/mcp/server.js');
      const tool = TOOLS.find((t) => t.name === 'x_download_media');
      expect(tool).toBeDefined();
      expect(tool.inputSchema.required).toContain('postUrl');
    });

    it('returns XACT_4001 envelope for an invalid postUrl (not silent)', async () => {
      const res = await toolMap.x_download_media({ postUrl: 'not-a-url' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('XACT_4001');
      expect(res.media).toEqual([]);
      expect(res.count).toBe(0);
    });

    it('returns XACT_4001 envelope for a missing postUrl/post', async () => {
      const res = await toolMap.x_download_media({});
      expect(res.success).toBe(false);
      expect(res.count).toBe(0);
    });
  });

  describe('post_detail action wiring (Story 31.1 fix)', () => {
    it('twitter descriptor maps post_detail → thread', async () => {
      const d = (await import('../../../src/scrapers/social/twitter/descriptor.js')).default;
      expect(d.mapAction({}, { platform: 'twitter', action: 'post_detail' })).toBe('thread');
    });

    it('bluesky descriptor maps post_detail → post_detail', async () => {
      const d = (await import('../../../src/scrapers/social/bluesky/descriptor.js')).default;
      expect(d.mapAction({}, { platform: 'bluesky', action: 'post_detail' })).toBe('post_detail');
    });

    it('mastodon descriptor maps post_detail → post_detail', async () => {
      const d = (await import('../../../src/scrapers/social/mastodon/descriptor.js')).default;
      expect(d.mapAction({}, { platform: 'mastodon', action: 'post_detail' })).toBe('post_detail');
    });

    it('facebook crawler registers a post_detail action', async () => {
      const { FacebookCrawler, FacebookClient } = await import('../../../src/scrapers/social/facebook/index.js');
      const crawler = new FacebookCrawler({ client: new FacebookClient({}) });
      const actions = crawler.listActions().map((a) => a.action);
      expect(actions).toContain('post_detail');
    });

    it('bluesky client resolves a bsky.app post URL to an at:// URI', async () => {
      const { BlueskyClient } = await import('../../../src/scrapers/social/bluesky/client.js');
      const client = new BlueskyClient({});
      // Stub resolveHandle + xrpc to assert URI construction without network.
      client.resolveHandle = async () => 'did:plc:alice';
      let captured;
      client.xrpc = async (nsid, params) => { captured = { nsid, params }; return { thread: { post: { uri: params.uri } } }; };
      await client.getPostThread({ url: 'https://bsky.app/profile/alice.bsky.social/post/3abc' });
      expect(captured.nsid).toBe('app.bsky.feed.getPostThread');
      expect(captured.params.uri).toBe('at://did:plc:alice/app.bsky.feed.post/3abc');
    });

    it('mastodon client extracts numeric status id + instance from a post URL', async () => {
      const { MastodonClient } = await import('../../../src/scrapers/social/mastodon/client.js');
      const client = new MastodonClient({});
      let captured;
      client.buildUrl = (path, params, instance) => { captured = { path, instance }; return `https://${instance}${path}`; };
      client.get = async () => ({ data: { id: '1234567890' } });
      const status = await client.getStatus({ url: 'https://mastodon.social/@Gargron/1234567890' });
      expect(captured.path).toBe('/api/v1/statuses/1234567890');
      expect(captured.instance).toBe('https://mastodon.social');
      expect(status.id).toBe('1234567890');
    });
  });
});
