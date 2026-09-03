import { createAgent, scrapeProfile, scrapeTweets, searchTweets, scrapeFeed } from '../src/scrapers/bluesky/index.js';

const client = await createAgent({ service: 'https://public.api.bsky.app' });

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

await audit('profile', () => scrapeProfile(client, 'bsky.app'));
await audit('scrapeTweets', () => scrapeTweets(client, 'bsky.app', { limit: 5 }));
await audit('searchTweets (no auth)', () => searchTweets(client, 'javascript', { limit: 5 }));
// use the official "What's Hot" feed generator
await audit('scrapeFeed', () => scrapeFeed(client, 'at://did:plc:z72i7hdynmk6r22z27h7cat4/app.bsky.feed.generator/whats-hot', { limit: 5 }));

console.table(results);
