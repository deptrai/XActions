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
 * Story 13.2.8 — Twitter Hybrid Engagement (Like & Retweet)
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 13.2.8 — Twitter Hybrid Engagement (Like & Retweet)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-engagement-user', {
    accountId: 'twitter-engagement-user',
    cookies: 'auth_token=eng_token; ct0=csrf_eng',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-engagement-user'], {
    credentials: {
      'twitter-engagement-user': { cookies: 'auth_token=eng_token; ct0=csrf_eng' },
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

        // FavoriteTweet
        if (url.pathname.includes('/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet')) {
          if (variables.tweet_id === '1111111111111111111') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'You have already favorited this Tweet.', code: 139 }] }));
            return;
          }
          if (variables.tweet_id === '9999999999999999999') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'No status found with that ID.', code: 144 }] }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { favorite_tweet: 'DONE' } }));
          return;
        }

        // UnfavoriteTweet
        if (url.pathname.includes('/ZYKSe-w7KEslx3JhSIk5LA/UnfavoriteTweet')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { unfavorite_tweet: 'DONE' } }));
          return;
        }

        // CreateRetweet
        if (url.pathname.includes('/mbRO74GrOvSfRcJnlMapnQ/CreateRetweet')) {
          if (variables.tweet_id === '2222222222222222222') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'You have already retweeted this Tweet.', code: 327 }] }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { create_retweet: { retweets_result: { rest_id: '123' } } } }));
          return;
        }

        // DeleteRetweet
        if (url.pathname.includes('/ZyZigVsNiFO6v1dEks1eWg/DeleteRetweet')) {
          if (variables.source_tweet_id === '3333333333333333333') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: 'Tweet not found in list of retweets.', code: 144 }] }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { delete_retweet: { unretweet_results: { rest_id: '123' } } } }));
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

  it('registers like, unlike, retweet, and undo_retweet actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const like = actions.find((a) => a.action === 'like');
    const unlike = actions.find((a) => a.action === 'unlike');
    const retweet = actions.find((a) => a.action === 'retweet');
    const undoRetweet = actions.find((a) => a.action === 'undo_retweet');

    expect(like).toBeTruthy();
    expect(like?.requiredArgs).toEqual(['tweetId']);
    expect(like?.optionalArgs).toEqual(['dryRun']);
    expect(like?.outputType).toBe('{ success: boolean }');
    expect(like?.category).toBe('social');
    expect(like?.requiresAuth).toBe(true);

    expect(unlike).toBeTruthy();
    expect(unlike?.requiredArgs).toEqual(['tweetId']);
    expect(unlike?.optionalArgs).toEqual(['dryRun']);
    expect(unlike?.outputType).toBe('{ success: boolean }');
    expect(unlike?.category).toBe('social');
    expect(unlike?.requiresAuth).toBe(true);

    expect(retweet).toBeTruthy();
    expect(retweet?.requiredArgs).toEqual(['tweetId']);
    expect(retweet?.optionalArgs).toEqual(['dryRun']);
    expect(retweet?.outputType).toBe('{ success: boolean }');
    expect(retweet?.category).toBe('social');
    expect(retweet?.requiresAuth).toBe(true);

    expect(undoRetweet).toBeTruthy();
    expect(undoRetweet?.requiredArgs).toEqual(['tweetId']);
    expect(undoRetweet?.optionalArgs).toEqual(['dryRun']);
    expect(undoRetweet?.outputType).toBe('{ success: boolean }');
    expect(undoRetweet?.category).toBe('social');
    expect(undoRetweet?.requiresAuth).toBe(true);
  });

  it('like sends FavoriteTweet GraphQL mutation with valid variables', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'like',
      args: { tweetId: '1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/lI07N6Otwv1PhnEgXILM7A\/FavoriteTweet/);
    expect(receivedRequests[0].variables).toEqual({ tweet_id: '1900000000000000000' });
  });

  it('like accepts tweet URL and normalizes ID', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'like',
      args: { tweetId: 'https://x.com/elonmusk/status/1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].variables).toEqual({ tweet_id: '1900000000000000000' });
  });

  it('unlike sends UnfavoriteTweet GraphQL mutation with valid variables', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'unlike',
      args: { tweetId: '1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/ZYKSe-w7KEslx3JhSIk5LA\/UnfavoriteTweet/);
    expect(receivedRequests[0].variables).toEqual({ tweet_id: '1900000000000000000' });
  });

  it('retweet sends CreateRetweet GraphQL mutation with dark_request false', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'retweet',
      args: { tweetId: '1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/mbRO74GrOvSfRcJnlMapnQ\/CreateRetweet/);
    expect(receivedRequests[0].variables).toEqual({ tweet_id: '1900000000000000000', dark_request: false });
  });

  it('undo_retweet sends DeleteRetweet GraphQL mutation with source_tweet_id', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'undo_retweet',
      args: { tweetId: '1900000000000000000', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(result).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/ZyZigVsNiFO6v1dEks1eWg\/DeleteRetweet/);
    expect(receivedRequests[0].variables).toEqual({ source_tweet_id: '1900000000000000000', dark_request: false });
  });

  it('dry-run returns success true without making any network request', async () => {
    const { crawler } = buildCrawler();
    const resultLike = await crawler.start({
      action: 'like',
      args: { tweetId: '1900000000000000000' },
      session: { accountId: 'twitter-engagement-user' },
    });
    const resultRetweet = await crawler.start({
      action: 'retweet',
      args: { tweetId: '1900000000000000000', dryRun: true },
      session: { accountId: 'twitter-engagement-user' },
    });

    expect(resultLike).toEqual({ success: true });
    expect(resultRetweet).toEqual({ success: true });
    expect(receivedRequests).toHaveLength(0);
  });

  it('rejects invalid or empty tweetId with PlatformError', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'like',
        args: { tweetId: '' },
        session: { accountId: 'twitter-engagement-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'retweet',
        args: { tweetId: 'invalid-non-numeric' },
        session: { accountId: 'twitter-engagement-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('handles idempotent errors gracefully returning success true', async () => {
    const { crawler } = buildCrawler();

    // Already favorited
    const likeRes = await crawler.start({
      action: 'like',
      args: { tweetId: '1111111111111111111', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });
    expect(likeRes).toEqual({ success: true });

    // Already retweeted
    const retweetRes = await crawler.start({
      action: 'retweet',
      args: { tweetId: '2222222222222222222', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });
    expect(retweetRes).toEqual({ success: true });

    // Not found in retweets list
    const unretweetRes = await crawler.start({
      action: 'undo_retweet',
      args: { tweetId: '3333333333333333333', dryRun: false },
      session: { accountId: 'twitter-engagement-user' },
    });
    expect(unretweetRes).toEqual({ success: true });
  });

  it('throws PlatformError for non-idempotent GraphQL errors', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'like',
        args: { tweetId: '9999999999999999999', dryRun: false },
        session: { accountId: 'twitter-engagement-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('rejects when governor denies account request', async () => {
    const { crawler } = buildCrawler();
    const strictGovernor = new AdaptiveRateGovernor();
    vi.spyOn(strictGovernor, 'canAccountRequest').mockReturnValue(false);

    crawler.governor = strictGovernor;

    await expect(
      crawler.start({
        action: 'like',
        args: { tweetId: '1900000000000000000', dryRun: false },
        session: { accountId: 'twitter-engagement-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy engagement functions are marked deprecated in source', async () => {
    const scraperSource = await fs.readFile('src/client/Scraper.js', 'utf8');
    expect(scraperSource).toMatch(/@deprecated.*likeTweet/);
    expect(scraperSource).toMatch(/@deprecated.*unlikeTweet/);
    expect(scraperSource).toMatch(/@deprecated.*retweet/);
    expect(scraperSource).toMatch(/@deprecated.*unretweet/);

    const clientApiSource = await fs.readFile('src/client/api/tweets.js', 'utf8');
    expect(clientApiSource).toMatch(/@deprecated.*likeTweet/);
    expect(clientApiSource).toMatch(/@deprecated.*unlikeTweet/);
    expect(clientApiSource).toMatch(/@deprecated.*retweet/);
    expect(clientApiSource).toMatch(/@deprecated.*unretweet/);

    const httpEngagementSource = await fs.readFile('src/scrapers/twitter/http/engagement.js', 'utf8');
    expect(httpEngagementSource).toMatch(/@deprecated.*likeTweet/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unlikeTweet/);
    expect(httpEngagementSource).toMatch(/@deprecated.*retweet/);
    expect(httpEngagementSource).toMatch(/@deprecated.*unretweet/);

    const httpIndexSource = await fs.readFile('src/scrapers/twitter/http/index.js', 'utf8');
    expect(httpIndexSource).toMatch(/@deprecated.*likeTweet/);
  });

  it('deprecation plan mentions engagement mapping', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/likeTweet.*twitter:like|twitter:like.*likeTweet/);
    expect(plan).toMatch(/retweet.*twitter:retweet|twitter:retweet.*retweet/);
  });
});
