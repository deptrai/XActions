// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} AutoCommentConfig
 * @property {string} [query]
 * @property {string} [targetUsername]
 * @property {string[]} [comments]
 * @property {string} [comment]
 * @property {number} [maxComments]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} ProcessAutoCommentOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {AutoCommentConfig} config
 */

/**
 * Auto-comment on tweets matching search criteria or from target users
 * Uses Twitter API when OAuth tokens available
 *
 * @param {ProcessAutoCommentOptions} options
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Record<string, unknown>>}
 */
async function processAutoComment({ operationId, userId, config }, isCancelled = () => false) {
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
      comments = [],
      comment,
      maxComments = 20,
      dryRun = false
    } = config;

    const commentList = comments.length > 0 ? comments : (comment ? [comment] : []);
    if (commentList.length === 0) {
      throw new Error('At least one comment text must be provided');
    }

    /** @type {TwitterApiTweet[]} */
    let tweets = [];
    let commentedCount = 0;
    const commentedTweets = [];
    const errors = [];

    if (targetUsername) {
      const userResponse = await client.get(`/users/by/username/${targetUsername}`);
      const userData = /** @type {TwitterApiEnvelope} */ (userResponse.data);
      const userInner = /** @type {Record<string, unknown>} */ (userData.data);
      const targetUserId = String(userInner.id);

      const tweetsResponse = await client.get(`/users/${targetUserId}/tweets`, {
        params: {
          max_results: Math.min(maxComments * 2, 100),
          'tweet.fields': 'created_at,author_id,conversation_id'
        }
      });
      const tweetsData = /** @type {TwitterApiEnvelope} */ (tweetsResponse.data);
      tweets = /** @type {TwitterApiTweet[]} */ (tweetsData.data || []);
    } else if (query) {
      const searchResponse = await client.get('/tweets/search/recent', {
        params: {
          query,
          max_results: Math.min(maxComments * 2, 100),
          'tweet.fields': 'created_at,author_id,conversation_id'
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

      if (commentedCount >= maxComments) break;

      try {
        const commentText = commentList[commentedCount % commentList.length];

        if (!dryRun) {
          await client.post('/tweets', {
            text: commentText,
            reply: {
              in_reply_to_tweet_id: tweet.id
            }
          });
          commentedCount++;

          commentedTweets.push({
            tweetId: tweet.id,
            tweetText: tweet.text?.substring(0, 100),
            comment: commentText
          });

          await new Promise(resolve =>
            setTimeout(resolve, 30000 + Math.random() * 30000)
          );
        } else {
          commentedTweets.push({
            tweetId: tweet.id,
            tweetText: tweet.text?.substring(0, 100),
            comment: commentText,
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
      commentedCount: dryRun ? 0 : commentedCount,
      totalFound: tweets.length,
      commentedTweets: commentedTweets.slice(0, 20),
      errors: errors.slice(0, 10),
      dryRun,
      cancelled: isCancelled()
    };
  } catch (error) {
    console.error('❌ Auto-comment error:', error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error));
    throw error;
  }
}

export { processAutoComment };
