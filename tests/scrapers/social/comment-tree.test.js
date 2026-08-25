// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';

/**
 * ATDD red-phase tests for src/scrapers/social/comment-tree.js
 * Story 14.1 — Hierarchical Comment Tree Extraction with Topological Sort
 *
 * These tests are intentionally skipped (TDD red phase).
 * Remove `.skip` after the implementation is written.
 */

describe.skip('Story 14.1 — CommentTreeExtractor (ATDD red phase)', () => {
  const makeRaw = (id, parentId = null, hasReplies = false) => ({
    id,
    parentId,
    author: { id: `user_${id}`, name: `Author ${id}` },
    text: `Comment ${id}`,
    created_time: 1787680000,
    feedback: {
      like_count: { count: 1 },
      comment_count: { total_count: hasReplies ? 1 : 0 },
    },
    // Replies are returned by a separate fetchLayer call; this is a leaf marker.
    comments: null,
  });

  const normalizeFn = (raw, postId) => ({
    id: `facebook:${postId}:${raw.id}`,
    platform: 'facebook',
    externalId: raw.id,
    postId: `facebook:${postId}`,
    parentCommentId: raw.parentId ? `facebook:${postId}:${raw.parentId}` : null,
    depth: 0,
    authorId: raw.author.id,
    authorName: raw.author.name,
    authorAvatar: null,
    content: raw.text,
    likesCount: raw.feedback.like_count.count,
    subCommentsCount: raw.feedback.comment_count.total_count,
    metadata: {},
    publishedAt: new Date(raw.created_time * 1000),
    crawledAt: new Date(),
  });

  it.skip('[P0] should collect root comments and assign depth 0', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    const fetchLayer = async ({ parentCommentId }) => {
      if (parentCommentId) return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
      return {
        comments: [makeRaw('r1'), makeRaw('r2')],
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 3, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    expect(comments).toHaveLength(2);
    expect(comments.every((c) => c.depth === 0)).toBe(true);
    expect(comments[0].parentCommentId).toBeNull();
  });

  it.skip('[P0] should recursively collect replies and increment depth by parent', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    const fetchLayer = async ({ parentCommentId }) => {
      if (!parentCommentId) {
        return {
          comments: [makeRaw('r1', null, true)],
          pageInfo: { has_next_page: false, end_cursor: null },
        };
      }
      if (parentCommentId === 'r1') {
        return {
          comments: [makeRaw('r1_1', 'r1')],
          pageInfo: { has_next_page: false, end_cursor: null },
        };
      }
      return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 3, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    const root = comments.find((c) => c.externalId === 'r1');
    const reply = comments.find((c) => c.externalId === 'r1_1');

    expect(root).toBeDefined();
    expect(root.depth).toBe(0);
    expect(reply).toBeDefined();
    expect(reply.depth).toBe(1);
    expect(reply.parentCommentId).toBe(`facebook:post_123:r1`);
  });

  it.skip('[P0] should return comments sorted by depth ascending (topological sort)', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    const fetchLayer = async ({ parentCommentId }) => {
      if (!parentCommentId) {
        return { comments: [makeRaw('r1', null, true)], pageInfo: { has_next_page: false, end_cursor: null } };
      }
      if (parentCommentId === 'r1') {
        return { comments: [makeRaw('r1_1', 'r1', true)], pageInfo: { has_next_page: false, end_cursor: null } };
      }
      if (parentCommentId === 'r1_1') {
        return { comments: [makeRaw('r1_1_1', 'r1_1')], pageInfo: { has_next_page: false, end_cursor: null } };
      }
      return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 3, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    const depths = comments.map((c) => c.depth);
    expect(depths).toEqual([0, 1, 2]);
  });

  it.skip('[P1] should detect a self-referencing cycle and stop recursion', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    const fetchLayer = async ({ parentCommentId }) => {
      if (!parentCommentId) {
        return { comments: [makeRaw('r1')], pageInfo: { has_next_page: false, end_cursor: null } };
      }
      // r1 points to itself — cycle
      return { comments: [makeRaw('r1', 'r1')], pageInfo: { has_next_page: false, end_cursor: null } };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 3, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    expect(comments).toHaveLength(1);
    expect(comments[0].externalId).toBe('r1');
    expect(comments[0].depth).toBe(0);
  });

  it.skip('[P1] should respect maxDepth and not fetch deeper layers', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    let deepestFetched = -1;
    const fetchLayer = async ({ parentCommentId }) => {
      const depth = parentCommentId ? 1 : 0;
      deepestFetched = Math.max(deepestFetched, depth);
      if (!parentCommentId) {
        return { comments: [makeRaw('r1', null, true)], pageInfo: { has_next_page: false, end_cursor: null } };
      }
      return { comments: [makeRaw('r1_1', 'r1', true)], pageInfo: { has_next_page: false, end_cursor: null } };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 1, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    expect(deepestFetched).toBeLessThanOrEqual(1);
    expect(comments.some((c) => c.depth === 1)).toBe(false);
    expect(comments).toHaveLength(1);
  });

  it.skip('[P1] should respect maxComments and stop collecting', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    const fetchLayer = async ({ parentCommentId }) => {
      if (parentCommentId) return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
      return {
        comments: Array.from({ length: 100 }, (_, i) => makeRaw(`r${i}`)),
        pageInfo: { has_next_page: true, end_cursor: 'next' },
      };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 1, maxComments: 10 });
    const comments = await extractor.fetch('post_123');

    expect(comments.length).toBeLessThanOrEqual(10);
  });

  it.skip('[P2] should deduplicate by id across pagination and recursion', async () => {
    const { CommentTreeExtractor } = await import('../../../src/scrapers/social/comment-tree.js');

    let call = 0;
    const fetchLayer = async ({ parentCommentId }) => {
      call += 1;
      if (!parentCommentId) {
        return { comments: [makeRaw('r1')], pageInfo: { has_next_page: call < 2, end_cursor: 'next' } };
      }
      return { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth: 1, maxComments: 500 });
    const comments = await extractor.fetch('post_123');

    expect(comments).toHaveLength(1);
    expect(comments[0].externalId).toBe('r1');
  });
});
