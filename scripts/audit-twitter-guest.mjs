import { TwitterCrawler } from '../src/scrapers/social/twitter/crawler.js';

const commands = [
  { action: 'profile', args: { username: 'nasa' } },
  { action: 'media', args: { username: 'nasa', limit: 5 } },
  { action: 'thread', args: { tweetId: '2095250561595535856' } },
  { action: 'trending', args: {} },
  { action: 'search', args: { query: 'xactions', limit: 5 } },
  { action: 'hashtag', args: { tag: 'javascript', limit: 5 } },
];

const crawler = new TwitterCrawler({});

for (const command of commands) {
  const start = Date.now();
  try {
    const result = await crawler.start(command);
    console.log(`✅ ${command.action} OK (${Date.now() - start}ms) items=${Array.isArray(result) ? result.length : (result?.items ? result.items.length : (result?.posts ? result.posts.length : 'n/a'))}`);
  } catch (err) {
    console.log(`❌ ${command.action} FAIL (${Date.now() - start}ms) ${err?.type || err?.name || 'Error'}: ${err.message}`);
  }
}
