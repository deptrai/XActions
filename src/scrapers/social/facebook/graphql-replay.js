// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GraphQL Replay Engine — Story 13.12 (FR-112)
 *
 * Captures Facebook GraphQL doc_id + auth tokens from a live browser session,
 * persists them to a replay cache (redis or sqlite), and enables pure-HTTP
 * replay of read queries — bypassing headless browser entirely.
 *
 * 10-50x faster than DOM scroll for read-heavy scraping paths.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';

const DEFAULT_REPLAY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_REPLAY_ENTRIES = 1000;
const GRAPHQL_URL_PATTERN = /\/api\/graphql\//;
const FB_TOKEN_FIELDS = ['doc_id', 'fb_dtsg', 'lsd', '__dyn', '__csr', 'fb_api_req_friendly_name', 'jazoest', 'hsi', 'spin_t', 'spin_b', 'spin_r'];

/**
 * In-memory fallback store when redis/sqlite unavailable.
 * @class
 */
export class InMemoryReplayStore {
  #store = new Map();
  #ttlMs;

  constructor(ttlMs = DEFAULT_REPLAY_TTL_MS) {
    this.#ttlMs = ttlMs;
  }

  async get(docId) {
    const entry = this.#store.get(docId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(docId);
      return null;
    }
    return entry;
  }

  async set(docId, data) {
    if (this.#store.size >= MAX_REPLAY_ENTRIES) {
      // Evict oldest
      const oldest = [...this.#store.entries()].sort((a, b) => a[1].capturedAt - b[1].capturedAt)[0];
      if (oldest) this.#store.delete(oldest[0]);
    }
    this.#store.set(docId, {
      docId,
      ...data,
      capturedAt: Date.now(),
      expiresAt: Date.now() + this.#ttlMs,
    });
  }

  async invalidate(docId) {
    this.#store.delete(docId);
  }

  async size() {
    return this.#store.size;
  }
}

/**
 * Redis-backed replay store for production use.
 * @class
 */
export class RedisReplayStore {
  #client;
  #prefix;
  #ttlMs;

  constructor(redisClient, prefix = 'xactions:graphql:replay:', ttlMs = DEFAULT_REPLAY_TTL_MS) {
    this.#client = redisClient;
    this.#prefix = prefix;
    this.#ttlMs = ttlMs;
  }

  async get(docId) {
    const key = `${this.#prefix}${docId}`;
    const raw = await this.#client.get(key);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        await this.#client.del(key);
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  }

  async set(docId, data) {
    const key = `${this.#prefix}${docId}`;
    const entry = {
      docId,
      ...data,
      capturedAt: Date.now(),
      expiresAt: Date.now() + this.#ttlMs,
    };
    await this.#client.set(key, JSON.stringify(entry), 'PX', this.#ttlMs);
  }

  async invalidate(docId) {
    await this.#client.del(`${this.#prefix}${docId}`);
  }

  async size() {
    const keys = await this.#client.keys(`${this.#prefix}*`);
    return keys.length;
  }
}

/**
 * Captures GraphQL request metadata from Puppeteer page requests.
 * Attach via page.on('request') — parses POST bodies to api/graphql endpoints.
 * @class
 */
export class GraphQLCaptureHook {
  /** @type {Map<string, {docId: string, tokens: Object, variables: Object, friendlyName: string, url: string, capturedAt: number}>} */
  #captured = new Map();
  /** @type {InMemoryReplayStore|RedisReplayStore|null} */
  #store = null;

  constructor(store = null) {
    this.#store = store || new InMemoryReplayStore();
  }

  /**
   * Attach to a Puppeteer page's request event.
   * @param {import('puppeteer').Page} page
   */
  attach(page) {
    page.on('request', (request) => this.#handleRequest(request));
  }

  /**
   * Parse a GraphQL request and persist to store.
   * @param {import('puppeteer').HTTPRequest} request
   */
  async #handleRequest(request) {
    try {
      const url = request.url();
      if (!GRAPHQL_URL_PATTERN.test(url)) return;
      if (request.method() !== 'POST') return;

      const postData = request.postData();
      if (!postData) return;

      const body = this.#parseBody(postData);
      if (!body || !body.doc_id) return;

      const docId = String(body.doc_id);
      const tokens = {};
      for (const field of FB_TOKEN_FIELDS) {
        if (body[field] !== undefined) tokens[field] = String(body[field]);
      }

      const friendlyName = body.fb_api_req_friendly_name || '';
      const variables = body.variables ? (typeof body.variables === 'string' ? JSON.parse(body.variables) : body.variables) : {};

      const entry = {
        docId,
        tokens,
        variables,
        friendlyName,
        url,
        capturedAt: Date.now(),
      };

      this.#captured.set(docId, entry);

      if (this.#store) {
        await this.#store.set(docId, {
          tokens,
          friendlyName,
          url,
        });
      }
    } catch { /* malformed request — skip */ }
  }

  /**
   * Parse URL-encoded or JSON body.
   * @param {string} postData
   * @returns {Object|null}
   */
  #parseBody(postData) {
    try {
      // URL-encoded form data
      if (postData.includes('&') || postData.includes('=')) {
        const params = new URLSearchParams(postData);
        const result = {};
        for (const [k, v] of params.entries()) {
          result[k] = v;
        }
        return result;
      }
      // JSON body
      return JSON.parse(postData);
    } catch {
      return null;
    }
  }

  /**
   * Get all captured doc_ids.
   * @returns {string[]}
   */
  getCapturedDocIds() {
    return [...this.#captured.keys()];
  }

  /**
   * Get all captured entries (doc_id + tokens + friendly name + variables).
   * @returns {Array<{docId: string, tokens: Object, variables: Object, friendlyName: string, url: string, capturedAt: number}>}
   */
  getCapturedEntries() {
    return [...this.#captured.values()];
  }

  /**
   * Get capture stats.
   * @returns {Promise<{totalCaptured: number, storeSize: number}>}
   */
  async getStats() {
    return {
      totalCaptured: this.#captured.size,
      storeSize: this.#store ? await this.#store.size() : 0,
    };
  }
}

/**
 * Replay engine — replays captured GraphQL queries via HTTP client.
 * Handles cache hits, rotation detection, and re-capture on miss.
 * @class
 */
export class GraphQLReplayEngine {
  /** @type {InMemoryReplayStore|RedisReplayStore} */
  #store;
  /** @type {GraphQLCaptureHook|null} */
  #captureHook;
  /** @type {Object|null} */
  #client; // FacebookClient or similar with requestGraphQl

  constructor({ store, captureHook, client }) {
    this.#store = store || new InMemoryReplayStore();
    this.#captureHook = captureHook || null;
    this.#client = client || null;
  }

  /**
   * Replay a GraphQL query by doc_id.
   * @param {string} docId
   * @param {Object} variables
   * @param {Object} [options]
   * @returns {Promise<{data: any, replayed: boolean, rotated: boolean}>}
   */
  async replay(docId, variables = {}, options = {}) {
    // Check store for cached tokens
    const cached = await this.#store.get(docId);
    if (cached && !options.forceCapture) {
      try {
        const result = await this.#client.requestGraphQl(docId, variables, {
          ...options,
          tokens: cached.tokens,
        });
        return { data: result, replayed: true, rotated: false };
      } catch (err) {
        // Detect rotation — invalidate cache
        if (this.#isRotationError(err)) {
          await this.#store.invalidate(docId);
          // Fall through to re-capture if we have a hook+page, else report rotation
          if (!this.#captureHook || !options.page) return { data: null, replayed: false, rotated: true };
          // else fall through to re-capture below
        } else {
          throw err;
        }
      }
    }

    // Cache miss or forced capture — need browser to re-capture
    if (!this.#captureHook) {
      throw new Error('GraphQLReplayEngine: no capture hook configured and no cached doc_id');
    }

    // Trigger browser capture — caller must provide page
    if (!options.page) {
      throw new Error('GraphQLReplayEngine: cache miss requires browser page for re-capture');
    }

    this.#captureHook.attach(options.page);
    // Wait for capture to complete (page navigates or caller triggers request)
    const captured = await this.#waitForCapture(docId, options.timeoutMs || 5000);
    if (!captured) {
      throw new Error(`GraphQLReplayEngine: failed to capture doc_id ${docId} from browser`);
    }

    // Retry with fresh tokens
    const result = await this.#client.requestGraphQl(docId, variables, {
      ...options,
      tokens: captured.tokens,
    });
    return { data: result, replayed: false, rotated: false };
  }

  /**
   * Check if error indicates doc_id rotation.
   * @param {Error & { code?: string }} err
   * @returns {boolean}
   */
  #isRotationError(err) {
    const msg = err.message || '';
    return (
      msg.includes('doc_id') ||
      msg.includes('Invalid doc_id') ||
      msg.includes('GraphQL error') ||
      msg.includes('schema error') ||
      err.code === 'XACT_4001'
    );
  }

  /**
   * Wait for a doc_id to be captured by the hook.
   * @param {string} docId
   * @param {number} timeoutMs
   * @returns {Promise<{tokens: Object}|null>}
   */
  async #waitForCapture(docId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const entry = await this.#store.get(docId);
      if (entry) return entry;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  /**
   * List all captured doc_ids with their metadata.
   * @returns {Promise<Array<{docId: string, friendlyName: string, capturedAt: number, expiresAt: number}>>}
   */
  async listCaptured() {
    const ids = this.#captureHook ? this.#captureHook.getCapturedDocIds() : [];
    const results = [];
    for (const docId of ids) {
      const entry = await this.#store.get(docId);
      if (entry) results.push({ docId, ...entry });
    }
    return results;
  }
}
