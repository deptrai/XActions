// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Stream Replay & Missed-Event Recovery (Story 29.3)
 * Reads events from Redis Stream (`stream:social:raw_posts`) by range or cursor,
 * supports ISO 8601 timestamps, pagination, per-stream filtering,
 * and optional delivery via outbound webhook dispatcher with `X-XActions-Replay: true`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { defaultWebhookDispatcher } from './outbound-webhook-dispatcher.js';
import { defaultWebhookSubscriptionStore } from './webhook-subscription-store.js';
import { getStreamStatus } from './streamManager.js';

export const DEFAULT_REPLAY_STREAM_KEY = 'stream:social:raw_posts';
export const DEFAULT_REPLAY_LIMIT = 100;
export const MAX_REPLAY_LIMIT = 1000;

/**
 * Valid stream ID regex: `<ms>` or `<ms>-<seq>`.
 */
const STREAM_ID_REGEX = /^\d+(?:-\d+)?$/;

/**
 * Custom error class with error code.
 */
class ReplayError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
  }
}

/**
 * Validate and normalize cursor string.
 *
 * @param {string | number} cursor
 * @returns {string}
 */
export function validateCursor(cursor) {
  if (cursor === undefined || cursor === null) {
    throw new ReplayError('Cursor is required', 'INVALID_CURSOR');
  }
  const str = String(cursor).trim();
  if (!STREAM_ID_REGEX.test(str)) {
    throw new ReplayError(`Invalid cursor format "${str}". Expected format: <ms>-<seq>`, 'INVALID_CURSOR');
  }
  return str;
}

/**
 * Validate and convert `since` timestamp to ms epoch.
 * Accepts ISO 8601 strings, Date objects, or numeric ms timestamps.
 *
 * @param {string | number | Date} since
 * @returns {number} Epoch milliseconds
 */
export function validateSince(since) {
  if (since === undefined || since === null) {
    throw new ReplayError('Since parameter is required', 'INVALID_SINCE');
  }

  let ms;
  if (since instanceof Date) {
    ms = since.getTime();
  } else if (typeof since === 'number') {
    ms = since;
  } else if (typeof since === 'string') {
    const trimmed = since.trim();
    // If purely numeric string
    if (/^\d+$/.test(trimmed)) {
      ms = Number(trimmed);
    } else {
      const parsed = Date.parse(trimmed);
      if (isNaN(parsed)) {
        throw new ReplayError(
          `Invalid "since" timestamp format: "${since}". Expected ISO 8601 string or epoch ms.`,
          'INVALID_SINCE'
        );
      }
      ms = parsed;
    }
  } else {
    throw new ReplayError('Invalid "since" parameter type', 'INVALID_SINCE');
  }

  if (isNaN(ms) || !Number.isFinite(ms) || ms < 0) {
    throw new ReplayError(`Invalid "since" timestamp: "${since}"`, 'INVALID_SINCE');
  }

  return ms;
}

/**
 * Parse a raw Redis XRANGE entry into `{ id, data }`.
 * Handles both ioredis format `[id, [k1, v1, k2, v2]]` and node-redis format `{ id, message }`.
 *
 * @param {unknown} rawEntry
 * @returns {{ id: string, data: Record<string, unknown> }}
 */
export function parseStreamEntry(rawEntry) {
  if (!rawEntry) {
    return { id: '', data: {} };
  }

  // node-redis format: { id: string, message: Record<string, string> }
  if (typeof rawEntry === 'object' && !Array.isArray(rawEntry) && rawEntry !== null) {
    const obj = /** @type {{ id?: unknown, message?: unknown }} */ (rawEntry);
    if (obj.id) {
      return {
        id: String(obj.id),
        data: (obj.message && typeof obj.message === 'object') ? { .../** @type {Record<string, unknown>} */ (obj.message) } : {},
      };
    }
  }

  // ioredis / raw RESP format: [id, [k1, v1, k2, v2, ...]]
  if (Array.isArray(rawEntry)) {
    const id = String(rawEntry[0] || '');
    const fields = rawEntry[1];
    /** @type {Record<string, unknown>} */
    const data = {};

    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length; i += 2) {
        data[String(fields[i])] = fields[i + 1];
      }
    } else if (fields && typeof fields === 'object') {
      Object.assign(data, fields);
    }

    return { id, data };
  }

  return { id: String(rawEntry), data: {} };
}

/**
 * Retrieve metadata and entry bounds for a Redis Stream.
 *
 * @param {import('../core/types.js').RedisClientLike} client - Redis client (ioredis or node-redis)
 * @param {string} streamKey
 * @returns {Promise<{ streamKey: string, firstEntry: string | null, lastEntry: string | null, length: number }>}
 */
export async function getStreamInfo(client, streamKey) {
  /** @type {{ streamKey: string, firstEntry: string | null, lastEntry: string | null, length: number }} */
  const result = {
    streamKey,
    firstEntry: null,
    lastEntry: null,
    length: 0,
  };

  if (!client) return result;

  // 1. Query length via XLEN
  try {
    if (typeof client.xLen === 'function') {
      result.length = Number(await client.xLen(streamKey)) || 0;
    } else if (typeof client.xlen === 'function') {
      result.length = Number(await client.xlen(streamKey)) || 0;
    } else if (typeof client.sendCommand === 'function') {
      result.length = Number(await client.sendCommand(['XLEN', streamKey])) || 0;
    }
  } catch {
    result.length = 0;
  }

  // 2. Query bounds via XINFO STREAM
  try {
    let rawInfo = null;
    if (typeof client.xInfoStream === 'function') {
      rawInfo = await client.xInfoStream(streamKey);
    } else if (typeof client.xInfo === 'function') {
      rawInfo = await client.xInfo('STREAM', streamKey);
    } else if (typeof client.xinfo === 'function') {
      rawInfo = await client.xinfo('STREAM', streamKey);
    } else if (typeof client.sendCommand === 'function') {
      rawInfo = await client.sendCommand(['XINFO', 'STREAM', streamKey]);
    }

    if (rawInfo) {
      if (Array.isArray(rawInfo)) {
        // Flat array format: ['length', 10, 'first-entry', ['id', [...]], 'last-entry', ...]
        for (let i = 0; i < rawInfo.length; i += 2) {
          const key = String(rawInfo[i]);
          const val = rawInfo[i + 1];
          if (key === 'first-entry' && val) {
            result.firstEntry = Array.isArray(val) ? String(val[0]) : (typeof val === 'object' && val !== null && 'id' in val ? String(/** @type {{ id: unknown }} */ (val).id) : String(val));
          } else if (key === 'last-entry' && val) {
            result.lastEntry = Array.isArray(val) ? String(val[0]) : (typeof val === 'object' && val !== null && 'id' in val ? String(/** @type {{ id: unknown }} */ (val).id) : String(val));
          } else if (key === 'length' && typeof val === 'number') {
            result.length = val;
          }
        }
      } else if (typeof rawInfo === 'object' && rawInfo !== null) {
        const infoObj = /** @type {Record<string, unknown>} */ (rawInfo);
        // Object format from node-redis: { length, firstEntry: { id }, lastEntry: { id } }
        if (infoObj.firstEntry && typeof infoObj.firstEntry === 'object' && 'id' in infoObj.firstEntry) {
          result.firstEntry = String(/** @type {{ id: unknown }} */ (infoObj.firstEntry).id);
        } else if (Array.isArray(infoObj['first-entry'])) {
          result.firstEntry = String(infoObj['first-entry'][0]);
        }
        if (infoObj.lastEntry && typeof infoObj.lastEntry === 'object' && 'id' in infoObj.lastEntry) {
          result.lastEntry = String(/** @type {{ id: unknown }} */ (infoObj.lastEntry).id);
        } else if (Array.isArray(infoObj['last-entry'])) {
          result.lastEntry = String(infoObj['last-entry'][0]);
        }
        if (typeof infoObj.length === 'number') {
          result.length = infoObj.length;
        }
      }
    }
  } catch {
    // Stream may not exist yet or empty
  }

  // Fallback for first/last entry if XINFO didn't find them but length > 0
  if (result.length > 0 && (!result.firstEntry || !result.lastEntry)) {
    try {
      if (!result.firstEntry) {
        const first = await runXRange(client, streamKey, '-', '+', 1);
        if (first.length > 0) {
          result.firstEntry = first[0].id;
        }
      }
      if (!result.lastEntry) {
        let last = null;
        if (typeof client.xrevrange === 'function') {
          const rev = await client.xrevrange(streamKey, '+', '-', 'COUNT', 1);
          if (Array.isArray(rev) && rev.length > 0) {
            last = parseStreamEntry(rev[0]).id;
          }
        } else if (typeof client.xRevRange === 'function') {
          const rev = await client.xRevRange(streamKey, '+', '-', { COUNT: 1 });
          if (Array.isArray(rev) && rev.length > 0) {
            last = parseStreamEntry(rev[0]).id;
          }
        }
        if (last) {
          result.lastEntry = last;
        }
      }
    } catch {
      // Safe ignore
    }
  }

  return result;
}

/**
 * Execute XRANGE command across supported client shapes.
 *
 * @param {import('../core/types.js').RedisClientLike} client
 * @param {string} streamKey
 * @param {string} start
 * @param {string} end
 * @param {number} count
 * @returns {Promise<Array<{ id: string, data: Record<string, unknown> }>>}
 */
async function runXRange(client, streamKey, start, end, count) {
  let raw = [];

  // 1. ioredis style: client.xrange(streamKey, start, end, 'COUNT', count)
  if (typeof client.xrange === 'function') {
    raw = await client.xrange(streamKey, start, end, 'COUNT', count);
  }
  // 2. node-redis v4+ style: client.xRange(streamKey, start, end, { COUNT: count })
  else if (typeof client.xRange === 'function') {
    raw = await client.xRange(streamKey, start, end, { COUNT: count });
  }
  // 3. sendCommand fallback
  else if (typeof client.sendCommand === 'function') {
    raw = await client.sendCommand(['XRANGE', streamKey, start, end, 'COUNT', String(count)]);
  } else {
    throw new Error('No compatible XRANGE method found on Redis client');
  }

  if (!Array.isArray(raw)) return [];
  return raw.map(parseStreamEntry);
}

/**
 * Check whether an event matches the target stream ID or metadata.
 *
 * @param {Record<string, unknown>} eventData
 * @param {string} [streamId]
 * @param {Record<string, unknown> | null} [streamMeta]
 * @returns {boolean}
 */
export function matchesStream(eventData, streamId, streamMeta) {
  if (!streamId || streamId === 'all' || streamId === DEFAULT_REPLAY_STREAM_KEY) {
    return true;
  }
  if (!eventData || typeof eventData !== 'object') {
    return false;
  }

  const sId = String(streamId).toLowerCase();
  const eventScraperId = String(eventData.scraper_id || eventData.scraperId || '').toLowerCase();
  const eventTargetId = String(eventData.target_id || eventData.targetId || '').toLowerCase();
  const eventStreamId = String(eventData.stream_id || eventData.streamId || '').toLowerCase();

  // 1. Direct ID matches
  if (eventScraperId === sId || eventTargetId === sId || eventStreamId === sId) {
    return true;
  }

  // 2. Match against stream metadata if available
  if (streamMeta) {
    const metaUsername = String(streamMeta.username || '').toLowerCase();
    const metaType = String(streamMeta.type || '').toLowerCase();
    const eventPlatform = String(eventData.platform || '').toLowerCase();
    const eventAuthor = String(
      eventData.author_handle || eventData.handle || eventData.username
      || eventData.author_name || eventData.author_id || eventData.authorId || ''
    ).toLowerCase();

    // Check username match (if not wildcard '*')
    if (metaUsername && metaUsername !== '*') {
      const authorMatch = eventAuthor === metaUsername || eventTargetId === metaUsername;
      if (!authorMatch) return false;
    }

    // Check platform / type match
    if (metaType) {
      const platformMatches =
        eventPlatform === metaType ||
        ((metaType === 'tweet' || metaType === 'follower' || metaType === 'mention')
          && (eventPlatform === 'twitter' || eventPlatform === 'x')) ||
        (metaType === 'jetstream' && eventPlatform === 'bluesky') ||
        (metaType === 'mastodon_sse' && eventPlatform === 'mastodon') ||
        (metaType === 'cdc' && (eventPlatform === 'cdc' || eventPlatform === 'postgres' || eventPlatform === 'custom'));

      if (!platformMatches) return false;
    }

    return true;
  }

  return false;
}

/**
 * Acquire Redis client instance for replay operations.
 *
 * @param {Object} [options]
 * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
 * @returns {Promise<import('../core/types.js').RedisClientLike>}
 */
/** @type {import('../core/types.js').RedisClientLike | null} */
let _sharedReplayClient = null;
/** @type {Promise<import('../core/types.js').RedisClientLike> | null} */
let _sharedReplayClientPromise = null;

async function resolveRedisClient(options = {}) {
  if (options.redisClient) {
    return options.redisClient;
  }
  if (_sharedReplayClient) {
    return _sharedReplayClient;
  }
  if (_sharedReplayClientPromise) {
    return _sharedReplayClientPromise;
  }

  _sharedReplayClientPromise = (async () => {
    const { createClient } = await import('redis');
    const url =
      process.env.REDIS_URL ||
      (process.env.REDIS_HOST
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
        : 'redis://localhost:6379');
    const client = createClient({ url });
    await client.connect();
    _sharedReplayClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
    return _sharedReplayClient;
  })();

  try {
    return await _sharedReplayClientPromise;
  } finally {
    _sharedReplayClientPromise = null;
  }
}

/**
 * Replay events from Redis Stream by timestamp range or cursor.
 *
 * @param {Object} [options]
 * @param {string} [options.streamKey='stream:social:raw_posts'] - Redis stream key
 * @param {string} [options.streamId] - Specific stream ID to filter for
 * @param {string | number | Date} [options.since] - ISO 8601 timestamp or epoch ms
 * @param {string} [options.cursor] - Stream entry ID to resume after (exclusive)
 * @param {number} [options.limit=100] - Max events to return (capped at 1000)
 * @param {'webhook'} [options.deliver] - Delivery mode
 * @param {string} [options.subscriptionId] - Webhook subscription ID for delivery
 * @param {import('../core/types.js').RedisClientLike} [options.redisClient] - Custom Redis client
 * @param {import('./outbound-webhook-dispatcher.js').OutboundWebhookDispatcher} [options.dispatcher] - Outbound webhook dispatcher instance
 * @param {import('./webhook-subscription-store.js').WebhookSubscriptionStore} [options.subscriptionStore] - Webhook subscription store instance
 * @param {Record<string, unknown> | null} [options.streamMeta] - Preloaded stream metadata
 * @returns {Promise<{
 *   events: Array<{ id: string, data: Record<string, unknown> }>,
 *   hasMore: boolean,
 *   nextCursor: string | null,
 *   count: number,
 *   streamInfo: { streamKey: string, firstEntry: string | null, lastEntry: string | null, length: number },
 *   warning?: string,
 *   delivered?: number,
 *   deliveryResults?: Array<Record<string, unknown>>
 * }>}
 */
export async function getStreamReplay(options = {}) {
  const streamKey = options.streamKey || DEFAULT_REPLAY_STREAM_KEY;
  const streamId = options.streamId;
  const deliver = options.deliver;
  const subscriptionId = options.subscriptionId;

  // 1. Resolve and validate limit (default 100, max 1000, min 1)
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(MAX_REPLAY_LIMIT, Math.floor(rawLimit))
    : DEFAULT_REPLAY_LIMIT;

  // 2. Validate cursor or since
  let validatedCursor = null;
  let sinceMs = null;

  if (options.cursor !== undefined && options.cursor !== null && options.cursor !== '') {
    validatedCursor = validateCursor(options.cursor);
  } else if (options.since !== undefined && options.since !== null && options.since !== '') {
    sinceMs = validateSince(options.since);
  }

  // 3. Obtain Redis client
  const client = await resolveRedisClient(options);
  const shouldCloseClient = false; // shared client is reused across requests

  try {
    // 4. Query stream info & length
    const streamInfo = await getStreamInfo(client, streamKey);

    // 5. Detect trimmed data if start is before stream's first entry
    let warning;
    if (streamInfo.firstEntry) {
      const firstEntryMs = parseInt(streamInfo.firstEntry.split('-')[0], 10);
      if (sinceMs !== null && sinceMs < firstEntryMs) {
        warning = 'Requested range partially trimmed';
      } else if (validatedCursor) {
        const cursorMs = parseInt(validatedCursor.split('-')[0], 10);
        if (cursorMs < firstEntryMs) {
          warning = 'Requested range partially trimmed';
        }
      }
    }

    // If stream is empty
    if (streamInfo.length === 0) {
      /** @type {{
       *   events: Array<{ id: string, data: Record<string, unknown> }>,
       *   hasMore: boolean,
       *   nextCursor: string | null,
       *   count: number,
       *   streamInfo: typeof streamInfo,
       *   warning?: string
       * }} */
      const emptyRes = {
        events: [],
        hasMore: false,
        nextCursor: null,
        count: 0,
        streamInfo,
      };
      if (warning) emptyRes.warning = warning;
      return emptyRes;
    }

    // 6. Compute start ID for XRANGE
    let startId = '-';
    if (validatedCursor) {
      // Exclusive start: increment sequence number
      const [cMs, cSeq] = validatedCursor.split('-');
      const parsedSeq = cSeq !== undefined ? parseInt(cSeq, 10) : 0;
      const nextSeq = Number.isFinite(parsedSeq) ? parsedSeq + 1 : 1;
      startId = `${cMs}-${nextSeq}`;
    } else if (sinceMs !== null) {
      startId = `${sinceMs}-0`;
    }

    // 7. Preload stream metadata for per-stream filtering if streamId provided
    let streamMeta = options.streamMeta || null;
    if (streamId && streamId !== 'all' && streamId !== streamKey && !streamMeta) {
      try {
        const res = await getStreamStatus(streamId);
        streamMeta = (res && typeof res === 'object') ? /** @type {Record<string, unknown>} */ (res) : null;
      } catch {
        // May not exist in streamManager
      }
    }

    const needsFiltering = Boolean(streamId && streamId !== 'all' && streamId !== streamKey);

    // 8. Fetch events via XRANGE
    /** @type {Array<{ id: string, data: Record<string, unknown> }>} */
    const matchedEvents = [];
    let hasMore = false;
    let nextCursor = null;

    if (!needsFiltering) {
      // Direct stream reading: fetch limit + 1 entries
      const rawEntries = await runXRange(client, streamKey, startId, '+', limit + 1);

      // Exclude cursor if returned
      const cleanEntries = validatedCursor
        ? rawEntries.filter((e) => e.id !== validatedCursor)
        : rawEntries;

      if (cleanEntries.length > limit) {
        matchedEvents.push(...cleanEntries.slice(0, limit));
        hasMore = true;
      } else {
        matchedEvents.push(...cleanEntries);
        // If we fetched limit+1 and dropped the cursor, remaining === limit still
        // implies more entries may exist (the extra slot was the cursor itself).
        hasMore = Boolean(validatedCursor && rawEntries.length > limit);
      }
    } else {
      // Filtering active: paginate through stream until limit + 1 matched or end of stream reached
      let currentStart = startId;
      const batchSize = Math.min(1000, Math.max(limit * 2, 100));

      let scanned = 0;
      const maxScan = 50_000;
      while (matchedEvents.length < limit + 1 && scanned < maxScan) {
        const batch = await runXRange(client, streamKey, currentStart, '+', batchSize);
        if (batch.length === 0) break;
        scanned += batch.length;

        for (const entry of batch) {
          if (validatedCursor && entry.id === validatedCursor) {
            continue;
          }
          if (matchesStream(entry.data, streamId, streamMeta)) {
            matchedEvents.push(entry);
            if (matchedEvents.length >= limit + 1) {
              break;
            }
          }
        }

        if (batch.length < batchSize) {
          // Reached end of stream
          break;
        }

        // Advance currentStart past last entry in batch
        const lastBatchId = batch[batch.length - 1].id;
        const [lMs, lSeq] = lastBatchId.split('-');
        const parsedSeq = lSeq !== undefined ? parseInt(lSeq, 10) : 0;
        const nextSeq = Number.isFinite(parsedSeq) ? parsedSeq + 1 : 1;
        currentStart = `${lMs}-${nextSeq}`;
      }

      if (matchedEvents.length > limit) {
        hasMore = true;
        matchedEvents.splice(limit);
      } else {
        hasMore = false;
      }
    }

    // Set nextCursor from last event if available
    if (matchedEvents.length > 0) {
      nextCursor = matchedEvents[matchedEvents.length - 1].id;
    }

    /** @type {{
     *   events: Array<{ id: string, data: Record<string, unknown> }>,
     *   hasMore: boolean,
     *   nextCursor: string | null,
     *   count: number,
     *   streamInfo: typeof streamInfo,
     *   warning?: string,
     *   delivered?: number,
     *   deliveryResults?: Array<Record<string, unknown>>
     * }} */
    const response = {
      events: matchedEvents,
      hasMore,
      nextCursor,
      count: matchedEvents.length,
      streamInfo,
    };

    if (warning) {
      response.warning = warning;
    }

    // 9. Webhook delivery handling
    if (deliver === 'webhook') {
      const store = options.subscriptionStore || defaultWebhookSubscriptionStore;
      const dispatcher = options.dispatcher || defaultWebhookDispatcher;

      if (!subscriptionId) {
        throw new ReplayError('Missing "subscriptionId" for webhook replay delivery', 'MISSING_SUBSCRIPTION_ID');
      }

      const subscription = await store.get(subscriptionId);
      if (!subscription) {
        throw new ReplayError(`Subscription not found: ${subscriptionId}`, 'SUBSCRIPTION_NOT_FOUND');
      }

      /** @type {Array<Record<string, unknown>>} */
      let results = [];
      try {
        if (typeof dispatcher.dispatchReplay === 'function') {
          results = await dispatcher.dispatchReplay(matchedEvents, subscription);
        } else {
          for (const event of matchedEvents) {
            const payload = event.data || event;
            try {
              const res = await dispatcher.deliverToSubscription(subscription, payload, { isReplay: true });
              results.push(res);
            } catch (err) {
              results.push({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
          }
        }
      } catch (err) {
        results.push({ success: false, error: err instanceof Error ? err.message : String(err) });
      }

      response.delivered = results.filter((r) => r.success !== false).length;
      response.deliveryResults = results;
    }

    return response;
  } finally {
    if (shouldCloseClient && client && typeof client.quit === 'function') {
      try {
        await client.quit();
      } catch {
        // Safe ignore
      }
    }
  }
}
