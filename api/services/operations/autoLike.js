// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} AutoLikeConfig
 * @property {string} [query]
 * @property {string} [targetUsername]
 * @property {number} [maxLikes]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} ProcessAutoLikeOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {AutoLikeConfig} config
 */

/**
 * Auto-like tweets based on search query or target user's tweets
 * Uses Twitter API when OAuth tokens available
 *
 * @param {ProcessAutoLikeOptions} options
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Record<string, unknown>>}
 */
async function processAutoLike({ operationId, userId, config }, isCancelled = () => false) {
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
      query,
      targetUsername,
      maxLikes = 50,
      dryRun = false
    } = config;

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    /** @type {TwitterApiTweet[]} */
    let tweets = [];
    let likedCount = 0;
    const likedTweets = [];
    const errors = [];

    if (targetUsername) {
      const userResponse = await client.get(`/users/by/username/${targetUsername}`);
      const userData = /** @type {TwitterApiEnvelope} */ (userResponse.data);
      const userInner = /** @type {Record<string, unknown>} */ (userData.data);
      const targetUserId = String(userInner.id);

      const tweetsResponse = await client.get(`/users/${targetUserId}/tweets`, {
        params: {
          max_results: Math.min(maxLikes, 100),
          'tweet.fields': 'created_at,author_id'
        }
      });
      const tweetsData = /** @type {TwitterApiEnvelope} */ (tweetsResponse.data);
      tweets = /** @type {TwitterApiTweet[]} */ (tweetsData.data || []);
    } else if (query) {
      const searchResponse = await client.get('/tweets/search/recent', {
        params: {
          query,
          max_results: Math.min(maxLikes, 100),
          'tweet.fields': 'created_at,author_id'
        }
      });
      const searchData = /** @type {TwitterApiEnvelope} */ (searchResponse.data);
      tweets = /** @type {TwitterApiTweet[]} */ (searchData.data || []);
    } else {
      throw new Error('Either query or targetUsername must be provided');
    }

    for (const tweet of tweets) {
      if (isCancelled()) {
        console.log(`🛑 Job ${operationId} cancelled`);
        break;
      }

      if (likedCount >= maxLikes) break;

      try {
        if (!dryRun) {
          await client.post(`/users/${myTwitterId}/likes`, {
            tweet_id: tweet.id
          });
          likedCount++;

          likedTweets.push({
            id: tweet.id,
            text: tweet.text?.substring(0, 100)
          });

          await new Promise(resolve =>
            setTimeout(resolve, 2000 + Math.random() * 1000)
          );
        } else {
          likedTweets.push({
            id: tweet.id,
            text: tweet.text?.substring(0, 100),
            dryRun: true
          });
        }
      } catch (error) {
        const message = error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error);
        errors.push({
          tweetId: tweet.id,
          error: message
        });
      }
    }

    return {
      success: true,
      likedCount: dryRun ? 0 : likedCount,
      totalFound: tweets.length,
      likedTweets: likedTweets.slice(0, 20),
      errors: errors.slice(0, 10),
      dryRun,
      cancelled: isCancelled()
    };
  } catch (error) {
    console.error('❌ Auto-like error:', error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error));
    throw error;
  }
}

export { processAutoLike };
