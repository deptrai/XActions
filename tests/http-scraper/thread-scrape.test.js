// by nichxbt
/**
 * Tests for scrapeThread and scrapeFullThread in
 * src/scrapers/twitter/http/thread.js
 *
 * Network-layer tests using mocked GraphQL client.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  scrapeThread,
  scrapeFullThread,
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

function buildCursorEntry(type, value, position = 'bottom') {
  return {
    entryId: `cursor-${position}-${Date.now()}`,
    content: {
      __typename: 'TimelineTimelineCursor',
      entryType: 'TimelineTimelineCursor',
      cursorType: type,
      value,
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

function buildSelfThread() {
  const authorId = '12345';
  const authorUsername = 'threadauthor';
  const authorName = 'Thread Author';

  const tweet1 = buildRawTweet({
    id: '2000000000000000001',
    authorId,
    authorUsername,
    authorName,
    text: 'This is the start of a thread 🧵 (1/4)',
    createdAt: 'Wed Jan 15 12:00:00 +0000 2025',
  });

  const tweet2 = buildRawTweet({
    id: '2000000000000000002',
    authorId,
    authorUsername,
    authorName,
    text: 'Second tweet in the thread (2/4)',
    createdAt: 'Wed Jan 15 12:01:00 +0000 2025',
    inReplyToTweetId: '2000000000000000001',
    inReplyToUserId: authorId,
    inReplyToUsername: authorUsername,
  });

  const tweet3 = buildRawTweet({
    id: '2000000000000000003',
    authorId,
    authorUsername,
    authorName,
    text: 'Third tweet in the thread (3/4)',
    createdAt: 'Wed Jan 15 12:02:00 +0000 2025',
    inReplyToTweetId: '2000000000000000002',
    inReplyToUserId: authorId,
    inReplyToUsername: authorUsername,
  });

  const tweet4 = buildRawTweet({
    id: '2000000000000000004',
    authorId,
    authorUsername,
    authorName,
    text: 'End of thread (4/4)',
    createdAt: 'Wed Jan 15 12:03:00 +0000 2025',
    inReplyToTweetId: '2000000000000000003',
    inReplyToUserId: authorId,
    inReplyToUsername: authorUsername,
  });

  return { tweet1, tweet2, tweet3, tweet4, authorId };
}

// ---------------------------------------------------------------------------
// Tests: scrapeThread
// ---------------------------------------------------------------------------

describe('scrapeThread', () => {
  it('should scrape and reconstruct a thread from the focal tweet', async () => {
    const { tweet1, tweet2, tweet3, tweet4 } = buildSelfThread();

    const response = buildTweetDetailResponse([
      buildTweetEntry(tweet1),
      buildTweetEntry(tweet2),
      buildTweetEntry(tweet3),
      buildTweetEntry(tweet4),
    ]);

    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '2000000000000000001');

    expect(client.graphql).toHaveBeenCalledTimes(1);
    expect(result.rootTweet).toBeDefined();
    expect(result.rootTweet.id).toBe('2000000000000000001');
    expect(result.authorReplies).toHaveLength(3);
    expect(result.conversation).toHaveLength(3);
    expect(result.totalReplies).toBe(3);
    expect(typeof result.hasMore).toBe('boolean');
    expect(result.cursor).toBeNull();
  });

  it('should include tweets from conversation modules', async () => {
    const rootTweet = buildRawTweet({
      id: '800',
      authorId: 'a1',
      text: 'Root tweet with replies',
    });

    const reply1 = buildRawTweet({
      id: '801',
      authorId: 'a2',
      authorUsername: 'replier',
      text: 'A reply from someone',
      inReplyToTweetId: '800',
      inReplyToUserId: 'a1',
    });

    const reply2 = buildRawTweet({
      id: '802',
      authorId: 'a3',
      authorUsername: 'replier2',
      text: 'Another reply',
      inReplyToTweetId: '800',
      inReplyToUserId: 'a1',
    });

    const response = buildTweetDetailResponse([
      buildTweetEntry(rootTweet),
      buildConversationModule('conversationthread-801', [reply1]),
      buildConversationModule('conversationthread-802', [reply2]),
    ]);

    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '800');

    expect(result.rootTweet.id).toBe('800');
    expect(result.conversation).toHaveLength(2);
  });

  it('should detect hasMore and extract cursor', async () => {
    const rootTweet = buildRawTweet({ id: '900', text: 'Root' });

    const reply = buildRawTweet({
      id: '901',
      text: 'A reply',
      inReplyToTweetId: '900',
    });

    const entries = [
      buildTweetEntry(rootTweet),
      buildConversationModule(
        'conversationthread-901',
        [reply],
        [{ type: 'ShowMoreThreads', value: 'next_page_cursor_123' }],
      ),
      buildCursorEntry('Bottom', 'bottom_cursor_456'),
    ];

    const response = buildTweetDetailResponse(entries);
    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '900');

    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBeTruthy();
  });

  it('should throw NotFoundError when no tweets found', async () => {
    const response = buildTweetDetailResponse([]);
    const client = createMockClient(() => response);

    await expect(scrapeThread(client, 'nonexistent')).rejects.toThrow(
      /not found/i,
    );
  });

  it('should pass correct variables to the GraphQL call', async () => {
    const rootTweet = buildRawTweet({ id: '950', text: 'Root' });
    const response = buildTweetDetailResponse([buildTweetEntry(rootTweet)]);
    const client = createMockClient(() => response);

    await scrapeThread(client, '950');

    expect(client.graphql).toHaveBeenCalledWith(
      expect.any(String),
      'TweetDetail',
      expect.objectContaining({
        focalTweetId: '950',
        with_rux_injections: false,
        rankingMode: 'Relevance',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: scrapeFullThread (walk up to root)
// ---------------------------------------------------------------------------

describe('scrapeFullThread', () => {
  it('should walk up to the root tweet then scrape the full thread', async () => {
    const authorId = 'author1';

    // Tweet 1 is root (no parent)
    const tweet1 = buildRawTweet({
      id: '1001',
      authorId,
      text: 'Root',
      createdAt: 'Wed Jan 15 12:00:00 +0000 2025',
    });

    // Tweet 2 replies to 1
    const tweet2 = buildRawTweet({
      id: '1002',
      authorId,
      text: 'Reply',
      createdAt: 'Wed Jan 15 12:01:00 +0000 2025',
      inReplyToTweetId: '1001',
      inReplyToUserId: authorId,
    });

    // Tweet 3 replies to 2
    const tweet3 = buildRawTweet({
      id: '1003',
      authorId,
      text: 'Reply to reply',
      createdAt: 'Wed Jan 15 12:02:00 +0000 2025',
      inReplyToTweetId: '1002',
      inReplyToUserId: authorId,
    });

    // First call: focal=1003, sees parent 1002
    const response1003 = buildTweetDetailResponse([
      buildTweetEntry(tweet2), // the parent tweet context
      buildTweetEntry(tweet3), // the focal tweet
    ]);

    // Second call: focal=1002, sees parent 1001
    const response1002 = buildTweetDetailResponse([
      buildTweetEntry(tweet1), // the parent tweet context
      buildTweetEntry(tweet2), // the focal tweet
    ]);

    // Third call: focal=1001, sees root (no parent)
    const response1001 = buildTweetDetailResponse([
      buildTweetEntry(tweet1),
      buildTweetEntry(tweet2),
      buildTweetEntry(tweet3),
    ]);

    const client = createMockClient((queryId, opName, variables) => {
      const focalId = variables?.focalTweetId;
      if (focalId === '1003') return response1003;
      if (focalId === '1002') return response1002;
      if (focalId === '1001') return response1001;
      return buildTweetDetailResponse([]);
    });

    const result = await scrapeFullThread(client, '1003');

    // Should have walked: 1003 → 1002 → 1001 (3 calls), then scrapeThread from 1001 (1 call)
    expect(client.graphql).toHaveBeenCalledTimes(4);
    expect(result.rootTweet).toBeDefined();
    expect(result.rootTweet.id).toBe('1001');
  });

  it('should return directly if the tweet is already the root', async () => {
    const rootTweet = buildRawTweet({
      id: '2001',
      text: 'Root that has no parent',
    });

    const response = buildTweetDetailResponse([buildTweetEntry(rootTweet)]);
    const client = createMockClient(() => response);

    const result = await scrapeFullThread(client, '2001');

    // Since the first call already shows no parent, it just scrapes from there
    expect(result.rootTweet.id).toBe('2001');
  });

  it('should respect maxDepth to prevent infinite loops', async () => {
    const client = createMockClient((queryId, opName, variables) => {
      const focalId = variables?.focalTweetId;
      const parentId = String(Number(focalId) - 1);

      const tweet = buildRawTweet({
        id: focalId,
        text: `Tweet ${focalId}`,
        inReplyToTweetId: parentId,
        inReplyToUserId: 'u1',
      });

      return buildTweetDetailResponse([buildTweetEntry(tweet)]);
    });

    const result = await scrapeFullThread(client, '1000', { maxDepth: 5 });

    // Should have stopped after maxDepth traversals + 1 final scrape
    expect(client.graphql.mock.calls.length).toBeLessThanOrEqual(7);
    expect(result.rootTweet).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: cursor extraction
// ---------------------------------------------------------------------------

describe('cursor extraction', () => {
  it('should extract Bottom cursor from cursor entry', async () => {
    const rootTweet = buildRawTweet({ id: '7000', text: 'Root' });
    const entries = [
      buildTweetEntry(rootTweet),
      buildCursorEntry('Bottom', 'bottom_cursor_xyz'),
    ];

    const response = buildTweetDetailResponse(entries);
    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '7000');

    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('bottom_cursor_xyz');
  });

  it('should extract ShowMoreThreads cursor from conversation module', async () => {
    const rootTweet = buildRawTweet({ id: '7100', text: 'Root' });
    const reply = buildRawTweet({
      id: '7101',
      text: 'Reply',
      inReplyToTweetId: '7100',
    });

    const entries = [
      buildTweetEntry(rootTweet),
      buildConversationModule(
        'conversationthread-7101',
        [reply],
        [{ type: 'ShowMoreThreads', value: 'showmore_cursor_abc' }],
      ),
    ];

    const response = buildTweetDetailResponse(entries);
    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '7100');

    expect(result.hasMore).toBe(true);
    // Should find either the Bottom or ShowMoreThreads cursor
    expect(result.cursor).toBeTruthy();
  });

  it('should set hasMore=false when no cursor present', async () => {
    const rootTweet = buildRawTweet({ id: '7200', text: 'Root' });
    const response = buildTweetDetailResponse([buildTweetEntry(rootTweet)]);

    const client = createMockClient(() => response);

    const result = await scrapeThread(client, '7200');

    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });
});
