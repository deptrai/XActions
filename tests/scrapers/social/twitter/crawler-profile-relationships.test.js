// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { TwitterCrawler } from '../../../../src/scrapers/social/twitter/crawler.js';
import { TwitterClient } from '../../../../src/scrapers/social/twitter/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';

describe('Story 13.2.1 — Twitter Hybrid Profile & Relationships', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
        });

        // UserByScreenName endpoint
        if (url.pathname.includes('UserByScreenName')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  __typename: 'User',
                  rest_id: '44196397',
                  is_blue_verified: true,
                  legacy: {
                    screen_name: 'elonmusk',
                    name: 'Elon Musk',
                    description: 'Technoking of Tesla',
                    followers_count: 200000000,
                    friends_count: 1000,
                    statuses_count: 50000,
                    favourites_count: 30000,
                    media_count: 5000,
                    location: 'Austin, TX',
                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/normal.jpg',
                    profile_banner_url: 'https://pbs.twimg.com/profile_banners/banner.jpg',
                    created_at: 'Tue Jun 02 20:12:29 +0000 2009',
                    verified: true,
                    protected: false,
                  },
                },
              },
            },
          }));
          return;
        }

        // Followers endpoint
        if (url.pathname.includes('Followers')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [
                        {
                          type: 'TimelineAddEntries',
                          entries: [
                            {
                              entryId: 'user-111111',
                              content: {
                                itemContent: {
                                  user_results: {
                                    result: {
                                      __typename: 'User',
                                      rest_id: '111111',
                                      legacy: {
                                        screen_name: 'follower_user',
                                        name: 'Follower One',
                                        description: 'I follow you',
                                        followers_count: 100,
                                        friends_count: 200,
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            {
                              entryId: 'cursor-bottom-12345',
                              content: {
                                cursorType: 'Bottom',
                                value: 'next_cursor_followers_123',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          }));
          return;
        }

        // Following endpoint
        if (url.pathname.includes('Following')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [
                        {
                          type: 'TimelineAddEntries',
                          entries: [
                            {
                              entryId: 'user-222222',
                              content: {
                                itemContent: {
                                  user_results: {
                                    result: {
                                      __typename: 'User',
                                      rest_id: '222222',
                                      legacy: {
                                        screen_name: 'following_user',
                                        name: 'Following One',
                                        description: 'You follow me',
                                        followers_count: 500,
                                        friends_count: 50,
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            {
                              entryId: 'cursor-bottom-67890',
                              content: {
                                cursorType: 'Bottom',
                                value: 'next_cursor_following_678',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          }));
          return;
        }

        // Retweeters endpoint
        if (url.pathname.includes('Retweeters')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              retweeters_timeline: {
                timeline: {
                  instructions: [
                    {
                      type: 'TimelineAddEntries',
                      entries: [
                        {
                          entryId: 'user-333333',
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  __typename: 'User',
                                  rest_id: '333333',
                                  legacy: {
                                    screen_name: 'retweeter_user',
                                    name: 'Retweeter One',
                                  },
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  const createCrawler = () => {
    const client = new TwitterClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new TwitterCrawler({
      client,
      requiresProxy: false,
    });
    return { client, crawler };
  };

  const dummySession = { accountId: 'test_twitter_acc', cookies: { auth_token: 'dummy', ct0: 'dummy' } };

  it('TwitterCrawler and TwitterClient inherit base contracts', () => {
    const { client, crawler } = createCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.platform).toBe('twitter');
  });

  it('registers profile, followers, following, retweeters, and non_followers actions', () => {
    const { crawler } = createCrawler();
    const actions = crawler.listActions();

    const profileAction = actions.find((a) => a.action === 'profile');
    const followersAction = actions.find((a) => a.action === 'followers');
    const followingAction = actions.find((a) => a.action === 'following');
    const retweetersAction = actions.find((a) => a.action === 'retweeters');
    const nonFollowersAction = actions.find((a) => a.action === 'non_followers');

    expect(profileAction).toBeTruthy();
    expect(profileAction?.requiresAuth).toBe(false);

    expect(followersAction).toBeTruthy();
    expect(followersAction?.requiredArgs).toContain('username');

    expect(followingAction).toBeTruthy();
    expect(followingAction?.requiredArgs).toContain('username');

    expect(retweetersAction).toBeTruthy();
    expect(retweetersAction?.requiredArgs).toContain('tweetId');

    expect(nonFollowersAction).toBeTruthy();
    expect(nonFollowersAction?.requiredArgs).toContain('username');
  });

  it('profile action fetches and normalizes user profile', async () => {
    const { crawler } = createCrawler();
    const result = await crawler.start({
      action: 'profile',
      args: { username: 'elonmusk' },
    });

    expect(result).toHaveProperty('profile');
    expect(result.profile.username).toBe('elonmusk');
    expect(result.profile.name).toBe('Elon Musk');
    expect(result.profile.id).toBe('twitter:44196397');
    expect(result.profile.externalId).toBe('44196397');
    expect(result.profile.followersCount).toBe(200000000);
  });

  it('followers action fetches followers list and returns pageInfo cursor', async () => {
    const { crawler } = createCrawler();
    const result = await crawler.start({
      action: 'followers',
      args: { username: 'elonmusk', limit: 20 },
      session: dummySession,
    });

    expect(result).toHaveProperty('followers');
    expect(Array.isArray(result.followers)).toBe(true);
    expect(result.followers).toHaveLength(1);
    expect(result.followers[0].username).toBe('follower_user');
    expect(result.followers[0].id).toBe('twitter:111111');
    expect(result.pageInfo.end_cursor).toBe('next_cursor_followers_123');
  });

  it('following action fetches following list and returns pageInfo cursor', async () => {
    const { crawler } = createCrawler();
    const result = await crawler.start({
      action: 'following',
      args: { username: 'elonmusk', limit: 20 },
      session: dummySession,
    });

    expect(result).toHaveProperty('following');
    expect(Array.isArray(result.following)).toBe(true);
    expect(result.following).toHaveLength(1);
    expect(result.following[0].username).toBe('following_user');
    expect(result.following[0].id).toBe('twitter:222222');
  });

  it('retweeters action fetches retweeters list', async () => {
    const { crawler } = createCrawler();
    const result = await crawler.start({
      action: 'retweeters',
      args: { tweetId: '1234567890' },
      session: dummySession,
    });

    expect(result).toHaveProperty('retweeters');
    expect(result.retweeters).toHaveLength(1);
    expect(result.retweeters[0].username).toBe('retweeter_user');
  });

  it('non_followers action calculates difference between following and followers', async () => {
    const { crawler } = createCrawler();
    const result = await crawler.start({
      action: 'non_followers',
      args: { username: 'elonmusk', limit: 100 },
      session: dummySession,
    });

    expect(result).toHaveProperty('nonFollowers');
    expect(result).toHaveProperty('mutuals');
    expect(result).toHaveProperty('stats');
    expect(result.nonFollowers).toHaveLength(1);
    expect(result.nonFollowers[0].username).toBe('following_user');
    expect(result.stats.nonFollowersCount).toBe(1);
    expect(result.stats.mutualsCount).toBe(0);
  });
});
