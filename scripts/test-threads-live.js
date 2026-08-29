import { ThreadsCrawler } from '../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../src/scrapers/social/threads/client.js';

async function runLiveTest() {
  console.log('🚀 [LIVE TEST] Initializing ThreadsCrawler with real network target (https://www.threads.com)...');
  const client = new ThreadsClient({ baseUrl: 'https://www.threads.com' });
  const crawler = new ThreadsCrawler({ client });

  console.log('\n--- 1. Testing Live Token Extraction (ensureLsd) ---');
  try {
    const tokens = await client.ensureLsd('threads-guest');
    console.log('✅ ensureLsd succeeded! Found tokens:', {
      hasLsd: !!tokens.lsd,
      lsdValue: tokens.lsd ? tokens.lsd.slice(0, 10) + '...' : null,
      hasCsrf: !!tokens.csrftoken,
      hasDtsg: !!tokens.fb_dtsg,
    });
  } catch (err) {
    console.error('❌ ensureLsd failed:', err.message);
  }

  console.log('\n--- 2. Testing Live Profile Extraction (username: "zuck") ---');
  try {
    const profile = await crawler.getProfile({ username: 'zuck' }, { accountId: 'threads-guest' });
    console.log('✅ getProfile result:', {
      id: profile.id,
      username: profile.username,
      name: profile.name,
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
      bio: profile.bio ? profile.bio.slice(0, 50) + '...' : null,
      isVerified: profile.isVerified,
    });
  } catch (err) {
    console.error('❌ getProfile failed:', err.message);
  }

  console.log('\n--- 3. Testing Live Search (query: "technology") ---');
  try {
    const searchRes = await crawler.searchPosts({ query: 'technology', count: 3 }, { accountId: 'threads-guest' });
    console.log(`✅ searchPosts returned ${searchRes.posts.length} posts (sourceMethod: ${searchRes.posts[0]?.metadata?.sourceMethod}):`);
    searchRes.posts.slice(0, 2).forEach((p, idx) => {
      console.log(`  [${idx + 1}] ID: ${p.id} | Author: ${p.authorUsername} | Text: ${p.text?.slice(0, 60)}...`);
    });
  } catch (err) {
    console.error('❌ searchPosts failed:', err.message);
  }

  console.log('\n--- 4. Testing Live Post Detail (post_detail) ---');
  try {
    const postRes = await crawler.getPostDetail({ postId: 'CuZ7X9_sF9y', includeReplies: false }, { accountId: 'threads-guest' });
    console.log('✅ getPostDetail result:', {
      id: postRes.post?.id,
      author: postRes.post?.authorUsername,
      text: postRes.post?.text?.slice(0, 60),
    });
  } catch (err) {
    console.error('⚠️ getPostDetail note:', err.message);
  }

  console.log('\n🏁 [LIVE TEST] Completed.');
}

runLiveTest().catch(console.error);
