// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { RedditCrawler } from '../../../../src/scrapers/social/reddit/crawler.js';
import { RedditClient } from '../../../../src/scrapers/social/reddit/client.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

describe('RedditCrawler', () => {
  let server;
  let serverUrl;
  let crawler;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // OAuth token
        if (req.url === '/api/v1/access_token') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'token123', token_type: 'bearer', expires_in: 3600 }));
          return;
        }

        // Subreddit listing
        if (req.url?.startsWith('/r/programming/new.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_abc',
                    id: 'abc',
                    subreddit: 'programming',
                    author: 'dev',
                    title: 'Hello',
                    selftext: 'World',
                    score: 10,
                    num_comments: 2,
                    created_utc: 1700000000,
                    permalink: '/r/programming/comments/abc/',
                  },
                },
              ],
              after: 't3_next',
            },
          }));
          return;
        }

        // User about
        if (req.url?.startsWith('/user/spez/about')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 't2',
            data: {
              name: 'spez',
              fullname: 't2_spez',
              id: 'spez',
              link_karma: 100,
              comment_karma: 200,
              created_utc: 1100000000,
            },
          }));
          return;
        }

        // User submitted
        if (req.url?.startsWith('/user/spez/submitted')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_user1',
                    id: 'user1',
                    subreddit: 'test',
                    author: 'spez',
                    title: 'User post',
                    score: 5,
                    num_comments: 1,
                    created_utc: 1700000000,
                  },
                },
              ],
              after: null,
            },
          }));
          return;
        }

        // Search
        if (req.url?.startsWith('/search')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_search1',
                    id: 'search1',
                    subreddit: 'all',
                    author: 'searcher',
                    title: 'Search result',
                    score: 20,
                    num_comments: 5,
                    created_utc: 1700000000,
                  },
                },
              ],
              after: 't3_searchnext',
            },
          }));
          return;
        }

        // Post comments
        if (req.url?.includes('/r/test/comments/post123')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([
            {
              kind: 'Listing',
              data: {
                children: [
                  {
                    kind: 't3',
                    data: {
                      name: 't3_post123',
                      id: 'post123',
                      subreddit: 'test',
                      author: 'poster',
                      title: 'Post',
                      score: 50,
                      num_comments: 1,
                      created_utc: 1700000000,
                    },
                  },
                ],
              },
            },
            {
              kind: 'Listing',
              data: {
                children: [
                  {
                    kind: 't1',
                    data: {
                      name: 't1_comment1',
                      id: 'comment1',
                      link_id: 't3_post123',
                      parent_id: 't3_post123',
                      author: 'commenter',
                      body: 'Nice post',
                      score: 15,
                      created_utc: 1700000100,
                      subreddit: 'test',
                    },
                  },
                ],
                after: null,
              },
            },
          ]));
          return;
        }

        // Subreddit about
        if (req.url?.startsWith('/r/test/about')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 't5',
            data: {
              name: 't5_test',
              id: 'test',
              display_name: 'test',
              public_description: 'Test community',
              subscribers: 1000,
              created_utc: 1200000000,
              url: '/r/test/',
            },
          }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;

    const client = new RedditClient({ baseUrl: serverUrl, apiBaseUrl: serverUrl });
    crawler = new RedditCrawler({ client });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('initializes with correct name and platform', () => {
    expect(crawler.name).toBe('reddit');
    expect(crawler.platform).toBe('reddit');
    expect(crawler.requiresAuth).toBe(false);
    expect(crawler.category).toBe('social');
  });

  it('lists all registered actions', () => {
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('subreddit');
    expect(actionNames).toContain('user');
    expect(actionNames).toContain('search');
    expect(actionNames).toContain('post_comments');
    expect(actionNames).toContain('subreddit_info');
  });

  it('has checkpointResolver for subreddit action', () => {
    const desc = crawler.listActions().find((a) => a.action === 'subreddit');
    expect(desc).toBeDefined();
    expect(typeof desc.checkpointResolver).toBe('function');
    const res = desc.checkpointResolver({ name: 'programming' });
    expect(res.targetType).toBe('subreddit');
    expect(res.targetKey).toBe('programming');
    expect(res.cursorField).toBe('after');
    expect(res.fallbackCursorFields).toContain('cursor');
  });

  it('has checkpointResolver for search action', () => {
    const desc = crawler.listActions().find((a) => a.action === 'search');
    const res = desc.checkpointResolver({ query: 'AI' });
    expect(res.targetType).toBe('search');
    expect(res.targetKey).toBe('ai');
    expect(res.cursorField).toBe('after');
  });

  it('has checkpointResolver for post_comments action', () => {
    const desc = crawler.listActions().find((a) => a.action === 'post_comments');
    const res = desc.checkpointResolver({ postId: 'abc123' });
    expect(res.targetType).toBe('post_comments');
    expect(res.targetKey).toBe('abc123');
    expect(res.cursorField).toBe('after');
  });

  it('rejects missing required args', async () => {
    await expect(crawler.start({ action: 'subreddit', args: {} })).rejects.toThrow(PlatformError);
    await expect(crawler.start({ action: 'user', args: {} })).rejects.toThrow(PlatformError);
    await expect(crawler.start({ action: 'search', args: {} })).rejects.toThrow(PlatformError);
    await expect(crawler.start({ action: 'post_comments', args: {} })).rejects.toThrow(PlatformError);
    await expect(crawler.start({ action: 'subreddit_info', args: {} })).rejects.toThrow(PlatformError);
  });

  it('subreddit action returns PostItem[] with pageInfo', async () => {
    const result = await crawler.start({ action: 'subreddit', args: { name: 'programming', limit: 5 } });
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('pageInfo');
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts[0].platform).toBe('reddit');
    expect(result.posts[0].id).toContain('reddit:');
    expect(result.pageInfo.end_cursor).toBe('t3_next');
    expect(result.pageInfo.has_next_page).toBe(true);
  });

  it('user action returns ProfileItem and PostItem[]', async () => {
    const result = await crawler.start({ action: 'user', args: { username: 'spez', limit: 5 } });
    expect(result).toHaveProperty('profile');
    expect(result).toHaveProperty('posts');
    expect(result.profile.platform).toBe('reddit');
    expect(result.profile.username).toBe('spez');
    expect(Array.isArray(result.posts)).toBe(true);
  });

  it('search action returns PostItem[] with pageInfo', async () => {
    const result = await crawler.start({ action: 'search', args: { query: 'test', limit: 5 } });
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('pageInfo');
    expect(result.posts[0].platform).toBe('reddit');
    expect(result.pageInfo.end_cursor).toBe('t3_searchnext');
  });

  it('post_comments action returns CommentItem[]', async () => {
    const result = await crawler.start({ action: 'post_comments', args: { postId: 'post123', subreddit: 'test' } });
    expect(result).toHaveProperty('comments');
    expect(result).toHaveProperty('pageInfo');
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments[0].platform).toBe('reddit');
    expect(result.comments[0].content).toBe('Nice post');
  });

  it('subreddit_info action returns PostItem with isCommunity', async () => {
    const result = await crawler.start({ action: 'subreddit_info', args: { name: 'test' } });
    expect(result.platform).toBe('reddit');
    expect(result.metadata.isCommunity).toBe(true);
    expect(result.metadata.displayName).toBe('test');
    expect(result.likesCount).toBe(1000);
  });

  it('supports postId as URL', async () => {
    const result = await crawler.start({
      action: 'post_comments',
      args: { url: 'https://www.reddit.com/r/test/comments/post123/title/' },
    });
    expect(result.comments[0].platform).toBe('reddit');
  });

  it('supports subreddit arg for post_comments', async () => {
    const result = await crawler.start({
      action: 'post_comments',
      args: { postId: 'post123', subreddit: 'test' },
    });
    expect(result.comments.length).toBe(1);
  });

  it('supports postId without subreddit for direct /comments lookup', async () => {
    const directServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/comments/post123')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_post123',
                    id: 'post123',
                    subreddit: 'test',
                    author: 'poster',
                    title: 'Post',
                    score: 50,
                    num_comments: 1,
                    created_utc: 1700000000,
                  },
                },
              ],
            },
          },
          {
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't1',
                  data: {
                    name: 't1_comment1',
                    id: 'comment1',
                    link_id: 't3_post123',
                    parent_id: 't3_post123',
                    author: 'commenter',
                    body: 'Direct lookup',
                    score: 15,
                    created_utc: 1700000100,
                    subreddit: 'test',
                  },
                },
              ],
              after: null,
            },
          },
        ]));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise((resolve) => directServer.listen(0, '127.0.0.1', resolve));
    const directUrl = `http://127.0.0.1:${directServer.address().port}`;
    const directClient = new RedditClient({ baseUrl: directUrl });
    const directCrawler = new RedditCrawler({ client: directClient });

    const result = await directCrawler.start({
      action: 'post_comments',
      args: { postId: 'post123' },
    });
    expect(result.comments.length).toBe(1);
    expect(result.comments[0].content).toBe('Direct lookup');
    await new Promise((resolve) => directServer.close(resolve));
  });

  it('stops pagination when all items already exist', async () => {
    const store = {
      storeBatch: async (posts) => ({ insertedCount: 0, totalCount: posts.length }),
      findExistingIds: async (ids) => ids,
    };
    const client = new RedditClient({ baseUrl: serverUrl });
    const c = new RedditCrawler({ client, store });
    const result = await c.start({ action: 'subreddit', args: { name: 'programming', limit: 5 } });
    expect(result.posts.length).toBe(1);
    expect(result.pageInfo.has_next_page).toBe(false);
  });
});
