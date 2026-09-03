import { saveAccountSnapshot, saveDailyEngagement } from '../src/analytics/historyStore.js';

const username = 'nichxbt';
const now = Date.now();

// Seed 30 days of snapshots
for (let i = 30; i >= 0; i--) {
  const d = new Date(now - i * 86400000);
  const ts = d.toISOString();
  saveAccountSnapshot(username, {
    followers_count: 10000 + Math.floor(Math.random() * 5000) + (30 - i) * 50,
    following_count: 3000 + Math.floor(Math.random() * 500),
    tweet_count: 500 + (30 - i) * 2,
    listed_count: 10,
    verified: true,
    snapshot_at: ts,
  });

  saveDailyEngagement(username, {
    date: ts.split('T')[0],
    avg_engagement_rate: Math.random() * 5 + 1,
    total_impressions: Math.floor(Math.random() * 10000 + 5000),
    total_engagements: Math.floor(Math.random() * 1000 + 200),
  });
}

console.log('✅ Seeded 31 snapshots for', username);
