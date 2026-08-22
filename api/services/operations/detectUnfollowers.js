// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} ProcessDetectUnfollowersOptions
 * @property {string} operationId
 * @property {string} userId
 */

/**
 * @param {ProcessDetectUnfollowersOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function processDetectUnfollowers({ operationId, userId }) {
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

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    const lastOperation = await prisma.operation.findFirst({
      where: {
        userId,
        type: 'detectUnfollowers',
        status: 'completed'
      },
      orderBy: { createdAt: 'desc' }
    });

    const followersResponse = await client.get(`/users/${myTwitterId}/followers`, {
      params: {
        max_results: 1000,
        'user.fields': 'username,name'
      }
    });
    const followersData = /** @type {TwitterApiEnvelope} */ (followersResponse.data);
    /** @type {TwitterApiUser[]} */
    const currentFollowers = /** @type {TwitterApiUser[]} */ (followersData.data || []);
    const currentFollowerIds = new Set(currentFollowers.map(f => String(f.id)));

    /** @type {TwitterApiUser[]} */
    let unfollowers = [];

    if (lastOperation && lastOperation.result) {
      const previousResult = /** @type {Record<string, unknown>} */ (JSON.parse(lastOperation.result));
      /** @type {TwitterApiUser[]} */
      const previousFollowers = /** @type {TwitterApiUser[]} */ (previousResult.followers || []);

      unfollowers = previousFollowers.filter(
        f => !currentFollowerIds.has(String(f.id))
      );
    }

    return {
      currentFollowersCount: currentFollowers.length,
      unfollowersCount: unfollowers.length,
      unfollowers: unfollowers.slice(0, 50),
      followers: currentFollowers.map(/** @param {TwitterApiUser} f */ (f) => ({
        id: f.id,
        username: f.username,
        name: f.name
      }))
    };
  } catch (error) {
    console.error('❌ Detect unfollowers error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processDetectUnfollowers };
