// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Scrapers Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export * from './facebook/index.js';
export * from './threads/index.js';
export * from './tiktok/index.js';
export * from './twitter/index.js';
export { parseHumanCount } from './threads/index.js';
export { profileItemToPostItem } from './facebook/index.js';
export * as bluesky from './bluesky/index.js';
export { BlueskyClient, BlueskyCrawler, BlueskyPlatformResponseValidator } from './bluesky/index.js';
export * as mastodon from './mastodon/index.js';
export { MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator } from './mastodon/index.js';
export * as reddit from './reddit/index.js';
export { RedditClient, RedditCrawler, RedditPlatformResponseValidator, RedditBrowserBridge } from './reddit/index.js';
export * as medium from './medium/index.js';
export { MediumClient, MediumCrawler, MediumPlatformResponseValidator } from './medium/index.js';
export * as instagram from './instagram/index.js';
export { InstagramClient, InstagramCrawler, InstagramPlatformResponseValidator } from './instagram/index.js';
export { CommentTreeExtractor } from './comment-tree.js';

// scrape() dispatch descriptors (Story 25.1) — one per social platform dir.
export { default as twitterDescriptor } from './twitter/descriptor.js';
export { default as facebookDescriptor } from './facebook/descriptor.js';
export { default as threadsDescriptor } from './threads/descriptor.js';
export { default as blueskyDescriptor } from './bluesky/descriptor.js';
export { default as mastodonDescriptor } from './mastodon/descriptor.js';
export { default as tiktokDescriptor } from './tiktok/descriptor.js';
export { default as redditDescriptor } from './reddit/descriptor.js';
export { default as mediumDescriptor } from './medium/descriptor.js';
export { default as instagramDescriptor } from './instagram/descriptor.js';
export { default as youtubeDescriptor } from './youtube/descriptor.js';
export { default as zaloDescriptor } from './zalo/descriptor.js';
