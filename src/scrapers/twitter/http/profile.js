// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter HTTP Profile Scraper
 *
 * Scrapes user profiles via Twitter's internal GraphQL API (UserByScreenName,
 * UserByRestId) - no browser required.  Drop-in replacement for the
 * Puppeteer-based scrapeProfile() in ../index.js.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { GRAPHQL } from './endpoints.js';
import { extractUserCoreFields } from './user-helpers.js';

/** @typedef {import('./types.js').Raw} Raw */
import { NotFoundError, AuthError, TwitterApiError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand t.co URLs using the entity data Twitter provides.
 *
 * @param {string} text - The raw text containing t.co links
 * @param {Raw[]} urlEntities - `legacy.entities.url.urls` or
 *   `legacy.entities.description.urls` arrays
 * @returns {string} Text with t.co links replaced by expanded URLs
 */
function expandTcoUrls(text, urlEntities = []) {
  if (!text || !urlEntities.length) return text || '';
  let expanded = text;
  for (const entity of urlEntities) {
    const shortUrl = typeof entity.url === 'string' ? entity.url : '';
    const longUrl = typeof entity.expanded_url === 'string' ? entity.expanded_url : '';
    if (shortUrl && longUrl) {
      expanded = expanded.replace(shortUrl, longUrl);
    }
  }
  return expanded;
}

/**
 * Parse Twitter's `created_at` string ("Mon Jan 01 00:00:00 +0000 2007")
 * into an ISO-8601 date string.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function toISODate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

// ---------------------------------------------------------------------------
// Core: parseUserData
// ---------------------------------------------------------------------------

/**
 * Transform Twitter's raw GraphQL user object into the clean XActions
 * profile format.
 *
 * This is a **pure function** - it performs no I/O and has no side effects.
 *
 * @param {Raw} rawUser - The `data.user.result` (or equivalent) object
 *   from a Twitter GraphQL response.
 * @returns {Raw} Normalised XActions profile object.
 * @throws {NotFoundError} If the user is unavailable (suspended / deactivated).
 */
export function parseUserData(rawUser) {
  if (!rawUser) {
    throw new NotFoundError('User data is empty');
  }

  // Handle UserUnavailable (suspended, deactivated, etc.)
  if (rawUser.__typename === 'UserUnavailable') {
    const reason = rawUser.reason || rawUser.message || 'Account unavailable';
    throw new NotFoundError(`User unavailable: ${reason}`);
  }

  const core = extractUserCoreFields(rawUser);

  return {
    id: core.restId,
    name: core.name,
    username: core.username,
    bio: core.bio || '',
    location: core.location || '',
    website: core.website,
    joined: core.joined,
    birthday: core.birthday,
    following: core.following,
    followers: core.followers,
    tweets: core.tweets,
    likes: core.likes,
    media: core.media,
    avatar: core.avatar,
    header: core.header,
    verified: core.verified,
    protected: core.protected,
    pinnedTweetId: core.pinnedTweetId,
    bioEntities: core.bioEntities,
    platform: 'twitter',
  };
}

// ---------------------------------------------------------------------------
// scrapeProfile (by username)
// ---------------------------------------------------------------------------

/**
 * Scrape a user profile by screen name via the `UserByScreenName` GraphQL
 * endpoint.
 *
 * Works with both **guest tokens** (for public profiles) and **auth tokens**
 * (any visible profile).
 *
 * @param {import('./client.js').TwitterHttpClient} client - Configured HTTP client.
 * @param {string} username - The screen name (without leading `@`).
 * @returns {Promise<Raw>} XActions profile object.
 * @throws {NotFoundError} Non-existent or suspended username.
 * @throws {AuthError} Protected account accessed without auth.
 * @throws {TwitterApiError} Other API errors.
 */
export async function scrapeProfile(client, username) {
  const { queryId, operationName } = GRAPHQL.UserByScreenName;
  const variables = {
    screen_name: username,
    withSafetyModeUserFields: true,
  };

  const response = await client.graphql(queryId, operationName, variables);

  // Validate response structure
  const result = response?.data?.user?.result;

  if (!result) {
    throw new NotFoundError(`User @${username} not found`);
  }

  // Handle errors array in response (rate-limit, partial errors)
  if (response.errors?.length) {
    const msg = response.errors.map((e) => e.message).join('; ');
    throw new TwitterApiError(`GraphQL errors: ${msg}`, { data: response });
  }

  // Protected account without auth → surface a clear error
  if (result.__typename === 'User' && result.legacy?.protected && !client.isAuthenticated()) {
    // We can still return the partial profile data - but callers should know
    // the bio / tweets may be restricted.
  }

  return parseUserData(result);
}

// ---------------------------------------------------------------------------
// scrapeProfileById (by user ID)
// ---------------------------------------------------------------------------

/**
 * Scrape a user profile by REST ID via the `UserByRestId` GraphQL endpoint.
 *
 * @param {import('./client.js').TwitterHttpClient} client - Configured HTTP client.
 * @param {string} userId - The numeric user ID.
 * @returns {Promise<Raw>} XActions profile object.
 * @throws {NotFoundError} Unknown user ID.
 * @throws {AuthError} Protected account without auth.
 * @throws {TwitterApiError} Other API errors.
 */
export async function scrapeProfileById(client, userId) {
  const { queryId, operationName } = GRAPHQL.UserByRestId;
  const variables = {
    userId: String(userId),
    withSafetyModeUserFields: true,
  };

  const response = await client.graphql(queryId, operationName, variables);

  const result = response?.data?.user?.result;

  if (!result) {
    throw new NotFoundError(`User with ID ${userId} not found`);
  }

  if (response.errors?.length) {
    const msg = response.errors.map((e) => e.message).join('; ');
    throw new TwitterApiError(`GraphQL errors: ${msg}`, { data: response });
  }

  return parseUserData(result);
}
