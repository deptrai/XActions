// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Sync local SQLite analytics data into Postgres for the dashboard service.
 *
 * Usage: node scripts/sync-analytics-to-postgres.mjs <username>
 */

import prisma from '../api/lib/prisma.js';
import { getAccountHistory, exportHistory } from '../src/analytics/historyStore.js';

const username = process.argv[2] || 'nichxbt';

function snapshotAtToDate(s) {
  return new Date(s);
}

const rawHistory = getAccountHistory(username, { interval: 'raw' });
console.log(`📊 SQLite account snapshots for @${username}:`, rawHistory.length);

for (const row of rawHistory) {
  const id = `sqlite_as_${row.id}`;
  const data = JSON.stringify({
    profile: {
      followers: row.followers_count,
      following: row.following_count,
      tweets: row.tweet_count,
      listed: row.listed_count,
      verified: Boolean(row.verified),
    },
    followerCount: row.followers_count,
    followingCount: row.following_count,
  });
  const createdAt = snapshotAtToDate(row.snapshot_at);

  await prisma.accountSnapshot.upsert({
    where: { id },
    update: { data, createdAt },
    create: { id, username, type: 'full', data, createdAt },
  });
}

const { dailyEngagement, tweetSnapshots } = exportHistory(username);
console.log(`📈 SQLite engagement rows:`, dailyEngagement.length);
console.log(`🐦 SQLite tweet snapshots:`, tweetSnapshots.length);

for (const row of dailyEngagement) {
  const id = `sqlite_ed_${row.id}`;
  await prisma.engagementDaily.upsert({
    where: { id },
    update: {
      date: row.date,
      avgEngagementRate: row.avg_engagement_rate,
      totalImpressions: row.total_impressions,
      totalEngagements: row.total_engagements,
      topTweetId: row.top_tweet_id,
    },
    create: {
      id,
      username,
      date: row.date,
      avgEngagementRate: row.avg_engagement_rate,
      totalImpressions: row.total_impressions,
      totalEngagements: row.total_engagements,
      topTweetId: row.top_tweet_id,
    },
  });
}

for (const row of tweetSnapshots) {
  const id = `sqlite_ts_${row.id}`;
  await prisma.tweetSnapshot.upsert({
    where: { id },
    update: {
      tweetId: row.tweet_id,
      text: null,
      likes: row.likes,
      retweets: row.retweets,
      replies: row.replies,
      quotes: row.quotes,
      views: row.views,
      bookmarkCount: row.bookmark_count,
      snapshotAt: snapshotAtToDate(row.snapshot_at),
    },
    create: {
      id,
      username,
      tweetId: row.tweet_id,
      text: null,
      likes: row.likes,
      retweets: row.retweets,
      replies: row.replies,
      quotes: row.quotes,
      views: row.views,
      bookmarkCount: row.bookmark_count,
      snapshotAt: snapshotAtToDate(row.snapshot_at),
    },
  });
}

await prisma.$disconnect();
console.log(`✅ Synced @${username} analytics to Postgres`);
