// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PrismaStore — PostgreSQL persistence via Prisma.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractStore } from '../core/base-store.js';
import { generatePostId, generateCommentId, isValidCategory, CATEGORY_VALUES } from '../core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import metadataSchemaRegistry from '../core/metadata-schema-registry.js';

export class PrismaStore extends AbstractStore {
  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {number} */
  #chunkSize = 500;

  /** @type {boolean} */
  #validateSchema = true;

  /** @type {import('../core/types.js').RedisClientLike | null} */
  redis = null;

  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {import('../core/types.js').RedisClientLike} [options.redis]
   * @param {number} [options.chunkSize=500]
   * @param {boolean} [options.validateSchema=true]
   */
  constructor(options = {}) {
    super();
    this.#prisma = options.prisma || null;
    this.redis = options.redisClient || options.redis || null;
    this.#chunkSize =
      typeof options.chunkSize === 'number' && options.chunkSize > 0
        ? Math.floor(options.chunkSize)
        : 500;
    this.#validateSchema = options.validateSchema !== false;
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
   * @param {Object} [opts]
   * @returns {Promise<void>}
   */
  async storeContent(post, opts = {}) {
    await this.storeBatch([post], opts);
  }

  /**
   * @param {import('../core/types.js').PostItem[]} posts
   * @param {Object} [opts]
   * @param {boolean} [opts.upsert=false]
   * @returns {Promise<void>}
   */
  async storeBatch(posts, opts = {}) {
    if (!Array.isArray(posts) || !posts.length) return;

    const shouldValidateSchema = opts.validateSchema ?? this.#validateSchema;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!post.category || !isValidCategory(post.category)) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: `Invalid or missing category "${post.category}" at index ${i}. Allowed: ${CATEGORY_VALUES.join(', ')}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: post.platform,
          details: { index: i },
        });
      }

      if (shouldValidateSchema) {
        const validation = metadataSchemaRegistry.validateMetadata(post.platform, post.category, post.metadata);
        if (!validation.valid) {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: `Metadata schema validation failed at index ${i}`,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: post.platform,
            statusCode: 400,
            details: { index: i, errors: validation.errors },
          });
        }
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

  /**
   * Upsert a crawl checkpoint with state and storage reference.
   * @param {Object} checkpoint
   * @param {string} checkpoint.platform
   * @param {string} checkpoint.targetType
   * @param {string} checkpoint.targetKey
   * @param {string} [checkpoint.lastCursor]
   * @param {Date | string} [checkpoint.lastTimestamp]
   * @param {Date | string} [checkpoint.lastCrawledAt]
   * @param {string} [checkpoint.status]
   * @param {string} [checkpoint.storageRef]
   * @param {Date | string} [checkpoint.nextScheduledAt]
   * @param {number} [checkpoint.errorCount]
   * @returns {Promise<any>}
   */
  async saveCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Checkpoint must be a valid non-null object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const { platform, targetType, targetKey } = checkpoint;
    if (!platform || !targetType || !targetKey) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Checkpoint must contain platform, targetType, and targetKey',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    await this.init();

    const data = {
      platform: String(platform),
      targetType: String(targetType),
      targetKey: String(targetKey),
      status: checkpoint.status ? String(checkpoint.status) : 'running',
      lastCursor: checkpoint.lastCursor ? String(checkpoint.lastCursor) : null,
      lastTimestamp: checkpoint.lastTimestamp ? new Date(checkpoint.lastTimestamp) : null,
      lastCrawledAt: checkpoint.lastCrawledAt ? new Date(checkpoint.lastCrawledAt) : new Date(),
      nextScheduledAt: checkpoint.nextScheduledAt ? new Date(checkpoint.nextScheduledAt) : null,
      storageRef: checkpoint.storageRef ? String(checkpoint.storageRef) : null,
      errorCount: typeof checkpoint.errorCount === 'number' ? checkpoint.errorCount : 0,
    };

    return await this.#prisma.crawlCheckpoint.upsert({
      where: {
        platform_targetType_targetKey: {
          platform: data.platform,
          targetType: data.targetType,
          targetKey: data.targetKey,
        },
      },
      update: data,
      create: data,
    });
  }

  /**
   * Retrieve a crawl checkpoint by composite key.
   * @param {string} platform
   * @param {string} targetType
   * @param {string} targetKey
   * @returns {Promise<any>}
   */
  async getCheckpoint(platform, targetType, targetKey) {
    await this.init();
    return await this.#prisma.crawlCheckpoint.findUnique({
      where: {
        platform_targetType_targetKey: {
          platform: String(platform),
          targetType: String(targetType),
          targetKey: String(targetKey),
        },
      },
    });
  }

  /** @returns {Promise<void>} */
  async close() {
    if (this.#prisma) {
      await this.#prisma.$disconnect();
      this.#prisma = null;
    }
  }
}
