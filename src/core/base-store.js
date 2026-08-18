// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractStore — platform-agnostic persistence contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').PostItem} PostItem */
/** @typedef {import('./types.js').CommentItem} CommentItem */

export class AbstractStore {
  constructor() {
    if (new.target === AbstractStore) {
      throw new TypeError('AbstractStore is abstract; extend it.');
    }
  }

  /** @returns {Promise<void>} */
  async init() {
    throw new Error('Method not implemented: init()');
  }

  /**
   * @param {PostItem} post
   * @returns {Promise<void>}
   */
  async storeContent(post) {
    throw new Error('Method not implemented: storeContent()');
  }

  /**
   * @param {PostItem[]} posts
   * @returns {Promise<void>}
   */
  async storeBatch(posts) {
    throw new Error('Method not implemented: storeBatch()');
  }

  /**
   * @param {CommentItem} comment
   * @returns {Promise<void>}
   */
  async storeComment(comment) {
    throw new Error('Method not implemented: storeComment()');
  }

  /**
   * @param {CommentItem[]} comments
   * @returns {Promise<void>}
   */
  async storeCommentBatch(comments) {
    throw new Error('Method not implemented: storeCommentBatch()');
  }

  /** @returns {Promise<void>} */
  async close() {
    throw new Error('Method not implemented: close()');
  }
}
