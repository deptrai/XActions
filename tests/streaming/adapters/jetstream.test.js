// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  JetstreamAdapter,
  normalizeJetstreamCommit,
  JETSTREAM_ENDPOINTS,
} from '../../../src/streaming/adapters/jetstream.js';

describe('normalizeJetstreamCommit', () => {
  it('normalizes valid Jetstream post commit', () => {
    const raw = {
      did: 'did:plc:ragtjsm2j2vknq6tfur4ql6q',
      time_us: 1725911162329308,
      kind: 'commit',
      commit: {
        rev: '3l3qo2vutsw2b',
        operation: 'create',
        collection: 'app.bsky.feed.post',
        rkey: '3l3qo2vuowo2b',
        cid: 'bafyreie5cvv4h45feadgeuwhbcutmh6t2ceseocmflxuvukopuxg444444',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Hello Bluesky push stream!',
          createdAt: '2024-09-09T19:46:02.102Z',
          langs: ['en'],
          embed: {
            images: [
              {
                image: {
                  ref: {
                    $link: 'bafkreic7x6h',
                  },
                },
              },
            ],
          },
        },
      },
    };

    const item = normalizeJetstreamCommit(raw);
    expect(item).not.toBeNull();
    expect(item.id).toBe('bluesky:did:plc:ragtjsm2j2vknq6tfur4ql6q:3l3qo2vuowo2b');
    expect(item.platform).toBe('bluesky');
    expect(item.externalId).toBe('did:plc:ragtjsm2j2vknq6tfur4ql6q:3l3qo2vuowo2b');
    expect(item.authorId).toBe('did:plc:ragtjsm2j2vknq6tfur4ql6q');
    expect(item.postUrl).toBe('https://bsky.app/profile/did:plc:ragtjsm2j2vknq6tfur4ql6q/post/3l3qo2vuowo2b');
    expect(item.content).toBe('Hello Bluesky push stream!');
    expect(item.mediaUrls).toHaveLength(1);
    expect(item.mediaUrls[0]).toContain('bafkreic7x6h');
    expect(item.publishedAt).toBeInstanceOf(Date);
    expect(item.metadata.cid).toBe('bafyreie5cvv4h45feadgeuwhbcutmh6t2ceseocmflxuvukopuxg444444');
  });

  it('returns null for non-post or non-create operations', () => {
    expect(normalizeJetstreamCommit(null)).toBeNull();
    expect(normalizeJetstreamCommit({ kind: 'identity' })).toBeNull();
    expect(normalizeJetstreamCommit({
      kind: 'commit',
      commit: {
        operation: 'delete',
        collection: 'app.bsky.feed.post',
      },
    })).toBeNull();
    expect(normalizeJetstreamCommit({
      kind: 'commit',
      commit: {
        operation: 'create',
        collection: 'app.bsky.feed.like',
      },
    })).toBeNull();
  });
});

describe('JetstreamAdapter', () => {
  it('instantiates and builds connection URL with options', async () => {
    const adapter = new JetstreamAdapter('jetstream-test-1', {
      jetstreamHost: 'jetstream1.us-east.bsky.network',
      wantedCollections: ['app.bsky.feed.post', 'app.bsky.feed.repost'],
      wantedDids: ['did:plc:123'],
      cursor: '1725911162329308',
    });

    const url = await adapter.buildUrl();
    expect(url).toContain('wss://jetstream1.us-east.bsky.network/subscribe');
    expect(url).toContain('wantedCollections=app.bsky.feed.post');
    expect(url).toContain('wantedCollections=app.bsky.feed.repost');
    expect(url).toContain('wantedDids=did%3Aplc%3A123');
    expect(url).toContain('cursor=1725911162329308');
  });

  it('selects from default endpoints if no host provided', async () => {
    const adapter = new JetstreamAdapter('jetstream-test-2');
    expect(JETSTREAM_ENDPOINTS).toContain(adapter.endpoint);
    const url = await adapter.buildUrl();
    expect(url).toContain('/subscribe?wantedCollections=app.bsky.feed.post');
  });
});
