import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { DistributedTokenBucket } from '../../src/core/distributed-token-bucket.js';
import { TwitterCrawler, gaussianDelay } from '../../src/scrapers/social/twitter/crawler.js';

describe('Story 32.2 — Fast Delay Flag & Distributed Hibernation Sync', () => {
  describe('Fast Delay Flag (XACTIONS_TEST_FAST_DELAYS)', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.XACTIONS_TEST_FAST_DELAYS;
    });

    afterEach(() => {
      process.env.XACTIONS_TEST_FAST_DELAYS = originalEnv;
    });

    it('skips delay when XACTIONS_TEST_FAST_DELAYS=1', async () => {
      process.env.XACTIONS_TEST_FAST_DELAYS = '1';
      const start = Date.now();
      const delay = await gaussianDelay(3000, 7000);
      const elapsed = Date.now() - start;

      expect(delay).toBe(0);
      expect(elapsed).toBeLessThan(250);
    });

    it('executes compose tweet without 3-7s delay when fast delay is enabled', async () => {
      process.env.XACTIONS_TEST_FAST_DELAYS = '1';

      const mockClient = {
        init: vi.fn().mockResolvedValue(undefined),
        requestGraphQl: vi.fn().mockResolvedValue({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  __typename: 'Tweet',
                  rest_id: '1234567890',
                  legacy: {
                    id_str: '1234567890',
                    full_text: 'Fast tweet composition test',
                    created_at: new Date().toISOString(),
                  },
                },
              },
            },
          },
        }),
      };

      const mockSessionManager = {
        get: vi.fn().mockReturnValue({ accountId: 'test-user', cookies: 'auth_token=xyz' }),
      };

      const crawler = new TwitterCrawler({
        client: mockClient,
        sessionManager: mockSessionManager,
        requiresAuth: true,
      });

      const start = Date.now();
      const res = await crawler.start({
        action: 'post',
        args: { text: 'Fast tweet composition test', dryRun: false },
        session: { accountId: 'test-user' },
      });
      const elapsed = Date.now() - start;

      expect(res).toBeDefined();
      expect(res.tweet).toBeDefined();
      expect(res.tweet.id).toBe('twitter:1234567890');
      // Must take well under 1000ms instead of 3000-7000ms
      expect(elapsed).toBeLessThan(500);
      expect(mockClient.requestGraphQl).toHaveBeenCalled();
    });
  });

  describe('AdaptiveRateGovernor Redis Hibernation & Panic Sync', () => {
    let mockRedis;
    let governor;

    beforeEach(() => {
      mockRedis = {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn().mockResolvedValue(1),
      };
      governor = new AdaptiveRateGovernor({ redis: mockRedis });
    });

    it('initializes redis from deps.redis or deps.distributedBucket', () => {
      const bucket = new DistributedTokenBucket({ redis: mockRedis });
      const govFromBucket = new AdaptiveRateGovernor({ distributedBucket: bucket });

      expect(governor.redis).toBe(mockRedis);
      expect(govFromBucket.redis).toBe(mockRedis);
    });

    describe('hibernateAccount Redis sync', () => {
      it('writes xact:hibernated key with reason and TTL to Redis and updates in-memory state', () => {
        governor.hibernateAccount('user-123', 'rate_limit', 300000, 'twitter');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'xact:hibernated:twitter:user-123',
          'rate_limit',
          'EX',
          300
        );
        expect(governor.isHibernating('user-123', 'twitter')).toBe(true);
        expect(governor.getHibernationReason('user-123', 'twitter')).toBe('rate_limit');
      });

      it('catches Redis set failures gracefully without throwing', () => {
        mockRedis.set.mockImplementation(() => {
          throw new Error('Redis connection refused');
        });

        expect(() => {
          governor.hibernateAccount('user-456', 'bot_challenge', 60000, 'twitter');
        }).not.toThrow();

        expect(governor.isHibernating('user-456', 'twitter')).toBe(true);
      });
    });

    describe('isHibernatingAsync', () => {
      it('returns true if already hibernating in-memory', async () => {
        governor.hibernateAccount('mem-user', 'rate_limit', 60000, 'twitter');
        const isHib = await governor.isHibernatingAsync('mem-user', 'twitter');
        expect(isHib).toBe(true);
      });

      it('queries Redis when not found in-memory and returns true if key exists in Redis', async () => {
        mockRedis.get.mockResolvedValueOnce('rate_limit');

        const isHib = await governor.isHibernatingAsync('redis-user', 'twitter');
        expect(mockRedis.get).toHaveBeenCalledWith('xact:hibernated:twitter:redis-user');
        expect(isHib).toBe(true);
      });

      it('returns false when key does not exist in Redis or memory', async () => {
        mockRedis.get.mockResolvedValueOnce(null);

        const isHib = await governor.isHibernatingAsync('clean-user', 'twitter');
        expect(mockRedis.get).toHaveBeenCalledWith('xact:hibernated:twitter:clean-user');
        expect(isHib).toBe(false);
      });

      it('falls back gracefully to false if Redis get throws', async () => {
        mockRedis.get.mockRejectedValueOnce(new Error('Redis timeout'));

        const isHib = await governor.isHibernatingAsync('err-user', 'twitter');
        expect(isHib).toBe(false);
      });
    });

    describe('panicStop Redis sync', () => {
      it('writes xact:panic key to Redis and hibernates accounts with critical throttle', () => {
        const res = governor.panicStop('twitter', { durationMs: 120000, reason: 'api_compromised' });

        expect(res.success).toBe(true);
        expect(res.throttleLevel).toBe('critical');
        expect(mockRedis.set).toHaveBeenCalledWith(
          'xact:panic:twitter',
          'api_compromised',
          'EX',
          120
        );
        expect(mockRedis.set).toHaveBeenCalledWith(
          'xact:hibernated:twitter:*',
          'api_compromised',
          'EX',
          120
        );
      });

      it('writes xact:panic:all when platform is "all"', () => {
        governor.panicStop('all', { durationMs: 60000 });

        expect(mockRedis.set).toHaveBeenCalledWith(
          'xact:panic:all',
          'emergency_panic_stop',
          'EX',
          60
        );
      });

      it('handles Redis error during panicStop gracefully', () => {
        mockRedis.set.mockRejectedValue(new Error('Redis cluster down'));

        expect(() => {
          governor.panicStop('mastodon');
        }).not.toThrow();

        expect(governor.getStatus().panicStoppedPlatforms).toContain('mastodon');
      });
    });

    describe('resumePanic Redis sync', () => {
      it('deletes xact:panic key in Redis and clears panic state', () => {
        governor.panicStop('threads');
        expect(governor.getStatus().panicStoppedPlatforms).toContain('threads');

        const res = governor.resumePanic('threads');
        expect(res.success).toBe(true);
        expect(mockRedis.del).toHaveBeenCalledWith('xact:panic:threads');
        expect(governor.getStatus().panicStoppedPlatforms).not.toContain('threads');
      });

      it('deletes xact:panic:all when resuming all panics', () => {
        governor.panicStop('all');
        const res = governor.resumePanic('all');

        expect(res.success).toBe(true);
        expect(mockRedis.del).toHaveBeenCalledWith('xact:panic:all');
        expect(governor.getStatus().panicStoppedPlatforms).toHaveLength(0);
      });
    });

    describe('wakeAccount Redis sync', () => {
      it('clears hibernation from memory and deletes xact:hibernated key in Redis', () => {
        governor.hibernateAccount('wake-user', 'manual_test', 60000, 'twitter');
        expect(governor.isHibernating('wake-user', 'twitter')).toBe(true);

        governor.wakeAccount('wake-user', 'twitter');
        expect(governor.isHibernating('wake-user', 'twitter')).toBe(false);
        expect(mockRedis.del).toHaveBeenCalledWith('xact:hibernated:twitter:wake-user');
      });
    });
  });
});
