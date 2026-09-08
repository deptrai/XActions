import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZaloClient, createZaloClient } from '../../../../src/scrapers/social/zalo/client.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import {
  AuthSessionExpiredError,
  RateLimitError,
  BotChallengeError,
  PlatformError,
} from '../../../../src/core/error-envelope.js';

describe('Story 33.1: ZaloClient', () => {
  let client;

  beforeEach(() => {
    client = new ZaloClient({
      accessToken: 'test_token_123',
    });
  });

  it('inherits from AbstractApiClient', () => {
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.name).toBe('zalo');
    expect(client.platform).toBe('zalo');
    expect(client.baseUrl).toBe('https://openapi.zalo.me');
  });

  it('creates client with createZaloClient helper', () => {
    const helperClient = createZaloClient({ accessToken: 'helper_token' });
    expect(helperClient).toBeInstanceOf(ZaloClient);
    expect(helperClient.accessToken).toBe('helper_token');
  });

  it('buildUrl correctly constructs URLs with query params', () => {
    const url = client.buildUrl('/v3.0/oa/article/getslice', {
      offset: 0,
      limit: 10,
      type: 'normal',
    });
    expect(url).toBe('https://openapi.zalo.me/v3.0/oa/article/getslice?offset=0&limit=10&type=normal');
  });

  it('setAccessToken updates token dynamically', () => {
    client.setAccessToken('new_token_456');
    expect(client.accessToken).toBe('new_token_456');
  });

  it('throws AuthSessionExpiredError when token is missing', async () => {
    const clientNoToken = new ZaloClient({ requiresAuth: true });
    clientNoToken.accessToken = null;

    await expect(clientNoToken.get('https://openapi.zalo.me/v3.0/oa/info')).rejects.toThrow(
      AuthSessionExpiredError
    );
  });

  it('getArticles calls correct endpoint', async () => {
    const mockResponse = {
      error: 0,
      message: 'Success',
      data: { total: 2, medias: [] },
    };
    vi.spyOn(client, 'request').mockResolvedValue(mockResponse);

    const res = await client.getArticles({ offset: 10, limit: 20 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      'https://openapi.zalo.me/v3.0/oa/article/getslice?offset=10&limit=20&type=normal',
      expect.objectContaining({
        headers: expect.objectContaining({
          access_token: 'test_token_123',
        }),
      })
    );
    expect(res).toEqual(mockResponse);
  });

  it('getFollowers calls correct endpoint', async () => {
    const mockResponse = {
      error: 0,
      message: 'Success',
      data: { total: 100, users: [] },
    };
    vi.spyOn(client, 'request').mockResolvedValue(mockResponse);

    const res = await client.getFollowers({ offset: 0, count: 50 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      'https://openapi.zalo.me/v3.0/oa/user/getfollowers?offset=0&count=50',
      expect.anything()
    );
    expect(res).toEqual(mockResponse);
  });

  it('getOaInfo calls correct endpoint', async () => {
    const mockResponse = {
      error: 0,
      message: 'Success',
      data: { oa_id: '123' },
    };
    vi.spyOn(client, 'request').mockResolvedValue(mockResponse);

    const res = await client.getOaInfo();
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      'https://openapi.zalo.me/v3.0/oa/info',
      expect.anything()
    );
    expect(res).toEqual(mockResponse);
  });

  it('getProducts calls correct endpoint', async () => {
    const mockResponse = {
      error: 0,
      message: 'Success',
      data: { total: 5, products: [] },
    };
    vi.spyOn(client, 'request').mockResolvedValue(mockResponse);

    const res = await client.getProducts({ offset: 0, limit: 10 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      'https://openapi.zalo.me/v3.0/oa/product/getslice?offset=0&limit=10',
      expect.anything()
    );
    expect(res).toEqual(mockResponse);
  });

  it('throws AuthSessionExpiredError on Zalo error -216', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      error: -216,
      message: 'Access token invalid',
    });

    await expect(client.getArticles()).rejects.toThrow(AuthSessionExpiredError);
  });

  it('throws RateLimitError on Zalo error -211', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      error: -211,
      message: 'Out of quota',
    });

    await expect(client.getArticles()).rejects.toThrow(RateLimitError);
  });

  it('throws BotChallengeError on WAF challenge HTML', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      status: 200,
      body: '<html>Cloudflare challenge verify you are human</html>',
    });

    await expect(client.getArticles()).rejects.toThrow(BotChallengeError);
  });

  it('throws PlatformError on OA deactivated error -221', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      error: -221,
      message: 'OA is deactivated',
    });

    await expect(client.getArticles()).rejects.toThrow(PlatformError);
  });
});
