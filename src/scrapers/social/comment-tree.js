// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CommentTreeExtractor — platform-agnostic hierarchical comment tree fetcher.
 * BFS by depth, cycle detection, deduplication, and topological sort before persistence.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import pLimit from 'p-limit';

/**
 * @typedef {Object} FetchLayerPage
 * @property {Record<string, unknown>[]} comments
 * @property {{ has_next_page: boolean, end_cursor: string | null }} [pageInfo]
 */

/**
 * @typedef {Object} FetchLayerInput
 * @property {string} postId
 * @property {string | null} [parentCommentId]
 * @property {string | null} [after]
 * @property {number} [limit]
 */

/**
 * @typedef {import('../../core/types.js').CommentItem} CommentItem
 */

export class CommentTreeExtractor {
  /** @type {function(FetchLayerInput): Promise<FetchLayerPage>} */
  #fetchLayer;

  /** @type {function(Record<string, unknown>, string): CommentItem | null} */
  #normalizeFn;

  /** @type {number} */
  #maxDepth;

  /** @type {number} */
  #maxComments;

  /** @type {ReturnType<typeof pLimit>} */
  #limit;

  /**
   * @param {function(FetchLayerInput): Promise<FetchLayerPage>} fetchLayer
   * @param {function(Record<string, unknown>, string): CommentItem | null} normalizeFn
   * @param {Object} [options]
   * @param {number} [options.maxDepth=3]
   * @param {number} [options.maxComments=500]
   * @param {number} [options.concurrency=2]
   */
  constructor(fetchLayer, normalizeFn, options = {}) {
    this.#fetchLayer = fetchLayer;
    this.#normalizeFn = normalizeFn;
    this.#maxDepth = Math.max(0, Math.min(options.maxDepth ?? 3, 5));
    this.#maxComments = Math.max(1, Math.min(options.maxComments ?? 500, 2000));
    this.#limit = pLimit(Math.max(1, Math.min(options.concurrency ?? 2, 4)));
  }

  /**
   * Fetch the full comment tree for a post.
   * @param {string} postId
   * @param {Object} [options]
   * @param {string | null} [options.after] - Initial root pagination cursor
   * @returns {Promise<{ comments: CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async fetch(postId, options = {}) {
    const initialAfter = options?.after || null;
    const byId = new Map();
    const seen = new Set();
    let total = 0;
    let rootPageInfo = { has_next_page: false, end_cursor: /** @type {string | null} */ (null) };

    /**
     * @param {Record<string, unknown>} raw
     * @param {number} depth
     * @param {string | null} [parentExternalId]
     */
    const add = (raw, depth, parentExternalId) => {
      if (total >= this.#maxComments) return;

      if (parentExternalId && raw.parentId === undefined) {
        raw.parentId = parentExternalId;
      }

      const normalized = this.#normalizeFn(raw, postId);
      if (!normalized) {
        return;
      }

      /** @type {CommentItem} */
      const comment = normalized;
      comment.depth = depth;

      const orphanMeta = /** @type {Record<string, unknown>} */ (comment.metadata || {});

      if (!comment.id) {
        return;
      }

      if (seen.has(comment.id)) {
        return;
      }

      if (comment.parentCommentId) {
        if (comment.parentCommentId === comment.id) {
          console.warn(`⚠️ Comment cycle detected at ${comment.id} (self-reference)`);
          return;
        }
        if (this.#wouldCreateCycle(comment.parentCommentId, comment.id, byId)) {
          console.warn(`⚠️ Comment cycle detected at ${comment.id} (ancestor loop)`);
          return;
        }
        if (!byId.has(comment.parentCommentId)) {
          // Missing parent — re-attach as orphan root to avoid FK violation.
          const orphanOf = comment.parentCommentId;
          comment.parentCommentId = undefined;
          comment.depth = 0;
          orphanMeta.orphanOf = orphanOf;
          comment.metadata = orphanMeta;
        }
      }

      seen.add(comment.id);
      byId.set(comment.id, comment);
      total++;
    };

    /**
     * Fetch one layer, paginating until done or the global cap is reached.
     * @param {string | null} parentCommentId
     * @param {number} depth
     * @param {string | null} [initialCursor=null]
     * @returns {Promise<{ pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
     */
    const fetchLayerPaginated = async (parentCommentId, depth, initialCursor = null) => {
      let after = /** @type {string | null} */ (initialCursor);
      let lastPageInfo = { has_next_page: false, end_cursor: /** @type {string | null} */ (null) };

      do {
        const remaining = this.#maxComments - total;
        if (remaining <= 0) break;

        const page = await this.#fetchLayer({
          postId,
          parentCommentId,
          after,
          limit: remaining,
        });

        const prevTotal = total;
        const rawComments = Array.isArray(page?.comments) ? page.comments : [];
        for (const raw of rawComments) {
          if (total >= this.#maxComments) break;
          add(raw, depth, parentCommentId);
        }

        const pageInfo = page?.pageInfo || { has_next_page: false, end_cursor: null };
        lastPageInfo = pageInfo;
        const nextCursor = pageInfo.has_next_page ? pageInfo.end_cursor : null;
        if (nextCursor === after || total === prevTotal) {
          break;
        }
        after = nextCursor;
      } while (after && total < this.#maxComments);

      return { pageInfo: lastPageInfo };
    };

    const root = await fetchLayerPaginated(null, 0, initialAfter);
    rootPageInfo = root.pageInfo;

    for (let depth = 0; depth < this.#maxDepth; depth++) {
      const parents = Array.from(byId.values()).filter(
        (c) => c.depth === depth && (c.subCommentsCount ?? 0) > 0
      );
      if (parents.length === 0) break;

      await Promise.all(
        parents.map((parent) =>
          this.#limit(() => fetchLayerPaginated(parent.externalId, depth + 1))
        )
      );
    }

    const comments = Array.from(byId.values()).sort((a, b) => a.depth - b.depth);
    return { comments, pageInfo: rootPageInfo };
  }

  /**
   * Check whether `parentId` is an ancestor of `childId` in the already-collected tree.
   * @param {string} parentId
   * @param {string} childId
   * @param {Map<string, CommentItem>} byId
   * @returns {boolean}
   */
  #wouldCreateCycle(parentId, childId, byId) {
    const visited = new Set();
    let current = byId.get(parentId);
    while (current) {
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      if (current.id === childId) return true;
      if (!current.parentCommentId) break;
      current = byId.get(current.parentCommentId);
    }
    return false;
  }
}
