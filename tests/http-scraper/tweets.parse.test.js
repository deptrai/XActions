// by nichxbt
/**
 * Tests for parseTweetData and parseTimelineInstructions
 * from src/scrapers/twitter/http/tweets.js
 *
 * Uses vitest with mocked client — no real network requests.
 * Fixture data mirrors actual Twitter GraphQL response shapes.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import {
  parseTweetData,
  parseTimelineInstructions,
} from '../../src/scrapers/twitter/http/tweets.js';

// ---------------------------------------------------------------------------
// Fixtures — realistic Twitter GraphQL response shapes
// ---------------------------------------------------------------------------

function buildRawTweet(overrides = {}) {
  return {
    __typename: 'Tweet',
    rest_id: '1234567890',
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '44196397',
          legacy: {
            screen_name: 'elonmusk',
            name: 'Elon Musk',
            profile_image_url_https:
              'https://pbs.twimg.com/profile_images/1234/photo_normal.jpg',
            verified: false,
          },
          is_blue_verified: true,
        },
      },
    },
    legacy: {
      id_str: '1234567890',
      full_text: 'Hello world! This is a test tweet.',
      created_at: 'Wed Jan 15 12:00:00 +0000 2025',
      favorite_count: 42000,
      retweet_count: 5000,
      reply_count: 1200,
      quote_count: 300,
      bookmark_count: 800,
      lang: 'en',
      source:
        '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
      entities: {
        urls: [
          {
            url: 'https://t.co/abc123',
            expanded_url: 'https://example.com/full-url',
            display_url: 'example.com/full-url',
          },
        ],
        hashtags: [{ text: 'testing' }, { text: 'xactions' }],
        user_mentions: [
          { screen_name: 'nichxbt', id_str: '9999999' },
        ],
      },
      extended_entities: { media: [] },
      ...overrides,
    },
    views: { count: '1500000' },
    ...(overrides._tweetLevel || {}),
  };
}

function buildRawTweetWithMedia() {
  return buildRawTweet({
    full_text: 'Check out this photo and video!',
    extended_entities: {
      media: [
        {
          type: 'photo',
          media_url_https: 'https://pbs.twimg.com/media/photo1.jpg',
          original_info: { width: 1920, height: 1080 },
          sizes: { large: { w: 1920, h: 1080 } },
        },
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/vid1.jpg',
          original_info: { width: 1280, height: 720 },
          sizes: { large: { w: 1280, h: 720 } },
          video_info: {
            duration_millis: 30000,
            variants: [
              {
                content_type: 'application/x-mpegURL',
                url: 'https://video.twimg.com/ext_tw_video/playlist.m3u8',
              },
              {
                content_type: 'video/mp4',
                bitrate: 832000,
                url: 'https://video.twimg.com/ext_tw_video/vid1_832.mp4',
              },
              {
                content_type: 'video/mp4',
                bitrate: 2176000,
                url: 'https://video.twimg.com/ext_tw_video/vid1_2176.mp4',
              },
              {
                content_type: 'video/mp4',
                bitrate: 256000,
                url: 'https://video.twimg.com/ext_tw_video/vid1_256.mp4',
              },
            ],
          },
        },
      ],
    },
  });
}

function buildRawQuoteTweet() {
  const inner = buildRawTweet({
    id_str: '1111111111',
    full_text: 'This is the original quoted tweet.',
    _tweetLevel: { rest_id: '1111111111' },
  });
  delete inner.legacy._tweetLevel;

  return {
    __typename: 'Tweet',
    rest_id: '2222222222',
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '55555',
          legacy: {
            screen_name: 'quoter',
            name: 'The Quoter',
            profile_image_url_https:
              'https://pbs.twimg.com/profile_images/5555/photo_normal.jpg',
            verified: false,
          },
          is_blue_verified: false,
        },
      },
    },
    legacy: {
      id_str: '2222222222',
      full_text: 'Great take! https://t.co/quoted',
      created_at: 'Thu Jan 16 08:00:00 +0000 2025',
      favorite_count: 100,
      retweet_count: 10,
      reply_count: 5,
      quote_count: 0,
      bookmark_count: 0,
      lang: 'en',
      source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter for iPhone</a>',
      entities: {
        urls: [],
        hashtags: [],
        user_mentions: [],
      },
      extended_entities: { media: [] },
    },
    views: { count: '500' },
    quoted_status_result: {
      result: inner,
    },
  };
}

function buildRawRetweet() {
  const original = buildRawTweet({
    id_str: '3333333333',
    full_text: 'Original tweet that was retweeted.',
    _tweetLevel: { rest_id: '3333333333' },
  });
  delete original.legacy._tweetLevel;

  return {
    __typename: 'Tweet',
    rest_id: '4444444444',
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '66666',
          legacy: {
            screen_name: 'retweeter',
            name: 'The Retweeter',
            profile_image_url_https:
              'https://pbs.twimg.com/profile_images/6666/photo_normal.jpg',
            verified: false,
          },
          is_blue_verified: false,
        },
      },
    },
    legacy: {
      id_str: '4444444444',
      full_text: 'RT @elonmusk: Original tweet that was retweeted.',
      created_at: 'Fri Jan 17 10:00:00 +0000 2025',
      favorite_count: 0,
      retweet_count: 0,
      reply_count: 0,
      quote_count: 0,
      bookmark_count: 0,
      lang: 'en',
      source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
      entities: { urls: [], hashtags: [], user_mentions: [] },
      extended_entities: { media: [] },
      retweeted_status_result: {
        result: original,
      },
    },
    views: { count: '0' },
  };
}

function buildTombstoneTweet() {
  return {
    __typename: 'TweetTombstone',
    tombstone: {
      text: {
        text: 'This Tweet was deleted by the Tweet author.',
      },
    },
  };
}

function buildTweetWithVisibility() {
  const inner = buildRawTweet({
    full_text: 'This tweet has visibility restrictions.',
    _tweetLevel: { rest_id: '5555555555' },
  });
  delete inner.legacy._tweetLevel;

  return {
    __typename: 'TweetWithVisibilityResults',
    tweet: inner,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('parseTweetData', () => {
  it('parses a standard tweet with text + metrics', () => {
    const raw = buildRawTweet();
    const result = parseTweetData(raw);

    expect(result).toBeTruthy();
    expect(result.id).toBe('1234567890');
    expect(result.text).toBe('Hello world! This is a test tweet.');
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.platform).toBe('twitter');

    // Author
    expect(result.author.id).toBe('44196397');
    expect(result.author.username).toBe('elonmusk');
    expect(result.author.name).toBe('Elon Musk');
    expect(result.author.verified).toBe(true);

    // Metrics
    expect(result.metrics.likes).toBe(42000);
    expect(result.metrics.retweets).toBe(5000);
    expect(result.metrics.replies).toBe(1200);
    expect(result.metrics.quotes).toBe(300);
    expect(result.metrics.bookmarks).toBe(800);
    expect(result.metrics.views).toBe(1500000);

    // URLs, hashtags, mentions
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0].expandedUrl).toBe('https://example.com/full-url');
    expect(result.hashtags).toEqual(['testing', 'xactions']);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].username).toBe('nichxbt');

    // Source
    expect(result.source).toBe('Twitter Web App');
    expect(result.lang).toBe('en');

    // Not a retweet/reply
    expect(result.isRetweet).toBe(false);
    expect(result.isReply).toBe(false);
    expect(result.inReplyTo).toBeNull();
  });

  it('parses media attachments (photo and video)', () => {
    const raw = buildRawTweetWithMedia();
    const result = parseTweetData(raw);

    expect(result.media).toHaveLength(2);

    // Photo
    const photo = result.media[0];
    expect(photo.type).toBe('photo');
    expect(photo.url).toBe('https://pbs.twimg.com/media/photo1.jpg');
    expect(photo.width).toBe(1920);
    expect(photo.height).toBe(1080);
    expect(photo.videoUrl).toBeNull();

    // Video — picks highest bitrate
    const video = result.media[1];
    expect(video.type).toBe('video');
    expect(video.url).toBe(
      'https://pbs.twimg.com/ext_tw_video_thumb/vid1.jpg',
    );
    expect(video.width).toBe(1280);
    expect(video.height).toBe(720);
    expect(video.videoUrl).toBe(
      'https://video.twimg.com/ext_tw_video/vid1_2176.mp4',
    );
  });

  it('parses a quote tweet (recursive)', () => {
    const raw = buildRawQuoteTweet();
    const result = parseTweetData(raw);

    expect(result.id).toBe('2222222222');
    expect(result.text).toBe('Great take! https://t.co/quoted');
    expect(result.author.username).toBe('quoter');

    // Quoted tweet is recursively parsed
    expect(result.quotedTweet).toBeTruthy();
    expect(result.quotedTweet.id).toBe('1111111111');
    expect(result.quotedTweet.text).toBe(
      'This is the original quoted tweet.',
    );
    expect(result.quotedTweet.author.username).toBe('elonmusk');
    expect(result.quotedTweet.platform).toBe('twitter');
  });

  it('parses a retweet', () => {
    const raw = buildRawRetweet();
    const result = parseTweetData(raw);

    expect(result.id).toBe('4444444444');
    expect(result.isRetweet).toBe(true);
    expect(result.retweetOf).toBeTruthy();
    expect(result.retweetOf.id).toBe('3333333333');
    expect(result.retweetOf.text).toBe(
      'Original tweet that was retweeted.',
    );
    expect(result.retweetOf.author.username).toBe('elonmusk');
  });

  it('handles TweetTombstone (deleted tweet)', () => {
    const raw = buildTombstoneTweet();
    const result = parseTweetData(raw);

    expect(result).toBeTruthy();
    expect(result.tombstone).toBe(true);
    expect(result.text).toBe(
      'This Tweet was deleted by the Tweet author.',
    );
    expect(result.id).toBeNull();
    expect(result.platform).toBe('twitter');
  });

  it('handles TweetWithVisibilityResults', () => {
    const raw = buildTweetWithVisibility();
    const result = parseTweetData(raw);

    expect(result).toBeTruthy();
    expect(result.id).toBe('5555555555');
    expect(result.text).toBe('This tweet has visibility restrictions.');
    expect(result.platform).toBe('twitter');
  });

  it('returns null for null/undefined input', () => {
    expect(parseTweetData(null)).toBeNull();
    expect(parseTweetData(undefined)).toBeNull();
  });

  it('handles a reply tweet', () => {
    const raw = buildRawTweet({
      in_reply_to_status_id_str: '9999999999',
      in_reply_to_user_id_str: '8888888',
      in_reply_to_screen_name: 'someuser',
    });
    const result = parseTweetData(raw);

    expect(result.isReply).toBe(true);
    expect(result.inReplyTo).toEqual({
      tweetId: '9999999999',
      userId: '8888888',
      username: 'someuser',
    });
  });
});

describe('parseTimelineInstructions', () => {
  it('extracts tweets and bottom cursor from TimelineAddEntries', () => {
    const instructions = [
      {
        type: 'TimelineAddEntries',
        entries: [
          {
            entryId: 'cursor-top-999',
            content: { value: 'TOP_CURSOR' },
          },
          {
            entryId: 'tweet-1001',
            content: {
              itemContent: {
                tweet_results: {
                  result: buildRawTweet({
                    id_str: '1001',
                    full_text: 'Tweet one',
                    _tweetLevel: { rest_id: '1001' },
                  }),
                },
              },
            },
          },
          {
            entryId: 'tweet-1002',
            content: {
              itemContent: {
                tweet_results: {
                  result: buildRawTweet({
                    id_str: '1002',
                    full_text: 'Tweet two',
                    _tweetLevel: { rest_id: '1002' },
                  }),
                },
              },
            },
          },
          {
            entryId: 'cursor-bottom-000',
            content: { value: 'BOTTOM_CURSOR_VALUE' },
          },
        ],
      },
    ];

    // Clean up internal override key
    for (const instr of instructions) {
      for (const entry of instr.entries || []) {
        const tr = entry?.content?.itemContent?.tweet_results?.result;
        if (tr?.legacy?._tweetLevel) delete tr.legacy._tweetLevel;
      }
    }

    const { tweets, cursor } = parseTimelineInstructions(instructions);

    expect(tweets).toHaveLength(2);
    expect(tweets[0].id).toBe('1001');
    expect(tweets[1].id).toBe('1002');
    expect(cursor).toBe('BOTTOM_CURSOR_VALUE');
  });

  it('handles TimelinePinEntry', () => {
    const instructions = [
      {
        type: 'TimelinePinEntry',
        entry: {
          content: {
            itemContent: {
              tweet_results: {
                result: buildRawTweet({
                  id_str: '5001',
                  full_text: 'Pinned tweet',
                  _tweetLevel: { rest_id: '5001' },
                }),
              },
            },
          },
        },
      },
    ];
    // Clean up
    delete instructions[0].entry.content.itemContent.tweet_results.result.legacy._tweetLevel;

    const { tweets } = parseTimelineInstructions(instructions);
    expect(tweets).toHaveLength(1);
    expect(tweets[0].id).toBe('5001');
    expect(tweets[0].text).toBe('Pinned tweet');
  });

  it('handles TimelineAddToModule', () => {
    const instructions = [
      {
        type: 'TimelineAddToModule',
        moduleItems: [
          {
            item: {
              itemContent: {
                tweet_results: {
                  result: buildRawTweet({
                    id_str: '6001',
                    full_text: 'Module tweet',
                    _tweetLevel: { rest_id: '6001' },
                  }),
                },
              },
            },
          },
        ],
      },
    ];
    delete instructions[0].moduleItems[0].item.itemContent.tweet_results.result.legacy._tweetLevel;

    const { tweets } = parseTimelineInstructions(instructions);
    expect(tweets).toHaveLength(1);
    expect(tweets[0].id).toBe('6001');
  });

  it('handles conversation module items (UserTweetsAndReplies)', () => {
    const instructions = [
      {
        type: 'TimelineAddEntries',
        entries: [
          {
            entryId: 'conversationthread-1234',
            content: {
              items: [
                {
                  item: {
                    itemContent: {
                      tweet_results: {
                        result: buildRawTweet({
                          id_str: '7001',
                          full_text: 'Conversation reply',
                          _tweetLevel: { rest_id: '7001' },
                        }),
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ];
    delete instructions[0].entries[0].content.items[0].item.itemContent.tweet_results.result.legacy._tweetLevel;

    const { tweets } = parseTimelineInstructions(instructions);
    expect(tweets).toHaveLength(1);
    expect(tweets[0].id).toBe('7001');
  });

  it('returns empty results for null/missing instructions', () => {
    expect(parseTimelineInstructions(null)).toEqual({
      tweets: [],
      cursor: null,
    });
    expect(parseTimelineInstructions([])).toEqual({
      tweets: [],
      cursor: null,
    });
  });
});
