// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getFollowing,
  getFollowers,
} from '../../browserAutomation.js';

/**
 * @typedef {object} DetectUnfollowersBrowserConfig
 * @property {string} sessionCookie
 * @property {string} username
 * @property {number} [maxUsers]
 */

/**
 * @param {string} userId
 * @param {DetectUnfollowersBrowserConfig} config
 * @param {(message: string) => void} updateProgress
 * @returns {Promise<Record<string, unknown>>}
 */
async function detectUnfollowersBrowser(userId, config, updateProgress) {
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

    updateProgress('Analysis complete!');

    return {
      success: true,
      nonFollowers: nonFollowers.map((u) => ({
        username: u.username,
        displayName: u.displayName,
      })),
      stats: {
        following: following.length,
        followers: followers.length,
        nonFollowers: nonFollowers.length,
        followBackRatio: ((followers.length / following.length) * 100).toFixed(1) + '%',
      },
    };
  } finally {
    await page.close();
  }
}

export { detectUnfollowersBrowser };
