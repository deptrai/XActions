// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 38.1: Crawler Lifecycle Clean-up & Stream Unification
 * Test suite verifying zero duplicate stream emissions, template method lifecycle,
 * and eradication of __streamEmitted domain payload pollution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { RedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';
import { globalActionRegistry } from '../../src/core/action-registry.js';

class FakeRedisClient {
  constructor() {
    this.calls = [];
  }
  async xAdd(key, id, fields, options) {
    this.calls.push({ key, id, fields, options });
    return 'test-msg-id';
  }
  async xadd(key, ...args) {
    this.calls.push({ key, args });
    return 'test-msg-id';
  }
}

class LifecycleTestCrawler extends AbstractCrawler {
  name = 'lifecycle-platform';
  category = 'social';

  constructor(deps = {}) {
    super(deps);

    // Standard action returning array of posts
    this.registerAction('fetch_posts', async (args, session) => {
      return {
        posts: [
          { id: 'post-1', externalId: 'ext-1', text: 'First post content', authorId: 'author-1' },
          { id: 'post-2', externalId: 'ext-2', text: 'Second post content', authorId: 'author-2' },
        ],
      };
    }, { action: 'fetch_posts', description: 'Fetch posts' });

    // Action that emits items mid-flight (e.g. during pagination or checkpoints)
    this.registerAction('paginated_crawl', async (args, session) => {
      const page1Items = [
        { id: 'page-item-1', externalId: 'pi-1', text: 'Page 1 item', authorId: 'author-1' },
      ];
      // Mid-flight emission
      await this.emitStreamBatch(page1Items, { targetType: 'tag', targetKey: 'tech' });

      const page2Items = [
        { id: 'page-item-2', externalId: 'pi-2', text: 'Page 2 item', authorId: 'author-2' },
      ];
      // Mid-flight emission for page 2
      await this.emitStreamBatch(page2Items, { targetType: 'tag', targetKey: 'tech' });

      // Action returns all items at the end
      return {
        posts: [...page1Items, ...page2Items],
      };
    }, { action: 'paginated_crawl', description: 'Paginated crawl with mid-flight stream emission' });

    // Action returning post and nested comments (like post_detail)
    this.registerAction('post_detail', async (args, session) => {
      const post = { id: 'root-post-1', externalId: 'rp-1', text: 'Root post', authorId: 'author-root' };
      const comments = [
        { id: 'comment-1', externalId: 'c-1', content: 'First reply', authorId: 'commenter-1' },
      ];
      // Mid-flight checkpoint emission of the root post
      await this.emitStreamBatch([post], { targetType: 'post', targetKey: 'rp-1' });

      return {
        post,
        comments,
      };
    }, { action: 'post_detail', description: 'Post detail with comments' });
  }
}

describe('Story 38.1: AbstractCrawler Lifecycle & Stream Unification', () => {
  let fakeClient;
  let publisher;
  let crawler;
  const originalEnv = process.env.REDIS_STREAM_ENABLED;

  beforeEach(() => {
    globalActionRegistry.clear();
    process.env.REDIS_STREAM_ENABLED = 'true';
    fakeClient = new FakeRedisClient();
    publisher = new RedisStreamPublisher({ redisClient: fakeClient, enabled: true });
    crawler = new LifecycleTestCrawler({
      store: { publisher },
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_STREAM_ENABLED;
    } else {
      process.env.REDIS_STREAM_ENABLED = originalEnv;
    }
  });

  describe('Single Point of Emission & Zero Duplication', () => {
    it('emits each item exactly once during standard start() execution', async () => {
      const result = await crawler.start({
        action: 'fetch_posts',
        args: { context: { workspaceId: 'ws-123' } },
      });

      expect(result.posts).toHaveLength(2);
      expect(fakeClient.calls).toHaveLength(2);
      expect(fakeClient.calls[0].fields.external_post_id).toBe('ext-1');
      expect(fakeClient.calls[1].fields.external_post_id).toBe('ext-2');
    });

    it('execute() aliases start() and performs identical single emission', async () => {
      const result = await crawler.execute({
        action: 'fetch_posts',
        args: { context: { workspaceId: 'ws-123' } },
      });

      expect(result.posts).toHaveLength(2);
      expect(fakeClient.calls).toHaveLength(2);
      expect(fakeClient.calls[0].fields.external_post_id).toBe('ext-1');
      expect(fakeClient.calls[1].fields.external_post_id).toBe('ext-2');
    });

    it('skips duplicate emission when crawler emits items mid-flight via emitStreamBatch()', async () => {
      const result = await crawler.execute({
        action: 'paginated_crawl',
        args: { context: { workspaceId: 'ws-123' } },
      });

      expect(result.posts).toHaveLength(2);
      // Even though emitStreamBatch was called twice mid-flight and execute() finished with all 2 posts,
      // total emissions must be exactly 2, with ZERO duplicates, and workspace_id properly inherited!
      expect(fakeClient.calls).toHaveLength(2);
      expect(fakeClient.calls[0].fields.external_post_id).toBe('pi-1');
      expect(fakeClient.calls[0].fields.workspace_id).toBe('ws-123');
      expect(fakeClient.calls[1].fields.external_post_id).toBe('pi-2');
      expect(fakeClient.calls[1].fields.workspace_id).toBe('ws-123');
    });

    it('emits newly added comments while deduplicating already-emitted root post in post_detail', async () => {
      const result = await crawler.execute({
        action: 'post_detail',
        args: { context: { workspaceId: 'ws-123' } },
      });

      expect(result.post).toBeDefined();
      expect(result.comments).toHaveLength(1);
      // Root post was emitted mid-flight (call 1), then execute() completed and emitted comment-1 (call 2).
      // Root post must NOT be emitted twice!
      expect(fakeClient.calls).toHaveLength(2);
      expect(fakeClient.calls[0].fields.external_post_id).toBe('rp-1');
      expect(fakeClient.calls[1].fields.external_post_id).toBe('c-1');
    });
  });

  describe('Zero Domain Payload Pollution', () => {
    it('guarantees no __streamEmitted property in returned payload from start() or execute()', async () => {
      const result1 = await crawler.start({ action: 'fetch_posts', args: {} });
      expect(result1).not.toHaveProperty('__streamEmitted');
      expect(result1.posts[0]).not.toHaveProperty('__streamEmitted');
      expect(result1.posts[1]).not.toHaveProperty('__streamEmitted');

      const result2 = await crawler.execute({ action: 'paginated_crawl', args: {} });
      expect(result2).not.toHaveProperty('__streamEmitted');
      expect(result2.posts[0]).not.toHaveProperty('__streamEmitted');
      expect(result2.posts[1]).not.toHaveProperty('__streamEmitted');

      const result3 = await crawler.execute({ action: 'post_detail', args: {} });
      expect(result3).not.toHaveProperty('__streamEmitted');
      expect(result3.post).not.toHaveProperty('__streamEmitted');
      expect(result3.comments[0]).not.toHaveProperty('__streamEmitted');
    });

    it('guarantees no __streamEmitted property exists in any source files or returned payloads', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      function scanDir(dir, matches = []) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, matches);
          } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('__streamEmitted')) {
              matches.push(fullPath);
            }
          }
        }
        return matches;
      }

      const srcDir = path.resolve(__dirname, '../../src');
      const offendingFiles = scanDir(srcDir);
      expect(offendingFiles).toEqual([]);
    });
  });

  describe('Stream Suppression & Environment Edge Cases', () => {
    it('skips emission when REDIS_STREAM_ENABLED is false or unset', async () => {
      process.env.REDIS_STREAM_ENABLED = 'false';
      await crawler.execute({ action: 'fetch_posts', args: {} });
      expect(fakeClient.calls).toHaveLength(0);

      delete process.env.REDIS_STREAM_ENABLED;
      await crawler.execute({ action: 'fetch_posts', args: {} });
      expect(fakeClient.calls).toHaveLength(0);
    });

    it('skips emission when dryRun is true in args or session', async () => {
      await crawler.execute({ action: 'fetch_posts', args: { dryRun: true } });
      expect(fakeClient.calls).toHaveLength(0);

      await crawler.execute({ action: 'fetch_posts', args: {}, session: { dryRun: true } });
      expect(fakeClient.calls).toHaveLength(0);

      await crawler.execute({ action: 'paginated_crawl', args: { dryRun: true } });
      expect(fakeClient.calls).toHaveLength(0);
    });

    it('logs warning when workspaceId is missing but proceeds with emission', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await crawler.execute({ action: 'fetch_posts', args: {} });

      expect(fakeClient.calls).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StreamPublisher:MissingWorkspaceId]'),
      );

      warnSpy.mockRestore();
    });

    it('supports direct invocation of emitStreamBatch() for external/direct callers', async () => {
      const items = [
        { id: 'direct-1', externalId: 'd-1', text: 'Direct caller post', authorId: 'direct-user' },
      ];

      await crawler.emitStreamBatch(items, { workspaceId: 'ws-direct' });

      expect(fakeClient.calls).toHaveLength(1);
      expect(fakeClient.calls[0].fields.external_post_id).toBe('d-1');
      expect(fakeClient.calls[0].fields.workspace_id).toBe('ws-direct');
    });

    it('extractItems extracts both profile and posts when both are present', () => {
      const result = {
        profile: { id: 'prof-1', username: 'user1', name: 'User One' },
        posts: [{ id: 'p-1', text: 'Post 1' }],
      };
      const extracted = crawler.extractItems(result);
      expect(extracted).toHaveLength(2);
      expect(extracted[0].id).toBe('prof-1');
      expect(extracted[1].id).toBe('p-1');
    });

    it('mapToThinEvent handles ProfileItem without bio using username/handle fallback', () => {
      const profileItem = {
        id: 'user:123',
        username: 'alice',
        handle: '@alice',
        profileUrl: 'https://example.com/alice',
      };
      const thin = crawler.mapToThinEvent(profileItem, { workspaceId: 'ws-99' });
      expect(thin.content_snippet).toBe('alice');
      expect(thin.author_id).toBe('user:123');
      expect(thin.post_url).toBe('https://example.com/alice');
      expect(thin.workspace_id).toBe('ws-99');
    });

    it('gracefully catches publisher errors without crashing the crawl', async () => {
      const failingClient = {
        xAdd: async () => { throw new Error('Redis connection drop'); },
        xadd: async () => { throw new Error('Redis connection drop'); },
      };
      const failingPublisher = new RedisStreamPublisher({ redisClient: failingClient, enabled: true });
      const testCrawler = new LifecycleTestCrawler({ store: { publisher: failingPublisher } });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await testCrawler.execute({ action: 'fetch_posts', args: { context: { workspaceId: 'ws-err' } } });

      expect(result.posts).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StreamPublisher] lifecycle-platform failed to publish item'),
      );
      warnSpy.mockRestore();
    });
  });
});
