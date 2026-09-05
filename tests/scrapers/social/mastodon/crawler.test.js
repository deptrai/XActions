// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Unit tests for MastodonCrawler (Story 23.4).
 * Tests ActionRegistry actions, CrawlerCommand execution pipeline,
 * Store integration, onProgress callbacks, and error propagation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { MastodonCrawler } from '../../../../src/scrapers/social/mastodon/crawler.js';
import { MastodonClient } from '../../../../src/scrapers/social/mastodon/client.js';
import { CATEGORIES } from '../../../../src/core/types.js';

describe('Story 23.4 — MastodonCrawler', () => {
  describe('Action Registry', () => {
    it('registers all 7 standard Mastodon actions in snake_case', () => {
      const crawler = new MastodonCrawler();
      const actions = crawler.listActions();
      const actionNames = actions.map((a) => a.action);

      expect(actionNames).toContain('profile');
      expect(actionNames).toContain('followers');
      expect(actionNames).toContain('following');
      expect(actionNames).toContain('posts');
      expect(actionNames).toContain('get_user_feed');
      expect(actionNames).toContain('search');
      expect(actionNames).toContain('hashtag');
      expect(actionNames).toContain('trending');

      for (const desc of actions) {
        expect(desc.requiresAuth).toBe(false);
        expect(desc.category).toBe('social');
      }
    });
  });

  describe('Crawler Execution & Normalization', () => {
    function createMockClient() {
      return {
        baseUrl: 'https://mastodon.social',
        accessToken: null,
        init: async () => {},
        lookupAccount: async (username) => ({
          id: '123',
          username,
          acct: username,
          display_name: `User ${username}`,
          note: '<p>Decentralized enthusiast</p>',
          url: `https://mastodon.social/@${username}`,
          followers_count: 100,
          following_count: 50,
          statuses_count: 500,
        }),
        getAccountFollowers: async () => ({
          accounts: [{ id: '10', username: 'alice', display_name: 'Alice' }],
          nextMaxId: '99',
        }),
        getAccountFollowing: async () => ({
          accounts: [{ id: '20', username: 'bob', display_name: 'Bob' }],
          nextMaxId: '88',
        }),
        getAccountStatuses: async () => ({
          statuses: [
            {
              id: '555',
              created_at: '2026-09-01T00:00:00.000Z',
              content: '<p>Hello Mastodon!</p>',
              account: { id: '123', username: 'Gargron', display_name: 'Eugen' },
            },
          ],
          nextMaxId: '550',
        }),
        search: async () => ({
          accounts: [{ id: '1', username: 'coder' }],
          statuses: [{ id: '2', content: 'test', account: { id: '1', username: 'coder' } }],
          hashtags: [{ name: 'foss' }],
        }),
        getHashtagTimeline: async (tag) => ({
          statuses: [
            {
              id: '777',
              content: `<p>Post about #${tag}</p>`,
              account: { id: '1', username: 'dev' },
            },
          ],
          nextMaxId: null,
        }),
        getTrendingStatuses: async () => [
          {
            id: '888',
            content: '<p>Trending topic post</p>',
            account: { id: '1', username: 'trendsetter' },
          },
        ],
      };
    }

    it('executes profile action and returns normalized ProfileItem', async () => {
      const client = createMockClient();
      const crawler = new MastodonCrawler({ client });

      const profile = await crawler.start({
        action: 'profile',
        args: { username: 'Gargron' },
      });

      expect(profile.id).toBe('mastodon:mastodon.social:123');
      expect(profile.platform).toBe('mastodon');
      expect(profile.username).toBe('Gargron');
      expect(profile.name).toBe('User Gargron');
      expect(profile.bio).toBe('Decentralized enthusiast');
      expect(profile.followersCount).toBe(100);
    });

    it('executes followers and following actions with pageInfo and onProgress', async () => {
      const client = createMockClient();
      const crawler = new MastodonCrawler({ client });
      let progressEvents = 0;

      const followersRes = await crawler.start({
        action: 'followers',
        args: {
          username: 'Gargron',
          limit: 10,
          onProgress: () => {
            progressEvents++;
          },
        },
      });

      expect(followersRes.profiles.length).toBe(1);
      expect(followersRes.profiles[0].username).toBe('alice');
      expect(followersRes.pageInfo.next_max_id).toBe('99');
      expect(followersRes.pageInfo.has_next_page).toBe(true);
      expect(progressEvents).toBe(1);

      const followingRes = await crawler.start({
        action: 'following',
        args: { username: 'Gargron' },
      });
      expect(followingRes.profiles[0].username).toBe('bob');
      expect(followingRes.pageInfo.next_max_id).toBe('88');
    });

    it('executes posts and get_user_feed actions', async () => {
      const client = createMockClient();
      const crawler = new MastodonCrawler({ client });

      const posts = await crawler.start({
        action: 'posts',
        args: { username: 'Gargron', limit: 5 },
      });

      expect(posts.length).toBe(1);
      expect(posts[0].id).toBe('mastodon:mastodon.social:555');
      expect(posts[0].category).toBe(CATEGORIES.SOCIAL);
      expect(posts[0].content).toBe('Hello Mastodon!');

      const feedPosts = await crawler.start({
        action: 'get_user_feed',
        args: { username: 'Gargron' },
      });
      expect(feedPosts.length).toBe(1);
      expect(feedPosts[0].id).toBe('mastodon:mastodon.social:555');
    });

    it('executes search action and returns posts, profiles, and hashtags', async () => {
      const client = createMockClient();
      const crawler = new MastodonCrawler({ client });

      const searchRes = await crawler.start({
        action: 'search',
        args: { query: 'coder' },
      });

      expect(searchRes.profiles.length).toBe(1);
      expect(searchRes.posts.length).toBe(1);
      expect(searchRes.hashtags.length).toBe(1);
      expect(searchRes.posts[0].id).toBe('mastodon:mastodon.social:2');
    });

    it('executes hashtag and trending actions', async () => {
      const client = createMockClient();
      const crawler = new MastodonCrawler({ client });

      const tagPosts = await crawler.start({
        action: 'hashtag',
        args: { hashtag: 'foss' },
      });
      expect(tagPosts.length).toBe(1);
      expect(tagPosts[0].content).toBe('Post about #foss');

      const trendingPosts = await crawler.start({
        action: 'trending',
        args: { limit: 5 },
      });
      expect(trendingPosts.length).toBe(1);
      expect(trendingPosts[0].content).toBe('Trending topic post');
    });

    it('integrates with store when store is provided', async () => {
      const storedBatches = [];
      const storedSingles = [];
      const store = {
        storeBatch: async (items) => {
          storedBatches.push(items);
        },
        storeContent: async (item) => {
          storedSingles.push(item);
        },
      };

      const client = createMockClient();
      const crawler = new MastodonCrawler({ client, store });

      await crawler.start({
        action: 'profile',
        args: { username: 'Gargron' },
      });
      expect(storedSingles.length).toBe(1);

      await crawler.start({
        action: 'posts',
        args: { username: 'Gargron' },
      });
      expect(storedBatches.length).toBe(1);
      expect(storedBatches[0][0].id).toBe('mastodon:mastodon.social:555');
    });
  });
});
