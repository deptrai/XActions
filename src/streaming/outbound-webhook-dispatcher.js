// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * OutboundWebhookDispatcher — Real-time outbound webhook dispatcher with HMAC signing,
 * exponential backoff retry, dead-letter queue (DLQ), and Redis stream consumer group.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'crypto';
import {
  WebhookSubscriptionStore,
  defaultWebhookSubscriptionStore,
} from './webhook-subscription-store.js';

export const DEFAULT_STREAM_KEY = 'stream:social:raw_posts';
export const DEFAULT_CONSUMER_GROUP = 'webhook-dispatcher';
export const DLQ_REDIS_KEY = 'xactions:webhook:dlq';
export const METRICS_KEY_PREFIX = 'xactions:webhook:metrics:';
export const DELIVERY_LOGS_KEY = 'xactions:webhook:delivery_logs';

/**
 * Generate HMAC-SHA256 signature formatted as `sha256=<hex>`.
 * Returns empty string if secret is not provided.
 *
 * @param {string | Record<string, unknown>} payload
 * @param {string} [secret]
 * @returns {string}
 */
export function createSignature(payload, secret) {
  if (!secret || typeof secret !== 'string') {
    return '';
  }
  const body = typeof payload === 'string'
    ? payload
    : (payload === undefined || payload === null ? '' : JSON.stringify(payload));
  const digest = crypto.createHmac('sha256', secret).update(body ?? '').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Verify HMAC-SHA256 signature timing-safely.
 * Supports both (payload, secret, signatureHeader) and (payload, signatureHeader, secret).
 *
 * @param {string | Record<string, unknown>} payload
 * @param {string} secretOrSignature
 * @param {string} signatureOrSecret
 * @returns {boolean}
 */
export function verifySignature(payload, secretOrSignature, signatureOrSecret) {
  if (!secretOrSignature || !signatureOrSecret) {
    return false;
  }
  let secret = '';
  let signatureHeader = '';
  const looksLikeSig = (s) => typeof s === 'string' && /^sha256=[a-f0-9]{64}$/i.test(s);
  if (looksLikeSig(secretOrSignature) && !looksLikeSig(signatureOrSecret)) {
    signatureHeader = secretOrSignature;
    secret = typeof signatureOrSecret === 'string' ? signatureOrSecret : '';
  } else if (looksLikeSig(signatureOrSecret) && !looksLikeSig(secretOrSignature)) {
    signatureHeader = signatureOrSecret;
    secret = typeof secretOrSignature === 'string' ? secretOrSignature : '';
  } else {
    secret = typeof secretOrSignature === 'string' ? secretOrSignature : '';
    signatureHeader = typeof signatureOrSecret === 'string' ? signatureOrSecret : '';
  }

  if (!secret || !signatureHeader) {
    return false;
  }
  const expected = createSignature(payload, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Parse raw Redis stream entry into an object.
 * Handles both node-redis ({ field: value }) and ioredis ([field, value, ...]) formats.
 *
 * @param {Record<string, unknown> | Array<unknown>} messageData
 * @returns {Record<string, unknown>}
 */
export function parseStreamPayload(messageData) {
  if (!messageData) return {};
  if (!Array.isArray(messageData) && typeof messageData === 'object') {
    return { ...messageData };
  }
  if (Array.isArray(messageData)) {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (let i = 0; i < messageData.length; i += 2) {
      const key = String(messageData[i]);
      const val = messageData[i + 1];
      result[key] = val;
    }
    return result;
  }
  return {};
}

export class OutboundWebhookDispatcher {
  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {WebhookSubscriptionStore} */
  #subscriptionStore;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /** @type {string} */
  #consumerName;

  /** @type {string} */
  #dlqKey;

  /** @type {string} */
  #deliveryLogsKey;

  /** @type {string} */
  #metricsPrefix;

  /** @type {number} */
  #maxRetries;

  /** @type {number} */
  #backoffBaseMs;

  /** @type {number} */
  #timeoutMs;

  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #isOwnedClient = false;

  /** @type {Set<Promise<unknown>>} */
  #inFlightDeliveries = new Set();

  /** @type {Array<Record<string, unknown>>} In-memory DLQ fallback */
  #dlqFallback = [];

  /** @type {Array<Record<string, unknown>>} In-memory logs fallback */
  #logsFallback = [];

  /** @type {Map<string, Record<string, unknown>>} In-memory metrics fallback */
  #metricsFallback = new Map();

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {WebhookSubscriptionStore} [options.subscriptionStore]
   * @param {string} [options.streamKey]
   * @param {string} [options.groupName]
   * @param {string} [options.consumerName]
   * @param {string} [options.dlqKey]
   * @param {string} [options.deliveryLogsKey]
   * @param {string} [options.metricsPrefix]
   * @param {number} [options.maxRetries=3] - Total 4 attempts (1 initial + 3 retries)
   * @param {number} [options.backoffBaseMs=1000] - 1s -> 2s -> 4s
   * @param {number} [options.timeoutMs=10000] - 10s fetch timeout
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#subscriptionStore = options.subscriptionStore || defaultWebhookSubscriptionStore;
    this.#streamKey = options.streamKey || DEFAULT_STREAM_KEY;
    this.#groupName = options.groupName || DEFAULT_CONSUMER_GROUP;
    this.#consumerName = options.consumerName || `dispatcher-${process.pid || 1}`;
    this.#dlqKey = options.dlqKey || DLQ_REDIS_KEY;
    this.#deliveryLogsKey = options.deliveryLogsKey || DELIVERY_LOGS_KEY;
    this.#metricsPrefix = options.metricsPrefix || METRICS_KEY_PREFIX;
    this.#maxRetries = Number.isFinite(options.maxRetries) ? Number(options.maxRetries) : 3;
    this.#backoffBaseMs = Number.isFinite(options.backoffBaseMs) ? Number(options.backoffBaseMs) : 1000;
    this.#timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
  }

  get isRunning() {
    return this.#running;
  }

  get subscriptionStore() {
    return this.#subscriptionStore;
  }

  get streamKey() {
    return this.#streamKey;
  }

  get groupName() {
    return this.#groupName;
  }

  get dlqKey() {
    return this.#dlqKey;
  }

  get inFlightCount() {
    return this.#inFlightDeliveries.size;
  }

  /**
   * Ensure Redis client is available and connected.
   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
   */
  async ensureClient() {
    if (this.#redisClient) {
      return this.#redisClient;
    }

    try {
      const { createClient } = await import('redis');
      const url =
        process.env.REDIS_URL ||
        (process.env.REDIS_HOST
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn('[OutboundWebhookDispatcher] Redis error:', err instanceof Error ? err.message : String(err));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      this.#isOwnedClient = true;
      return this.#redisClient;
    } catch {
      return null;
    }
  }

  /**
   * Initialize consumer group with MKSTREAM: true, ignoring BUSYGROUP if it exists.
   * @returns {Promise<void>}
   */
  async initGroup() {
    const client = await this.ensureClient();
    if (!client) return;

    try {
      if (typeof client.xGroupCreate === 'function') {
        await client.xGroupCreate(this.#streamKey, this.#groupName, '$', { MKSTREAM: true });
      } else if (typeof client.xgroup === 'function') {
        await client.xgroup('CREATE', this.#streamKey, this.#groupName, '$', 'MKSTREAM');
      }
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (!msg.includes('BUSYGROUP')) {
        console.warn('[OutboundWebhookDispatcher] xGroupCreate warning:', msg);
      }
    }
  }

  /**
   * Start consumer group processing loop.
   * @param {Object} [opts]
   * @param {number} [opts.count=10]
   * @param {number} [opts.blockMs=2000]
   */
  async start(opts = {}) {
    if (this.#running) return;
    this.#running = true;

    await this.initGroup();

    const count = opts.count || 10;
    const blockMs = opts.blockMs !== undefined ? opts.blockMs : 2000;

    // Run loop in background
    (async () => {
      let claimCounter = 0;
      while (this.#running) {
        try {
          await this.#consumeBatch(count, blockMs);

          // Every ~15 iterations, check for stalled messages with XAUTOCLAIM
          claimCounter++;
          if (claimCounter >= 15) {
            claimCounter = 0;
            await this.#claimStalledMessages(count);
          }
        } catch (err) {
          if (this.#running) {
            console.warn('[OutboundWebhookDispatcher] Consumer loop error:', err instanceof Error ? err.message : String(err));
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
    })();
  }

  /**
   * Stop dispatcher gracefully with up to 5s grace period for in-flight deliveries.
   * @param {number} [gracePeriodMs=5000]
   * @returns {Promise<void>}
   */
  async stop(gracePeriodMs = 5000) {
    this.#running = false;

    if (this.#inFlightDeliveries.size > 0) {
      let tid;
      const timeoutPromise = new Promise((resolve) => { tid = setTimeout(resolve, gracePeriodMs); });
      try {
        await Promise.race([
          Promise.allSettled(Array.from(this.#inFlightDeliveries)),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(tid);
      }
    }

    if (this.#isOwnedClient && this.#redisClient && typeof this.#redisClient.quit === 'function') {
      try {
        await this.#redisClient.quit();
      } catch {
        // Safe ignore on shutdown
      } finally {
        this.#redisClient = null;
      }
    }
  }

  /**
   * Read and process a batch from Redis stream using XREADGROUP.
   * @param {number} count
   * @param {number} blockMs
   */
  async #consumeBatch(count, blockMs) {
    const client = await this.ensureClient();
    if (!client) {
      await new Promise((r) => setTimeout(r, 500));
      return;
    }

    let rawEntries = null;

    try {
      if (typeof client.xReadGroup === 'function') {
        rawEntries = await client.xReadGroup(
          this.#groupName,
          this.#consumerName,
          [{ key: this.#streamKey, id: '>' }],
          { COUNT: count, BLOCK: blockMs }
        );
      } else if (typeof client.xreadgroup === 'function') {
        rawEntries = await client.xreadgroup(
          'GROUP',
          this.#groupName,
          this.#consumerName,
          'COUNT',
          count,
          'BLOCK',
          blockMs,
          'STREAMS',
          this.#streamKey,
          '>'
        );
      }
    } catch (err) {
      if (this.#running) {
        console.warn('[OutboundWebhookDispatcher] XREADGROUP error:', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (!rawEntries) return;

    // Normalize messages array across node-redis / ioredis
    const messages = [];
    if (Array.isArray(rawEntries)) {
      for (const streamObj of rawEntries) {
        // node-redis shape: { name, messages: [{ id, message }] }
        if (streamObj && Array.isArray(streamObj.messages)) {
          for (const msg of streamObj.messages) {
            messages.push({
              id: msg.id,
              data: parseStreamPayload(msg.message),
            });
          }
        } else if (Array.isArray(streamObj) && streamObj.length === 2) {
          // ioredis shape: [streamKey, [[id, [k1, v1, ...]], ...]]
          const entries = streamObj[1];
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (Array.isArray(entry) && entry.length >= 2) {
                messages.push({
                  id: entry[0],
                  data: parseStreamPayload(entry[1]),
                });
              }
            }
          }
        }
      }
    }

    if (messages.length === 0) return;

    // Process all messages
    for (const msg of messages) {
      const deliveryPromise = this.#processMessage(msg.id, msg.data);
      this.#inFlightDeliveries.add(deliveryPromise);
      deliveryPromise.finally(() => {
        this.#inFlightDeliveries.delete(deliveryPromise);
      });
    }

    await Promise.allSettled(Array.from(this.#inFlightDeliveries));
  }

  /**
   * Reclaim pending/stalled messages from idle consumers via XAUTOCLAIM.
   * @param {number} count
   */
  async #claimStalledMessages(count) {
    const client = await this.ensureClient();
    if (!client) return;

    try {
      const minIdleTimeMs = 30000; // Stalled for 30s
      let claimedMessages = null;

      if (typeof client.xAutoClaim === 'function') {
        claimedMessages = await client.xAutoClaim(
          this.#streamKey,
          this.#groupName,
          this.#consumerName,
          minIdleTimeMs,
          '0-0',
          { COUNT: count }
        );
      } else if (typeof client.xautoclaim === 'function') {
        claimedMessages = await client.xautoclaim(
          this.#streamKey,
          this.#groupName,
          this.#consumerName,
          minIdleTimeMs,
          '0-0',
          'COUNT',
          count
        );
      }

      if (claimedMessages) {
        const msgs = claimedMessages.messages || (Array.isArray(claimedMessages) ? claimedMessages[1] : null);
        if (Array.isArray(msgs)) {
          for (const msg of msgs) {
            const id = msg?.id || (Array.isArray(msg) ? msg[0] : null);
            const data = parseStreamPayload(msg?.message || (Array.isArray(msg) ? msg[1] : null));
            if (id && data) {
              await this.#processMessage(id, data);
            }
          }
        }
      }
    } catch (err) {
      // Safe ignore if XAUTOCLAIM not supported or fails
    }
  }

  /**
   * Process a single stream message and ACK it upon completion.
   * @param {string} msgId
   * @param {Record<string, unknown>} eventData
   */
  async #processMessage(msgId, eventData) {
    try {
      await this.dispatchEvent(eventData);
    } catch (err) {
      console.warn(`[OutboundWebhookDispatcher] Error dispatching message ${msgId}:`, err instanceof Error ? err.message : String(err));
    } finally {
      await this.#ackMessage(msgId);
    }
  }

  /**
   * ACK message from consumer group.
   * @param {string} msgId
   */
  async #ackMessage(msgId) {
    const client = await this.ensureClient();
    if (!client || !msgId) return;

    try {
      if (typeof client.xAck === 'function') {
        await client.xAck(this.#streamKey, this.#groupName, msgId);
      } else if (typeof client.xack === 'function') {
        await client.xack(this.#streamKey, this.#groupName, msgId);
      }
    } catch (err) {
      console.warn(`[OutboundWebhookDispatcher] XACK error for ${msgId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Match active subscriptions and dispatch event to all matching subscribers.
   * Asynchronous delivery with Promise.allSettled.
   *
   * @param {Record<string, unknown>} event
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async dispatchEvent(event) {
    if (!event || typeof event !== 'object') {
      return [];
    }

    const platform = String(event.platform || '');
    const matchingSubs = await this.#subscriptionStore.matchSubscriptions(platform);

    if (matchingSubs.length === 0) {
      return [];
    }

    // Deliver to all matching subscriptions concurrently
    const settled = await Promise.allSettled(
      matchingSubs.map((sub) => this.deliverToSubscription(sub, event))
    );
    return settled.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            success: false,
            delivered: false,
            attempts: 0,
            totalAttempts: 0,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          }
    );
  }

  /**
   * Alias for dispatchEvent.
   *
   * @param {Record<string, unknown>} event
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async dispatchToMatching(event) {
    return this.dispatchEvent(event);
  }

  /**
   * Deliver event to a single subscription with retry policy:
   * - Attempt 1: immediate
   * - Attempt 2: +1s
   * - Attempt 3: +2s
   * - Attempt 4: +4s (total 4 attempts = maxRetries 3)
   * - Permanent failure on 4xx: straight to DLQ (no retry)
   * - Timeout > 10s: abort and retry as 5xx
   * - All retries exhausted: move to DLQ
   *
   * @param {Record<string, unknown>} subscription
   * @param {Record<string, unknown>} payload
   * @param {Object} [options]
   * @param {boolean} [options.isReplay]
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<Record<string, unknown>>}
   */
  async deliverToSubscription(subscription, payload, options = {}) {
    if (!subscription || typeof subscription !== 'object' || !payload || typeof payload !== 'object') {
      return { success: false, delivered: false, error: 'Invalid input' };
    }
    const subId = String(subscription.id || 'unknown');
    const url = String(subscription.url || '');
    const secret = typeof subscription.secret === 'string' ? subscription.secret : '';
    const eventId = String(payload.id || payload.external_post_id || payload.externalId || '');
    const platform = String(payload.platform || '');

    const body = JSON.stringify(payload);
    const signature = createSignature(body, secret);

    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'XActions-Webhook-Dispatcher/1.0',
      'X-XActions-Delivery': `del_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12)}`,
      'X-XActions-Event': platform,
    };
    if (options.isReplay || options.headers?.['X-XActions-Replay']) {
      headers['X-XActions-Replay'] = 'true';
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }
    if (signature) {
      headers['X-XActions-Signature'] = signature;
    }

    let lastError = null;
    let lastStatusCode = null;
    let totalAttempts = 0;
    let delivered = false;
    let latencyMs = 0;

    // Total attempts: 1 initial + maxRetries
    const maxAttempts = this.#maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      totalAttempts = attempt;
      const startTime = Date.now();
      let attemptStatusCode = null;
      let attemptError = null;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.#timeoutMs);

        let response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        latencyMs = Date.now() - startTime;
        attemptStatusCode = response.status;
        lastStatusCode = response.status;

        // Drain / cancel body so undici can reuse the socket
        try {
          if (response.body && typeof response.body.cancel === 'function') {
            await response.body.cancel().catch(() => {});
          } else if (typeof response.text === 'function') {
            await response.text().catch(() => {});
          }
        } catch {
          // ignore drain errors
        }

        if (response.ok) {
          // Success (2xx)
          delivered = true;
          await this.#recordDeliveryLog({
            subscriptionId: subId,
            url,
            eventId,
            platform,
            attempt,
            statusCode: attemptStatusCode,
            latencyMs,
            success: true,
            error: null,
          });
          await this.#updateMetrics(subId, {
            success: true,
            latencyMs,
            attempts: attempt,
          });
          return {
            success: true,
            delivered: true,
            attempts: attempt,
            totalAttempts: attempt,
            statusCode: attemptStatusCode,
            latencyMs,
          };
        }

        // 4xx Permanent failure: straight to DLQ (no retry)
        // 429 / 408 are retryable (rate-limit / request timeout)
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
          attemptError = `HTTP ${response.status} (permanent)`;
          lastError = attemptError;
          await this.#recordDeliveryLog({
            subscriptionId: subId,
            url,
            eventId,
            platform,
            attempt,
            statusCode: attemptStatusCode,
            latencyMs,
            success: false,
            error: attemptError,
          });
          break; // Stop retry loop immediately
        }

        // 5xx Server Error: retryable
        attemptError = `HTTP ${response.status}`;
        lastError = attemptError;
      } catch (err) {
        latencyMs = Date.now() - startTime;
        const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        attemptError = isAbort ? `Timeout (> ${this.#timeoutMs}ms)` : (err instanceof Error ? err.message : String(err));
        lastError = attemptError;
        attemptStatusCode = 0;
        lastStatusCode = 0;
      }

      // Record this attempt in delivery logs
      await this.#recordDeliveryLog({
        subscriptionId: subId,
        url,
        eventId,
        platform,
        attempt,
        statusCode: attemptStatusCode,
        latencyMs,
        success: false,
        error: attemptError,
      });

      // If we have more attempts, wait with exponential backoff
      if (attempt < maxAttempts) {
        // Attempt 2: backoff 1s (attempt=1 retry)
        // Attempt 3: backoff 2s (attempt=2 retry)
        // Attempt 4: backoff 4s (attempt=3 retry)
        const backoffMs = this.#backoffBaseMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    // All attempts failed or 4xx occurred -> move to DLQ (unless retrying an existing DLQ item)
    await this.#updateMetrics(subId, {
      success: false,
      latencyMs,
      attempts: totalAttempts,
    });

    if (options.skipDlq) {
      return {
        success: false,
        delivered: false,
        attempts: totalAttempts,
        totalAttempts,
        statusCode: lastStatusCode,
        lastError,
      };
    }

    const dlqItem = await this.#pushToDlq({
      subscriptionId: subId,
      url,
      payload,
      lastError: lastError || 'Delivery failed',
      attempts: totalAttempts,
    });

    return {
      success: false,
      delivered: false,
      attempts: totalAttempts,
      totalAttempts,
      statusCode: lastStatusCode,
      lastError,
      dlqId: dlqItem.id,
    };
  }

  /**
   * Push failed event to DLQ (Redis list `xactions:webhook:dlq`).
   * @param {Object} data
   * @param {string} data.subscriptionId
   * @param {string} data.url
   * @param {Record<string, unknown>} data.payload
   * @param {string} data.lastError
   * @param {number} data.attempts
   * @returns {Promise<Record<string, unknown>>}
   */
  async #pushToDlq(data) {
    const id = `dlq_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12)}`;
    const dlqItem = {
      id,
      subscriptionId: data.subscriptionId,
      url: data.url,
      payload: data.payload,
      lastError: data.lastError,
      attempts: data.attempts,
      failedAt: new Date().toISOString(),
    };

    const client = await this.ensureClient();
    if (client) {
      try {
        const json = JSON.stringify(dlqItem);
        if (typeof client.lPush === 'function') {
          await client.lPush(this.#dlqKey, json);
          if (typeof client.lTrim === 'function') await client.lTrim(this.#dlqKey, 0, 999);
        } else if (typeof client.lpush === 'function') {
          await client.lpush(this.#dlqKey, json);
          if (typeof client.ltrim === 'function') await client.ltrim(this.#dlqKey, 0, 999);
        }
      } catch (err) {
        console.warn('[OutboundWebhookDispatcher] Redis LPUSH DLQ error:', err instanceof Error ? err.message : String(err));
        this.#dlqFallback.unshift(dlqItem);
      }
    } else {
      this.#dlqFallback.unshift(dlqItem);
    }

    return dlqItem;
  }

  /**
   * Record delivery attempt log.
   * @param {Record<string, any>} log
   */
  async #recordDeliveryLog(log) {
    const id = `del_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12)}`;
    const logEntry = {
      id,
      ...log,
      timestamp: new Date().toISOString(),
    };

    const client = await this.ensureClient();
    if (client) {
      try {
        const json = JSON.stringify(logEntry);
        const subLogKey = `${this.#deliveryLogsKey}:${log.subscriptionId}`;

        if (typeof client.lPush === 'function') {
          await client.lPush(this.#deliveryLogsKey, json);
          if (typeof client.lTrim === 'function') await client.lTrim(this.#deliveryLogsKey, 0, 999);
          await client.lPush(subLogKey, json);
          if (typeof client.lTrim === 'function') await client.lTrim(subLogKey, 0, 499);
        } else if (typeof client.lpush === 'function') {
          await client.lpush(this.#deliveryLogsKey, json);
          if (typeof client.ltrim === 'function') await client.ltrim(this.#deliveryLogsKey, 0, 999);
          await client.lpush(subLogKey, json);
          if (typeof client.ltrim === 'function') await client.ltrim(subLogKey, 0, 499);
        }
      } catch {
        this.#logsFallback.unshift(logEntry);
        if (this.#logsFallback.length > 1000) this.#logsFallback.length = 1000;
      }
    } else {
      this.#logsFallback.unshift(logEntry);
      if (this.#logsFallback.length > 1000) this.#logsFallback.length = 1000;
    }
  }

  /**
   * Update delivery metrics for subscription in Redis hash `xactions:webhook:metrics:{subId}`.
   * @param {string} subscriptionId
   * @param {Object} update
   * @param {boolean} update.success
   * @param {number} update.latencyMs
   */
  async #updateMetrics(subscriptionId, { success, latencyMs, attempts = 1 }) {
    const metricsKey = `${this.#metricsPrefix}${subscriptionId}`;
    const now = new Date().toISOString();
    const attemptCount = Number.isFinite(Number(attempts)) && Number(attempts) > 0 ? Number(attempts) : 1;

    const client = await this.ensureClient();
    if (client && typeof client.hIncrBy === 'function') {
      try {
        const newAttempts = await client.hIncrBy(metricsKey, 'totalAttempts', attemptCount);
        if (success) {
          await client.hIncrBy(metricsKey, 'totalSuccess', 1);
        } else {
          await client.hIncrBy(metricsKey, 'totalFailures', 1);
        }
        await client.hSet(metricsKey, {
          lastDeliveryAt: now,
          lastStatus: success ? 'success' : 'failure',
          avgLatencyMs: String(Math.round(Number(latencyMs) || 0)),
        });
        void newAttempts;
        return;
      } catch {
        // fall through to read-modify-write
      }
    }

    const current = await this.getMetrics(subscriptionId);
    const oldAttempts = Number(current.totalAttempts || 0);
    const oldSuccess = Number(current.totalSuccess || 0);
    const oldFailures = Number(current.totalFailures || 0);
    const oldAvgLatency = Number(current.avgLatencyMs || 0);

    const newAttempts = oldAttempts + attemptCount;
    const newSuccess = success ? oldSuccess + 1 : oldSuccess;
    const newFailures = !success ? oldFailures + 1 : oldFailures;
    const newAvgLatency = Math.round(((oldAvgLatency * oldAttempts) + latencyMs) / Math.max(newAttempts, 1));
    const newStatus = success ? 'success' : 'failure';

    const updated = {
      totalAttempts: String(newAttempts),
      totalSuccess: String(newSuccess),
      totalFailures: String(newFailures),
      avgLatencyMs: String(newAvgLatency),
      lastDeliveryAt: now,
      lastStatus: newStatus,
    };

    if (client) {
      try {
        if (typeof client.hSet === 'function') {
          await client.hSet(metricsKey, updated);
        } else if (typeof client.hset === 'function') {
          await client.hset(metricsKey, updated);
        }
      } catch {
        this.#metricsFallback.set(subscriptionId, updated);
      }
    } else {
      this.#metricsFallback.set(subscriptionId, updated);
    }
  }

  /**
   * Get metrics for a subscription.
   * @param {string} subscriptionId
   * @returns {Promise<Record<string, unknown>>}
   */
  async getMetrics(subscriptionId) {
    if (!subscriptionId) return {};
    const metricsKey = `${this.#metricsPrefix}${subscriptionId}`;

    const client = await this.ensureClient();
    if (client) {
      try {
        let raw = null;
        if (typeof client.hGetAll === 'function') {
          raw = await client.hGetAll(metricsKey);
        } else if (typeof client.hgetall === 'function') {
          raw = await client.hgetall(metricsKey);
        }
        if (raw && Object.keys(raw).length > 0) {
          return {
            totalAttempts: Number(raw.totalAttempts || 0),
            totalSuccess: Number(raw.totalSuccess || 0),
            totalFailures: Number(raw.totalFailures || 0),
            avgLatencyMs: Number(raw.avgLatencyMs || 0),
            lastDeliveryAt: raw.lastDeliveryAt || null,
            lastStatus: raw.lastStatus || null,
          };
        }
      } catch {
        // Fall back to memory
      }
    }

    const mem = this.#metricsFallback.get(subscriptionId);
    if (mem) {
      return {
        totalAttempts: Number(mem.totalAttempts || 0),
        totalSuccess: Number(mem.totalSuccess || 0),
        totalFailures: Number(mem.totalFailures || 0),
        avgLatencyMs: Number(mem.avgLatencyMs || 0),
        lastDeliveryAt: mem.lastDeliveryAt || null,
        lastStatus: mem.lastStatus || null,
      };
    }

    return {
      totalAttempts: 0,
      totalSuccess: 0,
      totalFailures: 0,
      avgLatencyMs: 0,
      lastDeliveryAt: null,
      lastStatus: null,
    };
  }

  /**
   * Get delivery logs, optionally filtered by subscriptionId.
   * @param {Object} [options]
   * @param {string} [options.subscriptionId]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getDeliveryLogs(options = {}) {
    const parsedLimit = Number(options.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 500)) : 50;
    const offset = Math.max(0, Number(options.offset || 0));
    const subId = options.subscriptionId;

    const listKey = subId ? `${this.#deliveryLogsKey}:${subId}` : this.#deliveryLogsKey;
    const results = [];

    const client = await this.ensureClient();
    if (client) {
      try {
        let rawItems = [];
        if (typeof client.lRange === 'function') {
          rawItems = await client.lRange(listKey, offset, offset + limit - 1);
        } else if (typeof client.lrange === 'function') {
          rawItems = await client.lrange(listKey, offset, offset + limit - 1);
        }

        if (Array.isArray(rawItems)) {
          for (const raw of rawItems) {
            try {
              results.push(JSON.parse(raw));
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Fall back to memory
      }
    }

    if (results.length === 0 && this.#logsFallback.length > 0) {
      let source = this.#logsFallback;
      if (subId) {
        source = source.filter((l) => l.subscriptionId === subId);
      }
      return source.slice(offset, offset + limit);
    }

    return results;
  }

  /**
   * Get DLQ entries.
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async getDlq(options = {}) {
    const parsedLimit = Number(options.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 500)) : 50;
    const offset = Math.max(0, Number(options.offset || 0));
    const results = [];

    const client = await this.ensureClient();
    if (client) {
      try {
        let rawItems = [];
        if (typeof client.lRange === 'function') {
          rawItems = await client.lRange(this.#dlqKey, offset, offset + limit - 1);
        } else if (typeof client.lrange === 'function') {
          rawItems = await client.lrange(this.#dlqKey, offset, offset + limit - 1);
        }

        if (Array.isArray(rawItems)) {
          for (const raw of rawItems) {
            try {
              results.push(JSON.parse(raw));
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Fall back to memory
      }
    }

    if (results.length === 0 && this.#dlqFallback.length > 0) {
      return this.#dlqFallback.slice(offset, offset + limit);
    }

    return results;
  }

  /**
   * Retry delivery of a DLQ entry by ID.
   * If delivery succeeds, entry is removed from DLQ.
   *
   * @param {string} dlqId
   * @returns {Promise<{ success: boolean, delivered: boolean, dlqId: string, statusCode?: number | null, attempts?: number, totalAttempts?: number, error?: string }>}
   */
  async retryDlqEntry(dlqId) {
    if (!dlqId) {
      return { success: false, delivered: false, dlqId: '', error: 'Missing dlqId' };
    }

    let foundItem = null;
    let foundRaw = null;

    const client = await this.ensureClient();
    if (client) {
      try {
        let rawItems = [];
        if (typeof client.lRange === 'function') {
          rawItems = await client.lRange(this.#dlqKey, 0, -1);
        } else if (typeof client.lrange === 'function') {
          rawItems = await client.lrange(this.#dlqKey, 0, -1);
        }

        if (Array.isArray(rawItems)) {
          for (const raw of rawItems) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.id === dlqId) {
                foundItem = parsed;
                foundRaw = raw;
                break;
              }
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Fall back to memory
      }
    }

    if (!foundItem) {
      const idx = this.#dlqFallback.findIndex((item) => item.id === dlqId);
      if (idx !== -1) {
        foundItem = this.#dlqFallback[idx];
      }
    }

    if (!foundItem) {
      return { success: false, delivered: false, dlqId, error: 'DLQ item not found' };
    }

    // Load subscription
    const sub = await this.#subscriptionStore.get(foundItem.subscriptionId);
    if (!sub) {
      return { success: false, delivered: false, dlqId, error: 'Subscription not found' };
    }

    // Re-attempt delivery without creating a duplicate DLQ entry on failure
    const result = await this.deliverToSubscription(sub, foundItem.payload, { skipDlq: true });

    if (result.success) {
      // Remove from DLQ
      if (client && foundRaw) {
        try {
          if (typeof client.lRem === 'function') {
            await client.lRem(this.#dlqKey, 1, foundRaw);
          } else if (typeof client.lrem === 'function') {
            await client.lrem(this.#dlqKey, 1, foundRaw);
          }
        } catch {
          // Ignore
        }
      }
      const memIdx = this.#dlqFallback.findIndex((item) => item.id === dlqId);
      if (memIdx !== -1) {
        this.#dlqFallback.splice(memIdx, 1);
      }

      return {
        success: true,
        delivered: true,
        dlqId,
        statusCode: typeof result.statusCode === "number" ? result.statusCode : null,
        attempts: typeof result.attempts === "number" ? result.attempts : undefined,
        totalAttempts: typeof result.totalAttempts === "number" ? result.totalAttempts : undefined,
      };
    }

    return {
      success: false,
      delivered: false,
      dlqId,
      statusCode: typeof result.statusCode === "number" ? result.statusCode : null,
      attempts: typeof result.attempts === "number" ? result.attempts : undefined,
      totalAttempts: typeof result.totalAttempts === "number" ? result.totalAttempts : undefined,
      error: String(result.lastError || result.error || "Delivery retry failed"),
    };
  }

  /**
   * Dispatch replay events to a specific subscription with X-XActions-Replay: true header.
   *
   * @param {Array<Record<string, unknown>>} events - Array of events to replay
   * @param {string | Record<string, unknown>} subscriptionOrId - Subscription ID or object
   * @returns {Promise<Array<Record<string, unknown>>>} Delivery results
   */
  async dispatchReplay(events, subscriptionOrId) {
    if (!Array.isArray(events) || events.length === 0) return [];
    /** @type {Record<string, any> | null} */
    let sub = null;
    if (typeof subscriptionOrId === 'string') {
      sub = await this.subscriptionStore.get(subscriptionOrId);
    } else if (subscriptionOrId && typeof subscriptionOrId === 'object') {
      sub = subscriptionOrId;
    }

    if (!sub) {
      throw new Error(`Subscription not found: ${subscriptionOrId}`);
    }

    const results = [];
    for (const event of events) {
      const payload = /** @type {Record<string, unknown>} */ (event && typeof event === 'object' && 'data' in event ? event.data : event);
      const res = await this.deliverToSubscription(sub, payload, { isReplay: true });
      results.push(res);
    }
    return results;
  }

  /**
   * Get consumer group pending count and lag.
   * @returns {Promise<{ pending: number, lag: number }>}
   */
  async getLag() {
    const client = await this.ensureClient();
    if (!client) return { pending: 0, lag: 0 };

    let pending = 0;
    let lag = 0;

    try {
      if (typeof client.xPending === 'function') {
        const info = await client.xPending(this.#streamKey, this.#groupName);
        if (info && typeof info.pending === 'number') {
          pending = info.pending;
        } else if (Array.isArray(info) && typeof info[0] === 'number') {
          pending = info[0];
        }
      } else if (typeof client.xpending === 'function') {
        const info = await client.xpending(this.#streamKey, this.#groupName);
        if (info && typeof info.pending === 'number') {
          pending = info.pending;
        } else if (Array.isArray(info) && typeof info[0] === 'number') {
          pending = info[0];
        }
      }
    } catch {
      // Ignore
    }

    return { pending, lag };
  }
}

export const defaultWebhookDispatcher = new OutboundWebhookDispatcher();

/**
 * Factory helper for creating dispatcher instance.
 * @param {Object} [options]
 * @returns {OutboundWebhookDispatcher}
 */
export function createWebhookDispatcher(options = {}) {
  return new OutboundWebhookDispatcher(options);
}
