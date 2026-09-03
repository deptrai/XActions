// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Seed rich analytics demo data for a local dashboard/user.
 *
 * Generates:
 * - 31 daily account snapshots (followers, following, tweets, listed, verified)
 * - 31 engagement daily roll-ups (rate, impressions, engagements, top tweet)
 * - 10 realistic top-performing tweets with daily metric evolution
 */

import {
  saveAccountSnapshot,
  saveDailyEngagement,
  saveTweetSnapshot,
} from '../src/analytics/historyStore.js';

const username = 'nichxbt';
const DAYS = 30;
const TOP_TWEETS_COUNT = 10;

const now = Date.now();

// Base metrics that trend upward with a little noise
let followers = 14000;
let following = 3200;
let tweets = 540;

const sampleTweets = [
  { text: 'Shipped the new XActions dashboard. 45 pages, zero API fees. 🚀', baseLikes: 450, baseRTs: 180, baseReplies: 65 },
  { text: 'Hot take: AI agents are the new browser extensions.', baseLikes: 820, baseRTs: 340, baseReplies: 120 },
  { text: 'How I grew from 0 to 14k followers without paid ads (thread) 🧵', baseLikes: 1200, baseRTs: 560, baseReplies: 210 },
  { text: 'MCP servers are about to change how every desktop app works.', baseLikes: 340, baseRTs: 120, baseReplies: 40 },
  { text: 'The best time to post is when your audience is awake. Obvious, yet ignored.', baseLikes: 280, baseRTs: 90, baseReplies: 28 },
  { text: 'Stop buying followers. Start building signal.', baseLikes: 670, baseRTs: 290, baseReplies: 95 },
  { text: 'One-line dashboards > 50-tab spreadsheets.', baseLikes: 390, baseRTs: 130, baseReplies: 42 },
  { text: 'Twitter/X is the largest free distribution channel in history. Use it.', baseLikes: 510, baseRTs: 220, baseReplies: 70 },
  { text: 'Less content, more context. Less growth hacking, more value.', baseLikes: 410, baseRTs: 150, baseReplies: 55 },
  { text: 'If you are not embarrassed by your first release, you shipped too late.', baseLikes: 730, baseRTs: 310, baseReplies: 88 },
];

// Stable tweet objects with IDs we evolve over time
const topTweets = sampleTweets.slice(0, TOP_TWEETS_COUNT).map((t, i) => ({
  tweetId: `tweet_${username}_${String(i).padStart(3, '0')}`,
  ...t,
  likes: t.baseLikes,
  retweets: t.baseRTs,
  replies: t.baseReplies,
  quotes: Math.floor(t.baseRTs * 0.15),
  views: t.baseLikes * 45 + Math.floor(Math.random() * 5000),
}));

for (let i = DAYS; i >= 0; i--) {
  const d = new Date(now - i * 86400000);
  const ts = d.toISOString();
  const date = ts.split('T')[0];

  // Daily follower/following/tweet growth with realistic noise
  followers += Math.floor(Math.random() * 120 - 20);
  following += Math.floor(Math.random() * 20 - 8);
  tweets += Math.floor(Math.random() * 4);

  saveAccountSnapshot(username, {
    followers_count: followers,
    following_count: following,
    tweet_count: tweets,
    listed_count: 10 + Math.floor(i / 10),
    verified: true,
    snapshot_at: `${date}T12:00:00.000Z`,
  });

  // Engagement rolls up all tweet metrics for the day (synthetic)
  const totalImpressions = topTweets.reduce((s, t) => s + t.views, 0) + Math.floor(Math.random() * 10000);
  const totalEngagements = topTweets.reduce(
    (s, t) => s + t.likes + t.retweets + t.replies + t.quotes,
    0
  );

  // Pick the current highest-engagement tweet as the top tweet of the day
  const topTweet = topTweets
    .slice()
    .sort((a, b) => (b.likes + b.retweets + b.replies + b.quotes) - (a.likes + a.retweets + a.replies + a.quotes))[0];

  saveDailyEngagement(username, {
    date,
    avg_engagement_rate: totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0,
    total_impressions: totalImpressions,
    total_engagements: totalEngagements,
    top_tweet_id: topTweet.tweetId,
  });

  // Evolve each top tweet's metrics slightly for the next day
  for (const t of topTweets) {
    const growth = 1 + (Math.random() * 0.08 - 0.01); // -1% to +7% daily
    t.likes = Math.max(10, Math.floor(t.likes * growth));
    t.retweets = Math.max(5, Math.floor(t.retweets * growth));
    t.replies = Math.max(2, Math.floor(t.replies * growth));
    t.quotes = Math.max(1, Math.floor(t.retweets * 0.15));
    t.views = Math.max(100, Math.floor(t.views * (1 + (Math.random() * 0.05 - 0.01))));

    saveTweetSnapshot(username, t.tweetId, {
      likes: t.likes,
      retweets: t.retweets,
      replies: t.replies,
      quotes: t.quotes,
      views: t.views,
      bookmarkCount: Math.floor(t.likes * 0.05),
    });
  }
}

console.log(`✅ Seeded ${DAYS + 1} days of analytics for @${username}`);
console.log(`   - account snapshots: ${DAYS + 1}`);
console.log(`   - engagement daily:  ${DAYS + 1}`);
console.log(`   - tweet snapshots:   ${(DAYS + 1) * TOP_TWEETS_COUNT}`);
