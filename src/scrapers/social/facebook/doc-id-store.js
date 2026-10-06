// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook GraphQL doc_id store — persistent capture cache with auto-refresh bookkeeping.
 *
 * doc_ids are Relay persisted-query identifiers issued by Facebook's servers per
 * web-app build: identical for every account at a point in time, rotated when
 * Facebook deploys a new build. They are captured once from any authenticated
 * session (see doc-id-capture.js / `xactions fb capture-docids`) and reused by
 * every account and guest session until rotation.
 *
 * This module owns the persistence layer:
 *  - `DocIdStore` — load/save a JSON file mapping ACTION_KEY -> { docId, friendlyName, ... }
 *  - `loadStoredDocIdsSync()` — merge stored doc_ids over DEFAULT_FB_DOC_IDS at crawler init
 *  - `noteDocIdFailure(docId)` — called by FacebookClient when a GraphQL error smells like
 *    rotation; bumps failCount and (opt-in) triggers a headless re-capture
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STORE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUTO_REFRESH_FAILURE_THRESHOLD = 3;

/**
 * Resolve where the doc_id store lives.
 * Priority: FACEBOOK_DOCIDS_PATH env > ~/.xactions/facebook-docids.json
 * @returns {string}
 */
export function getDocIdStorePath() {
  return (
    process.env.FACEBOOK_DOCIDS_PATH ||
    path.join(os.homedir(), '.xactions', 'facebook-docids.json')
  );
}

/**
 * Heuristic mapping from a captured GraphQL `fb_api_req_friendly_name` to the
 * crawler's ACTION keys (DEFAULT_FB_DOC_IDS keys in crawler.js).
 * Ordered — first match wins, so specific rules must precede generic ones.
 * @type {Array<{ pattern: RegExp, action: string }>}
 */
export const FRIENDLY_NAME_RULES = [
  { pattern: /CommentsListComponentsPaginationQuery/i, action: 'COMMENT_ROOTS' },
  { pattern: /Depth1CommentsListPaginationQuery/i, action: 'COMMENT_REPLIES' },
  { pattern: /Depth2CommentsListPaginationQuery/i, action: 'COMMENT_REPLIES_DEPTH2' },
  { pattern: /(GroupsCometFeed|group[\w_]*feed)/i, action: 'GROUP_FEED' },
  { pattern: /(Pages?Feed|profile[\w_]*feed)/i, action: 'PAGE_FEED' },
  { pattern: /(ProfileComet|profile[\w_]*(header|intro|timeline|about))/i, action: 'PROFILE' },
  { pattern: /search[\w_]*posts?/i, action: 'SEARCH_POSTS' },
  { pattern: /search[\w_]*people/i, action: 'SEARCH_PEOPLE' },
  { pattern: /search[\w_]*pages/i, action: 'SEARCH_PAGES' },
  { pattern: /search[\w_]*groups/i, action: 'SEARCH_GROUPS' },
  { pattern: /(GroupsSearch|group[\w_]*search)/i, action: 'GROUP_SEARCH' },
  { pattern: /member/i, action: 'GROUP_MEMBERS' },
  { pattern: /follower/i, action: 'FOLLOWERS' },
  { pattern: /following/i, action: 'FOLLOWING' },
  { pattern: /marketplace/i, action: 'MARKETPLACE_SEARCH' },
  { pattern: /(LikeMutation|UFI[\w_]*Like)/i, action: 'LIKE_MUTATION' },
  { pattern: /(CommentMutation|UFIAddComment)/i, action: 'COMMENT_MUTATION' },
  { pattern: /(Composer|StoryCreate|PostMutation)/i, action: 'POST_MUTATION' },
  { pattern: /Share[^\s]*Mutation/i, action: 'SHARE_MUTATION' },
];

/**
 * Map a captured friendly name to a crawler ACTION key.
 * @param {string} friendlyName
 * @returns {string|null}
 */
export function mapFriendlyName(friendlyName) {
  if (!friendlyName || typeof friendlyName !== 'string') return null;
  for (const { pattern, action } of FRIENDLY_NAME_RULES) {
    if (pattern.test(friendlyName)) return action;
  }
  return null;
}

/** @returns {Object} */
function emptyData() {
  return {
    version: STORE_VERSION,
    capturedAt: null,
    source: null,
    docIds: {},
    extra: {},
    tokens: {},
  };
}

/**
 * Persistent doc_id store.
 *
 * File shape:
 * {
 *   "version": 1,
 *   "capturedAt": 1690000000000,
 *   "source": "cli-capture",
 *   "docIds": { "PROFILE": { "docId": "...", "friendlyName": "...", "capturedAt": 0, "lastValidatedAt": 0, "failCount": 0 } },
 *   "extra":   { "SomeUnmappedQuery_facebookRelayOperation": { "docId": "...", "capturedAt": 0 } },
 *   "tokens":  { "fb_dtsg": "...", "lsd": "..." }
 * }
 */
export class DocIdStore {
  #filePath;
  #data;

  /**
   * @param {string} [filePath] - defaults to getDocIdStorePath()
   */
  constructor(filePath = getDocIdStorePath()) {
    this.#filePath = filePath;
    this.#data = emptyData();
  }

  /** @returns {string} */
  get filePath() {
    return this.#filePath;
  }

  /**
   * Read the store file (if any) into memory. Missing/corrupt file resets to empty.
   * @returns {DocIdStore} this
   */
  loadSync() {
    try {
      const raw = fs.readFileSync(this.#filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.docIds && typeof parsed.docIds === 'object') {
        this.#data = {
          ...emptyData(),
          ...parsed,
          docIds: parsed.docIds,
          extra: parsed.extra && typeof parsed.extra === 'object' ? parsed.extra : {},
          tokens: parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {},
        };
      }
    } catch {
      this.#data = emptyData();
    }
    return this;
  }

  /**
   * Persist the store to disk (creates parent dirs).
   * @returns {DocIdStore} this
   */
  saveSync() {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#data, null, 2));
    return this;
  }

  /**
   * @param {string} actionKey
   * @returns {{ docId: string, friendlyName?: string, capturedAt?: number, lastValidatedAt?: number, failCount?: number } | null}
   */
  get(actionKey) {
    return this.#data.docIds[actionKey] || null;
  }

  /**
   * Record a doc_id for an ACTION key.
   * @param {string} actionKey
   * @param {{ docId?: string, friendlyName?: string, source?: string|null }} [entry]
   * @returns {DocIdStore} this
   */
  set(actionKey, entry = {}) {
    const { docId, friendlyName = '', source = null } = entry || {};
    if (!actionKey || !docId) return this;
    const prev = this.#data.docIds[actionKey];
    this.#data.docIds[actionKey] = {
      docId: String(docId),
      friendlyName: friendlyName || prev?.friendlyName || '',
      capturedAt: Date.now(),
      lastValidatedAt: prev?.lastValidatedAt || null,
      failCount: 0, // fresh capture resets failure bookkeeping
      ...(source ? { source } : {}),
    };
    return this;
  }

  /**
   * Record an unmapped captured query (kept for inspection, not injected into the crawler).
   * @param {string} friendlyName
   * @param {{ docId?: string }} [entry]
   * @returns {DocIdStore} this
   */
  setExtra(friendlyName, entry = {}) {
    const { docId } = entry || {};
    if (!friendlyName || !docId) return this;
    this.#data.extra[friendlyName] = { docId: String(docId), capturedAt: Date.now() };
    return this;
  }

  /**
   * Store the latest auth tokens captured alongside doc_ids (fb_dtsg, lsd, ...).
   * @param {Record<string, string>} tokens
   * @returns {DocIdStore} this
   */
  setTokens(tokens = {}) {
    const useful = Object.fromEntries(
      Object.entries(tokens).filter(([, v]) => typeof v === 'string' && v.length > 0)
    );
    this.#data.tokens = { ...this.#data.tokens, ...useful };
    return this;
  }

  /**
   * Persist a sample of the variables a real client sent for an ACTION's
   * persisted query, so the expected variable shape can be inspected later.
   * @param {string} actionKey
   * @param {Record<string, any>} variables
   * @returns {DocIdStore} this
   */
  setVariablesSample(actionKey, variables = {}) {
    const entry = this.#data.docIds[actionKey];
    if (!entry) return this;
    const sample = {};
    for (const [key, value] of Object.entries(variables)) {
      // Keep the shape, redact long values (tokens/cursors are opaque).
      sample[key] = typeof value === 'string' && value.length > 40 ? `${value.slice(0, 8)}...` : value;
    }
    entry.variablesSample = sample;
    return this;
  }

  /**
   * Mark a successful use of an ACTION's doc_id.
   * @param {string} actionKey
   * @returns {DocIdStore} this
   */
  markValidated(actionKey) {
    const entry = this.#data.docIds[actionKey];
    if (entry) {
      entry.lastValidatedAt = Date.now();
      entry.failCount = 0;
    }
    return this;
  }

  /**
   * Bookkeeping for a GraphQL failure on a specific doc_id (likely rotation).
   * @param {string} docId
   * @returns {string|null} the ACTION key that owned this doc_id, if any
   */
  markFailedByDocId(docId) {
    if (!docId) return null;
    for (const [actionKey, entry] of Object.entries(this.#data.docIds)) {
      if (entry?.docId === String(docId)) {
        entry.failCount = (entry.failCount || 0) + 1;
        entry.lastFailedAt = Date.now();
        return actionKey;
      }
    }
    return null;
  }

  /**
   * Stamp the store as freshly captured (sets capturedAt + source).
   * @param {string} [source]
   * @returns {DocIdStore} this
   */
  markCaptured(source = 'capture') {
    this.#data.capturedAt = Date.now();
    this.#data.source = source;
    return this;
  }

  /**
   * ACTION key -> docId map, ready to spread over DEFAULT_FB_DOC_IDS.
   * @returns {Record<string, string>}
   */
  toDocIdMap() {
    /** @type {Record<string, string>} */
    const map = {};
    for (const [actionKey, entry] of Object.entries(this.#data.docIds)) {
      if (entry?.docId) map[actionKey] = entry.docId;
    }
    return map;
  }

  /**
   * True when the store is empty or older than maxAgeMs.
   * @param {number} [maxAgeMs]
   * @returns {boolean}
   */
  needsRefresh(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    if (!this.#data.capturedAt) return true;
    return Date.now() - this.#data.capturedAt > maxAgeMs;
  }

  /**
   * @returns {{ total: number, extra: number, failures: number, capturedAt: number|null, stale: boolean }}
   */
  getStats() {
    const entries = Object.values(this.#data.docIds);
    return {
      total: entries.length,
      extra: Object.keys(this.#data.extra).length,
      failures: entries.reduce((sum, e) => sum + (e?.failCount || 0), 0),
      capturedAt: this.#data.capturedAt,
      stale: this.needsRefresh(),
    };
  }

  /** @returns {Object} deep-ish copy for serialization/tests */
  toJSON() {
    return JSON.parse(JSON.stringify(this.#data));
  }
}

// --------------------------------------------------------------------------
// Process-wide active store
// --------------------------------------------------------------------------

/** @type {DocIdStore | null} */
let activeStore = null;

/**
 * Lazily-created process-wide store (loaded from disk once).
 * @returns {DocIdStore}
 */
export function getActiveDocIdStore() {
  if (!activeStore) {
    activeStore = new DocIdStore().loadSync();
  }
  return activeStore;
}

/**
 * Swap the active store (used by tests and the capture flow).
 * @param {DocIdStore|null} store
 */
export function setActiveDocIdStore(store) {
  activeStore = store;
}

/**
 * Stored doc_ids as a plain ACTION->docId map; {} when nothing captured yet.
 * @returns {Record<string, string>}
 */
export function loadStoredDocIdsSync() {
  try {
    return getActiveDocIdStore().toDocIdMap();
  } catch {
    return {};
  }
}

function autoRefreshEnabled() {
  const flag = String(process.env.FACEBOOK_DOCIDS_AUTO_REFRESH || '').toLowerCase();
  return flag === '1' || flag === 'true';
}

/**
 * Record a likely-rotated doc_id failure. Called from FacebookClient's GraphQL
 * error path; must never throw into the request flow.
 *
 * When FACEBOOK_DOCIDS_AUTO_REFRESH=1 and failures pile up past the threshold,
 * kicks off a headless re-capture (fire-and-forget) using previously saved cookies.
 * @param {string} docId
 * @returns {string|null} owning ACTION key, if known
 */
export function noteDocIdFailure(docId) {
  try {
    const store = getActiveDocIdStore();
    const actionKey = store.markFailedByDocId(docId);
    if (actionKey) store.saveSync();
    if (actionKey && autoRefreshEnabled() && store.getStats().failures >= AUTO_REFRESH_FAILURE_THRESHOLD) {
      // Dynamic import: capture module pulls in puppeteer; keep it off the
      // hot path unless an auto-refresh is actually warranted.
      import('./doc-id-capture.js')
        .then((m) => m.maybeAutoRefreshDocIds({ reason: 'rotation' }))
        .catch(() => { /* best-effort */ });
    }
    return actionKey;
  } catch {
    return null;
  }
}
