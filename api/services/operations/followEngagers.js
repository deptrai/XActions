// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} FollowEngagersConfig
 * @property {string} [tweetId]
 * @property {string} [tweetUrl]
 * @property {string} [engagementType]
 * @property {number} [maxFollows]
 * @property {boolean} [dryRun]
 * @property {string[]} [whitelist]
 */

/**
 * @typedef {object} ProcessFollowEngagersOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {FollowEngagersConfig} config
 */

/**
 * Follow users who engaged (liked/retweeted) with specific tweets
 * Uses Twitter API when OAuth tokens available
 *
 * @param {ProcessFollowEngagersOptions} options
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Record<string, unknown>>}
 */
async function processFollowEngagers({ operationId, userId, config }, isCancelled = () => false) {
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
    const {
      tweetId,
      tweetUrl,
      engagementType = 'likes',
      maxFollows = 50,
      dryRun = false,
      whitelist = []
    } = config;

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    const targetTweetId = tweetId || (tweetUrl ? tweetUrl.split('/status/')[1]?.split('?')[0] : null);

    if (!targetTweetId) {
      throw new Error('Either tweetId or tweetUrl must be provided');
    }

    const endpoint = engagementType === 'likes'
      ? `/tweets/${targetTweetId}/liking_users`
      : `/tweets/${targetTweetId}/retweeted_by`;

    const engagersResponse = await client.get(endpoint, {
      params: {
        max_results: 100,
        'user.fields': 'username,public_metrics'
      }
    });
    const engagersData = /** @type {TwitterApiEnvelope} */ (engagersResponse.data);
    /** @type {TwitterApiUser[]} */
    const engagers = /** @type {TwitterApiUser[]} */ (engagersData.data || []);

    const whitelistLower = whitelist.map(/** @param {string} u */ (u) => u.toLowerCase());
    const filteredEngagers = engagers.filter(/** @param {TwitterApiUser} e */ (e) =>
      e.username ? !whitelistLower.includes(e.username.toLowerCase()) : true
    );

    let followedCount = 0;
    const followedUsers = [];
    const errors = [];

    for (const engager of filteredEngagers) {
      if (isCancelled()) {
        console.log(`🛑 Job ${operationId} cancelled`);
        break;
      }

      if (followedCount >= maxFollows) break;

      try {
        if (!dryRun) {
          await client.post(`/users/${myTwitterId}/following`, {
            target_user_id: engager.id
          });
          followedCount++;

          followedUsers.push({
            id: engager.id,
            username: engager.username
          });

          await new Promise(resolve =>
            setTimeout(resolve, 2000 + Math.random() * 2000)
          );
        } else {
          followedUsers.push({
            id: engager.id,
            username: engager.username,
            dryRun: true
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already')) {
          followedUsers.push({
            id: engager.id,
            username: engager.username,
            alreadyFollowing: true
          });
        } else {
          errors.push({
            username: engager.username,
            error: message
          });
        }
      }
    }

    return {
      success: true,
      followedCount: dryRun ? 0 : followedCount,
      totalEngagers: engagers.length,
      followedUsers: followedUsers.slice(0, 50),
      errors: errors.slice(0, 10),
      dryRun,
      cancelled: isCancelled()
    };
  } catch (error) {
    console.error('❌ Follow engagers error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processFollowEngagers };
