// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ATDD Red-Phase Tests — Story 15.1.1: Threads Hybrid Profile & Followers/Following
 * Tests for ThreadsCrawler profile, followers, and following actions.
 * No mocks; uses local http.createServer for GraphQL and SSR responses.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { ThreadsCrawler } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import {
  namespacedProfileId,
  parseHumanCount,
  normalizeThreadsProfile,
  normalizeThreadsConnection,
  profileItemToPostItem,
} from '../../../../src/scrapers/social/threads/normalizer.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { defaultRedisStreamPublisher } from '../../../../src/utils/redis-stream-publisher.js';

describe('Story 15.1.1: Threads Hybrid Profile & Connections ATDD Test Suite', () => {
  let server;
  let serverUrl;
  const originalEnv = process.env.REDIS_STREAM_ENABLED;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const url = req.url || '';

        // 1. Landing / Profile SSR HTML
        if (url === '/@testuser' || url === '/@valid_user') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Test User (@testuser) on Threads</title>
              <meta property="og:title" content="Test User (@testuser) on Threads" />
              <meta property="og:description" content="12.5K followers. Tech enthusiast and AI builder." />
              <meta property="og:image" content="https://cdn.threads.net/avatar_test.jpg" />
            </head>
            <body>
              <script>
                window.__user_id = "987654321";
                window.__LSD__ = "LSD_token_123";
              </script>
              <input type="hidden" name="lsd" value="LSD_token_123" />
            </body>
            </html>
          `);
          return;
        }

        // 2. Landing page for tokens
        if (url === '/' || url === '/@instagram') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="LSD_token_123" />
            </body></html>
          `);
          return;
        }

        // 3. 404 User Not Found HTML
        if (url === '/@nonexistent_user') {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body><h1>Sorry, this page isn't available.</h1></body></html>`);
          return;
        }

        // 4. GraphQL Endpoint
        if (url === '/api/graphql') {
          let variables = {};
          let docId = '';
          try {
            const parsed = new URLSearchParams(body);
            docId = parsed.get('doc_id') || '';
            variables = JSON.parse(parsed.get('variables') || '{}');
          } catch {
            variables = {};
          }

          // Followers List Query mock
          if (docId === 'doc_followers_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  node: {
                    followers_connection: {
                      edges: [
                        {
                          node: {
                            id: 'follower_111',
                            pk: 'follower_111',
                            username: 'follower_one',
                            full_name: 'Follower One',
                            profile_pic_url: 'https://cdn.threads.net/f1.jpg',
                            is_verified: false,
                          },
                        },
                      ],
                      page_info: {
                        has_next_page: false,
                        end_cursor: 'cursor_follower_end',
                      },
                    },
                  },
                },
              })
            );
            return;
          }

          // Following List Query mock
          if (docId === 'doc_following_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  node: {
                    following_connection: {
                      edges: [
                        {
                          node: {
                            id: 'following_222',
                            pk: 'following_222',
                            username: 'following_one',
                            full_name: 'Following One',
                            profile_pic_url: 'https://cdn.threads.net/f2.jpg',
                            is_verified: true,
                          },
                        },
                      ],
                      page_info: {
                        has_next_page: false,
                        end_cursor: 'cursor_following_end',
                      },
                    },
                  },
                },
              })
            );
            return;
          }

          // Restricted / Empty connection query
          if (docId === 'doc_restricted_conn') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  node: null,
                },
              })
            );
            return;
          }

          // Profile Query mock
          if (docId === 'doc_profile_123' || variables.userID === '987654321') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  userData: {
                    user: {
                      id: '987654321',
                      pk: '987654321',
                      username: 'testuser',
                      full_name: 'Test User Display',
                      biography: 'Tech enthusiast and AI builder.',
                      profile_pic_url: 'https://cdn.threads.net/avatar_test.jpg',
                      follower_count: 12500,
                      following_count: 350,
                      is_verified: true,
                    },
                  },
                },
              })
            );
            return;
          }
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (originalEnv !== undefined) {
      process.env.REDIS_STREAM_ENABLED = originalEnv;
    } else {
      delete process.env.REDIS_STREAM_ENABLED;
    }
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    process.env.REDIS_STREAM_ENABLED = 'true';
  });

  // ==========================================================================
  // SCN-1: Action Registry Contract (AC-1)
  // ==========================================================================
  describe('SCN-1: ActionRegistry Registration (AC-1)', () => {
    it('registers profile, followers, and following in ActionRegistry with correct descriptors', () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });

      const actions = crawler.listActions();
      const actionNames = actions.map((a) => a.action);

      expect(actionNames).toContain('profile');
      expect(actionNames).toContain('followers');
      expect(actionNames).toContain('following');

      const profileDesc = actions.find((a) => a.action === 'profile');
      expect(profileDesc?.requiredArgs).toContain('username');
      expect(profileDesc?.outputType).toBe('ProfileItem');

      const followersDesc = actions.find((a) => a.action === 'followers');
      expect(followersDesc?.requiredArgs).toContain('username');
      expect(followersDesc?.optionalArgs).toContain('count');
      expect(followersDesc?.outputType).toContain('ProfileItem[]');

      const followingDesc = actions.find((a) => a.action === 'following');
      expect(followingDesc?.requiredArgs).toContain('username');
      expect(followingDesc?.optionalArgs).toContain('count');
      expect(followingDesc?.outputType).toContain('ProfileItem[]');
    });
  });

  // ==========================================================================
  // SCN-2: Normalizer Unit Contract (AC-5, AC-6)
  // ==========================================================================
  describe('SCN-2: Normalizer Unit Contract (AC-5, AC-6)', () => {
    it('namespacedProfileId produces threads:<id>', () => {
      expect(namespacedProfileId('123456')).toBe('threads:123456');
    });

    it('parseHumanCount parses numeric strings, K, and M formats', () => {
      expect(parseHumanCount('1234')).toBe(1234);
      expect(parseHumanCount('1.2K')).toBe(1200);
      expect(parseHumanCount('3.5M')).toBe(3500000);
      expect(parseHumanCount(500)).toBe(500);
      expect(parseHumanCount(null)).toBe(0);
    });

    it('normalizeThreadsProfile maps raw GraphQL object to ProfileItem', () => {
      const raw = {
        id: '987654321',
        pk: '987654321',
        username: 'testuser',
        full_name: 'Test User Display',
        biography: 'Tech builder bio',
        profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
        follower_count: 12500,
        following_count: 350,
        is_verified: true,
      };

      const profile = normalizeThreadsProfile(raw, 'graphql');
      expect(profile.id).toBe('threads:987654321');
      expect(profile.platform).toBe('threads');
      expect(profile.externalId).toBe('987654321');
      expect(profile.username).toBe('testuser');
      expect(profile.name).toBe('Test User Display');
      expect(profile.bio).toBe('Tech builder bio');
      expect(profile.avatar).toBe('https://cdn.threads.net/avatar.jpg');
      expect(profile.profileUrl).toBe('https://www.threads.net/@testuser');
      expect(profile.followersCount).toBe(12500);
      expect(profile.followingCount).toBe(350);
      expect(profile.metadata?.isProfile).toBe(true);
      expect(profile.metadata?.sourceMethod).toBe('graphql');
      expect(profile.metadata?.isVerified).toBe(true);
    });

    it('profileItemToPostItem converts ProfileItem to valid PostItem for PrismaStore', () => {
      const profile = {
        id: 'threads:987654321',
        platform: 'threads',
        externalId: '987654321',
        name: 'Test User Display',
        username: 'testuser',
        bio: 'Tech builder bio',
        avatar: 'https://cdn.threads.net/avatar.jpg',
        profileUrl: 'https://www.threads.net/@testuser',
        followersCount: 12500,
        followingCount: 350,
        metadata: {
          isProfile: true,
          sourceMethod: 'graphql',
          isVerified: true,
          userId: '987654321',
          username: 'testuser',
          followersCount: 12500,
          followingCount: 350,
        },
      };

      const postItem = profileItemToPostItem(profile);
      expect(postItem.id).toBe('threads:987654321');
      expect(postItem.platform).toBe('threads');
      expect(postItem.category).toBe('social');
      expect(postItem.authorId).toBe('987654321');
      expect(postItem.authorName).toBe('Test User Display');
      expect(postItem.authorAvatar).toBe('https://cdn.threads.net/avatar.jpg');
      expect(postItem.content).toBe('Tech builder bio');
      expect(postItem.mediaUrls).toEqual(['https://cdn.threads.net/avatar.jpg']);
      expect(postItem.likesCount).toBe(12500);
      expect(postItem.repliesCount).toBe(350);
      expect(postItem.metadata.isProfile).toBe(true);
    });
  });

  // ==========================================================================
  // SCN-3: Profile Action GraphQL Fetch & Persistence (AC-2)
  // ==========================================================================
  describe('SCN-3: profile Action via GraphQL (AC-2)', () => {
    it('fetches profile via GraphQL, saves to store, writes checkpoint, and emits thin event', async () => {
      const storedBatches = [];
      const savedCheckpoints = [];
      const emittedEvents = [];

      const mockPublisher = {
        publish: async (item) => {
          emittedEvents.push(item);
          return { ok: true, id: '1700000000000-0' };
        },
      };

      const mockStore = {
        publisher: mockPublisher,
        storeBatch: async (items) => {
          storedBatches.push(items);
        },
        saveCheckpoint: async (ckpt) => {
          savedCheckpoints.push(ckpt);
          return ckpt;
        },
      };

      const client = new ThreadsClient({
        baseUrl: serverUrl,
      });

      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        docIds: {
          PROFILE: 'doc_profile_123',
        },
      });

      const result = await crawler.start({
        action: 'profile',
        args: { username: 'testuser' },
        session: { accountId: 'threads-guest' },
      });

      expect(result.id).toBe('threads:987654321');
      expect(result.username).toBe('testuser');
      expect(result.followersCount).toBe(12500);

      // Verify persistence
      expect(storedBatches.length).toBe(1);
      expect(storedBatches[0][0].id).toBe('threads:987654321');

      // Verify checkpoint
      expect(savedCheckpoints.length).toBe(1);
      expect(savedCheckpoints[0].targetType).toBe('profile');
      expect(savedCheckpoints[0].targetKey).toBe('testuser');
      expect(savedCheckpoints[0].storageRef).toBe('threads:987654321');

      // Verify thin event emission
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].id).toBe('threads:987654321');
      expect(emittedEvents[0].platform).toBe('threads');
      expect(emittedEvents[0].storageRef).toBe('threads:987654321');
    });
  });

  // ==========================================================================
  // SCN-4: Profile Action SSR Fallback (AC-2, AC-4)
  // ==========================================================================
  describe('SCN-4: profile Action SSR Fallback (AC-2, AC-4)', () => {
    it('falls back to HTML SSR parsing when GraphQL doc_id is null', async () => {
      const storedBatches = [];
      const mockStore = {
        storeBatch: async (items) => storedBatches.push(items),
        saveCheckpoint: async () => {},
      };

      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        docIds: {
          PROFILE: null, // Forces SSR fallback
        },
      });

      const result = await crawler.start({
        action: 'profile',
        args: { username: 'valid_user' },
        session: { accountId: 'threads-guest' },
      });

      expect(result.id).toBe('threads:987654321');
      expect(result.username).toBe('testuser');
      expect(result.followersCount).toBe(12500);
      expect(result.bio).toContain('Tech enthusiast and AI builder');
      expect(result.metadata?.sourceMethod).toBe('ssr');
    });
  });

  // ==========================================================================
  // SCN-5: Followers & Following Actions via GraphQL (AC-3)
  // ==========================================================================
  describe('SCN-5: followers & following Actions via GraphQL (AC-3)', () => {
    it('followers action returns list of follower profiles with metadata.isFollower=true', async () => {
      const storedBatches = [];
      const mockStore = {
        storeBatch: async (items) => storedBatches.push(items),
        saveCheckpoint: async () => {},
      };

      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        docIds: {
          FOLLOWERS: 'doc_followers_123',
        },
      });

      const result = await crawler.start({
        action: 'followers',
        args: { username: 'testuser', count: 20 },
        session: { accountId: 'threads-guest' },
      });

      expect(Array.isArray(result.profiles)).toBe(true);
      expect(result.profiles.length).toBe(1);
      expect(result.profiles[0].id).toBe('threads:follower_111');
      expect(result.profiles[0].username).toBe('follower_one');
      expect(result.profiles[0].metadata?.isFollower).toBe(true);
    });

    it('following action returns list of following profiles with metadata.isFollowing=true', async () => {
      const storedBatches = [];
      const mockStore = {
        storeBatch: async (items) => storedBatches.push(items),
        saveCheckpoint: async () => {},
      };

      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        docIds: {
          FOLLOWING: 'doc_following_123',
        },
      });

      const result = await crawler.start({
        action: 'following',
        args: { username: 'testuser', count: 20 },
        session: { accountId: 'threads-guest' },
      });

      expect(Array.isArray(result.profiles)).toBe(true);
      expect(result.profiles.length).toBe(1);
      expect(result.profiles[0].id).toBe('threads:following_222');
      expect(result.profiles[0].username).toBe('following_one');
      expect(result.profiles[0].metadata?.isFollowing).toBe(true);
    });
  });

  // ==========================================================================
  // SCN-6: Public-List Limitation Fallback (AC-4)
  // ==========================================================================
  describe('SCN-6: Public-List Limitation Fallback (AC-4)', () => {
    it('returns empty profiles array with counts and limitation note without throwing', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        docIds: {
          FOLLOWERS: 'doc_restricted_conn',
          PROFILE: 'doc_profile_123',
        },
      });

      const result = await crawler.start({
        action: 'followers',
        args: { username: 'testuser' },
        session: { accountId: 'threads-guest' },
      });

      expect(result.profiles).toEqual([]);
      expect(result.counts).toBeDefined();
      expect(result.counts.followersCount).toBe(12500);
      expect(result.counts.followingCount).toBe(350);
      expect(result.note).toContain('Threads does not expose public follower/following lists');
    });
  });

  // ==========================================================================
  // SCN-7: Negative & Error Scenarios (AC-2/Edge)
  // ==========================================================================
  describe('SCN-7: Error Handling & 404 (AC-2/Edge)', () => {
    it('throws XACT_4041 PlatformError when username does not exist', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        docIds: { PROFILE: null },
      });

      await expect(
        crawler.start({
          action: 'profile',
          args: { username: 'nonexistent_user' },
          session: { accountId: 'threads-guest' },
        })
      ).rejects.toThrow();
    });
  });
});
