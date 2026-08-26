// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import {
  normalizeFacebookProfile,
  normalizeFacebookFollower,
  normalizeFacebookGroupMember,
  profileItemToPostItem,
} from '../../../../src/scrapers/social/facebook/normalize-profile.js';

describe('Story 13.5 — Facebook Hybrid Profile, Followers & Group Members', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('fb-user-1', {
    accountId: 'fb-user-1',
    cookies: 'c_user=10001; xs=sec_123',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('facebook', ['fb-user-1'], {
    credentials: {
      'fb-user-1': { cookies: 'c_user=10001; xs=sec_123' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  beforeEach(async () => {
    await cleanupTestDatabase();
    receivedRequests = [];
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          body,
        });

        // Mock Home page for token extraction
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Facebook</title></head>
              <body>
                <input type="hidden" name="jazoest" value="2953" />
                <input type="hidden" name="lsd" value="AVq_ProfileLsd123" />
                <script>
                  requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_Token_Profile"; });
                  window.__spin_r = 1016839210;
                  window.__spin_t = 1787680000;
                  window.__hsi = "739281928371928";
                  window.__rev = "123456789";
                  window.Env = { "USER_ID" : "10001" };
                </script>
              </body>
            </html>
          `);
          return;
        }

        // Mock GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variablesStr = params.get('variables') || '{}';
          let variables = {};
          try {
            variables = JSON.parse(variablesStr);
          } catch {}

          // 1. Profile Query Mock
          if (docId === 'fb_profile_doc_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  id: '4',
                  name: 'Mark Zuckerberg',
                  username: 'zuck',
                  profile_url: 'https://www.facebook.com/zuck',
                  profile_picture: { uri: 'https://cdn.fb.com/zuck.jpg' },
                  bio_text: { text: 'Building the metaverse and open source AI.' },
                  follower_count: 119000000,
                  following_count: 512,
                  is_verified: true,
                  join_time: 1075852800,
                },
              },
            }));
            return;
          }

          // 2. Followers Query Mock
          if (docId === 'fb_followers_doc_123') {
            const after = variables.after;
            if (!after) {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                data: {
                  user: {
                    followers: {
                      page_info: { has_next_page: true, end_cursor: 'cursor_page_2' },
                      edges: [
                        {
                          node: {
                            id: '1001',
                            name: 'Alice Johnson',
                            username: 'alice_j',
                            profile_picture: { uri: 'https://cdn.fb.com/alice.jpg' },
                          },
                        },
                        {
                          node: {
                            id: '1002',
                            name: 'Bob Smith',
                            username: 'bob_s',
                            profile_picture: { uri: 'https://cdn.fb.com/bob.jpg' },
                          },
                        },
                      ],
                    },
                  },
                },
              }));
              return;
            }

            // Page 2
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  followers: {
                    page_info: { has_next_page: false, end_cursor: null },
                    edges: [
                      {
                        node: {
                          id: '1003',
                          name: 'Charlie Brown',
                          username: 'charlie_b',
                          profile_picture: { uri: 'https://cdn.fb.com/charlie.jpg' },
                        },
                      },
                    ],
                  },
                },
              },
            }));
            return;
          }

          // 3. Following Query Mock
          if (docId === 'fb_following_doc_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  following: {
                    page_info: { has_next_page: false, end_cursor: null },
                    edges: [
                      {
                        node: {
                          id: '2001',
                          name: 'Priscilla Chan',
                          username: 'priscilla',
                          profile_picture: { uri: 'https://cdn.fb.com/priscilla.jpg' },
                        },
                      },
                    ],
                  },
                },
              },
            }));
            return;
          }

          // 4. Group Members Query Mock
          if (docId === 'fb_group_members_doc_123' || variables.groupId === '123456') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                group: {
                  id: '123456',
                  name: 'React Developers Vietnam',
                  members: {
                    page_info: { has_next_page: false, end_cursor: null },
                    edges: [
                      {
                        node: {
                          id: '5001',
                          name: 'Dev Lead One',
                          username: 'dev_lead_1',
                          profile_picture: { uri: 'https://cdn.fb.com/member1.jpg' },
                          bio_text: { text: 'React & Next.js engineer' },
                          member_type: 'ADMIN',
                        },
                      },
                      {
                        node: {
                          id: '5002',
                          name: 'Frontend Junior',
                          username: 'fe_junior',
                          profile_picture: { uri: 'https://cdn.fb.com/member2.jpg' },
                          member_type: 'MEMBER',
                        },
                      },
                    ],
                  },
                },
              },
            }));
            return;
          }
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanupTestDatabase();
  });

  // ============================================================================
  // AC-1 & AC-2: Inheritance & Action Registration
  // ============================================================================

  it('[P0] FacebookCrawler and FacebookClient should inherit base contracts and require auth (AC-1)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
    });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('facebook');
    expect(crawler.platform).toBe('facebook');
    expect(crawler.requiresAuth).toBe(true);

    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.platform).toBe('facebook');
  });

  it('[P0] should register profile, followers, following, group_members actions in ActionRegistry (AC-2)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client });

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action || a.name);

    expect(actionNames).toContain('profile');
    expect(actionNames).toContain('followers');
    expect(actionNames).toContain('following');
    expect(actionNames).toContain('group_members');

    const profileDesc = actions.find((a) => (a.action || a.name) === 'profile');
    expect(profileDesc).toBeDefined();
    expect(profileDesc?.requiredArgs).toEqual([]);
    expect(profileDesc?.optionalArgs).toEqual(expect.arrayContaining(['username', 'url']));
  });

  // ============================================================================
  // AC-3: Dispatcher GraphQL Body
  // ============================================================================

  it('[P0] FacebookClient.requestGraphQl should POST the correct doc_id, lsd, fb_dtsg, jazoest and variables (AC-3)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    await client.requestGraphQl('fb_profile_doc_123', { username: 'zuck', scale: 2 }, {
      accountId: 'fb-user-1',
      cookies: 'c_user=10001; xs=sec_123',
    });

    const graphqlRequests = receivedRequests.filter((r) => r.url?.startsWith('/api/graphql'));
    expect(graphqlRequests.length).toBeGreaterThanOrEqual(1);

    const last = graphqlRequests[graphqlRequests.length - 1];
    const body = new URLSearchParams(last.body);

    expect(body.get('doc_id')).toBe('fb_profile_doc_123');
    expect(body.get('lsd')).toBe('AVq_ProfileLsd123');
    expect(body.get('fb_dtsg')).toBe('DTSG_Token_Profile');
    expect(body.get('jazoest')).toBe('2953');
    expect(body.get('__user')).toBe('10001');
    expect(body.get('av')).toBe('10001');
    expect(JSON.parse(body.get('variables') || '{}')).toEqual({ username: 'zuck', scale: 2 });
  });

  // ============================================================================
  // AC-4: Profile Extraction
  // ============================================================================

  it('[P0] should crawl profile by username or URL and return normalized ProfileItem (AC-4, AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
      docIds: { PROFILE: 'fb_profile_doc_123' },
    });

    const result = await crawler.start({
      action: 'profile',
      args: { username: 'zuck' },
      session: { accountId: 'fb-user-1' },
    });

    expect(result).toBeDefined();
    expect(result.profile).toBeDefined();

    const profile = result.profile;
    expect(profile.id).toBe('facebook:4');
    expect(profile.externalId).toBe('4');
    expect(profile.platform).toBe('facebook');
    expect(profile.name).toBe('Mark Zuckerberg');
    expect(profile.username).toBe('zuck');
    expect(profile.bio).toContain('metaverse');
    expect(profile.followersCount).toBe(119000000);
    expect(profile.followingCount).toBe(512);
    expect(profile.avatar).toBe('https://cdn.fb.com/zuck.jpg');
    expect(profile.metadata?.isProfile).toBe(true);
    expect(profile.metadata?.sourceMethod).toBe('graphql');

    // URL resolution path
    const urlResult = await crawler.start({
      action: 'profile',
      args: { url: 'https://www.facebook.com/zuck' },
      session: { accountId: 'fb-user-1' },
    });
    expect(urlResult.profile.username).toBe('zuck');
  });

  // ============================================================================
  // AC-5: Followers & Following Extraction
  // ============================================================================

  it('[P0] should crawl followers with cursor pagination and return ProfileItem[] (AC-5, AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
      docIds: {
        FOLLOWERS: 'fb_followers_doc_123',
      },
    });

    const result = await crawler.start({
      action: 'followers',
      args: { username: 'zuck', limit: 10 },
      session: { accountId: 'fb-user-1' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.followers)).toBe(true);
    expect(result.followers.length).toBe(3);

    const follower = result.followers[0];
    expect(follower.id).toBe('facebook:1001');
    expect(follower.name).toBe('Alice Johnson');
    expect(follower.platform).toBe('facebook');
    expect(follower.metadata?.isFollower).toBe(true);
    expect(follower.metadata?.sourceMethod).toBe('graphql');
  });

  it('[P0] should crawl following with pagination and return ProfileItem[] (AC-5, AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
      docIds: {
        FOLLOWING: 'fb_following_doc_123',
      },
    });

    const followingResult = await crawler.start({
      action: 'following',
      args: { username: 'zuck', limit: 10 },
      session: { accountId: 'fb-user-1' },
    });

    expect(followingResult).toBeDefined();
    expect(Array.isArray(followingResult.following)).toBe(true);
    expect(followingResult.following.length).toBe(1);
    expect(followingResult.following[0].id).toBe('facebook:2001');
    expect(followingResult.following[0].name).toBe('Priscilla Chan');
    expect(followingResult.following[0].metadata?.isFollowing).toBe(true);
    expect(followingResult.note).toBeUndefined();
  });

  // ============================================================================
  // AC-6: Group Members Extraction
  // ============================================================================

  it('[P0] should crawl group_members with URL resolution and SSRF guard (AC-6, AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
      docIds: { GROUP_MEMBERS: 'fb_group_members_doc_123' },
    });

    const result = await crawler.start({
      action: 'group_members',
      args: { groupUrl: 'https://www.facebook.com/groups/123456', limit: 20 },
      session: { accountId: 'fb-user-1' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members.length).toBe(2);

    const member = result.members[0];
    expect(member.id).toBe('facebook:5001');
    expect(member.name).toBe('Dev Lead One');
    expect(member.platform).toBe('facebook');
    expect(member.metadata?.memberType).toBe('ADMIN');
    expect(member.metadata?.sourceMethod).toBe('graphql');

    // SSRF Guard test
    await expect(
      crawler.start({
        action: 'group_members',
        args: { groupUrl: 'https://evil.attacker.com/groups/123456' },
        session: { accountId: 'fb-user-1' },
      })
    ).rejects.toThrow(PlatformError);
  });

  // ============================================================================
  // AC-7: Normalizer Functions
  // ============================================================================

  it('[P1] normalizeFacebookProfile, normalizeFacebookFollower, normalizeFacebookGroupMember should enforce namespaced ID (AC-7)', () => {
    const rawProfile = {
      id: '9999',
      name: 'John Doe',
      username: 'johndoe',
      bio_text: { text: 'Engineer' },
    };
    const normalized = normalizeFacebookProfile(rawProfile);
    expect(normalized.id).toBe('facebook:9999');
    expect(normalized.platform).toBe('facebook');
    expect(normalized.name).toBe('John Doe');

    const rawFollower = {
      node: {
        id: '8888',
        name: 'Jane Follower',
        username: 'janef',
      },
    };
    const normFollower = normalizeFacebookFollower(rawFollower);
    expect(normFollower.id).toBe('facebook:8888');
    expect(normFollower.platform).toBe('facebook');

    const rawMember = {
      node: {
        id: '7777',
        name: 'Group Member One',
        member_type: 'MODERATOR',
      },
    };
    const normMember = normalizeFacebookGroupMember(rawMember, 'group_123');
    expect(normMember.id).toBe('facebook:7777');
    expect(normMember.metadata?.groupId).toBe('group_123');
  });

  it('[P1] profileItemToPostItem should produce schema-valid PostItem metadata (AC-8)', () => {
    const profile = normalizeFacebookProfile({
      id: '4',
      username: 'zuck',
      name: 'Mark Zuckerberg',
      bio_text: { text: 'Building the metaverse.' },
      profile_picture: { uri: 'https://cdn.fb.com/zuck.jpg' },
      follower_count: 119000000,
      following_count: 512,
      is_verified: true,
    });
    expect(profile).not.toBeNull();
    const postItem = profileItemToPostItem(profile);

    expect(postItem.id).toBe('facebook:4');
    expect(postItem.category).toBe('social');
    expect(postItem.publishedAt).toBeNull();
    expect(postItem.metadata?.isProfile).toBe(true);
    expect(postItem.metadata?.sourceMethod).toBe('graphql');
    expect(postItem.metadata?.profilePic).toBe('https://cdn.fb.com/zuck.jpg');
    expect(postItem.metadata?.bio).toBe('Building the metaverse.');

    const validation = metadataSchemaRegistry.validateMetadata('facebook', 'social', postItem.metadata);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  // ============================================================================
  // AC-8: PrismaStore & Checkpoint Persistence
  // ============================================================================

  it('[P0] should persist profiles as PostItem batches to PrismaStore and save crawl checkpoint (AC-8)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: createStore(),
      docIds: { PROFILE: 'fb_profile_doc_123' },
    });

    await crawler.start({
      action: 'profile',
      args: { username: 'zuck' },
      session: { accountId: 'fb-user-1' },
    });

    const storedItem = await prisma.post.findUnique({ where: { id: 'facebook:4' } });
    expect(storedItem).not.toBeNull();
    expect(storedItem?.category).toBe('social');
    expect(storedItem?.publishedAt).toBeNull();
    expect(storedItem?.metadata?.isProfile).toBe(true);
    expect(storedItem?.metadata?.sourceMethod).toBe('graphql');

    const checkpoint = await prisma.crawlCheckpoint.findUnique({
      where: {
        platform_targetType_targetKey: {
          platform: 'facebook',
          targetType: 'profile',
          targetKey: 'zuck',
        },
      },
    });
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.platform).toBe('facebook');
    expect(checkpoint?.targetType).toBe('profile');
    expect(checkpoint?.targetKey).toBe('zuck');
    expect(checkpoint?.lastCrawledAt).toBeInstanceOf(Date);
  });
});
