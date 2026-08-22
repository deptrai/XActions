// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} UnfollowNonFollowersConfig
 * @property {number} [maxUnfollows]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} ProcessUnfollowNonFollowersOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {UnfollowNonFollowersConfig} config
 */

/**
 * @param {ProcessUnfollowNonFollowersOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function processUnfollowNonFollowers({ operationId, userId, config }) {
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
        max_results: 1000,
        'user.fields': 'username'
      }
    });
    const followingData = /** @type {TwitterApiEnvelope} */ (followingResponse.data);
    /** @type {TwitterApiUser[]} */
    const following = /** @type {TwitterApiUser[]} */ (followingData.data || []);

    /** @type {TwitterApiUser[]} */
    const nonFollowers = [];
    let unfollowedCount = 0;

    for (const followedUser of following) {
      if (unfollowedCount >= maxUnfollows) break;

      try {
        const followersResponse = await client.get(`/users/${followedUser.id}/followers`, {
          params: {
            max_results: 1000
          }
        });
        const followersData = /** @type {TwitterApiEnvelope} */ (followersResponse.data);
        /** @type {TwitterApiUser[]} */
        const followerList = /** @type {TwitterApiUser[]} */ (followersData.data || []);

        const followsBack = followerList.some(/** @param {TwitterApiUser} follower */ (follower) =>
          String(follower.id) === myTwitterId
        );

        if (!followsBack) {
          nonFollowers.push(followedUser);

          if (!dryRun) {
            await client.delete(`/users/${myTwitterId}/following/${followedUser.id}`);
            unfollowedCount++;

            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error checking user ${followedUser.username}:`, message);
      }
    }

    return {
      unfollowedCount: dryRun ? 0 : unfollowedCount,
      nonFollowersFound: nonFollowers.length,
      nonFollowers: nonFollowers.map(/** @param {TwitterApiUser} u */ (u) => u.username),
      dryRun
    };
  } catch (error) {
    console.error('❌ Unfollow non-followers error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processUnfollowNonFollowers };
