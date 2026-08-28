// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import {
  normalizeFacebookSearchPost,
  normalizeFacebookSearchProfile,
  normalizeFacebookPageSearchResult,
  normalizeFacebookGroupSearchResult,
  searchResultToPostItem,
} from '../../../../src/scrapers/social/facebook/normalize-search.js';

describe('Story 13.6 — Facebook Hybrid Search (Global + Group Search)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('fb-search-user', {
    accountId: 'fb-search-user',
    cookies: 'c_user=61590064244856; xs=sec_search_token',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('facebook', ['fb-search-user'], {
    credentials: {
      'fb-search-user': { cookies: 'c_user=61590064244856; xs=sec_search_token' },
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

        // Mock token endpoint
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head>
                <script>
                  ["LSD",[],{"token":"TEST_LSD_SEARCH_123"}];
                  ["DTSGInitialData",[],{"token":"TEST_DTSG_SEARCH_456"}];
                </script>
              </head>
              <body>Facebook Search Mock</body>
            </html>
          `);
          return;
        }

        // Mock GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const rawVars = params.get('variables');
          let variables = {};
          try {
            variables = JSON.parse(rawVars || '{}');
          } catch {}

          // Search Posts GraphQL response
          if (docId === 'fb_search_posts_doc' || docId === 'SEARCH_POSTS') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [
                      {
                        node: {
                          id: 'post_search_101',
                          story: {
                            id: 'story_101',
                            post_id: '1010101',
                            message: { text: 'Exciting news about AI technology and LLMs #ai' },
                            actors: [{ id: '990011', name: 'Tech Innovator', profile_picture: { uri: 'https://fb.com/pic1.jpg' } }],
                            creation_time: 1787700000,
                            feedback: {
                              reaction_count: { count: 120 },
                              share_count: { count: 35 },
                              comment_count: { total_count: 15 },
                            },
                            url: 'https://facebook.com/1010101',
                          }
                        }
                      }
                    ],
                    page_info: {
                      has_next_page: true,
                      end_cursor: 'cursor_posts_page_1',
                    }
                  }
                }
              }
            }));
            return;
          }

          // Search People GraphQL response
          if (docId === 'fb_search_people_doc' || docId === 'SEARCH_PEOPLE') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [
                      {
                        node: {
                          id: 'user_search_201',
                          profile_id: '2020202',
                          name: 'Dr. Jane Smith',
                          profile_picture: { uri: 'https://fb.com/jane.jpg' },
                          bio_text: { text: 'AI Researcher at Lab' },
                          url: 'https://facebook.com/dr.jane.smith',
                          followers_count: 4500,
                        }
                      }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            }));
            return;
          }

          // Search Pages GraphQL response
          if (docId === 'fb_search_pages_doc' || docId === 'SEARCH_PAGES') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [
                      {
                        node: {
                          id: 'page_search_301',
                          page_id: '3030303',
                          name: 'Open Source AI Hub',
                          profile_picture: { uri: 'https://fb.com/hub.jpg' },
                          category_name: 'Science & Technology',
                          url: 'https://facebook.com/opensourceaihub',
                          likes_count: 12500,
                        }
                      }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            }));
            return;
          }

          // Search Groups GraphQL response
          if (docId === 'fb_search_groups_doc' || docId === 'SEARCH_GROUPS') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [
                      {
                        node: {
                          id: 'group_search_401',
                          group_id: '4040404',
                          name: 'Generative AI Community',
                          profile_picture: { uri: 'https://fb.com/group.jpg' },
                          privacy_setting: 'PUBLIC',
                          url: 'https://facebook.com/groups/4040404',
                          members_count: 89000,
                        }
                      }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            }));
            return;
          }

          // Group Search GraphQL response
          if (docId === 'fb_group_search_doc' || docId === 'GROUP_SEARCH') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                group: {
                  id: variables.groupID || '9876543210',
                  group_search_results: {
                    edges: [
                      {
                        node: {
                          id: 'grp_post_501',
                          post_id: '5050505',
                          message: { text: 'Discussing local agentic benchmarks in our group' },
                          actors: [{ id: '778899', name: 'Group Member Alex' }],
                          creation_time: 1787710000,
                          feedback: { reaction_count: { count: 42 }, share_count: { count: 8 }, comment_count: { total_count: 19 } },
                        }
                      }
                    ],
                    page_info: { has_next_page: false, end_cursor: 'cursor_group_search_end' }
                  }
                }
              }
            }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
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

  it('[AC-1] should inherit AbstractCrawler and register search and group_search actions', () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({ client, sessionManager });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('facebook');
    expect(crawler.platform).toBe('facebook');
    expect(crawler.requiresAuth).toBe(true);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search');
    expect(actionNames).toContain('group_search');

    const searchAction = actions.find((a) => a.action === 'search');
    expect(searchAction?.requiredArgs).toContain('query');
    expect(searchAction?.optionalArgs).toContain('type');
    expect(searchAction?.optionalArgs).toContain('location');
    expect(searchAction?.optionalArgs).toContain('limit');

    const groupSearchAction = actions.find((a) => a.action === 'group_search');
    expect(groupSearchAction?.requiredArgs).toContain('groupUrl');
    expect(groupSearchAction?.requiredArgs).toContain('query');
  });

  it('[AC-2 & AC-4] should execute global post search and return normalized PostItems', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_search_posts_doc',
      }
    });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'AI technology', type: 'posts', limit: 10 },
      session: { accountId: 'fb-search-user' },
    });

    expect(Array.isArray(result.posts || result)).toBe(true);
    const posts = result.posts || result;
    expect(posts.length).toBe(1);

    const post = posts[0];
    expect(post.id).toBe('facebook:1010101');
    expect(post.externalId).toBe('1010101');
    expect(post.platform).toBe('facebook');
    expect(post.category).toBe('social');
    expect(post.authorName).toBe('Tech Innovator');
    expect(post.content).toContain('Exciting news about AI');
    expect(post.likesCount).toBe(120);
    expect(post.metadata?.isSearchResult).toBe(true);
    expect(post.metadata?.searchType).toBe('posts');

    expect(result.pageInfo?.has_next_page).toBe(true);
    expect(result.pageInfo?.end_cursor).toBe('cursor_posts_page_1');
  });

  it('[AC-2 & AC-5] should search people, pages, groups and normalize to PostItem with publishedAt null', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        SEARCH_PEOPLE: 'fb_search_people_doc',
        SEARCH_PAGES: 'fb_search_pages_doc',
        SEARCH_GROUPS: 'fb_search_groups_doc',
      }
    });

    // 1. People search
    const peopleRes = await crawler.start({
      action: 'search',
      args: { query: 'Jane Smith', type: 'people' },
      session: { accountId: 'fb-search-user' },
    });
    const people = peopleRes.posts || peopleRes;
    expect(people[0].id).toBe('facebook:2020202');
    expect(people[0].authorName).toBe('Dr. Jane Smith');
    expect(people[0].publishedAt).toBeNull();
    expect(people[0].metadata?.resultType).toBe('people');

    // 2. Page search
    const pagesRes = await crawler.start({
      action: 'search',
      args: { query: 'Open Source', type: 'pages' },
      session: { accountId: 'fb-search-user' },
    });
    const pages = pagesRes.posts || pagesRes;
    expect(pages[0].id).toBe('facebook:3030303');
    expect(pages[0].authorName).toBe('Open Source AI Hub');
    expect(pages[0].publishedAt).toBeNull();
    expect(pages[0].metadata?.resultType).toBe('pages');

    // 3. Group search
    const groupsRes = await crawler.start({
      action: 'search',
      args: { query: 'Generative AI', type: 'groups' },
      session: { accountId: 'fb-search-user' },
    });
    const groups = groupsRes.posts || groupsRes;
    expect(groups[0].id).toBe('facebook:4040404');
    expect(groups[0].authorName).toBe('Generative AI Community');
    expect(groups[0].publishedAt).toBeNull();
    expect(groups[0].metadata?.resultType).toBe('groups');
  });

  it('[AC-2] should return multi-entity object when type is "all"', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_search_posts_doc',
        SEARCH_PEOPLE: 'fb_search_people_doc',
        SEARCH_PAGES: 'fb_search_pages_doc',
        SEARCH_GROUPS: 'fb_search_groups_doc',
      }
    });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'AI Innovation', type: 'all' },
      session: { accountId: 'fb-search-user' },
    });

    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('people');
    expect(result).toHaveProperty('pages');
    expect(result).toHaveProperty('groups');

    expect(Array.isArray(result.posts)).toBe(true);
    expect(Array.isArray(result.people)).toBe(true);
    expect(Array.isArray(result.pages)).toBe(true);
    expect(Array.isArray(result.groups)).toBe(true);
  });

  it('[AC-3 & AC-7] should execute group search and reject SSRF/non-group URLs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        GROUP_SEARCH: 'fb_group_search_doc',
      }
    });

    // Valid group search
    const result = await crawler.start({
      action: 'group_search',
      args: {
        groupUrl: 'https://www.facebook.com/groups/9876543210',
        query: 'benchmarks',
      },
      session: { accountId: 'fb-search-user' },
    });

    expect(Array.isArray(result.posts || result)).toBe(true);
    const posts = result.posts || result;
    expect(posts[0].id).toBe('facebook:5050505');
    expect(posts[0].content).toContain('agentic benchmarks');

    // SSRF / Non-Facebook URL rejection
    await expect(crawler.start({
      action: 'group_search',
      args: {
        groupUrl: 'https://evil-attacker.com/groups/12345',
        query: 'test',
      },
      session: { accountId: 'fb-search-user' },
    })).rejects.toThrow(PlatformError);
  });

  it('[AC-6] should format location into search query and support pagination cursor', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_search_posts_doc',
      }
    });

    await crawler.start({
      action: 'search',
      args: {
        query: 'specialty coffee',
        location: 'Da Nang',
        cursor: 'cursor_initial_offset',
      },
      session: { accountId: 'fb-search-user' },
    });

    const lastGraphqlReq = receivedRequests
      .filter((r) => r.url?.startsWith('/api/graphql'))
      .pop();

    expect(lastGraphqlReq).toBeDefined();
    const params = new URLSearchParams(lastGraphqlReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');

    expect(variables.query || variables.queryString || variables.searchTerm).toContain('Da Nang');
    expect(variables.cursor || variables.after).toBe('cursor_initial_offset');
  });

  it('[AC-8] should persist search results and save crawl checkpoint in PrismaStore', async () => {
    const store = createStore();
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      store,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_search_posts_doc',
      }
    });

    await crawler.start({
      action: 'search',
      args: { query: 'quantum computing', type: 'posts', limit: 5 },
      session: { accountId: 'fb-search-user' },
    });

    // Verify stored post
    const storedPosts = await prisma.post.findMany({
      where: { platform: 'facebook' },
    });
    expect(storedPosts.length).toBeGreaterThan(0);
    expect(storedPosts[0].externalId).toBe('1010101');

    // Verify crawl checkpoint
    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: {
        platform: 'facebook',
        targetType: 'search',
      },
    });

    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('quantum computing');
  });

  it('[AC-7] should validate input arguments and throw PlatformError for invalid inputs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({ client, sessionManager });

    // Missing query
    await expect(crawler.start({
      action: 'search',
      args: { query: '' },
      session: { accountId: 'fb-search-user' },
    })).rejects.toThrow(PlatformError);

    // Invalid search type
    await expect(crawler.start({
      action: 'search',
      args: { query: 'test', type: 'unsupported_type' },
      session: { accountId: 'fb-search-user' },
    })).rejects.toThrow(PlatformError);

    // Missing groupUrl for group_search
    await expect(crawler.start({
      action: 'group_search',
      args: { groupUrl: '', query: 'test' },
      session: { accountId: 'fb-search-user' },
    })).rejects.toThrow(PlatformError);
  });

  it('[AC-10] should validate search result metadata against schema registry', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_search_posts_doc',
        SEARCH_PEOPLE: 'fb_search_people_doc',
        SEARCH_PAGES: 'fb_search_pages_doc',
        SEARCH_GROUPS: 'fb_search_groups_doc',
      }
    });

    const res = await crawler.start({
      action: 'search',
      args: { query: 'AI Innovation', type: 'all' },
      session: { accountId: 'fb-search-user' },
    });

    for (const item of [...res.posts, ...res.people, ...res.pages, ...res.groups]) {
      expect(item.metadata?.isSearchResult).toBe(true);
      const validation = metadataSchemaRegistry.validateMetadata('facebook', 'social', item.metadata);
      expect(validation.valid).toBe(true);
    }
  });
});
