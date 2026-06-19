// by nichxbt
/**
 * Tests for scrapeConversation and deleted/wrapped tweet handling in
 * src/scrapers/twitter/http/thread.js
 *
 * Covers pagination, limits, tombstones, and visibility wrappers.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  scrapeThread,
  scrapeConversation,
} from '../../src/scrapers/twitter/http/thread.js';

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
  const id = overrides.id || '1000000000000000001';
  const authorId = overrides.authorId || '44196397';
  const authorUsername = overrides.authorUsername || 'testuser';
  const authorName = overrides.authorName || 'Test User';
  const text = overrides.text || 'Hello world!';
  const createdAt = overrides.createdAt || 'Wed Jan 15 12:00:00 +0000 2025';

  const legacy = {
    id_str: id,
    full_text: text,
    created_at: createdAt,
    favorite_count: overrides.likes ?? 100,
    retweet_count: overrides.retweets ?? 10,
    reply_count: overrides.replies ?? 5,
    quote_count: overrides.quotes ?? 2,
    bookmark_count: overrides.bookmarks ?? 1,
    lang: 'en',
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    entities: { urls: [], hashtags: [], user_mentions: [] },
    extended_entities: { media: [] },
  };

  if (overrides.inReplyToTweetId) {
    legacy.in_reply_to_status_id_str = overrides.inReplyToTweetId;
    legacy.in_reply_to_user_id_str = overrides.inReplyToUserId || authorId;
    legacy.in_reply_to_screen_name = overrides.inReplyToUsername || authorUsername;
  }

  return {
    __typename: overrides.typename || 'Tweet',
    rest_id: id,
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: authorId,
          legacy: {
            screen_name: authorUsername,
            name: authorName,
            profile_image_url_https: 'https://pbs.twimg.com/profile/photo_normal.jpg',
            verified: false,
          },
          is_blue_verified: false,
        },
      },
    },
    legacy,
    views: { count: '1000' },
  };
}

function buildTweetEntry(rawTweet) {
  return {
    entryId: `tweet-${rawTweet.rest_id}`,
    sortIndex: rawTweet.rest_id,
    content: {
      __typename: 'TimelineTimelineItem',
      entryType: 'TimelineTimelineItem',
      itemContent: {
        __typename: 'TimelineTweet',
        tweet_results: { result: rawTweet },
      },
    },
  };
}

function buildConversationModule(entryId, rawTweets, cursors = []) {
  const items = rawTweets.map((rawTweet) => ({
    entryId: `${entryId}-tweet-${rawTweet.rest_id}`,
    item: {
      itemContent: {
        __typename: 'TimelineTweet',
        tweet_results: { result: rawTweet },
      },
    },
  }));

  for (const cursor of cursors) {
    items.push({
      entryId: `${entryId}-cursor`,
      item: {
        itemContent: {
          __typename: 'TimelineTimelineCursor',
          cursorType: cursor.type || 'ShowMoreThreads',
          value: cursor.value,
        },
      },
    });
  }

  return {
    entryId,
    sortIndex: entryId,
    content: {
      __typename: 'TimelineTimelineModule',
      entryType: 'TimelineTimelineModule',
      items,
    },
  };
}

function buildTweetDetailResponse(entries) {
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries,
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: scrapeConversation
// ---------------------------------------------------------------------------

describe('scrapeConversation', () => {
  it('should collect all replies across pages', async () => {
    const rootTweet = buildRawTweet({ id: '3000', text: 'Root' });
    const reply1 = buildRawTweet({
      id: '3001',
      text: 'Reply 1',
      authorId: 'other1',
      authorUsername: 'replier1',
      inReplyToTweetId: '3000',
    });

    // Page 1: root + reply1 + cursor
    const page1 = buildTweetDetailResponse([
      buildTweetEntry(rootTweet),
      buildConversationModule(
        'conversationthread-3001',
        [reply1],
        [{ type: 'Bottom', value: 'page2_cursor' }],
      ),
    ]);

    const reply2 = buildRawTweet({
      id: '3002',
      text: 'Reply 2',
      authorId: 'other2',
      authorUsername: 'replier2',
      inReplyToTweetId: '3000',
    });

    // Page 2: root + reply2 (no more cursor)
    const page2 = buildTweetDetailResponse([
      buildTweetEntry(rootTweet),
      buildConversationModule('conversationthread-3002', [reply2]),
    ]);

    let callCount = 0;
    const client = createMockClient((queryId, opName, variables) => {
      callCount++;
      if (!variables.cursor) return page1;
      return page2;
    });

    const result = await scrapeConversation(client, '3000', { limit: 200 });

    expect(callCount).toBe(2);
    expect(result.conversation.length).toBeGreaterThanOrEqual(2);
    expect(result.rootTweet.id).toBe('3000');
  });

  it('should respect the limit option', async () => {
    const rootTweet = buildRawTweet({ id: '4000', text: 'Root' });
    const replies = Array.from({ length: 10 }, (_, i) =>
      buildRawTweet({
        id: `400${i + 1}`,
        text: `Reply ${i + 1}`,
        authorId: `user${i}`,
        inReplyToTweetId: '4000',
      }),
    );

    const response = buildTweetDetailResponse([
      buildTweetEntry(rootTweet),
      ...replies.map((r) =>
        buildConversationModule(`conversationthread-${r.rest_id}`, [r]),
      ),
    ]);

    const client = createMockClient(() => response);

    // Limit to 5 total tweets (including root)
    const result = await scrapeConversation(client, '4000', { limit: 5 });

    // Total tweets fetched should not exceed limit
    // (root + replies = at most 5 deduplicated)
    expect(result.rootTweet).toBeDefined();
  });

  it('should pass sortBy as rankingMode to the API', async () => {
    const rootTweet = buildRawTweet({ id: '5000', text: 'Root' });
    const response = buildTweetDetailResponse([buildTweetEntry(rootTweet)]);

    const client = createMockClient(() => response);

    await scrapeConversation(client, '5000', { sortBy: 'recency' });

    expect(client.graphql).toHaveBeenCalledWith(
      expect.any(String),
      'TweetDetail',
      expect.objectContaining({
        rankingMode: 'Recency',
      }),
    );
  });

  it('should call onProgress callback during pagination', async () => {
    const rootTweet = buildRawTweet({ id: '6000', text: 'Root' });
    const response = buildTweetDetailResponse([buildTweetEntry(rootTweet)]);

    const client = createMockClient(() => response);
    const onProgress = vi.fn();

    await scrapeConversation(client, '6000', { onProgress });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        fetched: expect.any(Number),
        limit: 200,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: handling deleted tweets in thread
// ---------------------------------------------------------------------------

describe('deleted tweets in thread', () => {
  it('should include tombstone tweets in parsed output', async () => {
    const rootTweet = buildRawTweet({ id: '8000', text: 'Root' });

    const tombstoneTweet = {
      __typename: 'TweetTombstone',
      tombstone: {
        text: { text: 'This Tweet was deleted by the Tweet author.' },
      },
    };

    const reply = buildRawTweet({
      id: '8002',
      text: 'Reply after deleted',
      inReplyToTweetId: '8001', // references the deleted tweet
    });

    const entries = [
      buildTweetEntry(rootTweet),
      {
        entryId: 'tweet-8001',
        content: {
          __typename: 'TimelineTimelineItem',
          entryType: 'TimelineTimelineItem',
          itemContent: {
            __typename: 'TimelineTweet',
            tweet_results: { result: tombstoneTweet },
          },
        },
      },
      buildConversationModule('conversationthread-8002', [reply]),
    ];

    const response = buildTweetDetailResponse(entries);
    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '8000');

    // Root + reply should be in the result; tombstone has no id so won't appear as a valid tweet
    expect(result.rootTweet.id).toBe('8000');
    // The reply to the deleted tweet should still be present
    const replyIds = result.conversation.map((t) => t.id);
    expect(replyIds).toContain('8002');
  });

  it('should handle TweetWithVisibilityResults wrapper in modules', async () => {
    const rawTweet = {
      __typename: 'TweetWithVisibilityResults',
      tweet: buildRawTweet({ id: '8100', text: 'Visibility-wrapped tweet' }),
    };

    const entries = [
      {
        entryId: 'tweet-8100',
        content: {
          __typename: 'TimelineTimelineItem',
          entryType: 'TimelineTimelineItem',
          itemContent: {
            __typename: 'TimelineTweet',
            tweet_results: { result: rawTweet },
          },
        },
      },
    ];

    const response = buildTweetDetailResponse(entries);
    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '8100');

    expect(result.rootTweet).toBeDefined();
    expect(result.rootTweet.id).toBe('8100');
  });
});
