// @ts-nocheck
// tests/analytics/telegramFeed.test.js
// Story 54.6 — telegramFeed unit tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { createTelegramFeed, loadTelegramChannels } from '../../src/analytics/telegramFeed.js';

describe('Story 54.6 — telegramFeed poller & health', () => {
  it('T-1: loadTelegramChannels loads channels from config/telegram-channels.json', () => {
    const channels = loadTelegramChannels();
    expect(Array.isArray(channels)).toBe(true);
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.some((c) => c.handle === 'whale_alert_io')).toBe(true);
  });

  it('T-2: sets safeRequestsPerMinute on adaptive rate governor on init', () => {
    let capturedPlatform = null;
    let capturedLimits = null;
    const mockGovernor = {
      setPlatformLimit: (platform, limits) => {
        capturedPlatform = platform;
        capturedLimits = limits;
      },
    };

    createTelegramFeed({
      governor: mockGovernor,
      safeRequestsPerMinute: 25,
      channels: ['durov'],
    });

    expect(capturedPlatform).toBe('telegram');
    expect(capturedLimits).toEqual({ safeRequestsPerMinute: 25 });
  });

  it('T-3: pollOnce scrapes channels, normalizes, passes to pipeline, and publishes to stream', async () => {
    const scrapedChannels = [];
    const mockScrape = async (platform, action, args) => {
      scrapedChannels.push({ platform, action, channel: args.channel });
      return {
        messages: [
          { id: 101, text: 'Alpha call on $SOL', date: 1710000000, views: 500 },
          { id: 102, text: 'Big move on $ETH', date: 1710000020, views: 1000 },
        ],
      };
    };

    let processedPosts = [];
    const mockPipeline = {
      processBatch: async (posts) => {
        processedPosts = posts;
        return { mentions: posts, skipped: 0 };
      },
    };

    const publishedItems = [];
    const mockPublisher = {
      publish: async (streamKey, item, scraperId) => {
        publishedItems.push({ streamKey, item, scraperId });
        return { ok: true, id: '123-0' };
      },
    };

    const feed = createTelegramFeed({
      channels: [{ handle: 'crypto_news' }],
      scrape: mockScrape,
      pipeline: mockPipeline,
      publisher: mockPublisher,
      streamKey: 'stream:social:raw_posts',
    });

    const res = await feed.pollOnce();
    expect(res.count).toBe(2);
    expect(scrapedChannels).toEqual([
      { platform: 'telegram', action: 'channel_messages', channel: 'crypto_news' },
    ]);
    expect(processedPosts).toHaveLength(2);
    expect(processedPosts[0].platform).toBe('telegram');
    expect(processedPosts[0].id).toBe('crypto_news:101');
    expect(publishedItems).toHaveLength(2);
    expect(publishedItems[0].streamKey).toBe('stream:social:raw_posts');
    expect(publishedItems[0].scraperId).toBe('telegram-feed');

    const health = feed.getHealth();
    expect(health.tgDegraded).toBe(false);
    expect(health.consecutiveEmptyBatches).toBe(0);
    expect(health.totalPosts).toBe(2);
    expect(health.totalBatches).toBe(1);
  });

  it('T-4: 3 consecutive empty batches triggers tgDegraded=true, recovers on non-empty', async () => {
    const mockScrape = async () => ({ messages: [] });
    let nowTime = 1710000000000;
    const mockNow = () => nowTime;

    const feed = createTelegramFeed({
      channels: ['empty_channel'],
      scrape: mockScrape,
      degradedThreshold: 3,
      now: mockNow,
    });

    expect(feed.getHealth().tgDegraded).toBe(false);

    // Batch 1: empty
    await feed.pollOnce();
    expect(feed.getHealth().consecutiveEmptyBatches).toBe(1);
    expect(feed.getHealth().tgDegraded).toBe(false);

    // Batch 2: empty
    await feed.pollOnce();
    expect(feed.getHealth().consecutiveEmptyBatches).toBe(2);
    expect(feed.getHealth().tgDegraded).toBe(false);

    // Batch 3: empty -> degraded triggered!
    nowTime += 5000;
    await feed.pollOnce();
    const degradedHealth = feed.getHealth();
    expect(degradedHealth.consecutiveEmptyBatches).toBe(3);
    expect(degradedHealth.tgDegraded).toBe(true);
    expect(degradedHealth.degraded).toBe(true);
    expect(degradedHealth.degradedSince).toBe(new Date(nowTime).toISOString());

    // Batch 4: scrape returns items -> recovers!
    let returnItems = true;
    const recoveringScrape = async () => (returnItems ? { messages: [{ id: 1, text: 'hi', date: 1710000000 }] } : { messages: [] });
    const recoveringFeed = createTelegramFeed({
      channels: ['ch1'],
      scrape: recoveringScrape,
      degradedThreshold: 3,
      now: mockNow,
    });
    returnItems = false;
    await recoveringFeed.pollOnce();
    await recoveringFeed.pollOnce();
    await recoveringFeed.pollOnce();
    expect(recoveringFeed.getHealth().tgDegraded).toBe(true);

    returnItems = true;
    await recoveringFeed.pollOnce();
    const recoveredHealth = recoveringFeed.getHealth();
    expect(recoveredHealth.consecutiveEmptyBatches).toBe(0);
    expect(recoveredHealth.tgDegraded).toBe(false);
    expect(recoveredHealth.degradedSince).toBeNull();
  });

  it('T-5: scrape rejection counts as empty batch and records lastError', async () => {
    const mockScrape = async () => {
      throw new Error('Relay flood wait active');
    };

    const feed = createTelegramFeed({
      channels: ['failing_channel'],
      scrape: mockScrape,
      degradedThreshold: 1,
    });

    await feed.pollOnce();
    const health = feed.getHealth();
    expect(health.tgDegraded).toBe(true);
    expect(health.consecutiveEmptyBatches).toBe(1);
    expect(health.lastError).toContain('Relay flood wait active');
  });

  it('T-6: start and stop lifecycle works idempotently', () => {
    const feed = createTelegramFeed({
      channels: ['ch1'],
      scrape: async () => ({ messages: [] }),
      pollIntervalMs: 10000,
    });

    feed.start();
    feed.start(); // idempotent
    feed.stop();
    feed.stop(); // idempotent
  });
});
