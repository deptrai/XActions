// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
 * Story 13.2.5 — Twitter Hybrid Lists, Communities & Spaces
 * Red-phase acceptance test scaffold (TDD).
 */

describe('Story 13.2.5 — Twitter Hybrid Lists, Communities & Spaces', () => {
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

  const userMember = (id, username, name = 'Member User') => ({
    entryId: `user-${id}`,
    sortIndex: '0',
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineUser',
        user_results: {
          result: {
            __typename: 'User',
            rest_id: id,
            legacy: {
              screen_name: username,
              name,
              description: `Bio of ${username}`,
              profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
              followers_count: 100,
              friends_count: 50,
            },
          },
        },
      },
    },
  });

  const buildUserListResponse = (listId, members, { cursor = null } = {}) => ({
    data: {
      list_members_timeline: {
        timeline: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                ...members,
                ...(cursor !== null
                  ? [{
                      entryId: 'cursor-bottom-9999',
                      sortIndex: '9999',
                      content: { entryType: 'TimelineTimelineCursor', value: cursor },
                    }]
                  : []),
              ],
            },
          ],
        },
      },
    },
  });

  const spaceEntry = (id, title, state = 'live') => ({
    entryId: `space-${id}`,
    sortIndex: '0',
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineAudioSpace',
        audioSpace_results: {
          result: {
            __typename: 'AudioSpace',
            id,
            title,
            state,
            participant_count: 42,
            started_at: '2024-01-01T00:00:00.000Z',
            host: {
              rest_id: 'host_' + id,
              legacy: {
                screen_name: 'host' + id,
                name: 'Host ' + id,
                profile_image_url_https: 'https://pbs.twimg.com/host.jpg',
              },
            },
          },
        },
      },
    },
  });

  const buildSpacesResponse = (query, entries, { cursor = null } = {}) => ({
    data: {
      search_spaces: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  ...entries,
                  ...(cursor !== null
                    ? [{
                        entryId: 'cursor-bottom-9999',
                        sortIndex: '9999',
                        content: { entryType: 'TimelineTimelineCursor', value: cursor },
                      }]
                    : []),
                ],
              },
            ],
          },
        },
      },
    },
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      receivedRequests.push({ method: req.method, path: url.pathname, search: url.search });

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = body ? Object.fromEntries(new URLSearchParams(body)) : {};
        const variables = payload.variables ? JSON.parse(payload.variables) : {};

        if (url.pathname.includes('/BQp2IEYkgxuSxqbTAr1e1g/ListMembers') && variables.listId === '123456') {
          const members = [
            userMember('1001', 'memberone'),
            userMember('1002', 'membertwo', 'Member Two'),
          ];
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(buildUserListResponse(variables.listId, members, { cursor: 'cursor2' })));
          return;
        }

        if (url.pathname.includes('/BQp2IEYkgxuSxqbTAr1e1g/ListMembers') && variables.listId === '789012') {
          const members = [
            userMember('2001', 'communityuser1'),
            userMember('2002', 'communityuser2'),
          ];
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(buildUserListResponse(variables.listId, members)));
          return;
        }

        if (url.pathname.includes('/flaR-PUMshxFWZWPNpq4zA/SearchTimeline')) {
          const entries = [spaceEntry('space1', 'Crypto Talk'), spaceEntry('space2', 'AI Chat', 'scheduled')];
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(buildSpacesResponse(variables.query, entries)));
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

  it('registers list_members, community_members, and spaces actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    expect(crawler).toBeInstanceOf(AbstractCrawler);

    const actions = crawler.listActions();
    const list = actions.find((a) => a.action === 'list_members');
    const community = actions.find((a) => a.action === 'community_members');
    const spaces = actions.find((a) => a.action === 'spaces');

    expect(list).toBeTruthy();
    expect(list?.requiredArgs).toEqual(['listUrl']);
    expect(list?.optionalArgs).toEqual(['listId', 'limit', 'cursor']);
    expect(list?.requiresAuth).toBe(true);

    expect(community).toBeTruthy();
    expect(community?.requiredArgs).toEqual(['communityUrl']);
    expect(community?.optionalArgs).toEqual(['communityId', 'limit', 'cursor']);
    expect(community?.requiresAuth).toBe(true);

    expect(spaces).toBeTruthy();
    expect(spaces?.requiredArgs).toEqual(['query']);
    expect(spaces?.optionalArgs).toEqual(['limit', 'cursor', 'state']);
    expect(spaces?.requiresAuth).toBe(false);
  });

  it('list_members extracts listId from listUrl and returns ProfileItem[] with isListMember metadata', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'list_members',
      args: { listUrl: 'https://x.com/i/lists/123456', limit: 20 },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toHaveProperty('members');
    expect(result.members).toHaveLength(2);
    expect(result.members[0].username).toBe('memberone');
    expect(result.members[0].metadata).toMatchObject({ isListMember: true, listId: '123456', sourceMethod: 'list_members' });
    expect(result.members[1].username).toBe('membertwo');
    expect(result.pageInfo).toMatchObject({ has_next_page: true, end_cursor: 'cursor2' });
  });

  it('list_members throws for malformed listUrl', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'list_members',
        args: { listUrl: 'https://example.com/not-a-list' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('community_members extracts communityId from communityUrl and returns ProfileItem[]', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'community_members',
      args: { communityUrl: 'https://x.com/i/communities/789012', limit: 20 },
      session: { accountId: 'twitter-list-user' },
    });

    expect(result).toHaveProperty('members');
    expect(result.members).toHaveLength(2);
    expect(result.members[0].username).toBe('communityuser1');
    expect(result.members[0].metadata).toMatchObject({ isCommunityMember: true, communityId: '789012', sourceMethod: 'community_members' });
  });

  it('community_members throws for malformed communityUrl', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'community_members',
        args: { communityUrl: 'https://example.com/not-a-community' },
      })
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it('spaces returns PostItem[] with isSpace metadata', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'spaces',
      args: { query: 'crypto', limit: 10 },
    });

    expect(result).toHaveProperty('posts');
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].id).toMatch(/^twitter:spaces:/);
    expect(result.posts[0].metadata).toMatchObject({ isSpace: true, spaceState: 'live', participantCount: 42, sourceMethod: 'spaces' });
    expect(result.posts[1].metadata.spaceState).toBe('scheduled');
  });

  it('spaces deduplicates and enforces limit', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'spaces',
      args: { query: 'crypto', limit: 1 },
    });

    expect(result.posts).toHaveLength(1);
  });

  it('legacy scrapers are marked deprecated in source', async () => {
    const source = await fs.readFile('src/scrapers/twitter/index.js', 'utf8');
    expect(source).toMatch(/@deprecated.*list_members/);
    expect(source).toMatch(/@deprecated.*community_members/);
    expect(source).toMatch(/@deprecated.*spaces/);
  });
});
