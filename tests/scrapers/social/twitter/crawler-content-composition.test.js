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
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';

/**
 * Story 13.2.6 — Twitter Hybrid Content Composition (Post, Reply, Quote)
 * Red-phase acceptance test scaffold (TDD).
 */

describe('Story 13.2.6 — Twitter Hybrid Content Composition (Post, Reply, Quote)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-write-user', {
    accountId: 'twitter-write-user',
    cookies: 'auth_token=write_token; ct0=csrf_write',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-write-user'], {
    credentials: {
      'twitter-write-user': { cookies: 'auth_token=write_token; ct0=csrf_write' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  const createTweetResponse = (tweetId, text, context = {}) => ({
    data: {
      create_tweet: {
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: tweetId,
            legacy: {
              id_str: tweetId,
              full_text: text,
              created_at: 'Sat Aug 30 12:00:00 +0000 2024',
            },
          },
        },
      },
    },
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        const variables = payload.variables ? JSON.parse(payload.variables) : {};
        receivedRequests.push({ method: req.method, path: url.pathname, search: url.search, body: payload, variables });

        if (url.pathname.includes('/SiM_cAu83R0wnrpmKQQSEw/CreateTweet')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(createTweetResponse('new-tweet-123', variables.tweet_text, variables)));
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
    // Default governor allows
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

  it('registers post, reply, and quote actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const post = actions.find((a) => a.action === 'post');
    const reply = actions.find((a) => a.action === 'reply');
    const quote = actions.find((a) => a.action === 'quote');

    expect(post).toBeTruthy();
    expect(post?.requiredArgs).toEqual(['text']);
    expect(post?.optionalArgs).toEqual(['mediaIds', 'premium', 'sensitive', 'dryRun']);
    expect(post?.requiresAuth).toBe(true);

    expect(reply).toBeTruthy();
    expect(reply?.requiredArgs).toEqual(['tweetId', 'text']);
    expect(reply?.optionalArgs).toEqual(['mediaIds', 'premium', 'sensitive', 'dryRun']);
    expect(reply?.requiresAuth).toBe(true);

    expect(quote).toBeTruthy();
    expect(quote?.requiredArgs).toEqual(['tweetId', 'text']);
    expect(quote?.optionalArgs).toEqual(['mediaIds', 'premium', 'sensitive', 'dryRun']);
    expect(quote?.requiresAuth).toBe(true);
  });

  it('post creates a tweet and returns PostItem with sourceMethod post', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'post',
      args: { text: 'Hello XActions', dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result).toHaveProperty('tweet');
    expect(result.tweet.id).toBe('twitter:new-tweet-123');
    expect(result.tweet.platform).toBe('twitter');
    expect(result.tweet.content).toBe('Hello XActions');
    expect(result.tweet.metadata).toMatchObject({ sourceMethod: 'post', tweetId: 'new-tweet-123' });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/SiM_cAu83R0wnrpmKQQSEw\/CreateTweet/);
  });

  it('post dry-run returns a PostItem without calling the API', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'post',
      args: { text: 'Dry run only' },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result).toHaveProperty('tweet');
    expect(result.tweet).toMatchObject({
      platform: 'twitter',
      category: 'social',
      content: 'Dry run only',
    });
    expect(result.tweet.metadata).toMatchObject({ dryRun: true, sourceMethod: 'post' });

    expect(receivedRequests).toHaveLength(0);
  });

  it('post rejects empty text', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'post',
        args: { text: '' },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('reply creates a reply and includes in_reply_to_tweet_id', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'reply',
      args: { tweetId: 'https://x.com/elonmusk/status/1900000000000000000', text: 'Nice one', dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result.tweet).toBeTruthy();
    expect(result.tweet.metadata).toMatchObject({
      sourceMethod: 'reply',
      replyToTweetId: '1900000000000000000',
    });

    expect(receivedRequests).toHaveLength(1);
    const body = receivedRequests[0].body || '{}';
    const variables = body.variables ? JSON.parse(body.variables) : {};
    expect(variables.reply).toMatchObject({
      in_reply_to_tweet_id: '1900000000000000000',
      exclude_reply_user_ids: [],
    });
  });

  it('quote creates a quote tweet and includes attachment_url', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'quote',
      args: { tweetId: '1900000000000000000', text: 'Agree', dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result.tweet).toBeTruthy();
    expect(result.tweet.metadata).toMatchObject({
      sourceMethod: 'quote',
      quotedTweetId: '1900000000000000000',
    });

    expect(receivedRequests).toHaveLength(1);
    const body = receivedRequests[0].body || '{}';
    const variables = body.variables ? JSON.parse(body.variables) : {};
    expect(variables.attachment_url).toBe('https://x.com/i/status/1900000000000000000');
  });

  it('rejects when governor denies account request', async () => {
    const { crawler } = buildCrawler();
    const strictGovernor = new AdaptiveRateGovernor();
    vi.spyOn(strictGovernor, 'canAccountRequest').mockReturnValue(false);

    // Replace governor on crawler
    crawler.governor = strictGovernor;

    await expect(
      crawler.start({
        action: 'post',
        args: { text: 'Should fail', dryRun: false },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy functions are marked deprecated in source', async () => {
    const scraperSource = await fs.readFile('src/client/Scraper.js', 'utf8');
    expect(scraperSource).toMatch(/@deprecated.*sendTweet/);
    expect(scraperSource).toMatch(/@deprecated.*sendQuoteTweet/);

    const actionsSource = await fs.readFile('src/scrapers/twitter/http/actions.js', 'utf8');
    expect(actionsSource).toMatch(/@deprecated.*postTweet/);
    expect(actionsSource).toMatch(/@deprecated.*postThread/);
    expect(actionsSource).toMatch(/@deprecated.*replyToTweet/);
    expect(actionsSource).toMatch(/@deprecated.*quoteTweet/);
    expect(actionsSource).toMatch(/@deprecated.*schedulePost/);
  });
});
