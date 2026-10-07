// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TelegramFeed — poller & feed manager for crypto Telegram channels (Story 54.6).
 *
 * Reads channel registry from `config/telegram-channels.json` (or injected config),
 * polls `scrape('telegram', 'channel_messages', { channel, limit })`,
 * normalizes messages via `normalizeTelegramPostItem`,
 * feeds PostItems into `TokenMentionPipeline.processBatch`,
 * publishes thin events to Redis stream `stream:social:raw_posts`,
 * and tracks isolated `tgDegraded` health state.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import fs from 'node:fs';
import { normalizeTelegramPostItem } from '../scrapers/social/telegram/normalizer.js';
import { RedisStreamPublisher } from '../utils/redis-stream-publisher.js';
import { globalAdaptiveRateGovernor } from '../core/adaptive-governor.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_POLL_LIMIT = 20;
const DEFAULT_DEGRADED_THRESHOLD = 3;
const DEFAULT_STREAM_KEY = 'stream:social:raw_posts';
const DEFAULT_SAFE_RPM = 20;

/**
 * Load channels from config/telegram-channels.json or fallback.
 * @param {string} [configPath]
 * @returns {Array<{channelId?: string, handle: string, topicTags?: string[], tier?: number}>}
 */
export function loadTelegramChannels(configPath) {
  try {
    let resolvedPath = configPath;
    if (!resolvedPath) {
      resolvedPath = new URL('../../config/telegram-channels.json', import.meta.url).pathname;
    }
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      if (Array.isArray(data?.channels)) {
        return data.channels;
      }
    }
  } catch (err) {
    console.warn('[TelegramFeed] Warning loading channel registry:', err instanceof Error ? err.message : String(err));
  }
  return [];
}

/**
 * Extract an array of raw messages from diverse scrape response shapes.
 * @param {unknown} res
 * @returns {Array<Record<string, unknown>>}
 */
function extractMessagesFromScrape(res) {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== 'object') return [];
  const obj = /** @type {Record<string, unknown>} */ (res);
  const candidates = [
    obj.messages,
    /** @type {Record<string, unknown>} */ (obj.data)?.messages,
    /** @type {Record<string, unknown>} */ (obj.data)?.items,
    /** @type {Record<string, unknown>} */ (obj.data)?.posts,
    obj.items,
    obj.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/**
 * Factory for creating a TelegramFeed poller.
 *
 * @param {object} [opts]
 * @param {Array<object|string>} [opts.channels] - Explicit channel list override
 * @param {string} [opts.configPath] - Custom path to telegram-channels.json
 * @param {object} [opts.pipeline] - TokenMentionPipeline instance with processBatch
 * @param {Function} [opts.scrape] - Injectable scrape(platform, action, args) function
 * @param {object} [opts.publisher] - Injectable RedisStreamPublisher instance
 * @param {string} [opts.streamKey] - Redis stream key (default 'stream:social:raw_posts')
 * @param {object} [opts.governor] - Adaptive rate governor instance
 * @param {number} [opts.safeRequestsPerMinute] - Platform RPM limit (default 20)
 * @param {number} [opts.pollIntervalMs] - Polling interval in ms (default 60000)
 * @param {number} [opts.pollLimit] - Per-channel message limit (default 20)
 * @param {number} [opts.degradedThreshold] - Consecutive empty batches before degraded (default 3)
 * @param {Function} [opts.now] - Injectable clock () => Date.now()
 */
export function createTelegramFeed(opts = {}) {
  const configChannels = opts.channels || loadTelegramChannels(opts.configPath);
  const channels = configChannels.map((c) => {
    if (typeof c === 'string') return { handle: c.replace(/^@/, ''), channelId: c.replace(/^@/, '') };
    const handle = String(c?.handle || c?.channelId || c?.id || '').replace(/^@/, '');
    return { ...c, handle, channelId: c?.channelId || handle };
  }).filter((c) => Boolean(c.handle));

  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0
    ? Number(opts.pollIntervalMs)
    : DEFAULT_POLL_INTERVAL_MS;
  const pollLimit = Number.isFinite(opts.pollLimit) && (opts.pollLimit ?? 0) > 0
    ? Number(opts.pollLimit)
    : DEFAULT_POLL_LIMIT;
  const degradedThreshold = Number.isFinite(opts.degradedThreshold) && (opts.degradedThreshold ?? 0) >= 1
    ? Math.floor(Number(opts.degradedThreshold))
    : DEFAULT_DEGRADED_THRESHOLD;
  const safeRpm = Number.isFinite(opts.safeRequestsPerMinute) && (opts.safeRequestsPerMinute ?? 0) > 0
    ? Number(opts.safeRequestsPerMinute)
    : DEFAULT_SAFE_RPM;
  const streamKey = opts.streamKey || DEFAULT_STREAM_KEY;

  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const pipeline = opts.pipeline || null;
  const publisher = opts.publisher || new RedisStreamPublisher({ streamKey });
  let _scrape = opts.scrape || null;

  const governor = opts.governor || globalAdaptiveRateGovernor;
  if (governor && typeof governor.setPlatformLimit === 'function') {
    governor.setPlatformLimit('telegram', { safeRequestsPerMinute: safeRpm });
  }

  // Health state (isolated tgDegraded, mirrors AD-3)
  const health = {
    tgDegraded: false,
    degraded: false,
    degradedSince: /** @type {string|null} */ (null),
    consecutiveEmptyBatches: 0,
    lastError: /** @type {string|null} */ (null),
    lastPollAt: /** @type {string|null} */ (null),
    totalBatches: 0,
    totalPosts: 0,
    channelsTracked: channels.length,
  };

  /**
   * Record batch outcome for tgDegraded contract.
   * @param {boolean} empty
   * @param {Error|null} [err]
   */
  function recordBatchEmptiness(empty, err = null) {
    health.totalBatches++;
    if (err) health.lastError = String(err?.message || err);
    if (empty) {
      health.consecutiveEmptyBatches++;
      if (!health.degraded && health.consecutiveEmptyBatches >= degradedThreshold) {
        health.degraded = true;
        health.tgDegraded = true;
        health.degradedSince = new Date(now()).toISOString();
        console.warn(`⚠️ TelegramFeed degraded — ${health.consecutiveEmptyBatches} consecutive empty batches`);
      }
    } else {
      health.consecutiveEmptyBatches = 0;
      health.degraded = false;
      health.tgDegraded = false;
      health.degradedSince = null;
    }
  }

  let _polling = false;
  let _timer = /** @type {NodeJS.Timeout|null} */ (null);

  /**
   * Poll all tracked channels once.
   * @returns {Promise<{posts: Array<object>, count: number, error?: Error}>}
   */
  async function pollOnce() {
    if (_polling) return { posts: [], count: 0 };
    _polling = true;
    try {
      health.lastPollAt = new Date(now()).toISOString();
      if (!_scrape) {
        const mod = await import('../scrapers/index.js');
        _scrape = mod.scrape;
      }

      const allPosts = [];
      const seenIds = new Set();
      let anyErr = null;

      for (const ch of channels) {
        try {
          const res = await _scrape('telegram', 'channel_messages', {
            channel: ch.handle,
            limit: pollLimit,
          });
          const rawMessages = extractMessagesFromScrape(res);
          for (const raw of rawMessages) {
            const post = normalizeTelegramPostItem(raw, ch.handle);
            if (!post?.id || seenIds.has(post.id)) continue;
            seenIds.add(post.id);
            allPosts.push(post);
          }
        } catch (err) {
          anyErr = err;
          console.error(`❌ TelegramFeed scrape error (${ch.handle}):`, err instanceof Error ? err.message : String(err));
        }
      }

      if (allPosts.length > 0) {
        if (pipeline && typeof pipeline.processBatch === 'function') {
          await pipeline.processBatch(allPosts);
        }
        if (publisher && typeof publisher.publish === 'function') {
          for (const post of allPosts) {
            await publisher.publish(streamKey, post, 'telegram-feed');
          }
        }
        health.totalPosts += allPosts.length;
        recordBatchEmptiness(false);
      } else {
        recordBatchEmptiness(true, anyErr);
      }

      if (anyErr) {
        health.lastError = String(anyErr?.message || anyErr);
      }

      return { posts: allPosts, count: allPosts.length };
    } finally {
      _polling = false;
    }
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(() => {
      pollOnce().catch((err) => {
        console.error('❌ TelegramFeed unexpected poll error:', err instanceof Error ? err.message : String(err));
      });
    }, pollIntervalMs);
  }

  function stop() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  function getHealth() {
    return { ...health };
  }

  function getChannels() {
    return [...channels];
  }

  return {
    start,
    stop,
    pollOnce,
    getHealth,
    getChannels,
  };
}

export default { createTelegramFeed, loadTelegramChannels };
