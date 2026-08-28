// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Scrapers Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export * from './facebook/index.js';
export * from './threads/index.js';
// TODO(Story 13.2.1): export * from './twitter/index.js' when TwitterCrawler/TwitterClient are created
export { CommentTreeExtractor } from './comment-tree.js';
