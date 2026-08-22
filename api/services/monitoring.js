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

  return {
    id: snapshot.id,
    username,
    type,
    ...JSON.parse(snapshot.data),
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

  return changes;
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
