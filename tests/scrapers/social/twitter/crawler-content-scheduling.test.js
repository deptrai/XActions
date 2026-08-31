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
 * Story 13.2.7 — Twitter Hybrid Content Scheduling
 * Red-phase acceptance test scaffold (TDD).
 */

describe('Story 13.2.7 — Twitter Hybrid Content Scheduling', () => {
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

  const createScheduledTweetResponse = (scheduledId, text, executeAt) => ({
    data: {
      create_scheduled_tweet: {
        id: scheduledId,
        rest_id: scheduledId,
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: scheduledId,
            legacy: {
              id_str: scheduledId,
              full_text: text,
              created_at: 'Sat Aug 30 12:00:00 +0000 2024',
            },
          },
        },
      },
    },
  });

  const FUTURE_ISO = '2026-09-01T12:00:00.000Z';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        const variables = payload.variables ? JSON.parse(payload.variables) : {};
        receivedRequests.push({ method: req.method, path: url.pathname, search: url.search, body: payload, variables });

        if (url.pathname.includes('/LCVzRQGxOaGnOnYH01NQXg/CreateScheduledTweet')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(createScheduledTweetResponse('scheduled-123', variables.post_tweet_request?.status || '', variables.execute_at)));
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

  it('registers schedule action with correct descriptor', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const schedule = actions.find((a) => a.action === 'schedule');

    expect(schedule).toBeTruthy();
    expect(schedule?.requiredArgs).toEqual(['text', 'publishAt']);
    expect(schedule?.optionalArgs).toEqual(['mediaIds', 'premium', 'sensitive', 'dryRun']);
    expect(schedule?.outputType).toMatch(/PostItem/);
    expect(schedule?.requiresAuth).toBe(true);
  });

  it('schedule creates a scheduled tweet and returns PostItem with sourceMethod schedule', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'schedule',
      args: { text: 'Hello future', publishAt: FUTURE_ISO, dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result).toHaveProperty('tweet');
    expect(result.tweet.id).toBe('twitter:scheduled-123');
    expect(result.tweet.platform).toBe('twitter');
    expect(result.tweet.content).toBe('Hello future');
    expect(result.tweet.metadata).toMatchObject({
      sourceMethod: 'schedule',
      tweetId: 'scheduled-123',
      scheduledAt: FUTURE_ISO,
      scheduledTweetId: 'scheduled-123',
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/LCVzRQGxOaGnOnYH01NQXg\/CreateScheduledTweet/);
    const variables = receivedRequests[0].variables;
    expect(variables.post_tweet_request).toMatchObject({
      status: 'Hello future',
      auto_populate_reply_metadata: false,
      exclude_reply_user_ids: [],
      media_ids: [],
    });
    expect(variables.execute_at).toBe(Math.floor(new Date(FUTURE_ISO).getTime() / 1000));
  });

  it('schedule dry-run returns a PostItem without calling the API', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'schedule',
      args: { text: 'Dry run future', publishAt: FUTURE_ISO },
      session: { accountId: 'twitter-write-user' },
    });

    expect(result).toHaveProperty('tweet');
    expect(result.tweet).toMatchObject({
      platform: 'twitter',
      category: 'social',
      content: 'Dry run future',
    });
    expect(result.tweet.metadata).toMatchObject({
      dryRun: true,
      sourceMethod: 'schedule',
      scheduledAt: FUTURE_ISO,
    });
    expect(result.tweet.id).toMatch(/twitter:schedule-dryrun-/);

    expect(receivedRequests).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'schedule',
        args: { text: '', publishAt: FUTURE_ISO },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('rejects whitespace-only text', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'schedule',
        args: { text: '   ', publishAt: FUTURE_ISO },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('rejects past publishAt', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'schedule',
        args: { text: 'Past', publishAt: '2020-01-01T00:00:00Z' },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('rejects more than 4 media IDs', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'schedule',
        args: { text: 'Media', publishAt: FUTURE_ISO, mediaIds: ['1', '2', '3', '4', '5'] },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('converts publishAt Date to execute_at Unix seconds', async () => {
    const { crawler } = buildCrawler();
    const publishAt = new Date(FUTURE_ISO);
    await crawler.start({
      action: 'schedule',
      args: { text: 'Date input', publishAt, dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].variables.execute_at).toBe(Math.floor(publishAt.getTime() / 1000));
  });

  it('converts publishAt milliseconds to execute_at Unix seconds', async () => {
    const { crawler } = buildCrawler();
    const publishAt = new Date(FUTURE_ISO).getTime();
    await crawler.start({
      action: 'schedule',
      args: { text: 'Ms input', publishAt, dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].variables.execute_at).toBe(Math.floor(publishAt / 1000));
  });

  it('converts publishAt seconds to execute_at Unix seconds', async () => {
    const { crawler } = buildCrawler();
    const publishAt = Math.floor(new Date(FUTURE_ISO).getTime() / 1000);
    await crawler.start({
      action: 'schedule',
      args: { text: 'Seconds input', publishAt, dryRun: false },
      session: { accountId: 'twitter-write-user' },
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].variables.execute_at).toBe(publishAt);
  });

  it('rejects when governor denies account request', async () => {
    const { crawler } = buildCrawler();
    const strictGovernor = new AdaptiveRateGovernor();
    vi.spyOn(strictGovernor, 'canAccountRequest').mockReturnValue(false);

    crawler.governor = strictGovernor;

    await expect(
      crawler.start({
        action: 'schedule',
        args: { text: 'Should fail', publishAt: FUTURE_ISO, dryRun: false },
        session: { accountId: 'twitter-write-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy schedule functions are marked deprecated in source', async () => {
    const actionsSource = await fs.readFile('src/scrapers/twitter/http/actions.js', 'utf8');
    expect(actionsSource).toMatch(/@deprecated.*schedulePost/);

    const indexSource = await fs.readFile('src/scrapers/twitter/http/index.js', 'utf8');
    expect(indexSource).toMatch(/@deprecated.*schedulePost/);
  });

  it('deprecation plan mentions schedule mapping', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/schedulePost.*twitter:schedule|twitter:schedule.*schedulePost/);
  });
});
