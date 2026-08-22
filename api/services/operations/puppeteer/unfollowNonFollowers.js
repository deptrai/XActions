// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getFollowing,
  getFollowers,
  unfollowUser,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} UnfollowNonFollowersBrowserConfig
 * @property {string} sessionCookie
 * @property {string} username
 * @property {number} [maxUsers]
 * @property {number} [limit]
 */

/**
 * @param {string} userId
 * @param {UnfollowNonFollowersBrowserConfig} config
 * @param {(message: string) => void} updateProgress
 * @returns {Promise<Record<string, unknown>>}
 */
async function unfollowNonFollowersBrowser(userId, config, updateProgress) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    const maxUsers = config.maxUsers || 1000;

    updateProgress('Fetching your following list...');
    const following = await getFollowing(config.sessionCookie, config.username, maxUsers);

    updateProgress(`Found ${following.length} accounts you follow`);

    updateProgress('Fetching your followers list...');
    const followers = await getFollowers(config.sessionCookie, config.username, maxUsers);

    updateProgress(`Found ${followers.length} followers`);

    const followerUsernames = new Set(followers.map((f) => String(f.username || '')));
    const nonFollowers = following.filter((f) => !followerUsernames.has(String(f.username || '')));

    updateProgress(`Identified ${nonFollowers.length} accounts that don't follow you back`);

    if (nonFollowers.length === 0) {
      return {
        success: true,
        unfollowed: [],
        message: 'Everyone you follow also follows you back!',
      };
    }

    /** @type {string[]} */
    const unfollowed = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = config.limit || nonFollowers.length;
    const total = Math.min(nonFollowers.length, limit);

    for (let i = 0; i < total; i++) {
      const user = nonFollowers[i];
      const username = String(user.username || '');

      updateProgress(`Unfollowing ${username} (${i + 1}/${total})`);

      const result = await unfollowUser(page, username);

      if (result.success) {
        unfollowed.push(username);
      } else {
        failed.push({ username, error: result.error });
      }

      await randomDelay(3000, 7000);

      if ((i + 1) % 10 === 0) {
        updateProgress(`Pausing for safety (${i + 1}/${total} completed)...`);
        await randomDelay(15000, 30000);
      }
    }

    return {
      success: true,
      unfollowed,
      failed,
      nonFollowers: nonFollowers.map((u) => u.username),
      totalProcessed: unfollowed.length + failed.length,
    };
  } finally {
    await page.close();
  }
}

export { unfollowNonFollowersBrowser };
