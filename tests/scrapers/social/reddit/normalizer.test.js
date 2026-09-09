// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import {
  namespacedRedditId,
  parseFullname,
  normalizeRedditPost,
  normalizeRedditComment,
  normalizeRedditSubreddit,
  normalizeRedditUser,
} from '../../../../src/scrapers/social/reddit/normalizer.js';

describe('namespacedRedditId', () => {
  it('generates namespaced id with reddit prefix', () => {
    expect(namespacedRedditId('t3_1a2b3c')).toBe('reddit:t3_1a2b3c');
    expect(namespacedRedditId('abc')).toBe('reddit:abc');
  });
});

describe('parseFullname', () => {
  it('parses t3 fullname', () => {
    expect(parseFullname('t3_1a2b3c')).toEqual({ kind: 't3', id: '1a2b3c' });
  });

  it('parses t1 fullname', () => {
    expect(parseFullname('t1_xyz789')).toEqual({ kind: 't1', id: 'xyz789' });
  });

  it('handles empty input', () => {
    expect(parseFullname('')).toEqual({ kind: 'unknown', id: '' });
    expect(parseFullname(undefined)).toEqual({ kind: 'unknown', id: '' });
  });
});

describe('normalizeRedditPost', () => {
  it('maps t3 post to PostItem', () => {
    const raw = {
      kind: 't3',
      data: {
        name: 't3_1a2b3c',
        id: '1a2b3c',
        subreddit: 'programming',
        author: 'spez',
        title: 'Hello world',
        selftext: 'This is a test post',
        score: 42,
        num_comments: 7,
        created_utc: 1700000000,
        permalink: '/r/programming/comments/1a2b3c/hello_world/',
        url: 'https://example.com/image.png',
        is_self: false,
        over_18: false,
        pinned: false,
        stickied: false,
      },
    };

    const post = normalizeRedditPost(raw);

    expect(post.id).toBe('reddit:t3_1a2b3c');
    expect(post.platform).toBe('reddit');
    expect(post.externalId).toBe('t3_1a2b3c');
    expect(post.category).toBe("social");
    expect(post.authorName).toBe('spez');
    expect(post.content).toBe('Hello world This is a test post');
    expect(post.likesCount).toBe(42);
    expect(post.repliesCount).toBe(7);
    expect(post.publishedAt).toEqual(new Date(1700000000 * 1000));
    expect(post.postUrl).toBe('https://example.com/image.png');
    expect(post.mediaUrls).toContain('https://example.com/image.png');
    expect(post.metadata.subreddit).toBe('programming');
    expect(post.metadata.isNsfw).toBe(false);
  });

  it('handles missing selftext', () => {
    const raw = {
      data: {
        name: 't3_abc',
        title: 'Title only',
        subreddit: 'test',
        author: 'user1',
        score: 1,
        created_utc: 1700000000,
      },
    };

    const post = normalizeRedditPost(raw);
    expect(post.content).toBe('Title only');
  });

  it('handles deleted author', () => {
    const raw = {
      data: {
        name: 't3_abc',
        title: 'Deleted post',
        subreddit: 'test',
        author: '[deleted]',
        score: 0,
        created_utc: 1700000000,
      },
    };

    const post = normalizeRedditPost(raw);
    expect(post.authorName).toBe('[deleted]');
    expect(post.authorUrl).toBe('');
  });
});

describe('normalizeRedditComment', () => {
  it('maps t1 comment to CommentItem', () => {
    const raw = {
      kind: 't1',
      data: {
        name: 't1_xyz789',
        id: 'xyz789',
        link_id: 't3_1a2b3c',
        parent_id: 't3_1a2b3c',
        author: 'commenter1',
        body: 'This is a comment',
        score: 15,
        created_utc: 1700000100,
        subreddit: 'programming',
        permalink: '/r/programming/comments/1a2b3c/_/xyz789/',
      },
    };

    const comment = normalizeRedditComment(raw);

    expect(comment.id).toBe('reddit:t3_1a2b3c:t1_xyz789');
    expect(comment.platform).toBe('reddit');
    expect(comment.externalId).toBe('t1_xyz789');
    expect(comment.postId).toBe('reddit:t3_1a2b3c');
    expect(comment.authorName).toBe('commenter1');
    expect(comment.content).toBe('This is a comment');
    expect(comment.likesCount).toBe(15);
    expect(comment.publishedAt).toEqual(new Date(1700000100 * 1000));
    expect(comment.metadata.subreddit).toBe('programming');
  });

  it('handles nested replies', () => {
    const raw = {
      data: {
        name: 't1_nested',
        link_id: 't3_1a2b3c',
        parent_id: 't1_xyz789',
        author: 'replier',
        body: 'Nested reply',
        score: 5,
        created_utc: 1700000200,
        depth: 1,
        replies: {
          data: {
            children: [{ kind: 't1', data: { name: 't1_child' } }],
          },
        },
      },
    };

    const comment = normalizeRedditComment(raw);
    expect(comment.parentCommentId).toBe('reddit:t1_xyz789');
    expect(comment.depth).toBe(1);
    expect(comment.subCommentsCount).toBe(1);
  });
});

describe('normalizeRedditSubreddit', () => {
  it('maps t5 subreddit to PostItem with community metadata', () => {
    const raw = {
      kind: 't5',
      data: {
        name: 't5_2xxxxx',
        id: '2xxxxx',
        display_name: 'programming',
        public_description: 'Computer programming community',
        description: 'A place for programmers',
        url: '/r/programming/',
        subscribers: 123456,
        accounts_active: 7890,
        created_utc: 1200000000,
        over18: false,
        quarantine: false,
        subreddit_type: 'public',
        icon_img: 'https://example.com/icon.png',
      },
    };

    const subreddit = normalizeRedditSubreddit(raw);

    expect(subreddit.id).toBe('reddit:t5_2xxxxx');
    expect(subreddit.platform).toBe('reddit');
    expect(subreddit.externalId).toBe('t5_2xxxxx');
    expect(subreddit.category).toBe("social");
    expect(subreddit.authorName).toBe('r/programming');
    expect(subreddit.content).toBe('Computer programming community');
    expect(subreddit.likesCount).toBe(123456);
    expect(subreddit.metadata.isCommunity).toBe(true);
    expect(subreddit.metadata.displayName).toBe('programming');
    expect(subreddit.metadata.subscribers).toBe(123456);
  });
});

describe('normalizeRedditUser', () => {
  it('maps t2 user to ProfileItem', () => {
    const raw = {
      kind: 't2',
      data: {
        name: 'spez',
        fullname: 't2_abc123',
        id: 'abc123',
        icon_img: 'https://example.com/avatar.png',
        link_karma: 1000,
        comment_karma: 5000,
        total_karma: 6000,
        created_utc: 1100000000,
        is_employee: false,
        is_mod: true,
        is_gold: false,
        verified: true,
        subreddit: {
          public_description: 'Reddit CEO',
        },
      },
    };

    const user = normalizeRedditUser(raw);

    expect(user.id).toBe('reddit:t2_abc123');
    expect(user.platform).toBe('reddit');
    expect(user.externalId).toBe('t2_abc123');
    expect(user.username).toBe('spez');
    expect(user.name).toBe('spez');
    expect(user.bio).toBe('Reddit CEO');
    expect(user.avatar).toBe('https://example.com/avatar.png');
    expect(user.profileUrl).toBe('https://www.reddit.com/user/spez');
    expect(user.followersCount).toBe(6000);
    expect(user.metadata.joined).toEqual(new Date(1100000000 * 1000));
    expect(user.metadata.linkKarma).toBe(1000);
    expect(user.metadata.commentKarma).toBe(5000);
    expect(user.metadata.isMod).toBe(true);
  });
});
