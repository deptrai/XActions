// @ts-nocheck
// tests/scrapers/social/telegram/client-mtproto.test.js
// Story 54.6 — TelegramClient mtproto transport & normalizer tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { TelegramClient } from '../../../../src/scrapers/social/telegram/client.js';
import { normalizeTelegramPostItem } from '../../../../src/scrapers/social/telegram/normalizer.js';

describe('Story 54.6 — TelegramClient mtproto transport & normalizer', () => {
  it('T-1: mtproto transport routes getChannelMessages to /channel/messages via HTTP', async () => {
    let capturedUrl = '';
    let capturedBody = null;
    let capturedHeaders = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      capturedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          channelId: '123456',
          messages: [
            { id: 1, text: 'Hello Solana $SOL', date: 1710000000, views: 100, forwards: 5 },
            { id: 2, text: 'Ethereum update $ETH', date: 1710000010, views: 200, forwards: 10 },
          ],
        }),
      };
    };

    const client = new TelegramClient({
      transport: 'mtproto',
      relayUrl: 'http://127.0.0.1:3800',
      relayToken: 'mock_hex_token_1234567890abcdef',
      fetchFn: mockFetch,
    });

    const messages = await client.getChannelMessages('crypto_news', { limit: 10 });
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(1);
    expect(capturedUrl).toBe('http://127.0.0.1:3800/channel/messages');
    expect(capturedBody).toEqual({ channel: 'crypto_news', limit: 10 });
    expect(capturedHeaders.authorization).toBe('Bearer mock_hex_token_1234567890abcdef');
  });

  it('T-2: mtproto transport routes getChannelInfo and searchChannels', async () => {
    const mockFetch = async (url) => {
      if (url.endsWith('/channel/info')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            channel: { channel: 'durov', title: 'Durov Channel', memberCount: 500000 },
          }),
        };
      }
      if (url.endsWith('/channel/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            results: [{ channel: 'solana_alpha', title: 'Solana Alpha' }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    };

    const client = new TelegramClient({
      transport: 'mtproto',
      fetchFn: mockFetch,
    });

    const info = await client.getChannelInfo('durov');
    expect(info.title).toBe('Durov Channel');
    expect(info.memberCount).toBe(500000);

    const search = await client.searchChannels('solana', { limit: 5 });
    expect(search).toHaveLength(1);
    expect(search[0].channel).toBe('solana_alpha');
  });

  it('T-3: relay 401 maps to AUTH_EXPIRED / XACT_4011', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const client = new TelegramClient({
      transport: 'mtproto',
      fetchFn: mockFetch,
    });

    await expect(client.getChannelMessages('durov')).rejects.toMatchObject({
      code: 'XACT_4011',
      statusCode: 401,
    });
  });

  it('T-4: relay FLOOD_WAIT 503 maps to RATE_LIMIT / XACT_4291 with cooldown details', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'FLOOD_WAIT_30' }),
    });

    const client = new TelegramClient({
      transport: 'mtproto',
      fetchFn: mockFetch,
    });

    await expect(client.getChannelMessages('durov')).rejects.toMatchObject({
      code: 'XACT_4291',
      statusCode: 429,
      details: {
        cooldownSec: 30,
        cooldownMs: 35000,
      },
    });
  });

  it('T-5: relay SESSION_BANNED 503 maps to AUTH_EXPIRED / XACT_4011', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'SESSION_BANNED' }),
    });

    const client = new TelegramClient({
      transport: 'mtproto',
      fetchFn: mockFetch,
    });

    await expect(client.getChannelMessages('durov')).rejects.toMatchObject({
      code: 'XACT_4011',
      statusCode: 503,
    });
  });

  it('T-6: normalizeTelegramPostItem normalizes raw message into PostItem shape for pipeline', () => {
    const rawMsg = {
      id: 42,
      text: 'Solana memecoin $BONK surging!',
      date: 1710000000,
      views: 1200,
      forwards: 45,
      postAuthor: 'WhaleAlert',
      fwdFrom: { fromId: '999', fromName: 'Original' },
    };

    const postItem = normalizeTelegramPostItem(rawMsg, 'channel_alpha');
    expect(postItem.id).toBe('channel_alpha:42');
    expect(postItem.externalId).toBe('channel_alpha:42');
    expect(postItem.platform).toBe('telegram');
    expect(postItem.channelId).toBe('channel_alpha');
    expect(postItem.content).toBe('Solana memecoin $BONK surging!');
    expect(postItem.authorName).toBe('WhaleAlert');
    expect(postItem.publishedAt).toBe(new Date(1710000000 * 1000).toISOString());
    expect(postItem.ts).toBe(1710000000 * 1000);
    expect(postItem.forwardFrom).toEqual({ fromId: '999', fromName: 'Original' });
    expect(postItem.metadata.views).toBe(1200);
    expect(postItem.metadata.forwards).toBe(45);
    expect(postItem.engagement.views).toBe(1200);
    expect(postItem.engagement.retweets).toBe(45);
  });
});
