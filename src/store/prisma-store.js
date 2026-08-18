// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PrismaStore — PostgreSQL persistence via Prisma.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractStore } from '../core/base-store.js';
import { generatePostId, generateCommentId } from '../core/types.js';

export class PrismaStore extends AbstractStore {
  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {number} */
  #chunkSize = 500;

  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {number} [options.chunkSize]
   */
  constructor(options = {}) {
    super();
    this.#prisma = options.prisma || null;
    this.#chunkSize = options.chunkSize || 500;
  }

  /** @returns {Promise<void>} */
  async init() {
    if (this.#prisma) return;
    const { default: prisma } = await import('../../api/lib/prisma.js');
    this.#prisma = prisma;
  }

  /**
   * Normalize namespaced ids.
   * @param {import('../core/types.js').PostItem} post
   * @returns {import('../core/types.js').PostItem}
   */
  #normalizePost(post) {
    const id = post.id || generatePostId(post.platform, post.externalId);
    return { ...post, id };
  }

  /**
   * @param {import('../core/types.js').PostItem} post
   * @returns {Promise<void>}
   */
  async storeContent(post) {
    await this.init();
    await this.storeBatch([post]);
  }

  /**
   * @param {import('../core/types.js').PostItem[]} posts
   * @param {Object} [opts]
   * @param {boolean} [opts.upsert=false]
   * @returns {Promise<void>}
   */
  async storeBatch(posts, opts = {}) {
    await this.init();
    if (!posts.length) return;
    const normalized = posts.map((p) => this.#normalizePost(p));
    for (let i = 0; i < normalized.length; i += this.#chunkSize) {
      const chunk = normalized.slice(i, i + this.#chunkSize);
      if (opts.upsert) {
        await this.#upsertChunk(this.#prisma?.post, chunk);
      } else {
        await this.#prisma?.post.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
    }
  }

  /**
   * @param {any} model
   * @param {any[]} items
   * @returns {Promise<void>}
   */
  async #upsertChunk(model, items) {
    if (!model) return;
    for (const item of items) {
      await model.upsert({
        where: { id: item.id },
        update: item,
        create: item,
      });
    }
  }

  /**
   * @param {import('../core/types.js').CommentItem} comment
   * @returns {Promise<void>}
   */
  async storeComment(comment) {
    await this.init();
    await this.storeCommentBatch([comment]);
  }

  /**
   * @param {import('../core/types.js').CommentItem[]} comments
   * @param {Object} [opts]
   * @param {boolean} [opts.upsert=false]
   * @returns {Promise<void>}
   */
  async storeCommentBatch(comments, opts = {}) {
    await this.init();
    if (!comments.length) return;

    // Ensure namespaced id and parent id belongs to same post
    const normalized = comments.map((c) => this.#normalizeComment(c));

    // Topological sort by depth ascending
    const sorted = [...normalized].sort((a, b) => (a.depth || 0) - (b.depth || 0));

    // Group by depth and insert level by level to avoid self-FK violation
    const byDepth = new Map();
    for (const comment of sorted) {
      const depth = comment.depth || 0;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth).push(comment);
    }

    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    for (const depth of depths) {
      const chunk = byDepth.get(depth);
      for (let i = 0; i < chunk.length; i += this.#chunkSize) {
        const slice = chunk.slice(i, i + this.#chunkSize);
        if (opts.upsert) {
          await this.#upsertChunk(this.#prisma?.comment, slice);
        } else {
          await this.#prisma?.comment.createMany({
            data: slice,
            skipDuplicates: true,
          });
        }
      }
    }
  }

  /**
   * @param {import('../core/types.js').CommentItem} comment
   * @returns {import('../core/types.js').CommentItem}
   */
  #normalizeComment(comment) {
    const postId = comment.postId;
    const externalId = comment.externalId;
    const platform = comment.platform;
    // postId is namespaced "${platform}:${postExternalId}"; extract postExternalId
    const postExternalId = postId.startsWith(`${platform}:`) ? postId.slice(platform.length + 1) : postId;
    const id = comment.id || generateCommentId(platform, postExternalId, externalId);
    return { ...comment, id };
  }

  /** @returns {Promise<void>} */
  async close() {
    await this.#prisma?.$disconnect();
  }
}
