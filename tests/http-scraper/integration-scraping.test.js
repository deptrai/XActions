// by nichxbt
/**
 * Integration Tests — Scraping Flows (End-to-End with Mocked Fetch)
 *
 * Covers: Profile Scrape, Tweet Scrape with Pagination,
 * Non-Follower Detection, Search via GraphQL, Thread Reconstruction.
 *
 * NOTE: client.graphql() wraps raw JSON as { data: json, cursor }.
 * Consumers access response.data.xxx, so the fetch mock must return
 * the INNER part of the Twitter API response (without the outer `data`
 * wrapper). Use `graphqlBody(FIXTURE)` helper to strip it.
 *
 * @see fixtures/responses.js
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Core modules under test
import {
  TwitterHttpClient,
  WaitingRateLimitStrategy,
} from '../../src/scrapers/twitter/http/client.js';
import {
  GRAPHQL,
  GRAPHQL_BASE,
  REST,
  REST_BASE,
  BEARER_TOKEN,
} from '../../src/scrapers/twitter/http/endpoints.js';
import {
  AuthError,
  RateLimitError,
  NotFoundError,
  NetworkError,
} from '../../src/scrapers/twitter/http/errors.js';

// Scraper modules
import { scrapeProfile, parseUserData } from '../../src/scrapers/twitter/http/profile.js';
import {
  scrapeFollowers,
  scrapeFollowing,
  scrapeNonFollowers,
  parseUserList,
} from '../../src/scrapers/twitter/http/relationships.js';

// Fixtures
import {
  PROFILE_RESPONSE,
  TWEETS_RESPONSE,
  TWEETS_RESPONSE_PAGE2,
  FOLLOWERS_RESPONSE,
  FOLLOWING_RESPONSE,
  SEARCH_RESPONSE,
  THREAD_RESPONSE,
  USER_RESOLVE_RESPONSE,
  mockResponse,
} from './fixtures/responses.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip the outer `data` wrapper from a fixture for fetch-level mocking.
 * client.graphql() adds its own { data: json, cursor } wrapper, so
 * consumers access response.data.xxx = json.xxx.
 *
 * @param {object} fixture — Full realistic Twitter API response
 * @returns {object} Inner content suitable for mock fetch json()
 */
const graphqlBody = (fixture) => fixture.data ?? fixture;

/**
 * Create an authenticated TwitterHttpClient with a mock fetch.
 *
 * @param {Function} fetchImpl — vi.fn() mock
 * @param {object} [opts] — Extra client options
 * @returns {TwitterHttpClient}
 */
function createClient(fetchImpl, opts = {}) {
  return new TwitterHttpClient({
    cookies: 'auth_token=tok123; ct0=csrf456',
    fetch: fetchImpl,
    maxRetries: opts.maxRetries ?? 0,
    ...opts,
  });
}

/**
 * Create a URL-matching mock fetch that routes responses by URL substring.
 *
 * @param {Array<[string, object]>} routes — [[urlSubstring, mockResponseObj]]
 * @param {object} [fallback] — Default response if no route matches
 * @returns {Function}
 */
function routedFetch(routes, fallback = mockResponse({})) {
  return vi.fn(async (url) => {
    for (const [pattern, response] of routes) {
      if (url.includes(pattern)) return response;
    }
    return fallback;
  });
}

// ===========================================================================
// 1. Full Profile Scrape Flow
// ===========================================================================

describe('Integration: Full Profile Scrape Flow', () => {
  it('mocked fetch → client → scrapeProfile → parsed profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(PROFILE_RESPONSE)),
    );
    const client = createClient(fetchMock);

    const profile = await scrapeProfile(client, 'testuser');

    // Verify output has all expected fields
    expect(profile.id).toBe('1890123456');
    expect(profile.name).toBe('Sarah Developer');
    expect(profile.username).toBe('testuser');
    expect(profile.bio).toContain('Full-stack dev');
    expect(profile.location).toBe('San Francisco, CA');
    expect(profile.website).toBe('https://sarahdev.io');
    expect(profile.following).toBe(890);
    expect(profile.followers).toBe(24500);
    expect(profile.tweets).toBe(12340);
    expect(profile.likes).toBe(45600);
    expect(profile.media).toBe(567);
    expect(profile.verified).toBe(true);
    expect(profile.protected).toBe(false);
    expect(profile.pinnedTweetId).toBe('1800000000000000001');
    expect(profile.platform).toBe('twitter');
    expect(profile.avatar).toContain('_400x400');
    expect(profile.avatar).not.toContain('_normal');
    expect(profile.header).toBeTruthy();
    expect(profile.joined).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(profile.bioEntities).toBeDefined();
  });

  it('verifies request URL, headers, and query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(PROFILE_RESPONSE)),
    );
    const client = createClient(fetchMock);

    await scrapeProfile(client, 'testuser');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];

    // URL contains GraphQL base and UserByScreenName
    expect(url).toContain(GRAPHQL_BASE);
    expect(url).toContain(GRAPHQL.UserByScreenName.queryId);
    expect(url).toContain('UserByScreenName');

    // Should be GET for queries
    expect(opts.method).toBe('GET');

    // Headers include bearer token and auth
    expect(opts.headers.authorization).toContain('Bearer');
    expect(opts.headers['x-csrf-token']).toBe('csrf456');
    expect(opts.headers['x-twitter-auth-type']).toBe('OAuth2Session');
    expect(opts.headers.cookie).toContain('auth_token=tok123');

    // URL query params include variables with screen_name
    const parsed = new URL(url);
    const variables = JSON.parse(parsed.searchParams.get('variables'));
    expect(variables.screen_name).toBe('testuser');
    expect(variables.withSafetyModeUserFields).toBe(true);

    // Features param exists
    const features = JSON.parse(parsed.searchParams.get('features'));
    expect(features).toBeDefined();
    expect(typeof features).toBe('object');
  });

  it('throws NotFoundError for missing user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ user: { result: null } }),
    );
    const client = createClient(fetchMock);

    await expect(scrapeProfile(client, 'ghostuser')).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
// 2. Full Tweet Scrape Flow with Pagination
// ===========================================================================

describe('Integration: Tweet Scrape with Pagination', () => {
  it('paginates through tweets using cursors via client.graphqlPaginate', async () => {
    // First page has tweets + cursor, second page has tweets + no cursor
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(graphqlBody(TWEETS_RESPONSE)))
      .mockResolvedValueOnce(mockResponse(graphqlBody(TWEETS_RESPONSE_PAGE2)));

    const client = createClient(fetchMock);
    const { queryId, operationName } = GRAPHQL.UserTweets;

    const pages = [];
    for await (const page of client.graphqlPaginate(queryId, operationName, {
      userId: '1890123456',
      count: 20,
      includePromotedContent: false,
    }, { limit: 5 })) {
      pages.push(page);
    }

    // Should have fetched 2 pages
    expect(pages.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First page should have a cursor
    expect(pages[0].cursor).toBeTruthy();

    // Second page should have no cursor (end of timeline)
    expect(pages[1].cursor).toBeNull();

    // Verify cursor was passed on the second request
    const secondUrl = fetchMock.mock.calls[1][0];
    expect(secondUrl).toContain('cursor');
    // The URL should contain the cursor from the first page
    const parsedUrl = new URL(secondUrl);
    const vars = JSON.parse(parsedUrl.searchParams.get('variables'));
    expect(vars.cursor).toBeTruthy();
  });

  it('verifies tweet entries are present in the response data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(TWEETS_RESPONSE)),
    );
    const client = createClient(fetchMock);
    const { queryId, operationName } = GRAPHQL.UserTweets;

    const result = await client.graphql(queryId, operationName, {
      userId: '1890123456',
      count: 20,
    });

    // Navigate the response to verify tweet entries
    const instructions = result.data?.user?.result?.timeline_v2?.timeline?.instructions;
    expect(instructions).toBeDefined();
    expect(instructions.length).toBeGreaterThan(0);

    const entries = instructions[0].entries;
    const tweetEntries = entries.filter(
      (e) => (e.entryId || '').startsWith('tweet-'),
    );
    expect(tweetEntries.length).toBe(3);

    // Verify tweet content
    const firstTweet = tweetEntries[0].content.itemContent.tweet_results.result;
    expect(firstTweet.rest_id).toBe('1800000000000000001');
    expect(firstTweet.legacy.full_text).toContain('shipped a new feature');
  });
});

// ===========================================================================
// 3. Non-Follower Detection Flow
// ===========================================================================

describe('Integration: Non-Follower Detection Flow', () => {
  it('scrapes followers and following, then computes non-followers', async () => {
    // scrapeNonFollowers calls:
    //   1. scrapeFollowing → resolveUserId (UserByScreenName) + Following endpoint
    //   2. scrapeFollowers → resolveUserId (UserByScreenName) + Followers endpoint
    // Total: minimum 4 fetch calls
    // FOLLOWERS_RESPONSE has a cursor, so we must return a no-cursor page on the 2nd call
    // to prevent infinite pagination (seen.size=5 never reaches limit=100).
    let followersPageCount = 0;
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('UserByScreenName')) {
        return mockResponse(graphqlBody(USER_RESOLVE_RESPONSE));
      }
      if (url.includes(GRAPHQL.Following.operationName)) {
        return mockResponse(graphqlBody(FOLLOWING_RESPONSE));
      }
      if (url.includes(GRAPHQL.Followers.operationName)) {
        followersPageCount++;
        // Return empty page on 2nd call so pagination terminates
        if (followersPageCount > 1) return mockResponse({});
        return mockResponse(graphqlBody(FOLLOWERS_RESPONSE));
      }
      return mockResponse({});
    });

    const client = createClient(fetchMock);

    const result = await scrapeNonFollowers(client, 'testuser', { limit: 100 });

    // FOLLOWING_RESPONSE has: alice_dev, carol_ml, frank_ai, grace_ui
    // FOLLOWERS_RESPONSE has: alice_dev, bob_codes, carol_ml, dave_ops, eve_sec
    // Mutuals: alice_dev, carol_ml (in both lists)
    // Non-followers: frank_ai, grace_ui (only in following, not in followers)

    expect(result.nonFollowers).toHaveLength(2);
    expect(result.mutuals).toHaveLength(2);

    const nonFollowerNames = result.nonFollowers.map((u) => u.username);
    expect(nonFollowerNames).toContain('frank_ai');
    expect(nonFollowerNames).toContain('grace_ui');

    const mutualNames = result.mutuals.map((u) => u.username);
    expect(mutualNames).toContain('alice_dev');
    expect(mutualNames).toContain('carol_ml');

    expect(result.stats.following).toBe(4);
    expect(result.stats.followers).toBe(5);
    expect(result.stats.nonFollowers).toBe(2);
    expect(result.stats.mutuals).toBe(2);
  });

  it('verifies set comparison is correct with overlapping lists', async () => {
    // Minimal inline test — parse user lists directly
    const followersInstructions = graphqlBody(FOLLOWERS_RESPONSE)
      .user.result.timeline.timeline.instructions;
    const followingInstructions = graphqlBody(FOLLOWING_RESPONSE)
      .user.result.timeline.timeline.instructions;

    const followers = parseUserList(followersInstructions);
    const following = parseUserList(followingInstructions);

    expect(followers.users.length).toBe(5);
    expect(following.users.length).toBe(4);

    // Manual set comparison
    const followerSet = new Set(followers.users.map((u) => u.username));
    const nonFollowers = following.users.filter((u) => !followerSet.has(u.username));
    expect(nonFollowers.length).toBe(2);
    expect(nonFollowers.map((u) => u.username).sort()).toEqual(['frank_ai', 'grace_ui']);
  });
});

// ===========================================================================
// 4. Search with Advanced Query
// ===========================================================================

describe('Integration: Search via GraphQL', () => {
  it('sends search query to SearchTimeline and processes results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(SEARCH_RESPONSE)),
    );
    const client = createClient(fetchMock);

    const { queryId, operationName } = GRAPHQL.SearchTimeline;
    const result = await client.graphql(queryId, operationName, {
      rawQuery: 'javascript lang:en',
      count: 20,
      querySource: 'typed_query',
      product: 'Latest',
    });

    // Verify fetch was called with correct query params
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(GRAPHQL.SearchTimeline.queryId);
    expect(url).toContain('SearchTimeline');

    // Verify search variables were sent
    const parsed = new URL(url);
    const variables = JSON.parse(parsed.searchParams.get('variables'));
    expect(variables.rawQuery).toBe('javascript lang:en');
    expect(variables.product).toBe('Latest');

    // Verify search results are parseable
    const timeline = result.data?.search_by_raw_query?.search_timeline?.timeline;
    expect(timeline).toBeDefined();
    const entries = timeline.instructions[0].entries;
    const tweetEntries = entries.filter((e) => (e.entryId || '').startsWith('tweet-'));
    expect(tweetEntries.length).toBe(3);

    // Verify cursor exists for pagination
    expect(result.cursor).toBeTruthy();
  });

  it('encodes query parameters correctly in URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(SEARCH_RESPONSE)),
    );
    const client = createClient(fetchMock);
    const { queryId, operationName } = GRAPHQL.SearchTimeline;

    await client.graphql(queryId, operationName, {
      rawQuery: 'from:testuser "hello world" OR #coding',
      count: 20,
    });

    const [url] = fetchMock.mock.calls[0];
    // Verify the complex query is URL-encoded correctly — URLSearchParams uses + for spaces,
    // so check via decoded variables rather than raw encodeURIComponent
    const parsedUrl = new URL(url);
    const variables = JSON.parse(parsedUrl.searchParams.get('variables'));
    expect(variables.rawQuery).toContain('"hello world"');
  });
});

// ===========================================================================
// 10. Thread Reconstruction
// ===========================================================================

describe('Integration: Thread Reconstruction', () => {
  it('fetches TweetDetail and reconstructs the thread order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(THREAD_RESPONSE)),
    );
    const client = createClient(fetchMock);

    const { queryId, operationName } = GRAPHQL.TweetDetail;
    const result = await client.graphql(queryId, operationName, {
      focalTweetId: '1810000000000000001',
      with_rux_injections: false,
      rankingMode: 'Relevance',
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
    });

    // Verify TweetDetail response has threaded conversation
    const threadInstructions = result.data?.threaded_conversation_with_injections_v2?.instructions;
    expect(threadInstructions).toBeDefined();
    expect(threadInstructions.length).toBeGreaterThan(0);

    // Extract tweet entries from the thread
    const entries = threadInstructions[0].entries;
    const tweetEntries = entries.filter((e) =>
      (e.entryId || '').startsWith('tweet-'),
    );

    // Should have 3 tweets in the thread
    expect(tweetEntries.length).toBe(3);

    // Verify order: thread opener → reply 2 → reply 3
    const tweets = tweetEntries.map(
      (e) => e.content.itemContent.tweet_results.result,
    );

    expect(tweets[0].rest_id).toBe('1810000000000000001');
    expect(tweets[0].legacy.full_text).toContain('1/3');
    expect(tweets[0].legacy.in_reply_to_status_id_str).toBeNull();

    expect(tweets[1].rest_id).toBe('1810000000000000002');
    expect(tweets[1].legacy.full_text).toContain('2/3');
    expect(tweets[1].legacy.in_reply_to_status_id_str).toBe('1810000000000000001');

    expect(tweets[2].rest_id).toBe('1810000000000000003');
    expect(tweets[2].legacy.full_text).toContain('3/3');
    expect(tweets[2].legacy.in_reply_to_status_id_str).toBe('1810000000000000002');

    // Verify thread chain: each tweet replies to the previous
    for (let i = 1; i < tweets.length; i++) {
      expect(tweets[i].legacy.in_reply_to_status_id_str).toBe(tweets[i - 1].rest_id);
    }

    // All belong to the same conversation
    const conversationIds = tweets.map((t) => t.legacy.conversation_id_str);
    expect(new Set(conversationIds).size).toBe(1);
    expect(conversationIds[0]).toBe('1810000000000000001');
  });

  it('verifies TweetDetail request format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(THREAD_RESPONSE)),
    );
    const client = createClient(fetchMock);

    const { queryId, operationName } = GRAPHQL.TweetDetail;
    await client.graphql(queryId, operationName, {
      focalTweetId: '1810000000000000001',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(GRAPHQL.TweetDetail.queryId);
    expect(url).toContain('TweetDetail');

    // Variables should include the focal tweet ID
    const parsed = new URL(url);
    const variables = JSON.parse(parsed.searchParams.get('variables'));
    expect(variables.focalTweetId).toBe('1810000000000000001');
  });
});
