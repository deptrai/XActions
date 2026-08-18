// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PrismaStore — PostgreSQL persistence via Prisma.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractStore } from '../core/base-store.js';

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
   * @param {import('../core/types.js').PostItem} post
   * @returns {Promise<void>}
   */
  async storeContent(post) {
    await this.init();
    await this.storeBatch([post]);
  }

  /**
   * @param {import('../core/types.js').PostItem[]} posts
   * @returns {Promise<void>}
   */
  async storeBatch(posts) {
    await this.init();
    if (!posts.length) return;
    for (let i = 0; i < posts.length; i += this.#chunkSize) {
      const chunk = posts.slice(i, i + this.#chunkSize);
      await this.#prisma?.post.createMany({
        data: chunk,
        skipDuplicates: true,
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
   * @returns {Promise<void>}
   */
  async storeCommentBatch(comments) {
    await this.init();
    if (!comments.length) return;
    // Topological sort by depth ascending
    const sorted = [...comments].sort((a, b) => (a.depth || 0) - (b.depth || 0));
    for (let i = 0; i < sorted.length; i += this.#chunkSize) {
      const chunk = sorted.slice(i, i + this.#chunkSize);
      await this.#prisma?.comment.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }
  }

  /** @returns {Promise<void>} */
  async close() {
    await this.#prisma?.$disconnect();
  }
}
