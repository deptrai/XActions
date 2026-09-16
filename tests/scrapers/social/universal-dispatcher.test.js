import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UniversalActionDispatcher,
  dispatchAction,
  resolveTargetPlatforms,
  resolvePlatformCredentials,
  DEFAULT_WRITE_PLATFORMS,
} from '../../../src/scrapers/social/dispatcher.js';
import { scrape } from '../../../src/scrapers/index.js';
import { toolMap } from '../../../src/mcp/local-tools.js';

describe('Story 30.1 — UniversalActionDispatcher (Cross-Platform Write Actions)', () => {
  describe('resolveTargetPlatforms', () => {
    it('resolves "all" to default write platforms', () => {
      expect(resolveTargetPlatforms('all')).toEqual(DEFAULT_WRITE_PLATFORMS);
      expect(resolveTargetPlatforms()).toEqual(DEFAULT_WRITE_PLATFORMS);
      expect(resolveTargetPlatforms('')).toEqual(DEFAULT_WRITE_PLATFORMS);
    });

    it('resolves array of platforms and cleans case/spaces', () => {
      expect(resolveTargetPlatforms(['Twitter', '  Bluesky  '])).toEqual(['twitter', 'bluesky']);
    });

    it('resolves comma-separated string of platforms', () => {
      expect(resolveTargetPlatforms('twitter, mastodon, threads')).toEqual(['twitter', 'mastodon', 'threads']);
    });
  });

  describe('resolvePlatformCredentials', () => {
    it('picks explicit credentials when supplied', () => {
      const creds = resolvePlatformCredentials('bluesky', {
        credentials: {
          bluesky: { identifier: 'alice.bsky.social', password: 'app-password' },
        },
      });
      expect(creds.identifier).toBe('alice.bsky.social');
      expect(creds.password).toBe('app-password');
    });

    it('falls back to environment variables when explicit credentials absent', () => {
      const orig = process.env.MASTODON_ACCESS_TOKEN;
      process.env.MASTODON_ACCESS_TOKEN = 'test-token-123';
      try {
        const creds = resolvePlatformCredentials('mastodon', {});
        expect(creds.accessToken).toBe('test-token-123');
      } finally {
        process.env.MASTODON_ACCESS_TOKEN = orig;
      }
    });
  });

  describe('UniversalActionDispatcher.dispatch', () => {
    it('throws XACT_4001 when command is not an object', async () => {
      await expect(UniversalActionDispatcher.dispatch(null)).rejects.toThrow();
    });

    it('throws XACT_4001 when action is missing', async () => {
      await expect(UniversalActionDispatcher.dispatch({ platform: 'all' })).rejects.toThrow();
    });

    it('executes post in dryRun across all default platforms without throwing', async () => {
      const res = await UniversalActionDispatcher.dispatch({
        platform: 'all',
        action: 'post',
        args: { text: 'Hello multi-platform world!', dryRun: true },
        options: { dryRun: true },
      });

      expect(res.action).toBe('post');
      expect(res.summary.total).toBe(DEFAULT_WRITE_PLATFORMS.length);
      expect(res.results).toBeDefined();
      expect(res.errors).toBeDefined();

      // In dryRun, supported crawlers (twitter, bluesky, mastodon, threads) succeed
      expect(res.results.twitter).toBeDefined();
      expect(res.results.bluesky).toBeDefined();
      expect(res.results.mastodon).toBeDefined();
      expect(res.results.threads).toBeDefined();
      expect(res.summary.succeeded).toBeGreaterThanOrEqual(3);
    });

    it('isolates failures: 1 failing platform does not reject the overall batch', async () => {
      // bluesky without text causes INVALID_ARGS error, but twitter / mastodon with text can run or fail independently
      const res = await UniversalActionDispatcher.dispatch({
        platform: ['twitter', 'bluesky'],
        action: 'post',
        args: { dryRun: true }, // missing text -> bluesky throws INVALID_ARGS
      });

      expect(res.summary.total).toBe(2);
      expect(res.errors.bluesky).toBeDefined();
      expect(res.errors.bluesky.code).toBe('XACT_4001');
      expect(res.errors.bluesky.suggestedAction).toBeDefined();
    });

    it('supports dispatchAction convenience helper', async () => {
      const res = await dispatchAction({
        platform: ['mastodon', 'bluesky'],
        action: 'like',
        args: { statusId: '12345', uri: 'at://did:plc:test/app.bsky.feed.post/123', dryRun: true },
      });

      expect(res.action).toBe('like');
      expect(res.summary.total).toBe(2);
      expect(res.results.mastodon).toBeDefined();
      expect(res.results.bluesky).toBeDefined();
    });
  });

  describe('scrape() integration with multi-platform write', () => {
    it('dispatches to UniversalActionDispatcher when platform is "all"', async () => {
      const res = await scrape('all', 'post', {
        text: 'Broadcasting via scrape("all")',
        dryRun: true,
      });

      expect(res).toBeDefined();
      expect(res.action).toBe('post');
      expect(res.summary).toBeDefined();
      expect(res.summary.total).toBe(DEFAULT_WRITE_PLATFORMS.length);
    });

    it('dispatches to UniversalActionDispatcher when platform is an Array', async () => {
      const res = await scrape(['bluesky', 'threads'], 'post', {
        text: 'Cross posting to Bluesky & Threads',
        dryRun: true,
      });

      expect(res.summary.total).toBe(2);
      expect(res.results.bluesky).toBeDefined();
      expect(res.results.threads).toBeDefined();
    });
  });

  describe('MCP tools integration', () => {
    it('x_publish_all publishes in dryRun across platforms', async () => {
      const res = await toolMap.x_publish_all({
        text: 'Test MCP broadcast',
        platforms: ['twitter', 'bluesky'],
        dryRun: true,
      });

      expect(res.action).toBe('post');
      expect(res.summary.total).toBe(2);
      expect(res.results.twitter).toBeDefined();
      expect(res.results.bluesky).toBeDefined();
    });

    it('x_like_all executes across platforms', async () => {
      const res = await toolMap.x_like_all({
        tweetId: '1900000000000000000',
        uri: 'at://did:plc:test/app.bsky.feed.post/123',
        statusId: '98765',
        platforms: ['twitter', 'bluesky', 'mastodon'],
        dryRun: true,
      });

      expect(res.action).toBe('like');
      expect(res.summary.total).toBe(3);
      expect(res.results.twitter).toBeDefined();
      expect(res.results.bluesky).toBeDefined();
      expect(res.results.mastodon).toBeDefined();
    });

    it('x_follow_all executes across platforms', async () => {
      const res = await toolMap.x_follow_all({
        username: 'testuser',
        subject: 'did:plc:testdid123',
        accountId: '54321',
        platforms: ['bluesky', 'mastodon'],
        dryRun: true,
      });

      expect(res.action).toBe('follow');
      expect(res.summary.total).toBe(2);
      expect(res.results.bluesky).toBeDefined();
      expect(res.results.mastodon).toBeDefined();
    });

    it('registers x_publish_all, x_like_all, and x_follow_all in MCP TOOLS list', async () => {
      const { TOOLS } = await import('../../../src/mcp/server.js');
      const toolNames = TOOLS.map((t) => t.name);
      expect(toolNames).toContain('x_publish_all');
      expect(toolNames).toContain('x_like_all');
      expect(toolNames).toContain('x_follow_all');
    });
  });
});
