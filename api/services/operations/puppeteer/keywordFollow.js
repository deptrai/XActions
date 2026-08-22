// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  searchTweets,
  followUser,
  randomDelay,
} from '../../browserAutomation.js';

/**
 * @typedef {object} KeywordFollowBrowserConfig
 * @property {string} sessionCookie
 * @property {string[]} [keywords]
 * @property {string} [query]
 * @property {number} [maxFollows]
 * @property {boolean} [dryRun]
 * @property {string[]} [whitelist]
 */

/**
 * Follow users who tweet about specific keywords using browser automation
 * @param {string} userId - User ID for the operation
 * @param {KeywordFollowBrowserConfig} config - Configuration
 * @param {(message: string) => void} updateProgress - Callback to update job progress
 * @param {() => boolean} [isCancelled] - Function to check if job is cancelled
 * @returns {Promise<Record<string, unknown>>}
 */
async function keywordFollowBrowser(userId, config, updateProgress, isCancelled = () => false) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    const {
      keywords = [],
      query,
      maxFollows = 50,
      dryRun = false,
      whitelist = [],
    } = config;

    const searchQuery = query || keywords.map((k) => (k.startsWith('#') ? k : k)).join(' OR ');

    if (!searchQuery) {
      throw new Error('Either keywords or query must be provided');
    }

    updateProgress(`Searching for tweets matching "${searchQuery}"...`);
    const result = await searchTweets(config.sessionCookie, searchQuery, { limit: maxFollows * 3 });
    const items = /** @type {Record<string, unknown>[]} */ (result.items || []);
    const tweets = items.map((t) => {
      const author = /** @type {Record<string, unknown>} */ (t.author || {});
      return {
        id: String(t.id || ''),
        text: String(t.text || ''),
        url: String(t.url || ''),
        username: String(author.username || ''),
      };
    });

    updateProgress(`Found ${tweets.length} tweets, extracting unique authors...`);

    /** @type {Record<string, unknown>[]} */
    const uniqueAuthors = [];
    const seenAuthors = new Set();

    for (const tweet of tweets) {
      const username = String(tweet.username || '');
      if (username && !seenAuthors.has(username.toLowerCase())) {
        seenAuthors.add(username.toLowerCase());
        uniqueAuthors.push({
          username,
          tweetText: String(tweet.text || '').substring(0, 100),
        });
      }
    }

    const whitelistLower = whitelist.map((u) => u.toLowerCase());
    const filteredAuthors = uniqueAuthors.filter((a) =>
      !whitelistLower.includes(String(a.username || '').toLowerCase())
    );

    updateProgress(`Found ${filteredAuthors.length} unique authors to potentially follow`);

    if (filteredAuthors.length === 0) {
      return {
        success: true,
        followed: [],
        message: 'No authors found for the given keywords',
      };
    }

    /** @type {Record<string, unknown>[]} */
    const followed = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    const limit = Math.min(filteredAuthors.length, maxFollows);

    for (let i = 0; i < limit; i++) {
      if (isCancelled()) {
        updateProgress('Job cancelled by user');
        break;
      }

      const author = filteredAuthors[i];
      const username = String(author.username || '');

      updateProgress(`Following @${username} (${i + 1}/${limit})`);

      if (!dryRun) {
        const result = await followUser(page, username);

        if (result.success) {
          followed.push({
            username,
            alreadyFollowing: result.alreadyFollowing || false,
            matchedTweet: author.tweetText,
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
          matchedTweet: author.tweetText,
          dryRun: true,
        });
      }
    }

    return {
      success: true,
      followed,
      failed,
      searchQuery,
      totalAuthorsFound: uniqueAuthors.length,
      totalProcessed: followed.length + failed.length,
      dryRun,
      cancelled: isCancelled(),
    };
  } finally {
    await page.close();
  }
}

export { keywordFollowBrowser };
