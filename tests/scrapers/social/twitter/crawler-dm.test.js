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
 * Story 13.2.10 — Twitter Hybrid Direct Messaging
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 13.2.10 — Twitter Hybrid Direct Messaging', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-dm-user', {
    accountId: 'twitter-dm-user',
    cookies: 'auth_token=dm_token; ct0=csrf_dm',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-dm-user'], {
    credentials: {
      'twitter-dm-user': { cookies: 'auth_token=dm_token; ct0=csrf_dm' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        }
        const queryVariables = url.searchParams.get('variables');
        const variables = payload.variables
          ? (typeof payload.variables === 'string' ? JSON.parse(payload.variables) : payload.variables)
          : (queryVariables ? JSON.parse(queryVariables) : {});
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          body: payload,
          variables,
        });

        // UserByScreenName
        if (url.pathname.includes('/Gb-d6r0vxPOADdG62OEBpQ/UserByScreenName')) {
          if (variables.screen_name === 'no_dm_user') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  result: {
                    __typename: 'User',
                    rest_id: '999999',
                    legacy: { screen_name: 'no_dm_user', can_dm: false },
                  },
                },
              },
            }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  __typename: 'User',
                  rest_id: '44196397',
                  legacy: { screen_name: variables.screen_name || 'elonmusk', can_dm: true },
                },
              },
            },
          }));
          return;
        }

        // REST DM Send (/1.1/dm/new2.json)
        if (url.pathname.includes('/1.1/dm/new2.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            event: {
              id: '1234567890_event',
              created_timestamp: '1725000000000',
              message_create: {
                target: { recipient_id: payload.recipient_ids?.[0] || '44196397' },
                message_data: { text: payload.text || 'hello' },
              },
            },
            entries: [
              {
                message: {
                  id: '1234567890_event',
                  time: '1725000000000',
                  message_data: { text: payload.text || 'hello' },
                },
              },
            ],
          }));
          return;
        }

        // REST DM Inbox (/1.1/dm/inbox_initial_state.json)
        if (url.pathname.includes('/1.1/dm/inbox_initial_state.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            inbox_initial_state: {
              conversations: {
                '44196397-123': {
                  conversation_id: '44196397-123',
                  type: 'ONE_TO_ONE',
                  unread_count: 0,
                  participants: [{ user_id: '44196397' }],
                },
              },
              entries: [
                {
                  message: {
                    conversation_id: '44196397-123',
                    id: 'msg-01',
                    time: '1725000000000',
                    message_data: { text: 'Hello from Elon', sender_id: '44196397' },
                  },
                },
              ],
              users: {
                '44196397': {
                  id: '44196397',
                  screen_name: 'elonmusk',
                  name: 'Elon Musk',
                  profile_image_url_https: 'https://pbs.twimg.com/avatar.jpg',
                },
              },
              cursor: 'next-inbox-cursor',
            },
          }));
          return;
        }

        // REST DM Conversation (/1.1/dm/conversation/)
        if (url.pathname.includes('/1.1/dm/conversation/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            conversation_timeline: {
              entries: [
                {
                  message: {
                    id: 'msg-01',
                    time: '1725000000000',
                    message_data: {
                      text: 'Hello there',
                      sender_id: '44196397',
                      recipient_id: '123',
                    },
                  },
                },
              ],
              users: {
                '44196397': {
                  id: '44196397',
                  screen_name: 'elonmusk',
                  name: 'Elon Musk',
                },
              },
              min_entry_id: 'cursor-min-id',
            },
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

  it('registers send_dm, dm_conversations, and dm_messages actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const sendDm = actions.find((a) => a.action === 'send_dm');
    const dmConversations = actions.find((a) => a.action === 'dm_conversations');
    const dmMessages = actions.find((a) => a.action === 'dm_messages');

    expect(sendDm).toBeTruthy();
    expect(sendDm?.category).toBe('social');
    expect(sendDm?.requiresAuth).toBe(true);

    expect(dmConversations).toBeTruthy();
    expect(dmConversations?.category).toBe('social');
    expect(dmConversations?.requiresAuth).toBe(true);

    expect(dmMessages).toBeTruthy();
    expect(dmMessages?.category).toBe('social');
    expect(dmMessages?.requiresAuth).toBe(true);
    expect(dmMessages?.requiredArgs).toEqual(['conversationId']);
  });

  it('send_dm sends message via REST dm/new2.json and returns message details', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'send_dm',
      args: { userId: '44196397', text: 'Hello Elon', dryRun: false },
      session: { accountId: 'twitter-dm-user' },
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('messageId', '1234567890_event');
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/dm\/new2\.json/);
    expect(receivedRequests[0].body.text).toBe('Hello Elon');
    expect(receivedRequests[0].body.recipient_ids).toEqual(['44196397']);
  });

  it('send_dm with username checks can_dm and rejects when not allowed', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'send_dm',
        args: { username: 'no_dm_user', text: 'Hello', dryRun: false },
        session: { accountId: 'twitter-dm-user' },
      })
    ).rejects.toMatchObject({
      code: 'TWITTER_DM_NOT_ALLOWED',
      statusCode: 403,
    });
  });

  it('send_dm dry-run returns success true without making network request', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'send_dm',
      args: { userId: '44196397', text: 'Dry run message' },
      session: { accountId: 'twitter-dm-user' },
    });

    expect(result).toEqual({ success: true, dryRun: true });
    expect(receivedRequests).toHaveLength(0);
  });

  it('dm_conversations retrieves inbox conversations list', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'dm_conversations',
      args: { limit: 20 },
      session: { accountId: 'twitter-dm-user' },
    });

    expect(result).toHaveProperty('conversations');
    expect(Array.isArray(result.conversations)).toBe(true);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      conversationId: '44196397-123',
      type: 'one_to_one',
      lastMessage: { text: 'Hello from Elon' },
    });
    expect(result.conversations[0].participants[0]).toMatchObject({
      id: '44196397',
      username: 'elonmusk',
    });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/dm\/inbox_initial_state\.json/);
  });

  it('dm_messages retrieves messages in a conversation', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'dm_messages',
      args: { conversationId: '44196397-123', limit: 50 },
      session: { accountId: 'twitter-dm-user' },
    });

    expect(result).toHaveProperty('messages');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'msg-01',
      text: 'Hello there',
      senderId: '44196397',
    });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].path).toMatch(/\/1\.1\/dm\/conversation\/44196397-123\.json/);
  });

  it('rejects missing or empty arguments with PlatformError', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'send_dm',
        args: { text: 'No recipient' },
        session: { accountId: 'twitter-dm-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'send_dm',
        args: { userId: '44196397', text: '' },
        session: { accountId: 'twitter-dm-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);

    await expect(
      crawler.start({
        action: 'dm_messages',
        args: {},
        session: { accountId: 'twitter-dm-user' },
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
        action: 'send_dm',
        args: { userId: '44196397', text: 'Blocked by governor', dryRun: false },
        session: { accountId: 'twitter-dm-user' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('legacy direct messaging functions are marked deprecated in source', async () => {
    const scraperSource = await fs.readFile('src/client/Scraper.js', 'utf8');
    expect(scraperSource).toMatch(/@deprecated.*sendDm/);
    expect(scraperSource).toMatch(/@deprecated.*sendDmToUser/);
    expect(scraperSource).toMatch(/@deprecated.*getDmConversations/);
    expect(scraperSource).toMatch(/@deprecated.*getDmMessages/);

    const clientDmsSource = await fs.readFile('src/client/api/dms.js', 'utf8');
    expect(clientDmsSource).toMatch(/@deprecated.*sendDm/);
    expect(clientDmsSource).toMatch(/@deprecated.*sendDmToUser/);
    expect(clientDmsSource).toMatch(/@deprecated.*getDmConversations/);
    expect(clientDmsSource).toMatch(/@deprecated.*getDmMessages/);

    const httpDmSource = await fs.readFile('src/scrapers/twitter/http/dm.js', 'utf8');
    expect(httpDmSource).toMatch(/@deprecated.*sendDM/);
    expect(httpDmSource).toMatch(/@deprecated.*getInbox/);
    expect(httpDmSource).toMatch(/@deprecated.*getConversation/);
  });

  it('deprecation plan mentions direct messaging mapping', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/sendDm.*twitter:send_dm|twitter:send_dm.*sendDm/);
    expect(plan).toMatch(/getDmConversations.*twitter:dm_conversations|twitter:dm_conversations.*getDmConversations/);
  });
});
