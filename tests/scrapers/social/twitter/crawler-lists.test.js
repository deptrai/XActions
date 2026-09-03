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
 * Story 13.2.11 — Twitter Hybrid List Management
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 13.2.11 — Twitter Hybrid List Management', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-list-user', {
    accountId: 'twitter-list-user',
    cookies: 'auth_token=list_token; ct0=csrf_list',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-list-user'], {
    credentials: {
      'twitter-list-user': { cookies: 'auth_token=list_token; ct0=csrf_list' },
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
        const variables = payload.variables ? (typeof payload.variables === 'string' ? JSON.parse(payload.variables) : payload.variables) : {};
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          body: payload,
          variables,
        });

        // UserByScreenName
        if (url.pathname.includes('/Gb-d6r0vxPOADdG62OEBpQ/UserByScreenName')) {
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

        // REST /1.1/lists/create.json
        if (url.pathname.includes('/1.1/lists/create.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id_str: '987654321',
            name: payload.name,
            description: payload.description,
            mode: payload.mode || 'public',
            member_count: 0,
            subscriber_count: 0,
          }));
          return;
        }

        // REST /1.1/lists/members/create_all.json
        if (url.pathname.includes('/1.1/lists/members/create_all.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id_str: payload.list_id,
            member_count: payload.user_id ? payload.user_id.split(',').length : 1,
          }));
          return;
        }

        // REST /1.1/lists/members/destroy_all.json
        if (url.pathname.includes('/1.1/lists/members/destroy_all.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id_str: payload.list_id,
            member_count: 0,
          }));
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

  it('registers create_list, add_list_members, and remove_list_members actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const createList = actions.find((a) => a.action === 'create_list');
    const addListMembers = actions.find((a) => a.action === 'add_list_members');
    const removeListMembers = actions.find((a) => a.action === 'remove_list_members');

    expect(createList).toBeTruthy();
    expect(createList?.category).toBe('social');
    expect(createList?.requiresAuth).toBe(true);
    expect(createList?.requiredArgs).toEqual(['name']);

    expect(addListMembers).toBeTruthy();
    expect(addListMembers?.category).toBe('social');
    expect(addListMembers?.requiresAuth).toBe(true);
    expect(addListMembers?.requiredArgs).toEqual(['listId']);

    expect(removeListMembers).toBeTruthy();
    expect(removeListMembers?.category).toBe('social');
    expect(removeListMembers?.requiresAuth).toBe(true);
    expect(removeListMembers?.requiredArgs).toEqual(['listId']);
  });

  it('create_list creates list via REST /1.1/lists/create.json', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'create_list',
      args: { name: 'Tech Leaders', description: 'Curated list', isPrivate: true, dryRun: false },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toMatchObject({
      success: true,
      listId: '987654321',
      name: 'Tech Leaders',
      isPrivate: true,
    });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/lists\/create\.json/);
    expect(receivedRequests[0].body).toMatchObject({
      name: 'Tech Leaders',
      description: 'Curated list',
      mode: 'private',
    });
  });

  it('add_list_members batches userIds and sends REST create_all.json', async () => {
    const { crawler } = buildCrawler();
    // 150 users => 2 batches (100 + 50)
    const userIds = Array.from({ length: 150 }, (_, i) => `user_${i}`);
    const result = await crawler.start({
      action: 'add_list_members',
      args: { listId: '987654321', userIds, dryRun: false },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toMatchObject({
      success: true,
      listId: '987654321',
      addedCount: 150,
      batchCount: 2,
    });
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/lists\/members\/create_all\.json/);
    expect(receivedRequests[0].body.list_id).toBe('987654321');
    expect(receivedRequests[0].body.user_id.split(',')).toHaveLength(100);
    expect(receivedRequests[1].body.user_id.split(',')).toHaveLength(50);
  });

  it('add_list_members resolves usernames to userIds before dispatching', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'add_list_members',
      args: { listId: '987654321', usernames: ['elonmusk'], dryRun: false },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toMatchObject({
      success: true,
      listId: '987654321',
      addedCount: 1,
      batchCount: 1,
    });
    expect(receivedRequests[0].path).toMatch(/\/UserByScreenName/);
    expect(receivedRequests[1].path).toMatch(/\/1\.1\/lists\/members\/create_all\.json/);
    expect(receivedRequests[1].body.user_id).toBe('44196397');
  });

  it('remove_list_members sends destroy_all.json requests', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'remove_list_members',
      args: { listId: '987654321', userIds: ['44196397'], dryRun: false },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toMatchObject({
      success: true,
      listId: '987654321',
      removedCount: 1,
      batchCount: 1,
    });
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/lists\/members\/destroy_all\.json/);
    expect(receivedRequests[0].body.user_id).toBe('44196397');
  });

  it('dry-run returns simulated response without calling network', async () => {
    const { crawler } = buildCrawler();
    const resCreate = await crawler.start({
      action: 'create_list',
      args: { name: 'Simulated List' },
      session: { accountId: 'twitter-list-user' },
    });
    const resAdd = await crawler.start({
      action: 'add_list_members',
      args: { listId: '987654321', userIds: ['123'], dryRun: true },
      session: { accountId: 'twitter-list-user' },
    });

    expect(resCreate).toEqual({ success: true, dryRun: true });
    expect(resAdd).toEqual({ success: true, dryRun: true, listId: '987654321', count: 1 });
    expect(receivedRequests).toHaveLength(0);
  });

  it('rejects invalid or missing arguments with PlatformError', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'create_list',
        args: { name: '' },
        session: { accountId: 'twitter-list-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'create_list',
        args: { name: 'A'.repeat(30) },
        session: { accountId: 'twitter-list-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'add_list_members',
        args: {},
        session: { accountId: 'twitter-list-user' },
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
        action: 'create_list',
        args: { name: 'Denied List', dryRun: false },
        session: { accountId: 'twitter-list-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy list functions are marked deprecated in source', async () => {
    const scraperSource = await fs.readFile('src/client/Scraper.js', 'utf8');
    expect(scraperSource).toMatch(/@deprecated.*getListTweets/);
    expect(scraperSource).toMatch(/@deprecated.*getListMembers/);
    expect(scraperSource).toMatch(/@deprecated.*getListById/);

    const clientListsSource = await fs.readFile('src/client/api/lists.js', 'utf8');
    expect(clientListsSource).toMatch(/@deprecated.*getListTweets/);
    expect(clientListsSource).toMatch(/@deprecated.*getListMembers/);
    expect(clientListsSource).toMatch(/@deprecated.*getListById/);
  });

  it('deprecation plan mentions list management mapping', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/getListMembers.*twitter:list_members|twitter:list_members.*getListMembers/);
  });
});
