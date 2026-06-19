// by nichxbt
/**
 * Tests for scrapeThread from src/scrapers/twitter/http/tweets.js
 *
 * Uses vitest with mocked client — no real network requests.
 * Fixture data mirrors actual Twitter GraphQL response shapes.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  scrapeThread,
} from '../../src/scrapers/twitter/http/tweets.js';

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function createMockClient(graphqlHandler) {
  return {
    graphql: vi.fn(graphqlHandler),
    isAuthenticated: vi.fn(() => true),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildThreadResponse(focalTweetId, authorId, authorUsername) {
  const tweets = [
    // Root tweet (earlier)
    {
      entryId: `tweet-${Number(focalTweetId) - 2}`,
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: String(Number(focalTweetId) - 2),
              core: {
                user_results: {
                  result: {
                    rest_id: authorId,
                    legacy: {
                      screen_name: authorUsername,
                      name: 'Thread Author',
                      profile_image_url_https: 'https://pbs.twimg.com/photo_normal.jpg',
                      verified: false,
                    },
                    is_blue_verified: true,
                  },
                },
              },
              legacy: {
                id_str: String(Number(focalTweetId) - 2),
                full_text: 'Thread starts here (1/3)',
                created_at: 'Wed Jan 15 12:00:00 +0000 2025',
                favorite_count: 100,
                retweet_count: 10,
                reply_count: 1,
                quote_count: 0,
                bookmark_count: 0,
                lang: 'en',
                source: '<a>Twitter Web App</a>',
                entities: { urls: [], hashtags: [], user_mentions: [] },
                extended_entities: { media: [] },
              },
              views: { count: '1000' },
            },
          },
        },
      },
    },
    // Middle tweet
    {
      entryId: `tweet-${Number(focalTweetId) - 1}`,
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: String(Number(focalTweetId) - 1),
              core: {
                user_results: {
                  result: {
                    rest_id: authorId,
                    legacy: {
                      screen_name: authorUsername,
                      name: 'Thread Author',
                      profile_image_url_https: 'https://pbs.twimg.com/photo_normal.jpg',
                      verified: false,
                    },
                    is_blue_verified: true,
                  },
                },
              },
              legacy: {
                id_str: String(Number(focalTweetId) - 1),
                full_text: 'Thread continues (2/3)',
                created_at: 'Wed Jan 15 12:01:00 +0000 2025',
                favorite_count: 80,
                retweet_count: 5,
                reply_count: 1,
                quote_count: 0,
                bookmark_count: 0,
                lang: 'en',
                source: '<a>Twitter Web App</a>',
                entities: { urls: [], hashtags: [], user_mentions: [] },
                extended_entities: { media: [] },
                in_reply_to_status_id_str: String(Number(focalTweetId) - 2),
                in_reply_to_user_id_str: authorId,
                in_reply_to_screen_name: authorUsername,
              },
              views: { count: '800' },
            },
          },
        },
      },
    },
    // Focal tweet (latest)
    {
      entryId: `tweet-${focalTweetId}`,
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: focalTweetId,
              core: {
                user_results: {
                  result: {
                    rest_id: authorId,
                    legacy: {
                      screen_name: authorUsername,
                      name: 'Thread Author',
                      profile_image_url_https: 'https://pbs.twimg.com/photo_normal.jpg',
                      verified: false,
                    },
                    is_blue_verified: true,
                  },
                },
              },
              legacy: {
                id_str: focalTweetId,
                full_text: 'Thread ends here (3/3)',
                created_at: 'Wed Jan 15 12:02:00 +0000 2025',
                favorite_count: 50,
                retweet_count: 2,
                reply_count: 0,
                quote_count: 0,
                bookmark_count: 0,
                lang: 'en',
                source: '<a>Twitter Web App</a>',
                entities: { urls: [], hashtags: [], user_mentions: [] },
                extended_entities: { media: [] },
                in_reply_to_status_id_str: String(Number(focalTweetId) - 1),
                in_reply_to_user_id_str: authorId,
                in_reply_to_screen_name: authorUsername,
              },
              views: { count: '500' },
            },
          },
        },
      },
    },
    // Reply from a different user
    {
      entryId: 'tweet-7777777777',
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: '7777777777',
              core: {
                user_results: {
                  result: {
                    rest_id: '99999',
                    legacy: {
                      screen_name: 'replier',
                      name: 'Some Replier',
                      profile_image_url_https: 'https://pbs.twimg.com/replier_normal.jpg',
                      verified: false,
                    },
                    is_blue_verified: false,
                  },
                },
              },
              legacy: {
                id_str: '7777777777',
                full_text: 'Great thread!',
                created_at: 'Wed Jan 15 12:05:00 +0000 2025',
                favorite_count: 5,
                retweet_count: 0,
                reply_count: 0,
                quote_count: 0,
                bookmark_count: 0,
                lang: 'en',
                source: '<a>Twitter for iPhone</a>',
                entities: { urls: [], hashtags: [], user_mentions: [] },
                extended_entities: { media: [] },
                in_reply_to_status_id_str: focalTweetId,
                in_reply_to_user_id_str: authorId,
                in_reply_to_screen_name: authorUsername,
              },
              views: { count: '100' },
            },
          },
        },
      },
    },
  ];

  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: tweets,
          },
        ],
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('scrapeThread', () => {
  it('reconstructs a thread and filters to same author', async () => {
    const focalTweetId = '1000000002';
    const authorId = '44196397';

    const client = createMockClient(async (queryId, opName) => {
      if (opName === 'TweetDetail') {
        return buildThreadResponse(focalTweetId, authorId, 'threadauthor');
      }
      return {};
    });

    const thread = await scrapeThread(client, focalTweetId);

    // Should include 3 tweets from the same author, not the replier
    expect(thread.tweets).toHaveLength(3);
    expect(thread.tweets.every((t) => t.author.id === authorId)).toBe(true);

    // Root tweet is the earliest
    expect(thread.rootTweet.text).toContain('Thread starts here');

    // Ordered chronologically
    const times = thread.tweets.map((t) => new Date(t.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }

    // totalReplies counts all tweets minus one (root)
    expect(thread.totalReplies).toBe(3); // 4 total tweets - 1
  });

  it('includes all authors when allAuthors=true', async () => {
    const focalTweetId = '1000000002';

    const client = createMockClient(async () =>
      buildThreadResponse(focalTweetId, '44196397', 'threadauthor'),
    );

    const thread = await scrapeThread(client, focalTweetId, {
      allAuthors: true,
    });

    // Should include all 4 tweets (3 from author + 1 replier)
    expect(thread.tweets).toHaveLength(4);
  });

  it('throws NotFoundError for empty thread', async () => {
    const client = createMockClient(async () => ({
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [],
        },
      },
    }));

    await expect(scrapeThread(client, '000')).rejects.toThrow(/not found/i);
  });
});
