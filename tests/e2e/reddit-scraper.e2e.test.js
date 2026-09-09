// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for Reddit Scraper (Story 35.1).
// by nichxbt

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
  scrape,
  createRedditClient,
  createRedditCrawler,
  RedditClient,
  RedditCrawler,
} from '../../src/scrapers/index.js';
import { defaultStore } from '../../src/store/store-with-redis.js';

describe('Story 35.1 — Reddit Scraper E2E Pipeline', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = createServer((req, res) => {
      // 1. OAuth2 Token endpoint
      if (req.url === '/api/v1/access_token' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'mock_reddit_oauth_token',
          token_type: 'bearer',
          expires_in: 3600,
        }));
        return;
      }

      // 2. Subreddit listing (.json or apiBaseUrl)
      if (req.url?.startsWith('/r/programming/new')) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '60',
        });
        res.end(JSON.stringify({
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  name: 't3_post123',
                  id: 'post123',
                  subreddit: 'programming',
                  author: 'dev_user',
                  title: 'E2E Test Reddit Post',
                  selftext: 'Deep dive into crawler architecture',
                  score: 150,
                  num_comments: 24,
                  created_utc: 1700000000,
                  permalink: '/r/programming/comments/post123/e2e_test/',
                  url: 'https://github.com/nirholas/XActions',
                  preview: {
                    images: [
                      {
                        source: { url: 'https://preview.redd.it/post123.jpg' },
                      },
                    ],
                  },
                },
              },
            ],
            after: 't3_post123',
          },
        }));
        return;
      }

      // 3. User Profile and Submitted Posts
      if (req.url?.startsWith('/user/spez/about')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          kind: 't2',
          data: {
            name: 'spez',
            fullname: 't2_spez_uid',
            id: 'spez_uid',
            link_karma: 50000,
            comment_karma: 100000,
            created_utc: 1120000000,
            subreddit: {
              public_description: 'Reddit CEO & Co-founder',
            },
          },
        }));
        return;
      }

      if (req.url?.startsWith('/user/spez/submitted')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  name: 't3_spez_post',
                  id: 'spez_post',
                  subreddit: 'announcements',
                  author: 'spez',
                  title: 'Reddit Updates',
                  selftext: 'Announcing new features',
                  score: 25000,
                  num_comments: 8000,
                  created_utc: 1700001000,
                  permalink: '/r/announcements/comments/spez_post/',
                },
              },
            ],
            after: null,
          },
        }));
        return;
      }

      // 4. Post Comments Thread (Post + Comments listing)
      if (req.url?.startsWith('/r/programming/comments/post123') || req.url?.startsWith('/comments/post123')) {
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
                    subreddit: 'programming',
                    author: 'dev_user',
                    title: 'E2E Test Reddit Post',
                    permalink: '/r/programming/comments/post123/e2e_test/',
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
                    author: 'reader_one',
                    body: 'Great architecture!',
                    score: 45,
                    created_utc: 1700000100,
                    replies: {
                      data: {
                        children: [
                          {
                            kind: 't1',
                            data: {
                              name: 't1_reply1',
                              id: 'reply1',
                              link_id: 't3_post123',
                              parent_id: 't1_comment1',
                              author: 'dev_user',
                              body: 'Thank you!',
                              score: 12,
                              created_utc: 1700000200,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
              after: null,
            },
          },
        ]));
        return;
      }

      // 5. Subreddit metadata
      if (req.url?.startsWith('/r/programming/about')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          kind: 't5',
          data: {
            name: 't5_programming',
            id: 'programming',
            display_name: 'programming',
            subscribers: 5600000,
            public_description: 'Computer Programming community',
            url: '/r/programming/',
            created_utc: 1200000000,
          },
        }));
        return;
      }

      // Default 404
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('verifies end-to-end Reddit subreddit post crawl via unified dispatcher', async () => {
    const result = await scrape('reddit', 'subreddit', {
      name: 'programming',
      limit: 10,
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
    });

    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('pageInfo');
    expect(result.posts).toHaveLength(1);

    const post = result.posts[0];
    expect(post.id).toBe('reddit:t3_post123');
    expect(post.platform).toBe('reddit');
    expect(post.category).toBe('social');
    expect(post.authorName).toBe('dev_user');
    expect(post.postUrl).toBe('https://www.reddit.com/r/programming/comments/post123/e2e_test/');
    expect(post.metadata.targetUrl).toBe('https://github.com/nirholas/XActions');
    expect(post.mediaUrls).toContain('https://preview.redd.it/post123.jpg');
    expect(post.likesCount).toBe(150);
    expect(post.repliesCount).toBe(24);
    expect(result.pageInfo.end_cursor).toBe('t3_post123');
  });

  it('verifies end-to-end Reddit user profile + post extraction', async () => {
    const result = await scrape('rdt', 'user', {
      username: 'spez',
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      redditUsername: 'pilot_agent',
    });

    expect(result).toHaveProperty('profile');
    expect(result).toHaveProperty('posts');

    const profile = result.profile;
    expect(profile.id).toBe('reddit:t2_spez_uid');
    expect(profile.platform).toBe('reddit');
    expect(profile.username).toBe('spez');
    expect(profile.followersCount).toBe(150000);
    expect(profile.bio).toBe('Reddit CEO & Co-founder');

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].id).toBe('reddit:t3_spez_post');
  });

  it('verifies end-to-end hierarchical comment thread extraction with parent integrity', async () => {
    const result = await scrape('reddit', 'post_comments', {
      postId: 'post123',
      subreddit: 'programming',
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
    });

    expect(result).toHaveProperty('comments');
    expect(result.comments).toHaveLength(2);

    const topComment = result.comments[0];
    expect(topComment.id).toBe('reddit:t3_post123:t1_comment1');
    expect(topComment.postId).toBe('reddit:t3_post123');
    expect(topComment.parentCommentId).toBeUndefined();
    expect(topComment.content).toBe('Great architecture!');

    const replyComment = result.comments[1];
    expect(replyComment.id).toBe('reddit:t3_post123:t1_reply1');
    expect(replyComment.postId).toBe('reddit:t3_post123');
    expect(replyComment.parentCommentId).toBe('reddit:t3_post123:t1_comment1');
    expect(replyComment.content).toBe('Thank you!');
  });

  it('verifies end-to-end subreddit community metadata extraction', async () => {
    const result = await scrape('reddit', 'subreddit_info', {
      name: 'programming',
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
    });

    expect(result.id).toBe('reddit:t5_programming');
    expect(result.platform).toBe('reddit');
    expect(result.metadata.isCommunity).toBe(true);
    expect(result.metadata.displayName).toBe('programming');
    expect(result.likesCount).toBe(5600000);
    expect(result.content).toBe('Computer Programming community');
  });

  it('verifies OAuth2 authenticated pipeline with auto-token refresh', async () => {
    const client = createRedditClient({
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      oauthUrl: `${serverUrl}/api/v1/access_token`,
      clientId: 'mock_client_id',
      clientSecret: 'mock_client_secret',
    });

    const crawler = createRedditCrawler({ client });
    const result = await crawler.start({
      action: 'subreddit',
      args: { name: 'programming', limit: 5 },
    });

    expect(client.accessToken).toBe('mock_reddit_oauth_token');
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].platform).toBe('reddit');
  });
});
