// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import { TwitterCrawler } from '../../../../src/scrapers/social/twitter/crawler.js';
import { TwitterClient } from '../../../../src/scrapers/social/twitter/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

/**
 * Story 13.2.9 — Twitter Hybrid Social Graph (Follow, Block, Mute, Bookmark)
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 13.2.9 — Twitter Hybrid Social Graph (Follow, Block, Mute, Bookmark)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-social-user', {
    accountId: 'twitter-social-user',
    cookies: 'auth_token=soc_token; ct0=csrf_soc',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-social-user'], {
    credentials: {
      'twitter-social-user': { cookies: 'auth_token=soc_token; ct0=csrf_soc' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        const variables = payload.variables ? JSON.parse(payload.variables) : {};
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          body: payload,
          variables,
        });

        // UserByScreenName
        if (url.pathname.includes('/NimuplG1OB7Fd2btCLdBOw/UserByScreenName')) {
          if (variables.screen_name === 'unknown_user') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: { user: { result: { __typename: 'UserUnavailable' } } } }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  __typename: 'User',
                  rest_id: '44196397',
                  legacy: { screen_name: variables.screen_name || 'elonmusk' },
                },
              },
            },
          }));
          return;
        }

        // REST Follow (friendships/create)
        if (url.pathname.includes('/1.1/friendships/create.json')) {
          if (payload.user_id === '999999') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'You are already following this user.', code: 160 }] }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, following: true }));
          return;
        }

        // REST Unfollow (friendships/destroy)
        if (url.pathname.includes('/1.1/friendships/destroy.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, following: false }));
          return;
        }

        // REST Block (blocks/create)
        if (url.pathname.includes('/1.1/blocks/create.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, blocking: true }));
          return;
        }

        // REST Unblock (blocks/destroy)
        if (url.pathname.includes('/1.1/blocks/destroy.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, blocking: false }));
          return;
        }

        // REST Mute (mutes/users/create)
        if (url.pathname.includes('/1.1/mutes/users/create.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, muting: true }));
          return;
        }

        // REST Unmute (mutes/users/destroy)
        if (url.pathname.includes('/1.1/mutes/users/destroy.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: payload.user_id, muting: false }));
          return;
        }

        // CreateBookmark
        if (url.pathname.includes('/aoDbu3RHznuiSkQ9aNM67Q/CreateBookmark')) {
          if (variables.tweet_id === '8888888888888888888') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'You have already bookmarked this Tweet.', code: 139 }] }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { create_bookmark: 'DONE' } }));
          return;
        }

        // DeleteBookmark
        if (url.pathname.includes('/Wlmlj2-xzyS1GN3a6cj-mQ/DeleteBookmark')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { delete_bookmark: 'DONE' } }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ errors: [{ message: 'Not found' }] }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    receivedRequests = [];
    await cleanupTestDatabase();
    vi.restoreAllMocks();
  });

  const buildCrawler = () => {
    const client = new TwitterClient({
      baseUrl: serverUrl,
      governor,
      accountPool,
      sessionManager,
      requiresAuth: true,
    });
    const crawler = new TwitterCrawler({
      client,
      store: createStore(),
      redisPublisher: null,
    });
    return { client, crawler };
  };

  it('registers follow, unfollow, block, unblock, mute, unmute, bookmark, and unbookmark actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const actionNames = ['follow', 'unfollow', 'block', 'unblock', 'mute', 'unmute', 'bookmark', 'unbookmark'];

    for (const name of actionNames) {
      const act = actions.find((a) => a.action === name);
      expect(act).toBeTruthy();
      expect(act?.category).toBe('social');
      expect(act?.requiresAuth).toBe(true);
      expect(act?.outputType).toBe('{ success: boolean }');
    }

    const bookmark = actions.find((a) => a.action === 'bookmark');
    expect(bookmark?.requiredArgs).toEqual(['tweetId']);
    const unbookmark = actions.find((a) => a.action === 'unbookmark');
    expect(unbookmark?.requiredArgs).toEqual(['tweetId']);
  });

  it('follow with userId sends REST friendships/create request', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'follow',
      args: { userId: '44196397', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/friendships\/create\.json/);
    expect(receivedRequests[0].body.user_id).toBe('44196397');
  });

  it('follow with username resolves userId first then calls REST', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'follow',
      args: { username: 'elonmusk', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[0].path).toMatch(/\/UserByScreenName/);
    expect(receivedRequests[1].path).toMatch(/\/1\.1\/friendships\/create\.json/);
    expect(receivedRequests[1].body.user_id).toBe('44196397');
  });

  it('unfollow with username resolves userId first then calls REST friendships/destroy', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'unfollow',
      args: { username: 'https://x.com/elonmusk', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests[1].path).toMatch(/\/1\.1\/friendships\/destroy\.json/);
    expect(receivedRequests[1].body.user_id).toBe('44196397');
  });

  it('block and unblock actions send correct REST requests', async () => {
    const { crawler } = buildCrawler();
    await crawler.start({
      action: 'block',
      args: { userId: '12345', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/blocks\/create\.json/);

    await crawler.start({
      action: 'unblock',
      args: { userId: '12345', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(receivedRequests[1].path).toMatch(/\/1\.1\/blocks\/destroy\.json/);
  });

  it('mute and unmute actions send correct REST requests', async () => {
    const { crawler } = buildCrawler();
    await crawler.start({
      action: 'mute',
      args: { userId: '12345', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/mutes\/users\/create\.json/);

    await crawler.start({
      action: 'unmute',
      args: { userId: '12345', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(receivedRequests[1].path).toMatch(/\/1\.1\/mutes\/users\/destroy\.json/);
  });

  it('bookmark and unbookmark send GraphQL CreateBookmark and DeleteBookmark mutations', async () => {
    const { crawler } = buildCrawler();
    const resBookmark = await crawler.start({
      action: 'bookmark',
      args: { tweetId: 'https://x.com/user/status/1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(resBookmark).toEqual({ success: true });
    expect(receivedRequests[0].path).toMatch(/\/CreateBookmark/);
    expect(receivedRequests[0].variables).toEqual({ tweet_id: '1900000000000000000' });

    const resUnbookmark = await crawler.start({
      action: 'unbookmark',
      args: { tweetId: '1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(resUnbookmark).toEqual({ success: true });
    expect(receivedRequests[1].path).toMatch(/\/DeleteBookmark/);
    expect(receivedRequests[1].variables).toEqual({ tweet_id: '1900000000000000000' });
  });

  it('dry-run returns success true without making any network request', async () => {
    const { crawler } = buildCrawler();
    const resFollow = await crawler.start({
      action: 'follow',
      args: { userId: '44196397' },
      session: { accountId: 'twitter-social-user' },
    });
    const resBookmark = await crawler.start({
      action: 'bookmark',
      args: { tweetId: '1900000000000000000', dryRun: true },
      session: { accountId: 'twitter-social-user' },
    });

    expect(resFollow).toEqual({ success: true });
    expect(resBookmark).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(0);
  });

  it('rejects invalid or missing arguments with PlatformError', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'follow',
        args: {},
        session: { accountId: 'twitter-social-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'bookmark',
        args: { tweetId: '' },
        session: { accountId: 'twitter-social-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'follow',
        args: { username: 'unknown_user', dryRun: false },
        session: { accountId: 'twitter-social-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('handles idempotent errors gracefully returning success true', async () => {
    const { crawler } = buildCrawler();

    // Already following
    const followRes = await crawler.start({
      action: 'follow',
      args: { userId: '999999', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(followRes).toEqual({ success: true });

    // Already bookmarked
    const bookmarkRes = await crawler.start({
      action: 'bookmark',
      args: { tweetId: '8888888888888888888', dryRun: false },
      session: { accountId: 'twitter-social-user' },
    });
    expect(bookmarkRes).toEqual({ success: true });
  });

  it('rejects when governor denies account request', async () => {
    const { crawler } = buildCrawler();
    const strictGovernor = new AdaptiveRateGovernor();
    vi.spyOn(strictGovernor, 'canAccountRequest').mockReturnValue(false);

    crawler.governor = strictGovernor;

    await expect(
      crawler.start({
        action: 'follow',
        args: { userId: '44196397', dryRun: false },
        session: { accountId: 'twitter-social-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy social graph functions are marked deprecated in source', async () => {
    const scraperSource = await fs.readFile('src/client/Scraper.js', 'utf8');
    expect(scraperSource).toMatch(/@deprecated.*followUser/);
    expect(scraperSource).toMatch(/@deprecated.*unfollowUser/);

    const clientUsersSource = await fs.readFile('src/client/api/users.js', 'utf8');
    expect(clientUsersSource).toMatch(/@deprecated.*followUser/);
    expect(clientUsersSource).toMatch(/@deprecated.*unfollowUser/);

    const httpEngagementSource = await fs.readFile('src/scrapers/twitter/http/engagement.js', 'utf8');
    expect(httpEngagementSource).toMatch(/@deprecated.*followUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unfollowUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*blockUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unblockUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*muteUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unmuteUser/);
    expect(httpEngagementSource).toMatch(/@deprecated.*bookmarkTweet/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unbookmarkTweet/);
  });

  it('deprecation plan mentions social graph mapping', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/followUser.*twitter:follow|twitter:follow.*followUser/);
    expect(plan).toMatch(/bookmarkTweet.*twitter:bookmark|twitter:bookmark.*bookmarkTweet/);
  });
});
