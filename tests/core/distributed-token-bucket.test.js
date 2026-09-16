import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DistributedTokenBucket,
  parseRateLimitHeaders,
  TOKEN_BUCKET_LUA,
} from '../../src/core/distributed-token-bucket.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';

describe('Story 32.2 — DistributedTokenBucket & Header Parsing', () => {
  describe('parseRateLimitHeaders', () => {
    it('parses standard x-ratelimit headers with epoch reset timestamp', () => {
      const futureEpochSec = Math.floor(Date.now() / 1000) + 120;
      const headers = {
        'x-rate-limit-limit': '15',
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': String(futureEpochSec),
      };

      const parsed = parseRateLimitHeaders(headers);
      expect(parsed.limit).toBe(15);
      expect(parsed.remaining).toBe(0);
      expect(parsed.resetTimestamp).toBe(futureEpochSec * 1000);
      expect(parsed.retryAfterMs).toBeGreaterThan(0);
    });

    it('parses delta-seconds in reset or retry-after header', () => {
      const headers = {
        'ratelimit-limit': '100',
        'ratelimit-remaining': '50',
        'retry-after': '30',
      };

      const parsed = parseRateLimitHeaders(headers);
      expect(parsed.limit).toBe(100);
      expect(parsed.remaining).toBe(50);
      expect(parsed.retryAfterMs).toBe(30000);
    });

    it('handles Headers object from fetch API', () => {
      const headers = new Headers();
      headers.set('X-RateLimit-Limit', '60');
      headers.set('X-RateLimit-Remaining', '12');

      const parsed = parseRateLimitHeaders(headers);
      expect(parsed.limit).toBe(60);
      expect(parsed.remaining).toBe(12);
    });

    it('returns null fields for empty or missing headers', () => {
      expect(parseRateLimitHeaders(null)).toEqual({
        limit: null,
        remaining: null,
        resetTimestamp: null,
        retryAfterMs: null,
      });
    });
  });

  describe('DistributedTokenBucket (In-Memory Engine)', () => {
    let bucket;

    beforeEach(() => {
      bucket = new DistributedTokenBucket();
    });

    it('allows consuming tokens within capacity', async () => {
      const res = await bucket.consume('test-key', 2, { capacity: 10, refillRate: 1 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(8);
      expect(res.retryAfterMs).toBe(0);
    });

    it('rejects requests when tokens are exhausted and calculates retryAfterMs', async () => {
      const opts = { capacity: 5, refillRate: 1 };
      await bucket.consume('user-1', 5, opts);

      const res = await bucket.consume('user-1', 1, opts);
      expect(res.allowed).toBe(false);
      expect(res.remaining).toBe(0);
      expect(res.retryAfterMs).toBeGreaterThanOrEqual(1000);
    });

    it('refills tokens over time', async () => {
      const opts = { capacity: 10, refillRate: 10 }; // 10 tokens per sec
      await bucket.consume('refill-test', 10, opts);

      // Advance clock artificially
      await new Promise((r) => setTimeout(r, 200));

      const can = await bucket.canConsume('refill-test', 1, opts);
      expect(can).toBe(true);
    });

    it('syncs bucket state directly from response headers', async () => {
      const headers = {
        'x-ratelimit-remaining': '3',
      };
      bucket.syncFromHeaders('twitter-acc-1', headers);

      const res = await bucket.consume('twitter-acc-1', 2, { capacity: 10 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(1);
    });

    it('resets bucket key state', async () => {
      await bucket.consume('reset-key', 5, { capacity: 5 });
      bucket.reset('reset-key');

      const res = await bucket.consume('reset-key', 1, { capacity: 5 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4);
    });
  });

  describe('DistributedTokenBucket (Redis Lua Script simulation)', () => {
    it('executes atomic Lua script when Redis client is provided', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([1, 4, 0]),
      };

      const bucket = new DistributedTokenBucket({ redis: mockRedis });
      const res = await bucket.consume('redis-consumer', 1, { capacity: 5, refillRate: 1 });

      expect(mockRedis.eval).toHaveBeenCalledWith(
        TOKEN_BUCKET_LUA,
        1,
        'xact:tokenbucket:redis-consumer',
        1,
        5,
        1,
        expect.any(Number),
        3600
      );
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4);
    });

    it('falls back to in-memory gracefully if Redis eval throws an error', async () => {
      const mockRedis = {
        eval: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      };

      const bucket = new DistributedTokenBucket({ redis: mockRedis });
      const res = await bucket.consume('fallback-key', 1, { capacity: 10 });

      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(9);
    });
  });

  describe('Multi-Process / High Concurrency Contention', () => {
    it('handles concurrent consume calls atomically without exceeding budget', async () => {
      const bucket = new DistributedTokenBucket();
      const capacity = 20;

      // Simulate 50 concurrent requests competing for 20 tokens
      const requests = Array.from({ length: 50 }, () =>
        bucket.consume('contention-key', 1, { capacity, refillRate: 0.1 })
      );

      const results = await Promise.all(requests);
      const allowedCount = results.filter((r) => r.allowed).length;
      const rejectedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(capacity);
      expect(rejectedCount).toBe(30);
    });
  });

  describe('AdaptiveRateGovernor delegation with REDIS_TOKEN_BUCKET=1', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.REDIS_TOKEN_BUCKET;
    });

    afterEach(() => {
      process.env.REDIS_TOKEN_BUCKET = originalEnv;
    });

    it('delegates to DistributedTokenBucket when REDIS_TOKEN_BUCKET=1', async () => {
      process.env.REDIS_TOKEN_BUCKET = '1';
      const mockBucket = {
        canConsume: vi.fn().mockResolvedValue(true),
        consume: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfterMs: 0 }),
      };

      const governor = new AdaptiveRateGovernor({ distributedBucket: mockBucket });
      const can = await governor.canConsumerRequest('chainlens');
      expect(can).toBe(true);
      expect(mockBucket.canConsume).toHaveBeenCalledWith('consumer:chainlens', 1, expect.any(Object));

      governor.recordConsumerRequest('chainlens');
      expect(mockBucket.consume).toHaveBeenCalledWith('consumer:chainlens', 1, expect.any(Object));
    });
  });
});
