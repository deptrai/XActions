// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * JetstreamAdapter — Push adapter for Bluesky Jetstream WebSocket firehose.
 * Connects to Bluesky Jetstream public endpoints, consumes JSON commits,
 * normalizes them to PostItem / ThinEvent, and publishes to Redis stream.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { WebSocket } from 'undici';
import { BasePushAdapter } from './base-adapter.js';
import { CATEGORIES } from '../../core/types.js';

export const JETSTREAM_ENDPOINTS = [
  'wss://jetstream1.us-east.bsky.network/subscribe',
  'wss://jetstream2.us-east.bsky.network/subscribe',
  'wss://jetstream1.us-west.bsky.network/subscribe',
  'wss://jetstream2.us-west.bsky.network/subscribe',
];

/**
 * Normalizes a Bluesky Jetstream commit event into a standard PostItem.
 * Note: Jetstream post events provide `did`, `commit.rkey`, `commit.record`, but NO author.handle.
 * We construct:
 * - externalId: `${did}:${rkey}`
 * - id: `bluesky:${did}:${rkey}`
 * - authorId: `did`
 * - postUrl: `https://bsky.app/profile/${did}/post/${rkey}`
 *
 * @param {Record<string, any>} event
 * @returns {import('../../core/types.js').PostItem | null}
 */
export function normalizeJetstreamCommit(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.kind !== 'commit') return null;

  const commit = event.commit;
  if (!commit || typeof commit !== 'object') return null;
  if (commit.operation !== 'create') return null;
  if (commit.collection !== 'app.bsky.feed.post') return null;

  const did = String(event.did || '');
  const rkey = String(commit.rkey || '');
  if (!did || !rkey) return null;

  const record = commit.record || {};
  const externalId = `${did}:${rkey}`;
  const id = `bluesky:${externalId}`;
  const text = typeof record.text === 'string' ? record.text : '';
  const authorId = did;
  const authorName = did; // DID is the only authoritative identifier in Jetstream JSON
  const postUrl = `https://bsky.app/profile/${did}/post/${rkey}`;

  /** @type {string[]} */
  const mediaUrls = [];
  if (record.embed) {
    const embed = record.embed;
    // Direct images: embed.images
    if (Array.isArray(embed.images)) {
      for (const img of embed.images) {
        if (img?.image?.ref?.$link) {
          mediaUrls.push(`https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${img.image.ref.$link}@jpeg`);
        } else if (typeof img?.alt === 'string' && img?.thumb) {
          mediaUrls.push(String(img.thumb));
        }
      }
    }
    // recordWithMedia: embed.media.images
    if (embed.media && Array.isArray(embed.media.images)) {
      for (const img of embed.media.images) {
        if (img?.image?.ref?.$link) {
          mediaUrls.push(`https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${img.image.ref.$link}@jpeg`);
        } else if (typeof img?.alt === 'string' && img?.thumb) {
          mediaUrls.push(String(img.thumb));
        }
      }
    }
    // Video embed: embed.video or embed.media.video
    const videoEmbed = embed.video || embed.media?.video;
    if (videoEmbed?.ref?.$link) {
      mediaUrls.push(`https://video.bsky.app/watch/${did}/${videoEmbed.ref.$link}/playlist.m3u8`);
    } else if (videoEmbed?.playlist) {
      mediaUrls.push(String(videoEmbed.playlist));
    }
    // External link thumbnail
    if (embed.external?.thumb?.ref?.$link) {
      mediaUrls.push(`https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${embed.external.thumb.ref.$link}@jpeg`);
    }
  }

  // Published at: record.createdAt or event.time_us (microseconds since Unix epoch)
  let publishedAt = null;
  if (record.createdAt) {
    publishedAt = new Date(record.createdAt);
    if (isNaN(publishedAt.getTime())) publishedAt = null;
  }
  if (!publishedAt && event.time_us) {
    const ms = Math.floor(Number(event.time_us) / 1000);
    if (Number.isFinite(ms) && ms > 0) {
      publishedAt = new Date(ms);
    }
  }

  return {
    id,
    platform: 'bluesky',
    externalId,
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorUrl: `https://bsky.app/profile/${did}`,
    postUrl,
    content: text,
    mediaUrls,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    metadata: {
      did,
      rkey,
      cid: commit.cid || null,
      rev: commit.rev || null,
      langs: Array.isArray(record.langs) ? record.langs : [],
      time_us: event.time_us || null,
      reply: record.reply ? {
        parent: record.reply.parent?.uri || null,
        root: record.reply.root?.uri || null,
      } : null,
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

export class JetstreamAdapter extends BasePushAdapter {
  /** @type {WebSocket | null} */
  ws = null;

  /** @type {string} */
  endpoint;

  /**
   * @param {string} streamId
   * @param {Record<string, any>} [options]
   * @param {import('../../utils/redis-stream-publisher.js').RedisStreamPublisher} [publisher]
   */
  constructor(streamId, options = {}, publisher) {
    super(streamId, options, publisher);

    if (options.jetstreamHost) {
      this.endpoint = options.jetstreamHost.startsWith('wss://') || options.jetstreamHost.startsWith('ws://')
        ? options.jetstreamHost
        : `wss://${options.jetstreamHost}/subscribe`;
    } else {
      // Pick random default endpoint
      const idx = Math.floor(Math.random() * JETSTREAM_ENDPOINTS.length);
      this.endpoint = JETSTREAM_ENDPOINTS[idx];
    }
  }

  /**
   * Build the WebSocket connection URL with query parameters.
   * @returns {Promise<string>}
   */
  async buildUrl() {
    const url = new URL(this.endpoint);

    // Collections
    const wantedCollections = this.options.wantedCollections || ['app.bsky.feed.post'];
    if (Array.isArray(wantedCollections)) {
      for (const col of wantedCollections) {
        url.searchParams.append('wantedCollections', col);
      }
    } else if (typeof wantedCollections === 'string') {
      url.searchParams.append('wantedCollections', wantedCollections);
    }

    // Dids
    if (this.options.wantedDids) {
      const dids = Array.isArray(this.options.wantedDids) ? this.options.wantedDids : [this.options.wantedDids];
      for (const d of dids) {
        url.searchParams.append('wantedDids', d);
      }
    }

    // Cursor (resume from Redis persisted cursor or options)
    const cursor = await this.getCursor();
    if (cursor) {
      url.searchParams.set('cursor', String(cursor));
    }

    return url.toString();
  }

  /**
   * Connect to Bluesky Jetstream WebSocket.
   * @returns {Promise<void>}
   */
  async connect() {
    this._closing = false;
    const connectUrl = await this.buildUrl();

    return new Promise((resolve, reject) => {
      let isResolved = false;

      try {
        console.log(`📡 [${this.streamId}] Connecting to Jetstream: ${connectUrl}`);
        const ws = new WebSocket(connectUrl);
        this.ws = ws;

        ws.onopen = () => {
          this._connected = true;
          this._resetReconnect();
          this._startCursorFlush();
          this._emitStatus('running');
          console.log(`✅ [${this.streamId}] Jetstream WebSocket connected`);
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        ws.onmessage = async (msgEvent) => {
          try {
            const rawData = typeof msgEvent.data === 'string' ? msgEvent.data : msgEvent.data.toString();
            const event = JSON.parse(rawData);

            // Track cursor from event.time_us
            if (event.time_us) {
              this._cursor = String(event.time_us);
            }

            // Normalize commit
            const item = normalizeJetstreamCommit(event);
            if (item) {
              await this._emitEvent(item);
            }
          } catch (err) {
            console.warn(`⚠️ [${this.streamId}] Error handling Jetstream message:`, err instanceof Error ? err.message : String(err));
          }
        };

        ws.onerror = (errEvent) => {
          const err = new Error(errEvent?.message || 'Jetstream WebSocket error');
          console.error(`❌ [${this.streamId}] Jetstream WebSocket error:`, err.message);
          this._emitError(err);
          // Don't call _scheduleReconnect here — onclose will fire next and handle it
          if (!isResolved) {
            isResolved = true;
            reject(err);
          }
        };

        ws.onclose = (closeEvent) => {
          console.log(`🔌 [${this.streamId}] Jetstream WebSocket closed (code: ${closeEvent?.code}, reason: ${closeEvent?.reason || 'none'})`);
          this._connected = false;
          this.ws = null;

          if (!this._closing) {
            this._scheduleReconnect();
          }
        };
      } catch (err) {
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      }
    });
  }

  /**
   * Disconnect WebSocket cleanly.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._closing = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Safe ignore
      }
      this.ws = null;
    }
    await super.disconnect();
  }
}
