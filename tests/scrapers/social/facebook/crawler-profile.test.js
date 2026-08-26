// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import {
  normalizeFacebookProfile,
  normalizeFacebookFollower,
  normalizeFacebookGroupMember,
} from '../../../../src/scrapers/social/facebook/normalize-profile.js';

describe('Story 13.5 — Facebook Hybrid Profile, Followers & Group Members', () => {
  let server;
  let serverUrl;
  let storedBatches = [];
  let savedCheckpoints = [];

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

  const mockStore = {
    storeBatch: async (items, options) => {
      storedBatches.push({ items, options });
      return { inserted: items.length, updated: 0, skipped: 0, failed: 0 };
    },
    saveCheckpoint: async (checkpoint) => {
      savedCheckpoints.push(checkpoint);
      return checkpoint;
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
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
                  window.Env = { "USER_ID": "10001" };
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
          if (docId === 'fb_profile_doc_123' || variables.targetKey === 'zuck' || variables.userID === '4') {
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
          if (docId === 'fb_followers_doc_123' || variables.targetKey === 'zuck_followers') {
            const cursor = variables.cursor;
            if (!cursor) {
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
          if (docId === 'fb_following_doc_123' || variables.targetKey === 'zuck_following') {
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
          if (docId === 'fb_group_members_doc_123' || variables.groupID === '123456' || variables.groupId === '123456') {
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
      store: mockStore,
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
  });

  // ============================================================================
  // AC-4: Profile Extraction
  // ============================================================================

  it('[P0] should crawl profile by username or URL and return normalized ProfileItem (AC-4, AC-7)', async () => {
    storedBatches = [];
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
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

  it('[P0] should crawl followers with cursor pagination and handle following gracefully (AC-5, AC-7)', async () => {
    storedBatches = [];
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
      docIds: {
        FOLLOWERS: 'fb_followers_doc_123',
        FOLLOWING: 'fb_following_doc_123',
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

    // Following test
    const followingResult = await crawler.start({
      action: 'following',
      args: { username: 'zuck' },
      session: { accountId: 'fb-user-1' },
    });
    expect(followingResult).toBeDefined();
    expect(Array.isArray(followingResult.following) || followingResult.note).toBeTruthy();
  });

  // ============================================================================
  // AC-6: Group Members Extraction
  // ============================================================================

  it('[P0] should crawl group_members with URL resolution and SSRF guard (AC-6, AC-7)', async () => {
    storedBatches = [];
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
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

    // SSRF Guard test
    await expect(
      crawler.start({
        action: 'group_members',
        args: { groupUrl: 'https://evil.attacker.com/groups/123456' },
        session: { accountId: 'fb-user-1' },
      })
    ).rejects.toThrow();
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

  // ============================================================================
  // AC-8: PrismaStore & Checkpoint Persistence
  // ============================================================================

  it('[P0] should persist profiles as PostItem batches to PrismaStore and save crawl checkpoint (AC-8)', async () => {
    storedBatches = [];
    savedCheckpoints = [];

    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
      docIds: { PROFILE: 'fb_profile_doc_123' },
    });

    await crawler.start({
      action: 'profile',
      args: { username: 'zuck' },
      session: { accountId: 'fb-user-1' },
    });

    expect(storedBatches.length).toBeGreaterThanOrEqual(1);
    const storedItem = storedBatches[0].items[0];
    expect(storedItem.id).toBe('facebook:4');
    expect(storedItem.category).toBe('social');
    expect(storedItem.publishedAt).toBeNull();

    expect(savedCheckpoints.length).toBeGreaterThanOrEqual(1);
    const checkpoint = savedCheckpoints[0];
    expect(checkpoint.platform).toBe('facebook');
    expect(checkpoint.targetType).toBe('profile');
    expect(checkpoint.targetKey).toBe('zuck');
  });
});
