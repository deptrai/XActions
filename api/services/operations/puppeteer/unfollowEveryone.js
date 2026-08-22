// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getFollowing,
  unfollowUser,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} UnfollowEveryoneBrowserConfig
 * @property {string} sessionCookie
 * @property {string} username
 * @property {number} [maxUsers]
 * @property {number} [limit]
 */

/**
 * @param {string} userId
 * @param {UnfollowEveryoneBrowserConfig} config
 * @param {(message: string) => void} updateProgress
 * @returns {Promise<Record<string, unknown>>}
 */
async function unfollowEveryoneBrowser(userId, config, updateProgress) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    const maxUsers = config.maxUsers || 5000;

    updateProgress('Fetching your following list...');
    const following = await getFollowing(config.sessionCookie, config.username, maxUsers);

    updateProgress(`Found ${following.length} accounts to unfollow`);

    if (following.length === 0) {
      return {
        success: true,
        unfollowed: [],
        message: 'You are not following anyone!',
      };
    }

    /** @type {string[]} */
    const unfollowed = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = config.limit || following.length;
    const total = Math.min(following.length, limit);

    for (let i = 0; i < total; i++) {
      const user = following[i];
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

      if ((i + 1) % 50 === 0) {
        updateProgress(`Extended pause (${i + 1}/${total} completed)...`);
        await randomDelay(60000, 120000);
      }
    }

    return {
      success: true,
      unfollowed,
      failed,
      totalProcessed: unfollowed.length + failed.length,
    };
  } finally {
    await page.close();
  }
}

export { unfollowEveryoneBrowser };
