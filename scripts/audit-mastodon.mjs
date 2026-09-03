import { createClient, scrapeProfile, scrapeTweets, searchTweets, scrapeHashtag, scrapeTrending } from '../src/scrapers/mastodon/index.js';

const client = createClient({ instance: 'https://mastodon.social' });

const results = [];

async function audit(name, fn) {
  const start = Date.now();
  try {
    const data = await fn();
    results.push({ name, status: 'OK', duration: Date.now() - start, count: Array.isArray(data) ? data.length : 1 });
  } catch (err) {
    results.push({ name, status: 'FAIL', duration: Date.now() - start, error: err.message });
  }
}

await audit('profile', () => scrapeProfile(client, 'nasa'));
await audit('scrapeTweets', () => scrapeTweets(client, 'nasa', { limit: 5 }));
await audit('searchTweets', () => searchTweets(client, 'javascript', { limit: 5 }));
await audit('scrapeHashtag', () => scrapeHashtag(client, 'javascript', { limit: 5 }));
await audit('scrapeTrending', () => scrapeTrending(client, { limit: 5 }));

console.table(results);
