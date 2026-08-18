// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PrismaStore — PostgreSQL persistence via Prisma.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractStore } from '../core/base-store.js';
import { generatePostId, generateCommentId, isValidCategory, CATEGORY_VALUES } from '../core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';

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
    this.#chunkSize =
      typeof options.chunkSize === 'number' && options.chunkSize > 0
        ? Math.floor(options.chunkSize)
        : 500;
  }

  /** @returns {Promise<void>} */
  async init() {
    if (this.#prisma) return;
    const { default: prisma } = await import('../../api/lib/prisma.js');
    this.#prisma = prisma;
  }

  /**
   * Normalize and sanitize post item to Prisma Post schema.
   * @param {import('../core/types.js').PostItem} post
   * @returns {Object}
   */
  #normalizePost(post) {
    if (!post || typeof post !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Post must be a valid non-null object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const platform = String(post.platform || '');
    const externalId = String(post.externalId || '');
    if (!platform || !externalId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Post must contain valid non-empty platform and externalId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const id = post.id || generatePostId(platform, externalId);
    return {
      id,
      platform,
      externalId,
      category: post.category,
      authorId: String(post.authorId || ''),
      authorName: String(post.authorName || ''),
      authorAvatar: post.authorAvatar || null,
      authorUrl: post.authorUrl || null,
      postUrl: post.postUrl || null,
      content: post.content || '',
      mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
      likesCount: Number(post.likesCount) || 0,
      repostsCount: Number(post.repostsCount) || 0,
      repliesCount: Number(post.repliesCount) || 0,
      viewsCount: Number(post.viewsCount) || 0,
      metadata: post.metadata && typeof post.metadata === 'object' ? post.metadata : null,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      crawledAt: post.crawledAt ? new Date(post.crawledAt) : new Date(),
    };
  }

  /**
   * Normalize and sanitize comment item to Prisma Comment schema.
   * @param {import('../core/types.js').CommentItem} comment
   * @returns {Object}
   */
  #normalizeComment(comment) {
    if (!comment || typeof comment !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Comment must be a valid non-null object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const platform = String(comment.platform || '');
    const rawPostId = String(comment.postId || '');
    const commentExternalId = String(comment.externalId || '');

    if (!platform || !rawPostId || !commentExternalId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Comment must contain valid non-empty platform, postId, and externalId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const postExternalId = rawPostId.startsWith(`${platform}:`)
      ? rawPostId.slice(platform.length + 1)
      : rawPostId;
    const postId = `${platform}:${postExternalId}`;
    const id = comment.id || generateCommentId(platform, postExternalId, commentExternalId);

    let parentCommentId = null;
    if (comment.parentCommentId) {
      const rawParent = String(comment.parentCommentId);
      parentCommentId = rawParent.startsWith(`${platform}:`)
        ? rawParent
        : generateCommentId(platform, postExternalId, rawParent);
    }

    const depth =
      typeof comment.depth === 'number' && Number.isInteger(comment.depth) && comment.depth >= 0
        ? comment.depth
        : parentCommentId
          ? 1
          : 0;

    return {
      id,
      platform,
      externalId: commentExternalId,
      postId,
      parentCommentId,
      depth,
      authorId: String(comment.authorId || ''),
      authorName: String(comment.authorName || ''),
      authorAvatar: comment.authorAvatar || null,
      content: comment.content || '',
      likesCount: Number(comment.likesCount) || 0,
      subCommentsCount: Number(comment.subCommentsCount) || 0,
      metadata: comment.metadata && typeof comment.metadata === 'object' ? comment.metadata : null,
      publishedAt: comment.publishedAt ? new Date(comment.publishedAt) : null,
      crawledAt: comment.crawledAt ? new Date(comment.crawledAt) : new Date(),
    };
  }

  /**
   * @param {import('../core/types.js').PostItem} post
   * @returns {Promise<void>}
   */
  async storeContent(post) {
    await this.storeBatch([post]);
  }

  /**
   * @param {import('../core/types.js').PostItem[]} posts
   * @param {Object} [opts]
   * @param {boolean} [opts.upsert=false]
   * @returns {Promise<void>}
   */
  async storeBatch(posts, opts = {}) {
    if (!Array.isArray(posts) || !posts.length) return;

    for (const post of posts) {
      if (!post.category || !isValidCategory(post.category)) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: `Invalid or missing category "${post.category}". Allowed: ${CATEGORY_VALUES.join(', ')}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: post.platform,
        });
      }
    }

    await this.init();
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
   * @param {Object} model
   * @param {Array<Object>} items
   */
  async #upsertChunk(model, items) {
    if (!model || !items.length) return;
    if (this.#prisma?.$transaction) {
      await this.#prisma.$transaction(
        items.map((item) =>
          model.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          })
        )
      );
    } else {
      for (const item of items) {
        await model.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
      }
    }
  }

  /**
   * @param {import('../core/types.js').CommentItem} comment
   * @returns {Promise<void>}
   */
  async storeComment(comment) {
    await this.storeCommentBatch([comment]);
  }

  /**
   * @param {import('../core/types.js').CommentItem[]} comments
   * @param {Object} [opts]
   * @param {boolean} [opts.upsert=false]
   * @returns {Promise<void>}
   */
  async storeCommentBatch(comments, opts = {}) {
    if (!Array.isArray(comments) || !comments.length) return;
    await this.init();

    const normalized = comments.map((c) => this.#normalizeComment(c));
    const byDepth = new Map();
    for (const comment of normalized) {
      const depth = comment.depth;
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

  /** @returns {Promise<void>} */
  async close() {
    if (this.#prisma) {
      await this.#prisma.$disconnect();
      this.#prisma = null;
    }
  }
}
