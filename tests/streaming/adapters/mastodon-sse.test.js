// by nichxbt
import { describe, it, expect } from 'vitest';
import { MastodonSSEAdapter } from '../../../src/streaming/adapters/mastodon-sse.js';

describe('MastodonSSEAdapter', () => {
  it('constructs correct endpoint URLs for stream types', () => {
    const publicAdapter = new MastodonSSEAdapter('masto-pub', {
      instance: 'https://mastodon.social',
      streamType: 'public',
    });
    expect(publicAdapter.buildUrl()).toBe('https://mastodon.social/api/v1/streaming/public');

    const localAdapter = new MastodonSSEAdapter('masto-loc', {
      instance: 'mastodon.social',
      streamType: 'local',
    });
    expect(localAdapter.buildUrl()).toBe('https://mastodon.social/api/v1/streaming/public/local');

    const tagAdapter = new MastodonSSEAdapter('masto-tag', {
      instance: 'https://mastodon.social',
      streamType: 'hashtag',
      tag: '#tech',
    });
    expect(tagAdapter.buildUrl()).toBe('https://mastodon.social/api/v1/streaming/hashtag?tag=tech');

    const userAdapter = new MastodonSSEAdapter('masto-user', {
      instance: 'https://mastodon.social',
      streamType: 'user',
    });
    expect(userAdapter.buildUrl()).toBe('https://mastodon.social/api/v1/streaming/user');
  });

  it('throws when tag option is missing for hashtag stream', () => {
    const tagAdapter = new MastodonSSEAdapter('masto-err', {
      streamType: 'hashtag',
    });
    expect(() => tagAdapter.buildUrl()).toThrow('tag');
  });

  it('parses SSE block and emits normalized status', async () => {
    const adapter = new MastodonSSEAdapter('masto-parse', {
      instance: 'https://mastodon.social',
    });

    const emitted = [];
    adapter.on('event', (item) => emitted.push(item));

    const block = `event: update\ndata: {"id":"1092345","content":"<p>Hello Mastodon SSE</p>","account":{"id":"999","username":"mastouser","display_name":"Masto Dev"}}\n\n`;
    await adapter._handleSSEBlock(block);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].platform).toBe('mastodon');
    expect(emitted[0].externalId).toBe('1092345');
    expect(emitted[0].content).toBe('Hello Mastodon SSE');
    expect(emitted[0].authorName).toBe('Masto Dev');
    expect(adapter._cursor).toBe('1092345');
  });

  it('ignores delete events and comments', async () => {
    const adapter = new MastodonSSEAdapter('masto-ignore');
    const emitted = [];
    adapter.on('event', (item) => emitted.push(item));

    await adapter._handleSSEBlock(': ths is a heartbeat comment\n\n');
    await adapter._handleSSEBlock('event: delete\ndata: 1092345\n\n');

    expect(emitted).toHaveLength(0);
  });
});
