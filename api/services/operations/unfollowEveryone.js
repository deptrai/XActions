// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} UnfollowEveryoneConfig
 * @property {number} [maxUnfollows]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} ProcessUnfollowEveryoneOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {UnfollowEveryoneConfig} config
 */

/**
 * @param {ProcessUnfollowEveryoneOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function processUnfollowEveryone({ operationId, userId, config }) {
  try {
    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'processing', startedAt: new Date() }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.twitterAccessToken) {
      throw new Error('User not found or Twitter not connected');
    }

    const client = /** @type {import('axios').AxiosInstance} */ (await getTwitterClient(user));
    const { maxUnfollows = 100, dryRun = false } = config;

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    const followingResponse = await client.get(`/users/${myTwitterId}/following`, {
      params: {
        max_results: Math.min(maxUnfollows, 1000),
        'user.fields': 'username'
      }
    });
    const followingData = /** @type {TwitterApiEnvelope} */ (followingResponse.data);
    /** @type {TwitterApiUser[]} */
    const following = /** @type {TwitterApiUser[]} */ (followingData.data || []);
    let unfollowedCount = 0;
    const unfollowedUsers = [];

    for (const followedUser of following) {
      if (unfollowedCount >= maxUnfollows) break;

      try {
        if (!dryRun) {
          await client.delete(`/users/${myTwitterId}/following/${followedUser.id}`);
          unfollowedCount++;

          unfollowedUsers.push({
            id: followedUser.id,
            username: followedUser.username
          });

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error unfollowing ${followedUser.username}:`, message);
      }
    }

    return {
      unfollowedCount: dryRun ? 0 : unfollowedCount,
      totalFound: following.length,
      unfollowedUsers: unfollowedUsers.slice(0, 50),
      dryRun
    };
  } catch (error) {
    console.error('❌ Unfollow everyone error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processUnfollowEveryone };
