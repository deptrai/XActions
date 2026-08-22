// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getTweetEngagers,
  followUser,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} FollowEngagersBrowserConfig
 * @property {string} sessionCookie
 * @property {string} tweetUrl
 * @property {'likes' | 'retweets'} [engagementType]
 * @property {number} [maxFollows]
 * @property {boolean} [dryRun]
 * @property {string[]} [whitelist]
 */

/**
 * Follow users who engaged with specific tweets using browser automation
 * @param {string} userId - User ID for the operation
 * @param {FollowEngagersBrowserConfig} config - Configuration
 * @param {(message: string) => void} updateProgress - Callback to update job progress
 * @param {() => boolean} [isCancelled] - Function to check if job is cancelled
 * @returns {Promise<Record<string, unknown>>}
 */
async function followEngagersBrowser(userId, config, updateProgress, isCancelled = () => false) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    const {
      tweetUrl,
      engagementType = 'likes',
      maxFollows = 50,
      dryRun = false,
      whitelist = [],
    } = config;

    if (!tweetUrl) {
      throw new Error('tweetUrl must be provided');
    }

    updateProgress(`Fetching ${engagementType} from tweet...`);
    const engagers = await getTweetEngagers(
      config.sessionCookie,
      tweetUrl,
      engagementType,
      maxFollows * 2
    );

    updateProgress(`Found ${engagers.length} users who ${engagementType === 'likes' ? 'liked' : 'retweeted'} the tweet`);

    if (engagers.length === 0) {
      return {
        success: true,
        followed: [],
        message: 'No engagers found for this tweet',
      };
    }

    const whitelistLower = whitelist.map((u) => u.toLowerCase());
    const filteredEngagers = engagers.filter((e) =>
      !whitelistLower.includes(String(e.username || '').toLowerCase())
    );

    /** @type {Record<string, unknown>[]} */
    const followed = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = Math.min(filteredEngagers.length, maxFollows);

    for (let i = 0; i < limit; i++) {
      if (isCancelled()) {
        updateProgress('Job cancelled by user');
        break;
      }

      const user = filteredEngagers[i];
      const username = String(user.username || '');

      updateProgress(`Following @${username} (${i + 1}/${limit})`);

      if (!dryRun) {
        const result = await followUser(page, username);

        if (result.success) {
          followed.push({
            username,
            displayName: user.displayName,
            alreadyFollowing: result.alreadyFollowing || false,
          });
        } else {
          failed.push({
            username,
            error: result.error,
          });
        }

        await randomDelay(3000, 6000);

        if ((i + 1) % 10 === 0) {
          updateProgress(`Pausing for safety (${i + 1}/${limit} completed)...`);
          await randomDelay(15000, 30000);
        }

        if ((i + 1) % 30 === 0) {
          updateProgress(`Extended pause (${i + 1}/${limit} completed)...`);
          await randomDelay(60000, 90000);
        }
      } else {
        followed.push({
          username,
          displayName: user.displayName,
          dryRun: true,
        });
      }
    }

    return {
      success: true,
      followed,
      failed,
      totalEngagers: engagers.length,
      totalProcessed: followed.length + failed.length,
      dryRun,
      cancelled: isCancelled(),
    };
  } finally {
    await page.close();
  }
}

export { followEngagersBrowser };
