// by nichxbt
/**
 * Tests for reconstructThread and parseConversationModule in
 * src/scrapers/twitter/http/thread.js
 *
 * Pure logic tests — no network requests.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import {
  parseConversationModule,
  reconstructThread,
} from '../../src/scrapers/twitter/http/thread.js';

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
// Tests: reconstructThread
// ---------------------------------------------------------------------------

describe('reconstructThread', () => {
  it('should reconstruct a self-thread in chronological order', () => {
    const { tweet1, tweet2, tweet3, tweet4, authorId } = buildSelfThread();

    // Parse through parseTweetData-like format
    const tweets = [tweet1, tweet2, tweet3, tweet4].map((raw) => ({
      id: raw.rest_id,
      text: raw.legacy.full_text,
      createdAt: new Date(raw.legacy.created_at).toISOString(),
      author: {
        id: raw.core.user_results.result.rest_id,
        username: raw.core.user_results.result.legacy.screen_name,
        name: raw.core.user_results.result.legacy.name,
      },
      inReplyTo: raw.legacy.in_reply_to_status_id_str
        ? {
            tweetId: raw.legacy.in_reply_to_status_id_str,
            userId: raw.legacy.in_reply_to_user_id_str,
            username: raw.legacy.in_reply_to_screen_name,
          }
        : null,
      platform: 'twitter',
    }));

    const result = reconstructThread(tweets);

    expect(result.rootTweet).toBeDefined();
    expect(result.rootTweet.id).toBe('2000000000000000001');
    expect(result.authorReplies).toHaveLength(3); // 3 replies by same author
    expect(result.authorReplies[0].id).toBe('2000000000000000002');
    expect(result.authorReplies[1].id).toBe('2000000000000000003');
    expect(result.authorReplies[2].id).toBe('2000000000000000004');
    expect(result.conversation).toHaveLength(3);
  });

  it('should handle a single tweet (no thread)', () => {
    const tweet = {
      id: '111',
      text: 'Solo tweet',
      createdAt: '2025-01-15T12:00:00.000Z',
      author: { id: 'u1', username: 'solo', name: 'Solo' },
      inReplyTo: null,
      platform: 'twitter',
    };

    const result = reconstructThread([tweet]);

    expect(result.rootTweet).toBeDefined();
    expect(result.rootTweet.id).toBe('111');
    expect(result.authorReplies).toHaveLength(0);
    expect(result.conversation).toHaveLength(0);
  });

  it('should handle empty input', () => {
    const result = reconstructThread([]);
    expect(result.rootTweet).toBeNull();
    expect(result.authorReplies).toHaveLength(0);
    expect(result.conversation).toHaveLength(0);
  });

  it('should separate author replies from other users replies', () => {
    const tweets = [
      {
        id: '100',
        text: 'Root tweet',
        createdAt: '2025-01-15T12:00:00.000Z',
        author: { id: 'author1', username: 'op', name: 'OP' },
        inReplyTo: null,
      },
      {
        id: '101',
        text: 'Author self-reply',
        createdAt: '2025-01-15T12:01:00.000Z',
        author: { id: 'author1', username: 'op', name: 'OP' },
        inReplyTo: { tweetId: '100', userId: 'author1', username: 'op' },
      },
      {
        id: '102',
        text: 'Someone else replies',
        createdAt: '2025-01-15T12:02:00.000Z',
        author: { id: 'other1', username: 'commenter', name: 'Commenter' },
        inReplyTo: { tweetId: '100', userId: 'author1', username: 'op' },
      },
      {
        id: '103',
        text: 'Author continues thread',
        createdAt: '2025-01-15T12:03:00.000Z',
        author: { id: 'author1', username: 'op', name: 'OP' },
        inReplyTo: { tweetId: '101', userId: 'author1', username: 'op' },
      },
    ];

    const result = reconstructThread(tweets);

    expect(result.rootTweet.id).toBe('100');
    expect(result.authorReplies).toHaveLength(2); // 101 + 103
    expect(result.authorReplies.map((t) => t.id)).toEqual(['101', '103']);
    expect(result.conversation).toHaveLength(3); // 101 + 102 + 103
  });

  it('should handle branching conversations', () => {
    const tweets = [
      {
        id: '200',
        text: 'Root',
        createdAt: '2025-01-15T12:00:00.000Z',
        author: { id: 'a1', username: 'root', name: 'Root' },
        inReplyTo: null,
      },
      {
        id: '201',
        text: 'Branch A',
        createdAt: '2025-01-15T12:01:00.000Z',
        author: { id: 'a2', username: 'branchA', name: 'Branch A' },
        inReplyTo: { tweetId: '200', userId: 'a1', username: 'root' },
      },
      {
        id: '202',
        text: 'Branch B',
        createdAt: '2025-01-15T12:02:00.000Z',
        author: { id: 'a3', username: 'branchB', name: 'Branch B' },
        inReplyTo: { tweetId: '200', userId: 'a1', username: 'root' },
      },
      {
        id: '203',
        text: 'Reply to Branch A',
        createdAt: '2025-01-15T12:03:00.000Z',
        author: { id: 'a4', username: 'replyA', name: 'Reply A' },
        inReplyTo: { tweetId: '201', userId: 'a2', username: 'branchA' },
      },
    ];

    const result = reconstructThread(tweets);

    expect(result.rootTweet.id).toBe('200');
    expect(result.conversation).toHaveLength(3);
    // All replies should be in conversation
    const ids = result.conversation.map((t) => t.id);
    expect(ids).toContain('201');
    expect(ids).toContain('202');
    expect(ids).toContain('203');
  });

  it('should handle missing tweets (deleted) in the chain', () => {
    // Tweet 300 → [deleted 301] → 302
    // 302 replies to 301, but 301 is not in the array
    const tweets = [
      {
        id: '300',
        text: 'Root',
        createdAt: '2025-01-15T12:00:00.000Z',
        author: { id: 'a1', username: 'root', name: 'Root' },
        inReplyTo: null,
      },
      {
        id: '302',
        text: 'Reply to deleted tweet',
        createdAt: '2025-01-15T12:02:00.000Z',
        author: { id: 'a1', username: 'root', name: 'Root' },
        inReplyTo: { tweetId: '301', userId: 'a1', username: 'root' }, // 301 not in set
      },
    ];

    const result = reconstructThread(tweets);

    expect(result.rootTweet.id).toBe('300');
    // 302's parent is missing, so it becomes an orphan root and still shows up
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0].id).toBe('302');
  });

  it('should build a tree map of parent-child relationships', () => {
    const tweets = [
      {
        id: '400',
        text: 'Root',
        createdAt: '2025-01-15T12:00:00.000Z',
        author: { id: 'a1', username: 'root', name: 'Root' },
        inReplyTo: null,
      },
      {
        id: '401',
        text: 'Reply 1',
        createdAt: '2025-01-15T12:01:00.000Z',
        author: { id: 'a1', username: 'root', name: 'Root' },
        inReplyTo: { tweetId: '400', userId: 'a1', username: 'root' },
      },
      {
        id: '402',
        text: 'Reply 2',
        createdAt: '2025-01-15T12:02:00.000Z',
        author: { id: 'a2', username: 'other', name: 'Other' },
        inReplyTo: { tweetId: '400', userId: 'a1', username: 'root' },
      },
    ];

    const result = reconstructThread(tweets);
    expect(result.tree).toBeInstanceOf(Map);
    // Root's children
    const rootChildren = result.tree.get('400');
    expect(rootChildren).toBeDefined();
    expect(rootChildren).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: parseConversationModule
// ---------------------------------------------------------------------------

describe('parseConversationModule', () => {
  it('should parse a conversation module with tweets', () => {
    const rawTweet1 = buildRawTweet({ id: '500', text: 'First reply' });
    const rawTweet2 = buildRawTweet({ id: '501', text: 'Second reply' });

    const module = buildConversationModule(
      'conversationthread-500',
      [rawTweet1, rawTweet2],
    );

    const { tweets, cursors } = parseConversationModule(module.content);

    expect(tweets).toHaveLength(2);
    expect(tweets[0].id).toBe('500');
    expect(tweets[1].id).toBe('501');
    expect(cursors).toHaveLength(0);
  });

  it('should extract cursors for "Show more replies"', () => {
    const rawTweet = buildRawTweet({ id: '600', text: 'A reply' });

    const module = buildConversationModule(
      'conversationthread-600',
      [rawTweet],
      [{ type: 'ShowMoreThreads', value: 'DAACCgACGKi_cursor_value' }],
    );

    const { tweets, cursors } = parseConversationModule(module.content);

    expect(tweets).toHaveLength(1);
    expect(cursors).toHaveLength(1);
    expect(cursors[0].type).toBe('ShowMoreThreads');
    expect(cursors[0].value).toBe('DAACCgACGKi_cursor_value');
  });

  it('should handle empty module', () => {
    const { tweets, cursors } = parseConversationModule(null);
    expect(tweets).toHaveLength(0);
    expect(cursors).toHaveLength(0);
  });

  it('should handle module with only cursors', () => {
    const module = buildConversationModule(
      'conversationthread-700',
      [],
      [{ type: 'ShowMoreThreadsPrompt', value: 'cursor_abc' }],
    );

    const { tweets, cursors } = parseConversationModule(module.content);

    expect(tweets).toHaveLength(0);
    expect(cursors).toHaveLength(1);
    expect(cursors[0].value).toBe('cursor_abc');
  });

  it('should handle TweetTombstone entries', () => {
    const tombstone = {
      __typename: 'TweetTombstone',
      tombstone: {
        text: { text: 'This Tweet was deleted by the Tweet author.' },
      },
    };

    const module = {
      items: [
        {
          item: {
            itemContent: {
              __typename: 'TimelineTweet',
              tweet_results: { result: tombstone },
            },
          },
        },
      ],
    };

    const { tweets } = parseConversationModule(module);
    expect(tweets).toHaveLength(1);
    expect(tweets[0].tombstone).toBe(true);
  });
});
