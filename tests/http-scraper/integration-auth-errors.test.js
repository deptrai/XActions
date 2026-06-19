// by nichxbt
/**
 * Integration Tests — Auth & Error Handling (End-to-End with Mocked Fetch)
 *
 * Covers: Rate Limit Recovery, Auth Error Handling,
 * Guest Token + Public Scrape.
 *
 * NOTE: client.graphql() wraps raw JSON as { data: json, cursor }.
 * Consumers access response.data.xxx, so the fetch mock must return
 * the INNER part of the Twitter API response (without the outer `data`
 * wrapper). Use `graphqlBody(FIXTURE)` helper to strip it.
 *
 * @see fixtures/responses.js
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';

// Core modules under test
import {
  TwitterHttpClient,
  WaitingRateLimitStrategy,
} from '../../src/scrapers/twitter/http/client.js';
import {
  GRAPHQL,
  GRAPHQL_BASE,
} from '../../src/scrapers/twitter/http/endpoints.js';
import {
  AuthError,
  RateLimitError,
  NotFoundError,
  NetworkError,
} from '../../src/scrapers/twitter/http/errors.js';

// Scraper modules
import { scrapeProfile } from '../../src/scrapers/twitter/http/profile.js';
import { postTweet } from '../../src/scrapers/twitter/http/actions.js';
import { likeTweet, unlikeTweet } from '../../src/scrapers/twitter/http/engagement.js';
import { deleteTweet } from '../../src/scrapers/twitter/http/actions.js';
import { GuestTokenManager } from '../../src/scrapers/twitter/http/guest.js';

// Fixtures
import {
  PROFILE_RESPONSE,
  GUEST_TOKEN_RESPONSE,
  mockResponse,
  makeRateLimitResponse,
  makeAuthErrorResponse,
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
// 7. Rate Limit Recovery
// ===========================================================================

describe('Integration: Rate Limit Recovery', () => {
  it('retries after 429 with wait strategy and succeeds on second attempt', async () => {
    const now = Math.floor(Date.now() / 1000);
    // First call returns 429, second call returns success
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeRateLimitResponse(now + 1)) // 429, resets in 1 sec
      .mockResolvedValueOnce(mockResponse(graphqlBody(PROFILE_RESPONSE)));

    const client = new TwitterHttpClient({
      cookies: 'auth_token=tok123; ct0=csrf456',
      fetch: fetchMock,
      rateLimitStrategy: 'wait',
      maxRetries: 3,
    });

    const startTime = Date.now();
    const profile = await scrapeProfile(client, 'testuser');
    const elapsed = Date.now() - startTime;

    // Should have succeeded after waiting
    expect(profile.username).toBe('testuser');
    expect(profile.id).toBe('1890123456');

    // Should have waited at least ~1 second (the rate limit reset)
    expect(elapsed).toBeGreaterThanOrEqual(500);

    // Two fetch calls: first 429, second success
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitError with error strategy (default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRateLimitResponse());
    const client = createClient(fetchMock);

    await expect(scrapeProfile(client, 'testuser')).rejects.toThrow(RateLimitError);
  });

  it('includes rate limit headers in error context', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 300;
    const fetchMock = vi.fn().mockResolvedValue(makeRateLimitResponse(resetAt));
    const client = createClient(fetchMock);

    const err = await scrapeProfile(client, 'testuser').catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt).toBeTruthy();
  });
});

// ===========================================================================
// 8. Auth Error → AuthError thrown
// ===========================================================================

describe('Integration: Auth Error Handling', () => {
  it('throws AuthError on 401 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeAuthErrorResponse());
    const client = createClient(fetchMock);

    await expect(scrapeProfile(client, 'testuser')).rejects.toThrow(AuthError);
  });

  it('AuthError has correct status code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeAuthErrorResponse());
    const client = createClient(fetchMock);

    const err = await scrapeProfile(client, 'testuser').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('Authentication failed');
  });

  it('does NOT retry on auth errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeAuthErrorResponse());
    const client = new TwitterHttpClient({
      cookies: 'auth_token=tok123; ct0=csrf456',
      fetch: fetchMock,
      maxRetries: 3, // 3 retries — but auth errors should NOT retry
    });

    await expect(scrapeProfile(client, 'testuser')).rejects.toThrow(AuthError);
    // Only 1 fetch call — no retries for auth errors
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires auth for write operations', async () => {
    const fetchMock = vi.fn();
    const unauthClient = new TwitterHttpClient({
      fetch: fetchMock,
      maxRetries: 0,
    });

    await expect(postTweet(unauthClient, 'test')).rejects.toThrow(AuthError);
    await expect(likeTweet(unauthClient, '123')).rejects.toThrow(AuthError);
    await expect(deleteTweet(unauthClient, '123')).rejects.toThrow(AuthError);

    // No fetch calls should have been made
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. Guest Token → Public Scrape
// ===========================================================================

describe('Integration: Guest Token + Public Scrape', () => {
  it('activates a guest token via mocked fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(GUEST_TOKEN_RESPONSE),
    );

    const guest = new GuestTokenManager({ fetch: fetchMock });
    const token = await guest.activate();

    expect(token).toBeDefined();
    expect(token.value).toBe('1890567890123456789');
    expect(token.isExpired()).toBe(false);

    // Verify the activation request
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('guest/activate');
    expect(opts.method).toBe('POST');
    expect(opts.headers.authorization).toContain('Bearer');
  });

  it('provides correct unauthenticated headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(GUEST_TOKEN_RESPONSE),
    );

    const guest = new GuestTokenManager({ fetch: fetchMock });
    const headers = await guest.getHeaders();

    expect(headers['x-guest-token']).toBe('1890567890123456789');
    expect(headers.authorization).toContain('Bearer');
    expect(headers['user-agent']).toBeTruthy();

    // No auth-specific headers
    expect(headers['x-csrf-token']).toBeUndefined();
    expect(headers['x-twitter-auth-type']).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  });

  it('unauthenticated client sends no auth cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(graphqlBody(PROFILE_RESPONSE)),
    );

    // Create client WITHOUT cookies
    const client = new TwitterHttpClient({
      fetch: fetchMock,
      maxRetries: 0,
    });

    // Use graphql endpoint directly (scrapeProfile may require auth for some paths)
    const { queryId, operationName } = GRAPHQL.UserByScreenName;
    await client.graphql(queryId, operationName, {
      screen_name: 'publicuser',
    });

    const [, opts] = fetchMock.mock.calls[0];
    // No cookie header for unauthenticated requests
    // x-csrf-token and x-twitter-auth-type are only added for authenticated clients
    expect(opts.headers.cookie).toBeUndefined();
    expect(opts.headers['x-csrf-token']).toBeUndefined();
    expect(opts.headers['x-twitter-auth-type']).toBeUndefined();
  });
});
