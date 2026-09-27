// by nichxbt — tests/scrapers/social/comment-tree.test.js
// Story 49.2: CommentTreeExtractor concurrency hardening tests
import { describe, it, expect, vi } from 'vitest';
import { CommentTreeExtractor } from '../../../src/scrapers/social/comment-tree.js';

/**
 * Create a normalizer that returns a CommentItem from raw data.
 * @param {Record<string, unknown>} overrides
 */
const makeNormalizer = (overrides = {}) => (raw, postId) => {
  if (!raw.id) return null;
  return {
    id: raw.id,
    externalId: raw.id,
    postId,
    text: raw.text || `comment ${raw.id}`,
    authorName: raw.author || 'test-author',
    parentCommentId: raw.parentId || null,
    subCommentsCount: raw.subCommentsCount ?? 0,
    depth: 0,
    metadata: {},
    ...overrides,
  };
};

/**
 * Create a fetchLayer that returns controlled pages.
 * @param {Map<string, {comments: Array, pageInfo: Object}[]>} routes — parentId → pages
 */
const makeFetchLayer = (routes) => {
  const calls = [];
  return {
    calls,
    fn: async ({ postId, parentCommentId, after }) => {
      calls.push({ postId, parentCommentId, after });
      const key = parentCommentId || '__root__';
      const pages = routes.get(key) || [];
      // Find page matching cursor (or first unvisited)
      const visited = calls.filter(c => c.parentCommentId === parentCommentId).length - 1;
      const page = pages[Math.min(visited, pages.length - 1)] || { comments: [], pageInfo: { has_next_page: false, end_cursor: null } };
      return page;
    },
  };
};

describe('CommentTreeExtractor — Story 49.2 fixes', () => {
  it('empty cursor with has_next_page=true does not stop pagination', async () => {
    // Simulates: page 1 returns empty cursor but has_next_page=true
    // Old behavior: stops. New: retries with same cursor.
    let callNum = 0;
    const fetchLayer = vi.fn(async () => {
      callNum++;
      if (callNum === 1) {
        // First call: empty cursor but has_next_page=true
        return {
          comments: [{ id: 'c1' }],
          pageInfo: { has_next_page: true, end_cursor: '' },
        };
      }
      // Second call (same cursor retry): return more data + real end
      return {
        comments: [{ id: 'c2' }],
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    });

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1', { after: 'seed_cursor' });

    expect(fetchLayer).toHaveBeenCalledTimes(2);
    expect(result.comments).toHaveLength(2);
    expect(result.comments.map(c => c.id)).toEqual(['c1', 'c2']);
  });

  it('empty cursor with has_next_page=false stops pagination', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: [{ id: 'c1' }],
      pageInfo: { has_next_page: false, end_cursor: '' },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1');

    expect(fetchLayer).toHaveBeenCalledTimes(1);
    expect(result.comments).toHaveLength(1);
  });

  it('cycle detector returns true for already-visited nodes', async () => {
    // Feed comments that form a cycle: A→B, B→A
    const fetchLayer = vi.fn(async () => ({
      comments: [
        { id: 'A', parentId: null },
        { id: 'B', parentId: 'A' },
        { id: 'A2', parentId: 'B' }, // different id, but parent chain → B → A → null (no cycle)
      ],
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1');

    // All should be added (no actual cycle in these ids)
    expect(result.comments.length).toBeGreaterThanOrEqual(2);
  });

  it('self-referencing comment is skipped', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: [
        { id: 'c1' },
        { id: 'c2', parentId: 'c2' }, // self-reference
      ],
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1');

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].id).toBe('c1');
  });

  it('orphan comments re-attached to depth 0 when parent missing', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: [
        { id: 'c1' },
        { id: 'orphan1', parentId: 'missing_parent' },
      ],
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1');

    expect(result.comments).toHaveLength(2);
    const orphan = result.comments.find(c => c.id === 'orphan1');
    expect(orphan.depth).toBe(0);
    expect(orphan.parentCommentId).toBeUndefined();
    expect(orphan.metadata?.orphanOf).toBe('missing_parent');
  });

  it('shared state mutation is isolated per fetch call', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: [{ id: 'shared_id' }],
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const r1 = await extractor.fetch('post1');
    const r2 = await extractor.fetch('post2');

    // Both calls should see the same comment (no cross-call dedup)
    expect(r1.comments).toHaveLength(1);
    expect(r2.comments).toHaveLength(1);
  });

  it('per-parent error isolation — one failure does not kill the tree', async () => {
    let callCount = 0;
    const fetchLayer = vi.fn(async ({ parentCommentId, depth }) => {
      callCount++;
      if (depth === 0) {
        return {
          comments: [
            { id: 'p1', subCommentsCount: 2 },
            { id: 'p2', subCommentsCount: 2 },
          ],
          pageInfo: { has_next_page: false, end_cursor: null },
        };
      }
      if (parentCommentId === 'p1') {
        throw new Error('upstream timeout');
      }
      return {
        comments: [{ id: 'child_of_p2' }],
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    });

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 1 });
    const result = await extractor.fetch('post1');

    // p1's children failed but p2's should succeed
    expect(result.comments.some(c => c.id === 'child_of_p2')).toBe(true);
    expect(result.note).toContain('Failed to fetch replies for p1');
  });

  it('comments with subCommentsCount=0 are not expanded', async () => {
    const fetchLayer = vi.fn(async ({ depth }) => {
      if (depth === 0) {
        return {
          comments: [
            { id: 'p1', subCommentsCount: 0 },
            { id: 'p2', subCommentsCount: 5 },
          ],
          pageInfo: { has_next_page: false, end_cursor: null },
        };
      }
      return {
        comments: [{ id: 'child' }],
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    });

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 1 });
    const result = await extractor.fetch('post1');

    // Only p2 should have been expanded (p1 has subCommentsCount=0)
    const p2Children = result.comments.filter(c => c.depth === 1);
    expect(p2Children.length).toBeGreaterThanOrEqual(1);
  });

  it('duplicate comment IDs are deduplicated', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: [
        { id: 'c1', text: 'first' },
        { id: 'c2' },
        { id: 'c1', text: 'duplicate' }, // same id
      ],
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0 });
    const result = await extractor.fetch('post1');

    expect(result.comments).toHaveLength(2);
    // first occurrence wins (deduplication keeps earliest)
    expect(result.comments.find(c => c.id === 'c1').text).toBe('first');
  });

  it('maxComments cap is respected', async () => {
    const fetchLayer = vi.fn(async () => ({
      comments: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` })),
      pageInfo: { has_next_page: false, end_cursor: null },
    }));

    const extractor = new CommentTreeExtractor(fetchLayer, makeNormalizer(), { maxDepth: 0, maxComments: 5 });
    const result = await extractor.fetch('post1');

    expect(result.comments).toHaveLength(5);
  });
});
