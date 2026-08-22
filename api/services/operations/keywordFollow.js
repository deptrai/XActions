// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';

/**
 * @typedef {object} KeywordFollowConfig
 * @property {string[]} [keywords]
 * @property {string} [query]
 * @property {number} [maxFollows]
 * @property {number} [minFollowers]
 * @property {number} [maxFollowers]
 * @property {boolean} [dryRun]
 * @property {string[]} [whitelist]
 */

/**
 * @typedef {object} ProcessKeywordFollowOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {KeywordFollowConfig} config
 */

/**
 * Follow users who tweet about specific keywords/hashtags
 * Uses Twitter API when OAuth tokens available
 *
 * @param {ProcessKeywordFollowOptions} options
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Record<string, unknown>>}
 */
async function processKeywordFollow({ operationId, userId, config }, isCancelled = () => false) {
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
      keywords = [],
      query,
      maxFollows = 50,
      minFollowers = 0,
      maxFollowers,
      dryRun = false,
      whitelist = []
    } = config;

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    const searchQuery = query || keywords.map(/** @param {string} k */ (k) =>
      k.startsWith('#') ? k : `#${k}`
    ).join(' OR ');

    if (!searchQuery) {
      throw new Error('Either keywords or query must be provided');
    }

    const searchResponse = await client.get('/tweets/search/recent', {
      params: {
        query: searchQuery,
        max_results: 100,
        'tweet.fields': 'author_id,created_at',
        expansions: 'author_id',
        'user.fields': 'username,public_metrics'
      }
    });
    const searchData = /** @type {TwitterApiEnvelope} */ (searchResponse.data);
    /** @type {TwitterApiTweet[]} */
    const tweets = /** @type {TwitterApiTweet[]} */ (searchData.data || []);
    /** @type {TwitterApiUser[]} */
    const users = /** @type {TwitterApiUser[]} */ (searchData.includes?.users || []);

    const userMap = new Map(users.map(/** @param {TwitterApiUser} u */ (u) => [String(u.id), u]));

    /** @type {TwitterApiUser[]} */
    const uniqueAuthors = [];
    const seenAuthors = new Set();

    for (const tweet of tweets) {
      const authorId = tweet.author_id;
      if (!authorId) continue;
      const author = userMap.get(authorId);
      if (author && !seenAuthors.has(author.id)) {
        seenAuthors.add(author.id);

        const followers = author.public_metrics?.followers_count || 0;
        if (followers >= minFollowers) {
          if (!maxFollowers || followers <= maxFollowers) {
            uniqueAuthors.push(author);
          }
        }
      }
    }

    const whitelistLower = whitelist.map(/** @param {string} u */ (u) => u.toLowerCase());
    const filteredAuthors = uniqueAuthors.filter(/** @param {TwitterApiUser} a */ (a) =>
      a.username ? !whitelistLower.includes(a.username.toLowerCase()) : true
    );

    let followedCount = 0;
    const followedUsers = [];
    const errors = [];

    for (const author of filteredAuthors) {
      if (isCancelled()) {
        console.log(`🛑 Job ${operationId} cancelled`);
        break;
      }

      if (followedCount >= maxFollows) break;

      try {
        if (!dryRun) {
          await client.post(`/users/${myTwitterId}/following`, {
            target_user_id: author.id
          });
          followedCount++;

          followedUsers.push({
            id: author.id,
            username: author.username,
            followers: author.public_metrics?.followers_count
          });

          await new Promise(resolve =>
            setTimeout(resolve, 2000 + Math.random() * 2000)
          );
        } else {
          followedUsers.push({
            id: author.id,
            username: author.username,
            followers: author.public_metrics?.followers_count,
            dryRun: true
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already')) {
          followedUsers.push({
            id: author.id,
            username: author.username,
            alreadyFollowing: true
          });
        } else {
          errors.push({
            username: author.username,
            error: message
          });
        }
      }
    }

    return {
      success: true,
      followedCount: dryRun ? 0 : followedCount,
      totalAuthorsFound: uniqueAuthors.length,
      followedUsers: followedUsers.slice(0, 50),
      errors: errors.slice(0, 10),
      searchQuery,
      dryRun,
      cancelled: isCancelled()
    };
  } catch (error) {
    console.error('❌ Keyword follow error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processKeywordFollow };
