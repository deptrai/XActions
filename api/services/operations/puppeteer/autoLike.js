// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getUserTweets,
  searchTweets,
  likePost,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} AutoLikeBrowserConfig
 * @property {string} sessionCookie
 * @property {string} [query]
 * @property {string} [targetUsername]
 * @property {number} [maxLikes]
 * @property {boolean} [dryRun]
 */

/**
 * Auto-like tweets using browser automation
 * @param {string} userId - User ID for the operation
 * @param {AutoLikeBrowserConfig} config - Configuration
 * @param {(message: string) => void} updateProgress - Callback to update job progress
 * @param {() => boolean} [isCancelled] - Function to check if job is cancelled
 * @returns {Promise<Record<string, unknown>>}
 */
async function autoLikeBrowser(userId, config, updateProgress, isCancelled = () => false) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    const {
      query,
      targetUsername,
      maxLikes = 50,
      dryRun = false,
    } = config;

    /** @type {Record<string, unknown>[]} */
    let tweets = [];

    if (targetUsername) {
      updateProgress(`Fetching tweets from @${targetUsername}...`);
      tweets = await getUserTweets(config.sessionCookie, targetUsername, maxLikes);
    } else if (query) {
      updateProgress(`Searching for tweets matching "${query}"...`);
      const result = await searchTweets(config.sessionCookie, query, { limit: maxLikes });
      const items = /** @type {Record<string, unknown>[]} */ (result.items || []);
      tweets = items.map((t) => {
        const author = /** @type {Record<string, unknown>} */ (t.author || {});
        return {
          id: String(t.id || ''),
          text: String(t.text || ''),
          url: String(t.url || ''),
          username: String(author.username || ''),
        };
      });
    } else {
      throw new Error('Either query or targetUsername must be provided');
    }

    updateProgress(`Found ${tweets.length} tweets to like`);

    if (tweets.length === 0) {
      return {
        success: true,
        liked: [],
        message: 'No tweets found to like',
      };
    }

    /** @type {Record<string, unknown>[]} */
    const liked = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = Math.min(tweets.length, maxLikes);

    for (let i = 0; i < limit; i++) {
      if (isCancelled()) {
        updateProgress('Job cancelled by user');
        break;
      }

      const tweet = tweets[i];

      updateProgress(`Liking tweet ${i + 1}/${limit} from @${tweet.username}`);

      const tweetUrl = String(tweet.url || '');
      if (!dryRun && tweetUrl) {
        const result = await likePost(page, tweetUrl);

        if (result.success) {
          liked.push({
            url: tweetUrl,
            username: tweet.username,
            alreadyLiked: result.alreadyLiked || false,
          });
        } else {
          failed.push({
            url: tweetUrl,
            username: tweet.username,
            error: result.error,
          });
        }

        await randomDelay(2000, 5000);

        if ((i + 1) % 10 === 0) {
          updateProgress(`Pausing for safety (${i + 1}/${limit} completed)...`);
          await randomDelay(10000, 20000);
        }
      } else if (dryRun) {
        liked.push({
          url: tweetUrl,
          username: tweet.username,
          dryRun: true,
        });
      }
    }

    return {
      success: true,
      liked,
      failed,
      totalProcessed: liked.length + failed.length,
      dryRun,
      cancelled: isCancelled(),
    };
  } finally {
    await page.close();
  }
}

export { autoLikeBrowser };
