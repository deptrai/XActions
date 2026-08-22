// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getUserTweets,
  searchTweets,
  postComment,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} AutoCommentBrowserConfig
 * @property {string} sessionCookie
 * @property {string} [query]
 * @property {string} [targetUsername]
 * @property {string[]} [comments]
 * @property {string} [comment]
 * @property {number} [maxComments]
 * @property {boolean} [dryRun]
 */

/**
 * Auto-comment on tweets using browser automation
 * @param {string} userId - User ID for the operation
 * @param {AutoCommentBrowserConfig} config - Configuration
 * @param {(message: string) => void} updateProgress - Callback to update job progress
 * @param {() => boolean} [isCancelled] - Function to check if job is cancelled
 * @returns {Promise<Record<string, unknown>>}
 */
async function autoCommentBrowser(userId, config, updateProgress, isCancelled = () => false) {
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
      comments = [],
      comment,
      maxComments = 20,
      dryRun = false,
    } = config;

    const commentList = comments.length > 0 ? comments : (comment ? [comment] : []);
    if (commentList.length === 0) {
      throw new Error('At least one comment text must be provided');
    }

    /** @type {Record<string, unknown>[]} */
    let tweets = [];

    if (targetUsername) {
      updateProgress(`Fetching tweets from @${targetUsername}...`);
      tweets = await getUserTweets(config.sessionCookie, targetUsername, maxComments * 2);
    } else if (query) {
      updateProgress(`Searching for tweets matching "${query}"...`);
      const result = await searchTweets(config.sessionCookie, query, { limit: maxComments * 2 });
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

    updateProgress(`Found ${tweets.length} tweets to comment on`);

    if (tweets.length === 0) {
      return {
        success: true,
        commented: [],
        message: 'No tweets found to comment on',
      };
    }

    /** @type {Record<string, unknown>[]} */
    const commented = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = Math.min(tweets.length, maxComments);

    for (let i = 0; i < limit; i++) {
      if (isCancelled()) {
        updateProgress('Job cancelled by user');
        break;
      }

      const tweet = tweets[i];
      const commentText = commentList[i % commentList.length];

      updateProgress(`Commenting on tweet ${i + 1}/${limit} from @${tweet.username}`);

      const tweetUrl = String(tweet.url || '');
      if (!dryRun && tweetUrl) {
        const result = await postComment(page, tweetUrl, commentText);

        if (result.success) {
          commented.push({
            tweetUrl,
            username: tweet.username,
            tweetText: String(tweet.text || '').substring(0, 100),
            comment: commentText,
          });
        } else {
          failed.push({
            tweetUrl,
            username: tweet.username,
            error: result.error,
          });
        }

        updateProgress('Waiting before next comment (rate limit safety)...');
        await randomDelay(30000, 60000);

        if ((i + 1) % 5 === 0) {
          updateProgress(`Extended pause (${i + 1}/${limit} completed)...`);
          await randomDelay(120000, 180000);
        }
      } else if (dryRun) {
        commented.push({
          tweetUrl,
          username: tweet.username,
          tweetText: String(tweet.text || '').substring(0, 100),
          comment: commentText,
          dryRun: true,
        });
      }
    }

    return {
      success: true,
      commented,
      failed,
      totalProcessed: commented.length + failed.length,
      dryRun,
      cancelled: isCancelled(),
    };
  } finally {
    await page.close();
  }
}

export { autoCommentBrowser };
