// by nichxbt
// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — Facebook Automation Guardrail Tests: likeFacebookPosts, commentOnFacebookPosts, createFacebookPost

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  commentOnFacebookPosts,
  createFacebookPost,
  likeFacebookPosts,
} from '../../api/services/facebookAutomation.js';

const noDelay = () => {};

// =============================================================================
// likeFacebookPosts (Story 2.2)
// =============================================================================

describe('likeFacebookPosts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC1, AC3.8 — dry-run default (no likeFn invocation, preview returned)
  // -------------------------------------------------------------------------

  describe('dry-run default', () => {
    it('returns preview without calling likeFn', async () => {
      const fakePage = {};
      const likeFnSpy = vi.fn();
      const postUrls = ['https://facebook.com/post/1', 'https://facebook.com/post/2'];

      const result = await likeFacebookPosts(fakePage, postUrls, { likeFn: likeFnSpy });

      expect(likeFnSpy).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.preview).toHaveLength(2);
      expect(result.preview[0].target).toBe(postUrls[0]);
    });
  });

  // -------------------------------------------------------------------------
  // AC1.3 — dryRun:false invokes likeFn per URL with delay seam
  // -------------------------------------------------------------------------

  describe('dryRun:false — real write', () => {
    it('calls likeFn once per URL through runGuardedBatch', async () => {
      const fakePage = {};
      const likeFnSpy = vi.fn().mockResolvedValue({ liked: true, alreadyLiked: false });
      const postUrls = ['https://facebook.com/post/1', 'https://facebook.com/post/2'];

      const result = await likeFacebookPosts(fakePage, postUrls, {
        dryRun: false,
        likeFn: likeFnSpy,
        delay: noDelay,
      });

      expect(likeFnSpy).toHaveBeenCalledTimes(2);
      expect(likeFnSpy).toHaveBeenNthCalledWith(1, fakePage, postUrls[0]);
      expect(likeFnSpy).toHaveBeenNthCalledWith(2, fakePage, postUrls[1]);
      expect(result.dryRun).toBe(false);
      expect(result.succeeded).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // AC3.9 — alreadyLiked field in result
  // -------------------------------------------------------------------------

  describe('alreadyLiked handling', () => {
    it('includes alreadyLiked:true in result when post already liked', async () => {
      const fakePage = {};
      const likeFnSpy = vi.fn().mockResolvedValue({ liked: false, alreadyLiked: true });
      const postUrls = ['https://facebook.com/post/already-liked'];

      const result = await likeFacebookPosts(fakePage, postUrls, {
        dryRun: false,
        likeFn: likeFnSpy,
        delay: noDelay,
      });

      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].alreadyLiked).toBe(true);
    });

    it('includes alreadyLiked:false when newly liked', async () => {
      const fakePage = {};
      const likeFnSpy = vi.fn().mockResolvedValue({ liked: true, alreadyLiked: false });
      const postUrls = ['https://facebook.com/post/new'];

      const result = await likeFacebookPosts(fakePage, postUrls, {
        dryRun: false,
        likeFn: likeFnSpy,
        delay: noDelay,
      });

      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].alreadyLiked).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC2.7 — button not found error propagates as result.ok=false
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('records ok:false when likeFn throws (button not found)', async () => {
      const fakePage = {};
      const likeFnSpy = vi.fn().mockRejectedValue(new Error('❌ Like button not found'));
      const postUrls = ['https://facebook.com/post/broken'];

      const result = await likeFacebookPosts(fakePage, postUrls, {
        dryRun: false,
        likeFn: likeFnSpy,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Like button not found');
      expect(result.failed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC1.2, AC4.11 — over-maxBatch throws (inherited from runGuardedBatch)
  // -------------------------------------------------------------------------

  describe('maxBatch enforcement', () => {
    it('throws when postUrls.length > maxBatch (inherited)', async () => {
      const fakePage = {};
      const postUrls = Array.from({ length: 21 }, (_, i) => `https://facebook.com/post/${i}`);

      await expect(
        likeFacebookPosts(fakePage, postUrls, { dryRun: false, delay: noDelay })
      ).rejects.toThrow(/maxBatch/i);
    });
  });
});

// =============================================================================
// commentOnFacebookPosts (Story 2.3)
// =============================================================================

describe('commentOnFacebookPosts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC1, AC3.9 — dry-run default (no commentFn invocation, preview returned)
  // -------------------------------------------------------------------------

  describe('dry-run default', () => {
    it('returns preview without calling commentFn', async () => {
      const fakePage = {};
      const commentFnSpy = vi.fn();
      const postUrls = ['https://facebook.com/post/1', 'https://facebook.com/post/2'];
      const commentText = 'Great post!';

      const result = await commentOnFacebookPosts(fakePage, postUrls, commentText, { commentFn: commentFnSpy });

      expect(commentFnSpy).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.preview).toHaveLength(2);
      expect(result.preview[0].target).toBe(postUrls[0]);
      expect(result.preview[0].previewComment).toBe(commentText);
    });
  });

  // -------------------------------------------------------------------------
  // AC1.3 — dryRun:false invokes commentFn per URL with delay seam
  // -------------------------------------------------------------------------

  describe('dryRun:false — real write', () => {
    it('calls commentFn once per URL through runGuardedBatch', async () => {
      const fakePage = {};
      const commentFnSpy = vi.fn().mockResolvedValue({ commented: true });
      const postUrls = ['https://facebook.com/post/1', 'https://facebook.com/post/2'];
      const commentText = 'Nice work!';

      const result = await commentOnFacebookPosts(fakePage, postUrls, commentText, {
        dryRun: false,
        commentFn: commentFnSpy,
        delay: noDelay,
      });

      expect(commentFnSpy).toHaveBeenCalledTimes(2);
      expect(commentFnSpy).toHaveBeenNthCalledWith(1, fakePage, postUrls[0], commentText);
      expect(commentFnSpy).toHaveBeenNthCalledWith(2, fakePage, postUrls[1], commentText);
      expect(result.dryRun).toBe(false);
      expect(result.succeeded).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // AC3.10 — commentText field in result
  // -------------------------------------------------------------------------

  describe('commentText in results', () => {
    it('includes commentText in real-run results', async () => {
      const fakePage = {};
      const commentFnSpy = vi.fn().mockResolvedValue({ commented: true });
      const postUrls = ['https://facebook.com/post/test'];
      const commentText = 'Test comment';

      const result = await commentOnFacebookPosts(fakePage, postUrls, commentText, {
        dryRun: false,
        commentFn: commentFnSpy,
        delay: noDelay,
      });

      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].commentText).toBe(commentText);
    });
  });

  // -------------------------------------------------------------------------
  // AC2.8 — comment input not found error propagates as result.ok=false
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('records ok:false when commentFn throws (input not found)', async () => {
      const fakePage = {};
      const commentFnSpy = vi.fn().mockRejectedValue(new Error('❌ Comment input not found'));
      const postUrls = ['https://facebook.com/post/broken'];
      const commentText = 'Test';

      const result = await commentOnFacebookPosts(fakePage, postUrls, commentText, {
        dryRun: false,
        commentFn: commentFnSpy,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Comment input not found');
      expect(result.failed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC1.2 — over-maxBatch throws (inherited from runGuardedBatch)
  // -------------------------------------------------------------------------

  describe('maxBatch enforcement', () => {
    it('throws when postUrls.length > maxBatch (inherited)', async () => {
      const fakePage = {};
      const postUrls = Array.from({ length: 21 }, (_, i) => `https://facebook.com/post/${i}`);
      const commentText = 'Test';

      await expect(
        commentOnFacebookPosts(fakePage, postUrls, commentText, { dryRun: false, delay: noDelay })
      ).rejects.toThrow(/maxBatch/i);
    });
  });
});

// =============================================================================
// createFacebookPost (Story 2.4)
// =============================================================================

describe('createFacebookPost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC1, AC3.9 — dry-run default (no createPostFn invocation, preview returned)
  // -------------------------------------------------------------------------

  describe('dry-run default', () => {
    it('returns preview without calling createPostFn', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn();
      const content = 'Hello from XActions!';

      const result = await createFacebookPost(fakePage, content, { createPostFn: createPostFnSpy });

      expect(createPostFnSpy).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.preview).toHaveLength(1);
      expect(result.preview[0].target).toBe(content);
      expect(result.preview[0].previewContent).toBe(content);
    });
  });

  // -------------------------------------------------------------------------
  // AC1.3 — dryRun:false invokes createPostFn with content
  // -------------------------------------------------------------------------

  describe('dryRun:false — real write', () => {
    it('calls createPostFn once with correct content', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn().mockResolvedValue({ posted: true, postUrl: 'https://facebook.com/posts/123' });
      const content = 'Test post content';

      const result = await createFacebookPost(fakePage, content, {
        dryRun: false,
        createPostFn: createPostFnSpy,
        delay: noDelay,
      });

      expect(createPostFnSpy).toHaveBeenCalledTimes(1);
      expect(createPostFnSpy).toHaveBeenCalledWith(fakePage, content);
      expect(result.dryRun).toBe(false);
      expect(result.succeeded).toBe(1);
    });

    it('routes through single-item batch for guardrail consistency', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn().mockResolvedValue({ posted: true });
      const content = 'Single post content';

      const result = await createFacebookPost(fakePage, content, {
        dryRun: false,
        createPostFn: createPostFnSpy,
        delay: noDelay,
      });

      expect(result.attempted).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].target).toBe(content);
    });
  });

  // -------------------------------------------------------------------------
  // AC3.10 — content field in result
  // -------------------------------------------------------------------------

  describe('content in results', () => {
    it('includes content in real-run results', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn().mockResolvedValue({ posted: true });
      const content = 'My post text';

      const result = await createFacebookPost(fakePage, content, {
        dryRun: false,
        createPostFn: createPostFnSpy,
        delay: noDelay,
      });

      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].content).toBe(content);
    });
  });

  // -------------------------------------------------------------------------
  // AC2.8 — composer not found error propagates as result.ok=false
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('records ok:false when createPostFn throws (composer not found)', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn().mockRejectedValue(new Error('❌ Post composer not found'));
      const content = 'Test post';

      const result = await createFacebookPost(fakePage, content, {
        dryRun: false,
        createPostFn: createPostFnSpy,
        delay: noDelay,
        maxRetry: 0,
      });

      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Post composer not found');
      expect(result.failed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC4 — account-risk warning fires before real write
  // -------------------------------------------------------------------------

  describe('account-risk warning', () => {
    it('surfaces account-risk warning on real run', async () => {
      const fakePage = {};
      const createPostFnSpy = vi.fn().mockResolvedValue({ posted: true });
      const content = 'Test post';

      const result = await createFacebookPost(fakePage, content, {
        dryRun: false,
        createPostFn: createPostFnSpy,
        delay: noDelay,
      });

      expect(result.warning).toBeTruthy();
      expect(result.warning).toMatch(/warning/i);
    });

    it('no warning on dry-run', async () => {
      const fakePage = {};
      const content = 'Test post';

      const result = await createFacebookPost(fakePage, content, { createPostFn: vi.fn() });

      expect(result.warning).toBeNull();
    });
  });
});
