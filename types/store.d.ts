// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript Type Declarations for XActions Store Adapter.
 * @author nich (@nichxbt)
 * @license MIT
 */

export interface PostItem {
  id?: string;
  platform: string;
  externalId: string;
  category: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  authorUrl?: string | null;
  postUrl?: string | null;
  content: string;
  mediaUrls?: string[];
  likesCount?: number;
  repostsCount?: number;
  repliesCount?: number;
  viewsCount?: number;
  metadata?: Record<string, unknown> | null;
  publishedAt?: Date | string | null;
  crawledAt?: Date | string;
}

export interface CommentItem {
  id?: string;
  platform: string;
  externalId: string;
  postId: string;
  parentCommentId?: string | null;
  depth?: number;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  content: string;
  likesCount?: number;
  subCommentsCount?: number;
  metadata?: Record<string, unknown> | null;
  publishedAt?: Date | string | null;
  crawledAt?: Date | string;
}

export abstract class AbstractStore {
  abstract init(): Promise<void>;
  abstract storeContent(post: PostItem): Promise<void>;
  abstract storeBatch(posts: PostItem[], opts?: { upsert?: boolean }): Promise<void>;
  abstract storeComment(comment: CommentItem): Promise<void>;
  abstract storeCommentBatch(comments: CommentItem[], opts?: { upsert?: boolean }): Promise<void>;
  abstract close(): Promise<void>;
}

export interface PrismaStoreOptions {
  prisma?: unknown;
  chunkSize?: number;
}

export class PrismaStore extends AbstractStore {
  constructor(options?: PrismaStoreOptions);
  init(): Promise<void>;
  storeContent(post: PostItem): Promise<void>;
  storeBatch(posts: PostItem[], opts?: { upsert?: boolean }): Promise<void>;
  storeComment(comment: CommentItem): Promise<void>;
  storeCommentBatch(comments: CommentItem[], opts?: { upsert?: boolean }): Promise<void>;
  close(): Promise<void>;
}
