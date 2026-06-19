// by nichxbt
/**
 * Integration Tests — Mutation Flows (End-to-End with Mocked Fetch)
 *
 * Covers: Post Tweet → Like → Delete, Media Upload.
 *
 * NOTE: client.graphql() wraps raw JSON as { data: json, cursor }.
 * Mutations use client.graphql({ mutation: true }) which returns
 * client.request() directly (no data-wrap).
 *
 * @see fixtures/responses.js
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';

// Core modules under test
import {
  TwitterHttpClient,
} from '../../src/scrapers/twitter/http/client.js';
import {
  GRAPHQL,
} from '../../src/scrapers/twitter/http/endpoints.js';

// Scraper modules
import { postTweet, deleteTweet } from '../../src/scrapers/twitter/http/actions.js';
import { likeTweet, unlikeTweet } from '../../src/scrapers/twitter/http/engagement.js';

// Fixtures
import {
  TWEET_CREATE_RESPONSE,
  LIKE_RESPONSE,
  DELETE_TWEET_RESPONSE,
  MEDIA_INIT_RESPONSE,
  MEDIA_FINALIZE_RESPONSE,
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

// ===========================================================================
// 5. Post Tweet → Like → Delete Flow
// ===========================================================================

describe('Integration: Post Tweet → Like → Delete Flow', () => {
  it('chains create, like, and delete mutations end-to-end', async () => {
    // Mutations: client.graphql({ mutation: true }) returns client.request() directly (no data-wrap).
    // parseTweetResult looks for json.data.create_tweet, so pass the full fixture (with data wrapper).
    const fetchMock = vi.fn(async (url) => {
      if (url.includes(GRAPHQL.CreateTweet.operationName)) {
        return mockResponse(TWEET_CREATE_RESPONSE);
      }
      if (url.includes(GRAPHQL.FavoriteTweet.operationName)) {
        return mockResponse(LIKE_RESPONSE);
      }
      if (url.includes(GRAPHQL.DeleteTweet.operationName)) {
        return mockResponse(DELETE_TWEET_RESPONSE);
      }
      return mockResponse({});
    });

    const client = createClient(fetchMock);

    // Step 1: Post a tweet
    const tweet = await postTweet(client, 'Hello from integration tests! 🎉');
    expect(tweet).toBeDefined();
    expect(tweet.rest_id || tweet.legacy?.id_str).toBeTruthy();

    const tweetId = tweet.rest_id ?? tweet.legacy?.id_str ?? '1820000000000000001';

    // Step 2: Like the tweet
    const likeResult = await likeTweet(client, tweetId);
    expect(likeResult).toEqual({ success: true });

    // Step 3: Delete the tweet
    const deleteResult = await deleteTweet(client, tweetId);
    expect(deleteResult).toEqual({ success: true });

    // Verify all 3 mutations were called
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('verifies each mutation sends correct request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(TWEET_CREATE_RESPONSE)),
    );
    const client = createClient(fetchMock);

    await postTweet(client, 'Test tweet body', {
      replyTo: '111',
      mediaIds: ['media1', 'media2'],
    });

    const [url, opts] = fetchMock.mock.calls[0];

    // Should be POST mutation
    expect(opts.method).toBe('POST');
    expect(url).toContain(GRAPHQL.CreateTweet.queryId);

    // Body should contain the tweet text and options
    const body = JSON.parse(opts.body);
    expect(body.variables.tweet_text).toBe('Test tweet body');
    expect(body.variables.reply.in_reply_to_tweet_id).toBe('111');
    expect(body.variables.media.media_entities).toHaveLength(2);
    expect(body.variables.media.media_entities[0].media_id).toBe('media1');
  });

  it('verifies like mutation body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(graphqlBody(LIKE_RESPONSE)));
    const client = createClient(fetchMock);

    await likeTweet(client, '777');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(GRAPHQL.FavoriteTweet.queryId);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.variables.tweet_id).toBe('777');
  });

  it('verifies delete mutation body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(graphqlBody(DELETE_TWEET_RESPONSE)));
    const client = createClient(fetchMock);

    await deleteTweet(client, '888');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(GRAPHQL.DeleteTweet.queryId);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.variables.tweet_id).toBe('888');
  });
});

// ===========================================================================
// 6. Media Upload Flow (INIT → APPEND → FINALIZE)
// ===========================================================================

describe('Integration: Media Upload Flow', () => {
  it('executes 3-step chunked upload with correct sequence', async () => {
    // Mock client.rest for upload — the media module calls client.rest()
    // with upload URLs that go through the REST path
    const restMock = vi.fn()
      .mockResolvedValueOnce(MEDIA_INIT_RESPONSE)       // INIT
      .mockResolvedValueOnce({})                         // APPEND
      .mockResolvedValueOnce(MEDIA_FINALIZE_RESPONSE)    // FINALIZE (has processing_info)
      .mockResolvedValueOnce({});                        // STATUS poll → no processing_info → returns

    const mockClient = {
      rest: restMock,
      request: restMock,
      isAuthenticated: () => true,
    };

    // Import uploadChunked dynamically to test it
    const { uploadChunked } = await import(
      '../../src/scrapers/twitter/http/media.js'
    );

    // 1 KB buffer — small enough for a single chunk
    const smallBuffer = Buffer.alloc(1024, 0xff);

    const result = await uploadChunked(
      mockClient,
      smallBuffer,
      'image/jpeg',
      'tweet_image',
    );

    expect(result.mediaId).toBe('1830000000000000001');
    expect(result.mediaKey).toBe('3_1830000000000000001');

    // Verify 4 calls: INIT, APPEND, FINALIZE, STATUS poll
    expect(restMock).toHaveBeenCalledTimes(4);

    // Verify INIT call includes total_bytes
    const initCall = restMock.mock.calls[0];
    expect(initCall).toBeDefined();
  });

  it('splits large files into multiple APPEND chunks', async () => {
    // 11 MB buffer → should be split into 3 chunks (5MB + 5MB + 1MB)
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 0xab);

    const restMock = vi.fn()
      .mockResolvedValueOnce(MEDIA_INIT_RESPONSE)    // INIT
      .mockResolvedValueOnce({})                      // APPEND chunk 0
      .mockResolvedValueOnce({})                      // APPEND chunk 1
      .mockResolvedValueOnce({})                      // APPEND chunk 2
      .mockResolvedValueOnce(MEDIA_FINALIZE_RESPONSE) // FINALIZE (has processing_info)
      .mockResolvedValueOnce({});                     // STATUS poll → no processing_info → returns

    const mockClient = {
      rest: restMock,
      request: restMock,
      isAuthenticated: () => true,
    };

    const { uploadChunked } = await import(
      '../../src/scrapers/twitter/http/media.js'
    );

    const result = await uploadChunked(
      mockClient,
      largeBuffer,
      'video/mp4',
      'tweet_video',
    );

    expect(result.mediaId).toBe('1830000000000000001');

    // INIT + 3 APPEND + FINALIZE + STATUS poll = 6 calls
    expect(restMock).toHaveBeenCalledTimes(6);
  });
});
