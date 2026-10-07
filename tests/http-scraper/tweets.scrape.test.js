// by nichxbt
/**
 * Tests for scrapeTweets, scrapeTweetsAndReplies, and scrapeTweetById
 * from src/scrapers/twitter/http/tweets.js
 *
 * Uses vitest with mocked client — no real network requests.
 * Fixture data mirrors actual Twitter GraphQL response shapes.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scrapeTweets,
  scrapeTweetsAndReplies,
  scrapeTweetById,
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
        urls: [],
        hashtags: [],
        user_mentions: [],
      },
      extended_entities: { media: [] },
      ...overrides,
    },
    views: { count: '1500000' },
    ...(overrides._tweetLevel || {}),
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

function buildTimelineResponse(tweetCount, bottomCursorValue = null) {
  const entries = [];

  for (let i = 0; i < tweetCount; i++) {
    const tweetId = String(9000000000 + i);
    entries.push({
      entryId: `tweet-${tweetId}`,
      sortIndex: tweetId,
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: buildRawTweet({
              id_str: tweetId,
              full_text: `Test tweet number ${i}`,
              _tweetLevel: { rest_id: tweetId },
            }),
          },
        },
      },
    });
    // Clean up internal override key
    delete entries[entries.length - 1].content.itemContent.tweet_results.result.legacy._tweetLevel;
  }

  // Add top cursor
  entries.unshift({
    entryId: 'cursor-top-9999999999',
    sortIndex: '9999999999',
    content: {
      entryType: 'TimelineTimelineCursor',
      cursorType: 'Top',
      value: 'DAACCgACGKi_top',
    },
  });

  // Add bottom cursor
  if (bottomCursorValue) {
    entries.push({
      entryId: 'cursor-bottom-8000000000',
      sortIndex: '8000000000',
      content: {
        entryType: 'TimelineTimelineCursor',
        cursorType: 'Bottom',
        value: bottomCursorValue,
      },
    });
  }

  return {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries,
                },
              ],
            },
          },
        },
      },
    },
  };
}

function buildUserByScreenNameResponse(userId = '44196397', username = 'testuser') {
  return {
    data: {
      user: {
        result: {
          __typename: 'User',
          rest_id: userId,
          legacy: { screen_name: username },
        },
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('scrapeTweets', () => {
  it('resolves username and paginates UserTweets', async () => {
    let callCount = 0;

    const client = createMockClient(async (queryId, opName, variables) => {
      if (opName === 'UserByScreenName') {
        return buildUserByScreenNameResponse('44196397', 'testuser');
      }
      if (opName === 'UserTweets') {
        callCount++;
        if (callCount === 1) {
          return buildTimelineResponse(5, 'CURSOR_PAGE_2');
        }
        // Second page — no more cursor
        return buildTimelineResponse(3, null);
      }
      return {};
    });

    const tweets = await scrapeTweets(client, 'testuser', { limit: 10 });

    expect(tweets).toHaveLength(8);
    expect(tweets[0].platform).toBe('twitter');

    // Should have called graphql at least 3 times: 1 user lookup + 2 pages
    expect(client.graphql).toHaveBeenCalledTimes(3);
  });

  it('respects limit option', async () => {
    const client = createMockClient(async (queryId, opName, variables) => {
      if (opName === 'UserByScreenName') {
        return buildUserByScreenNameResponse();
      }
      if (opName === 'UserTweets') {
        return buildTimelineResponse(20, 'MORE_CURSOR');
      }
      return {};
    });

    const tweets = await scrapeTweets(client, 'testuser', { limit: 5 });
    expect(tweets).toHaveLength(5);
  });

  it('calls onProgress callback', async () => {
    const progressCalls = [];

    const client = createMockClient(async (queryId, opName) => {
      if (opName === 'UserByScreenName') {
        return buildUserByScreenNameResponse();
      }
      if (opName === 'UserTweets') {
        return buildTimelineResponse(3, null);
      }
      return {};
    });

    await scrapeTweets(client, 'testuser', {
      limit: 10,
      onProgress: (p) => progressCalls.push(p),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]).toHaveProperty('fetched');
    expect(progressCalls[0]).toHaveProperty('limit');
  });

  it('delegates to scrapeTweetsAndReplies when includeReplies=true', async () => {
    const client = createMockClient(async (queryId, opName) => {
      if (opName === 'UserByScreenName') {
        return buildUserByScreenNameResponse();
      }
      if (opName === 'UserTweetsAndReplies') {
        return buildTimelineResponse(3, null);
      }
      return {};
    });

    const tweets = await scrapeTweets(client, 'testuser', {
      limit: 10,
      includeReplies: true,
    });

    expect(tweets).toHaveLength(3);
    // Should call UserTweetsAndReplies, not UserTweets
    const opNames = client.graphql.mock.calls.map((c) => c[1]);
    expect(opNames).toContain('UserTweetsAndReplies');
    expect(opNames).not.toContain('UserTweets');
  });
});

describe('scrapeTweetsAndReplies', () => {
  it('uses UserTweetsAndReplies endpoint', async () => {
    const client = createMockClient(async (queryId, opName) => {
      if (opName === 'UserByScreenName') {
        return buildUserByScreenNameResponse();
      }
      if (opName === 'UserTweetsAndReplies') {
        return buildTimelineResponse(5, null);
      }
      return {};
    });

    const tweets = await scrapeTweetsAndReplies(client, 'testuser', {
      limit: 10,
    });

    expect(tweets).toHaveLength(5);
    const opNames = client.graphql.mock.calls.map((c) => c[1]);
    expect(opNames).toContain('UserTweetsAndReplies');
  });
});

describe('scrapeTweetById', () => {
  it('fetches a single tweet by ID', async () => {
    const client = createMockClient(async (queryId, opName, variables) => {
      if (opName === 'TweetResultByRestId') {
        return {
          data: {
            tweetResult: {
              result: buildRawTweet({
                id_str: variables.tweetId,
                full_text: 'Single tweet lookup result.',
                _tweetLevel: { rest_id: variables.tweetId },
              }),
            },
          },
        };
      }
      return {};
    });

    const tweet = await scrapeTweetById(client, '1234567890');

    expect(tweet.id).toBe('1234567890');
    expect(tweet.text).toBe('Single tweet lookup result.');
    expect(tweet.platform).toBe('twitter');
  });

  it('throws NotFoundError for missing tweet', async () => {
    const client = createMockClient(async () => ({
      data: { tweetResult: { result: null } },
    }));

    await expect(scrapeTweetById(client, '000')).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws NotFoundError for tombstone tweet', async () => {
    const client = createMockClient(async () => ({
      data: {
        tweetResult: {
          result: buildTombstoneTweet(),
        },
      },
    }));

    await expect(scrapeTweetById(client, '000')).rejects.toThrow(
      /unavailable/i,
    );
  });
});
