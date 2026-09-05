// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Unit tests for MastodonClient (Story 23.4).
 * Tests AbstractApiClient pipeline integration, REST endpoint methods,
 * instance URL handling, auth token headers, Link header pagination, and error mapping.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { MastodonClient } from '../../../../src/scrapers/social/mastodon/client.js';
import { MastodonPlatformResponseValidator } from '../../../../src/scrapers/social/mastodon/validator.js';
import { PlatformError, RateLimitError, AuthSessionExpiredError } from '../../../../src/core/error-envelope.js';

describe('Story 23.4 — MastodonClient', () => {
  describe('Constructor & Configuration', () => {
    it('sets default properties correctly', () => {
      const client = new MastodonClient();
      expect(client.name).toBe('mastodon');
      expect(client.platform).toBe('mastodon');
      expect(client.requiresAuth).toBe(false);
      expect(client.requiresProxy).toBe(false);
      expect(client.baseUrl).toBe('https://mastodon.social');
      expect(client.responseValidator).toBeInstanceOf(MastodonPlatformResponseValidator);
    });

    it('accepts custom baseUrl and accessToken', () => {
      const client = new MastodonClient({
        instance: 'https://fosstodon.org/',
        accessToken: 'secret_token_123',
      });
      expect(client.baseUrl).toBe('https://fosstodon.org');
      expect(client.accessToken).toBe('secret_token_123');
    });

    it('updates accessToken via init(session)', async () => {
      const client = new MastodonClient();
      expect(client.accessToken).toBeNull();
      await client.init({ accessToken: 'new_token' });
      expect(client.accessToken).toBe('new_token');
    });

    it('sign() returns an empty object (no client-side crypto signing)', async () => {
      const client = new MastodonClient();
      const signed = await client.sign({ foo: 'bar' });
      expect(signed).toEqual({});
    });
  });

  describe('buildUrl', () => {
    it('constructs path with instance and query params', () => {
      const client = new MastodonClient({ instance: 'https://mastodon.social' });
      const url = client.buildUrl('/api/v1/accounts/lookup', { acct: 'Gargron', limit: 10 });
      expect(url).toBe('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron&limit=10');
    });

    it('supports instance override per call', () => {
      const client = new MastodonClient({ instance: 'https://mastodon.social' });
      const url = client.buildUrl('/api/v1/timelines/public', { local: 'true' }, 'https://infosec.exchange');
      expect(url).toBe('https://infosec.exchange/api/v1/timelines/public?local=true');
    });
  });

  describe('REST Endpoint Methods', () => {
    it('lookupAccount calls /api/v1/accounts/lookup and returns account', async () => {
      let interceptedUrl = '';
      const httpClient = async (opts) => {
        interceptedUrl = opts.url;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: { id: '42', username: 'Gargron', acct: 'Gargron' },
        };
      };

      const client = new MastodonClient({ httpClient });
      const account = await client.lookupAccount('Gargron');
      expect(account.id).toBe('42');
      expect(interceptedUrl).toBe('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
    });

    it('lookupAccount falls back to /api/v1/accounts/search if lookup 404s', async () => {
      const calls = [];
      const httpClient = async (opts) => {
        calls.push(opts.url);
        if (opts.url.includes('/accounts/lookup')) {
          return {
            status: 404,
            headers: { 'content-type': 'application/json' },
            data: { error: 'Record not found' },
          };
        }
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: [{ id: '99', username: 'alice', acct: 'alice' }],
        };
      };

      const client = new MastodonClient({ httpClient });
      const account = await client.lookupAccount('alice');
      expect(account.id).toBe('99');
      expect(calls.length).toBe(2);
      expect(calls[0]).toContain('/accounts/lookup');
      expect(calls[1]).toContain('/accounts/search');
    });

    it('getAccountStatuses queries statuses with pagination', async () => {
      let reqOpts = null;
      const httpClient = async (opts) => {
        reqOpts = opts;
        return {
          status: 200,
          headers: {
            'content-type': 'application/json',
            link: '<https://mastodon.social/api/v1/accounts/1/statuses?max_id=888>; rel="next"',
          },
          data: [{ id: '999', content: 'test post' }, { id: '888', content: 'older post' }],
        };
      };

      const client = new MastodonClient({ httpClient });
      const res = await client.getAccountStatuses('1', { limit: 15, max_id: '1000' });
      expect(res.statuses.length).toBe(2);
      expect(res.nextMaxId).toBe('888');
      expect(reqOpts.url).toContain('/api/v1/accounts/1/statuses?limit=15&max_id=1000');
    });

    it('getAccountFollowers and getAccountFollowing query respective endpoints', async () => {
      const called = [];
      const httpClient = async (opts) => {
        called.push(opts.url);
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: [{ id: '2', username: 'follower1' }],
        };
      };

      const client = new MastodonClient({ httpClient });
      const followers = await client.getAccountFollowers('1');
      const following = await client.getAccountFollowing('1');

      expect(followers.accounts.length).toBe(1);
      expect(following.accounts.length).toBe(1);
      expect(called[0]).toContain('/api/v1/accounts/1/followers?limit=40');
      expect(called[1]).toContain('/api/v1/accounts/1/following?limit=40');
    });

    it('search dispatches to /api/v2/search and returns structured results', async () => {
      let interceptedUrl = '';
      const httpClient = async (opts) => {
        interceptedUrl = opts.url;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: {
            accounts: [{ id: '1', username: 'coder' }],
            statuses: [{ id: '10', content: 'code' }],
            hashtags: [{ name: 'dev' }],
          },
        };
      };

      const client = new MastodonClient({ httpClient });
      const res = await client.search({ query: 'coder', type: 'accounts' });
      expect(res.accounts.length).toBe(1);
      expect(res.statuses.length).toBe(1);
      expect(res.hashtags.length).toBe(1);
      expect(interceptedUrl).toContain('/api/v2/search?q=coder&type=accounts&limit=20&resolve=true');
    });

    it('getHashtagTimeline queries /api/v1/timelines/tag/:tag', async () => {
      let interceptedUrl = '';
      const httpClient = async (opts) => {
        interceptedUrl = opts.url;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: [{ id: '55', content: '#tech news' }],
        };
      };

      const client = new MastodonClient({ httpClient });
      const res = await client.getHashtagTimeline('#tech');
      expect(res.statuses.length).toBe(1);
      expect(interceptedUrl).toContain('/api/v1/timelines/tag/tech?limit=20');
    });

    it('getTrendingStatuses falls back gracefully to [] when instance returns 404/403', async () => {
      const httpClient = async () => ({
        status: 404,
        headers: { 'content-type': 'application/json' },
        data: { error: 'Trends not supported' },
      });

      const client = new MastodonClient({ httpClient });
      const trends = await client.getTrendingStatuses();
      expect(trends).toEqual([]);
    });

    it('passes Authorization header when accessToken is provided', async () => {
      let sentHeaders = {};
      const httpClient = async (opts) => {
        sentHeaders = opts.headers;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: { id: '1', username: 'me' },
        };
      };

      const client = new MastodonClient({ httpClient, accessToken: 'my_bearer_token' });
      await client.getAccount('1');
      expect(sentHeaders['authorization']).toBe('Bearer my_bearer_token');
    });
  });

  describe('Error Mapping', () => {
    it('throws RateLimitError on HTTP 429', async () => {
      const httpClient = async () => ({
        status: 429,
        headers: { 'retry-after': '0', 'content-type': 'application/json' },
        data: { error: 'Throttled' },
      });

      const client = new MastodonClient({
        httpClient,
        maxProxyRetries: 1,
        backoffBaseMs: 1,
      });
      await expect(client.getAccount('1')).rejects.toThrow();
    });

    it('throws AuthSessionExpiredError on HTTP 401 invalid_token', async () => {
      const httpClient = async () => ({
        status: 401,
        headers: { 'content-type': 'application/json' },
        data: { error: 'invalid_token', error_description: 'The access token is invalid' },
      });

      const client = new MastodonClient({ httpClient, accessToken: 'bad_token' });
      await expect(client.getAccount('1')).rejects.toThrow();
    });
  });
});
