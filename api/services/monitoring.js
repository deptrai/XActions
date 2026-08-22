// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
import * as automation from './browserAutomation.js';

/**
 * @typedef {object} ScrapeListResult
 * @property {Record<string, unknown>[]} items
 */

/**
 * @typedef {object} SnapshotChanges
 * @property {{ from: Date; to: Date }} timespan
 * @property {{ gained: string[]; lost: string[] }} followers
 * @property {{ added: string[]; removed: string[] }} following
 * @property {{ changes: Record<string, unknown>[] }} profile
 */

/**
 * Create a snapshot of account state
 * @param {string} sessionCookie
 * @param {string} username
 * @param {'full' | 'profile' | 'followers' | 'following'} [type]
 */
export async function createSnapshot(sessionCookie, username, type = 'full') {
  const data = {};

  if (type === 'full' || type === 'profile') {
    data.profile = await automation.scrapeProfile(sessionCookie, username);
  }

  if (type === 'full' || type === 'followers') {
    const followers = /** @type {ScrapeListResult} */ (await automation.scrapeFollowers(sessionCookie, username, { limit: 5000 }));
    data.followers = followers.items.map((/** @type {Record<string, unknown>} */ f) => f.username);
    data.followerCount = followers.items.length;
  }

  if (type === 'full' || type === 'following') {
    const following = /** @type {ScrapeListResult} */ (await automation.scrapeFollowing(sessionCookie, username, { limit: 5000 }));
    data.following = following.items.map((/** @type {Record<string, unknown>} */ f) => f.username);
    data.followingCount = following.items.length;
  }

  // Store in database
  const snapshot = await prisma.accountSnapshot.create({
    data: {
      username,
      type,
      data: JSON.stringify(data),
      createdAt: new Date()
    }
  });

  return {
    id: snapshot.id,
    username,
    type,
    ...data,
    createdAt: snapshot.createdAt
  };
}

/**
 * Get latest snapshot for a user
 * @param {string} username
 * @param {'full' | 'profile' | 'followers' | 'following'} [type]
 */
export async function getLatestSnapshot(username, type = 'full') {
  const snapshot = await prisma.accountSnapshot.findFirst({
    where: { username, type },
    orderBy: { createdAt: 'desc' }
  });

  if (!snapshot) return null;

  const data = /** @type {Record<string, unknown>} */ (JSON.parse(snapshot.data));

  return {
    id: snapshot.id,
    username,
    type,
    ...data,
    includesFollowersList: Array.isArray(data.followers),
    includesFollowingList: Array.isArray(data.following),
    stats: null,
    createdAt: snapshot.createdAt
  };
}

/**
 * Compare two snapshots
 * @param {string} snapshotId1
 * @param {string} snapshotId2
 */
export async function compareSnapshots(snapshotId1, snapshotId2) {
  const [snap1, snap2] = await Promise.all([
    prisma.accountSnapshot.findUnique({ where: { id: snapshotId1 } }),
    prisma.accountSnapshot.findUnique({ where: { id: snapshotId2 } })
  ]);

  if (!snap1 || !snap2) {
    throw new Error('Snapshot not found');
  }

  const data1 = /** @type {Record<string, unknown>} */ (JSON.parse(snap1.data));
  const data2 = /** @type {Record<string, unknown>} */ (JSON.parse(snap2.data));

  const snapshot1 = {
    id: snap1.id,
    username: snap1.username,
    type: snap1.type,
    createdAt: snap1.createdAt,
    followerCount: data1.followerCount,
    followingCount: data1.followingCount,
  };

  const snapshot2 = {
    id: snap2.id,
    username: snap2.username,
    type: snap2.type,
    createdAt: snap2.createdAt,
    followerCount: data2.followerCount,
    followingCount: data2.followingCount,
  };

  const changes = /** @type {SnapshotChanges} */ ({
    timespan: {
      from: snap1.createdAt,
      to: snap2.createdAt
    },
    followers: {
      gained: /** @type {string[]} */ ([]),
      lost: /** @type {string[]} */ ([])
    },
    following: {
      added: /** @type {string[]} */ ([]),
      removed: /** @type {string[]} */ ([])
    },
    profile: {
      changes: /** @type {Record<string, unknown>[]} */ ([])
    }
  });

  // Compare followers
  const followers1 = /** @type {string[]} */ (data1.followers);
  const followers2 = /** @type {string[]} */ (data2.followers);
  if (Array.isArray(followers1) && Array.isArray(followers2)) {
    const set1 = new Set(followers1);
    const set2 = new Set(followers2);

    changes.followers.gained = followers2.filter((/** @type {string} */ f) => !set1.has(f));
    changes.followers.lost = followers1.filter((/** @type {string} */ f) => !set2.has(f));
  }

  // Compare following
  const following1 = /** @type {string[]} */ (data1.following);
  const following2 = /** @type {string[]} */ (data2.following);
  if (Array.isArray(following1) && Array.isArray(following2)) {
    const set1 = new Set(following1);
    const set2 = new Set(following2);

    changes.following.added = following2.filter((/** @type {string} */ f) => !set1.has(f));
    changes.following.removed = following1.filter((/** @type {string} */ f) => !set2.has(f));
  }

  // Compare profile fields
  if (data1.profile && data2.profile) {
    const profile1 = /** @type {Record<string, unknown>} */ (data1.profile);
    const profile2 = /** @type {Record<string, unknown>} */ (data2.profile);
    for (const field of ['bio', 'name', 'location', 'website']) {
      if (profile1[field] !== profile2[field]) {
        changes.profile.changes.push({
          field,
          from: profile1[field],
          to: profile2[field]
        });
      }
    }
  }

  const timeBetweenMs = Number(new Date(snap2.createdAt)) - Number(new Date(snap1.createdAt));
  const hours = Math.max(0, Math.round(timeBetweenMs / 3600000));
  const timeBetweenHuman = hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;

  return {
    username: snap1.username,
    snapshot1,
    snapshot2,
    followersGained: changes.followers.gained,
    followersLost: changes.followers.lost,
    followingAdded: changes.following.added,
    followingRemoved: changes.following.removed,
    profileChanges: changes.profile.changes,
    timeBetweenHuman,
  };
}

/**
 * Get all snapshots for a user
 * @param {string} username
 * @param {number} [limit]
 */
export async function listSnapshots(username, limit = 10) {
  const snapshots = await prisma.accountSnapshot.findMany({
    where: { username },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  return snapshots.map((s) => ({
    id: s.id,
    username: s.username,
    type: s.type,
    createdAt: s.createdAt
  }));
}

/**
 * Save a pre-built snapshot for a user without re-scraping.
 * @param {string} username
 * @param {Record<string, unknown>} data
 */
export async function saveSnapshot(username, data) {
  const snapshot = await prisma.accountSnapshot.create({
    data: {
      username,
      type: 'full',
      data: JSON.stringify(data),
      createdAt: new Date()
    }
  });

  return {
    id: snapshot.id,
    username,
    type: snapshot.type,
    ...data,
    includesFollowersList: Array.isArray(data.followers),
    includesFollowingList: Array.isArray(data.following),
    stats: null,
    createdAt: snapshot.createdAt
  };
}

/**
 * Delete all snapshots for a user.
 * @param {string} username
 */
export async function deleteSnapshots(username) {
  const result = await prisma.accountSnapshot.deleteMany({
    where: { username }
  });

  return result.count;
}

/**
 * List all monitored accounts (users with snapshots).
 * @param {{ limit?: number }} options
 */
export async function listMonitoredAccounts(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);

  const snapshots = await prisma.accountSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1000 // Pre-limit for grouping; real limit applied after grouping.
  });

  /** @type {Map<string, { lastSnapshotAt: Date; snapshotCount: number; latestFollowerCount?: number; latestFollowingCount?: number }>} */
  const accounts = new Map();
  for (const s of snapshots) {
    if (!accounts.has(s.username)) {
      const data = /** @type {Record<string, unknown>} */ (s.data ? JSON.parse(s.data) : {});
      accounts.set(s.username, {
        lastSnapshotAt: s.createdAt,
        snapshotCount: 1,
        latestFollowerCount: typeof data.followerCount === 'number' ? data.followerCount : undefined,
        latestFollowingCount: typeof data.followingCount === 'number' ? data.followingCount : undefined
      });
    } else {
      const existing = accounts.get(s.username);
      if (existing) existing.snapshotCount += 1;
    }
  }

  return Array.from(accounts.entries())
    .slice(0, limit)
    .map(([username, info]) => ({
      username,
      lastSnapshotAt: info.lastSnapshotAt,
      snapshotCount: info.snapshotCount,
      latestFollowerCount: info.latestFollowerCount,
      latestFollowingCount: info.latestFollowingCount
    }));
}
