// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import {
  namespacedBlueskyId,
  normalizeBlueskyProfile,
  normalizeBlueskyConnection,
  normalizeBlueskyPost,
  normalizeBlueskyTrendingTopic,
  profileItemToPostItem,
} from '../../../../src/scrapers/social/bluesky/normalizer.js';

describe('Story 23.2: Bluesky Normalizers', () => {
  it('namespacedBlueskyId prepends bluesky: prefix', () => {
    expect(namespacedBlueskyId('did:plc:123')).toBe('bluesky:did:plc:123');
    expect(namespacedBlueskyId('at://did:plc:123/app.bsky.feed.post/3')).toBe('bluesky:at://did:plc:123/app.bsky.feed.post/3');
    expect(namespacedBlueskyId('')).toBe('bluesky:');
  });

  it('normalizeBlueskyProfile transforms raw actor profile to ProfileItem', () => {
    const raw = {
      did: 'did:plc:alice123',
      handle: 'alice.bsky.social',
      displayName: 'Alice In Wonderland',
      description: 'Decentralized enthusiast',
      avatar: 'https://cdn.bsky.app/avatar.jpg',
      banner: 'https://cdn.bsky.app/banner.jpg',
      followersCount: 1500,
      followsCount: 300,
      postsCount: 420,
      indexedAt: '2026-01-01T12:00:00Z',
      createdAt: '2024-05-01T00:00:00Z',
    };

    const profile = normalizeBlueskyProfile(raw);
    expect(profile.id).toBe('bluesky:did:plc:alice123');
    expect(profile.platform).toBe('bluesky');
    expect(profile.username).toBe('alice.bsky.social');
    expect(profile.name).toBe('Alice In Wonderland');
    expect(profile.bio).toBe('Decentralized enthusiast');
    expect(profile.avatar).toBe('https://cdn.bsky.app/avatar.jpg');
    expect(profile.followersCount).toBe(1500);
    expect(profile.followingCount).toBe(300);
    expect(profile.profileUrl).toBe('https://bsky.app/profile/alice.bsky.social');
    expect(profile.metadata.did).toBe('did:plc:alice123');
    expect(profile.metadata.banner).toBe('https://cdn.bsky.app/banner.jpg');
    expect(profile.metadata.postsCount).toBe(420);
  });

  it('normalizeBlueskyConnection formats follower/following relationships', () => {
    const raw = {
      did: 'did:plc:bob456',
      handle: 'bob.bsky.social',
      displayName: 'Bob The Builder',
      description: 'Can we fix it?',
      avatar: 'https://cdn.bsky.app/bob.jpg',
      indexedAt: '2026-02-01T00:00:00Z',
    };

    const follower = normalizeBlueskyConnection(raw, 'follower');
    expect(follower.id).toBe('bluesky:did:plc:bob456');
    expect(follower.platform).toBe('bluesky');
    expect(follower.username).toBe('bob.bsky.social');
    expect(follower.metadata.isFollower).toBe(true);
    expect(follower.metadata.isFollowing).toBe(false);

    const following = normalizeBlueskyConnection(raw, 'following');
    expect(following.metadata.isFollower).toBe(false);
    expect(following.metadata.isFollowing).toBe(true);
  });

  it('normalizeBlueskyPost formats post item conforming to PostItem schema', () => {
    const rawPostItem = {
      post: {
        uri: 'at://did:plc:carol789/app.bsky.feed.post/3lbexample',
        cid: 'bafyreiexamplecid',
        author: {
          did: 'did:plc:carol789',
          handle: 'carol.bsky.social',
          displayName: 'Carol',
          avatar: 'https://cdn.bsky.app/carol.jpg',
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Hello #world and @alice.bsky.social check this out',
          createdAt: '2026-09-04T08:00:00.000Z',
          langs: ['en'],
        },
        embed: {
          $type: 'app.bsky.embed.images#view',
          images: [
            {
              thumb: 'https://cdn.bsky.app/thumb1.jpg',
              fullsize: 'https://cdn.bsky.app/full1.jpg',
              alt: 'A lovely sunset',
            },
          ],
        },
        replyCount: 12,
        repostCount: 34,
        likeCount: 56,
        quoteCount: 7,
        indexedAt: '2026-09-04T08:00:05.000Z',
      },
    };

    const post = normalizeBlueskyPost(rawPostItem);
    expect(post.id).toBe('bluesky:at://did:plc:carol789/app.bsky.feed.post/3lbexample');
    expect(post.platform).toBe('bluesky');
    expect(post.authorId).toBe('did:plc:carol789');
    expect(post.authorName).toBe('Carol');
    expect(post.authorAvatar).toBe('https://cdn.bsky.app/carol.jpg');
    expect(post.content).toBe('Hello #world and @alice.bsky.social check this out');
    expect(post.mediaUrls).toHaveLength(1);
    expect(post.mediaUrls[0]).toBe('https://cdn.bsky.app/thumb1.jpg');
    expect(post.likesCount).toBe(56);
    expect(post.repostsCount).toBe(34);
    expect(post.repliesCount).toBe(12);
    expect(post.postUrl).toBe('https://bsky.app/profile/carol.bsky.social/post/3lbexample');
    expect(post.metadata.uri).toBe('at://did:plc:carol789/app.bsky.feed.post/3lbexample');
    expect(post.metadata.cid).toBe('bafyreiexamplecid');
  });

  it('normalizeBlueskyTrendingTopic creates PostItem for trending trends', () => {
    const rawTopic = {
      topic: 'OpenSource',
      displayName: '#OpenSource',
      description: 'Software development trends',
    };

    const trend = normalizeBlueskyTrendingTopic(rawTopic, 1);
    expect(trend.id).toBe('bluesky:trend:OpenSource');
    expect(trend.platform).toBe('bluesky');
    expect(trend.category).toBe('trending');
    expect(trend.content).toBe('#OpenSource — Software development trends');
    expect(trend.metadata.rank).toBe(1);
    expect(trend.metadata.topic).toBe('OpenSource');
    expect(trend.metadata.displayName).toBe('#OpenSource');
    expect(trend.metadata.description).toBe('Software development trends');
  });

  it('profileItemToPostItem maps ProfileItem to universal PostItem for store persistence', () => {
    const profile = normalizeBlueskyProfile({
      did: 'did:plc:testdid',
      handle: 'test.bsky.social',
      displayName: 'Test',
      description: 'A tester profile',
    });

    const postItem = profileItemToPostItem(profile);
    expect(postItem.id).toBe('bluesky:did:plc:testdid');
    expect(postItem.platform).toBe('bluesky');
    expect(postItem.category).toBe('profile');
    expect(postItem.authorId).toBe('did:plc:testdid');
    expect(postItem.authorName).toBe('Test');
    expect(postItem.content).toBe('A tester profile');
  });
});
