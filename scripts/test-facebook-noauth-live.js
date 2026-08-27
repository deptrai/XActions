// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Live test script for Facebook Public Scrapers (No Auth Required)
 * Tests marketplace, search, profile, and page_posts without any account credentials.
 */

import { FacebookCrawler } from '../src/scrapers/social/facebook/crawler.js';

async function main() {
  console.log('🚀 Starting Live Facebook No-Auth Scraping Test...\n');

  const crawler = new FacebookCrawler();

  const results = {
    marketplace: null,
    search: null,
    profile: null,
    page_posts: null,
  };

  // 1. Test Marketplace
  console.log('--- 1. Testing Marketplace (public action, no auth) ---');
  try {
    const marketplaceRes = await crawler.start({
      action: 'marketplace',
      args: { query: 'macbook', location: 'Ho Chi Minh City', limit: 3 },
    });
    console.log('✅ Marketplace result:', {
      postsCount: marketplaceRes?.posts?.length ?? (Array.isArray(marketplaceRes) ? marketplaceRes.length : 0),
      firstPost: (marketplaceRes?.posts || marketplaceRes)?.[0] ? {
        id: (marketplaceRes?.posts || marketplaceRes)[0].id,
        content: (marketplaceRes?.posts || marketplaceRes)[0].content?.slice(0, 80),
        metadata: (marketplaceRes?.posts || marketplaceRes)[0].metadata,
      } : 'No posts parsed (likely SSR/DOM structure differences)',
      note: marketplaceRes?.note,
    });
    results.marketplace = 'SUCCESS';
  } catch (err) {
    console.error('❌ Marketplace failed:', err.message, { code: err.code, type: err.type });
    results.marketplace = `FAILED: ${err.message}`;
  }

  // 2. Test Search
  console.log('\n--- 2. Testing Search (public action, no auth) ---');
  try {
    const searchRes = await crawler.start({
      action: 'search',
      args: { query: 'technology', type: 'pages', limit: 3 },
    });
    console.log('✅ Search result:', {
      pagesCount: searchRes?.pages?.length ?? (Array.isArray(searchRes) ? searchRes.length : 0),
      firstPage: (searchRes?.pages || searchRes)?.[0] ? {
        id: (searchRes?.pages || searchRes)[0].id,
        authorName: (searchRes?.pages || searchRes)[0].authorName,
      } : 'Empty result',
    });
    results.search = 'SUCCESS';
  } catch (err) {
    console.error('❌ Search failed:', err.message, { code: err.code, type: err.type });
    results.search = `FAILED: ${err.message}`;
  }

  // 3. Test Profile
  console.log('\n--- 3. Testing Profile (public action, no auth) ---');
  try {
    const profileRes = await crawler.start({
      action: 'profile',
      args: { username: 'zuck' },
    });
    console.log('✅ Profile result:', {
      profile: profileRes?.profile ? {
        id: profileRes.profile.id,
        name: profileRes.profile.name,
        username: profileRes.profile.username,
        bio: profileRes.profile.bio?.slice(0, 80),
      } : profileRes,
    });
    results.profile = 'SUCCESS';
  } catch (err) {
    console.error('❌ Profile failed:', err.message, { code: err.code, type: err.type });
    results.profile = `FAILED: ${err.message}`;
  }

  // 4. Test Page Posts
  console.log('\n--- 4. Testing Page Posts (public action, no auth) ---');
  try {
    const pagePostsRes = await crawler.start({
      action: 'page_posts',
      args: { pageId: 'zuck', count: 3 },
    });
    console.log('✅ Page posts result:', {
      postsCount: pagePostsRes?.posts?.length ?? (Array.isArray(pagePostsRes) ? pagePostsRes.length : 0),
      firstPost: (pagePostsRes?.posts || pagePostsRes)?.[0] ? {
        id: (pagePostsRes?.posts || pagePostsRes)[0].id,
        content: (pagePostsRes?.posts || pagePostsRes)[0].content?.slice(0, 80),
      } : 'Empty',
    });
    results.page_posts = 'SUCCESS';
  } catch (err) {
    console.error('❌ Page posts failed:', err.message, { code: err.code, type: err.type });
    results.page_posts = `FAILED: ${err.message}`;
  }

  console.log('\n========================================');
  console.log('📊 LIVE NO-AUTH TEST SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('========================================\n');

  await crawler.cleanup();
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
