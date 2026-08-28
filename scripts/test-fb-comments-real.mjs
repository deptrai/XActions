// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// One-off real-cookie integration test for FacebookCrawler.getCommentsForPost.
// Usage: node scripts/test-fb-comments-real.mjs [post_url]

import 'dotenv/config';
import fs from 'node:fs';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';
import { FacebookClient } from '../src/scrapers/social/facebook/client.js';
import { FacebookCrawler } from '../src/scrapers/social/facebook/crawler.js';

const COOKIE_PATH = process.env.FB_COOKIE_PATH || '/Users/luisphan/.xactions/facebook-cookies.json';
const PROXY_URL = process.env.PROXY_URL || JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/proxy-config.json', 'utf8')).gatewayUrl;
const POST_URL = process.argv[2] || 'https://www.facebook.com/share/p/1EewJwQixN/';

async function main() {
  const rawCookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
  const cookieRecord = {};
  for (const c of rawCookies) {
    if (c.name) cookieRecord[c.name] = c.value;
  }

  const accountId = cookieRecord.c_user || 'real_fb_test';

  const proxyPool = new ProxyIpPool({ proxies: [PROXY_URL], validateOnAdd: false });
  const client = new FacebookClient({ proxyPool, client: process.env.HTTP_CLIENT || 'got' });
  const crawler = new FacebookCrawler({ client });

  console.log(`🚀 Testing getCommentsForPost with real cookie + proxy`);
  console.log(`🌐 Proxy: ${PROXY_URL.replace(/:.*@/, ':****@')}`);
  console.log(`📄 Post:  ${POST_URL}`);

  const { comments, pageInfo } = await crawler.getCommentsForPost(
    { postId: POST_URL, maxDepth: 2, maxComments: 100 },
    { accountId, cookies: cookieRecord },
  );

  console.log(`✅ Found ${comments.length} comments`);
  console.log(`📄 Page info:`, pageInfo);

  const depthCounts = {};
  for (const c of comments) {
    depthCounts[c.depth] = (depthCounts[c.depth] || 0) + 1;
  }
  console.log('Depth counts:', depthCounts);

  for (const c of comments.filter(c => c.depth <= 1).slice(0, 8)) {
    console.log({
      depth: c.depth,
      externalId: c.externalId,
      author: c.authorName,
      content: c.content?.slice(0, 100) || null,
      likes: c.likesCount,
      replies: c.subCommentsCount,
    });
  }

  await crawler.cleanup();
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
