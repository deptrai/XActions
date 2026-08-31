// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Lists API
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Tweet } from '../models/Tweet.js';
import { Profile } from '../models/Profile.js';
import { ScraperError } from '../errors.js';
import { GRAPHQL_ENDPOINTS, buildGraphQLUrl, DEFAULT_FEATURES } from './graphqlQueries.js';
import { parseTimelineEntries, parseTweetEntry, parseUserEntry, extractCursor } from './parsers.js';

/** @typedef {import('./parsers.js').Raw} Raw */
/** @typedef {import('./parsers.js').HttpClient} HttpClient */

/**
 * Paginate list timeline results.
 * @template T
 * @param {HttpClient} http
 * @param {keyof typeof GRAPHQL_ENDPOINTS} endpoint - GRAPHQL_ENDPOINTS key
 * @param {Record<string, unknown>} variables
 * @param {string} timelinePath - dot-path to timeline
 * @param {(entry: Raw) => T | null} parseEntry - parseTweetEntry or parseUserEntry
 * @param {number} count
 * @returns {AsyncGenerator<T>}
 */
async function* paginateList(http, endpoint, variables, timelinePath, parseEntry, count) {
  let cursor = null;
  let yielded = 0;

  while (yielded < count) {
    const vars = /** @type {Record<string, unknown>} */ ({ ...variables });
    if (cursor) vars.cursor = cursor;

    const ep = GRAPHQL_ENDPOINTS[endpoint];
    if (!ep) throw new ScraperError(`Unknown endpoint: ${endpoint}`, 'INTERNAL_ERROR');

    const url = buildGraphQLUrl(ep, vars, DEFAULT_FEATURES);
    const data = await http.get(url);

    const { entries } = parseTimelineEntries(data, timelinePath);
    if (!entries || entries.length === 0) break;

    let foundItems = false;
    for (const entry of entries) {
      if (entry.entryId?.startsWith('cursor-')) continue;
      const item = parseEntry(entry);
      if (item) {
        yield item;
        yielded++;
        foundItems = true;
        if (yielded >= count) return;
      }
    }

    const nextCursor = extractCursor(entries, 'bottom');
    if (!nextCursor || nextCursor === cursor || !foundItems) break;
    cursor = nextCursor;

    // Rate limit courtesy delay
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
  }
}

/**
 * Get tweets from a list.
 *
 * @deprecated getListTweets — use TwitterCrawler.start({ action: 'list_members', args: { listId } }) instead.
 * @param {HttpClient} http
 * @param {string} listId
 * @param {number} [count=100]
 * @returns {AsyncGenerator<Tweet>}
 */
export async function* getListTweets(http, listId, count = 100) {
  yield* paginateList(
    http,
    'ListLatestTweetsTimeline',
    { listId, count: 20 },
    'data.list.tweets_timeline.timeline',
    parseTweetEntry,
    count,
  );
}

/**
 * Get members of a list.
 *
 * @deprecated getListMembers — use TwitterCrawler.start({ action: 'list_members', args: { listId, limit: count } }) instead.
 * @param {HttpClient} http
 * @param {string} listId
 * @param {number} [count=100]
 * @returns {AsyncGenerator<Profile>}
 */
export async function* getListMembers(http, listId, count = 100) {
  yield* paginateList(
    http,
    'ListMembers',
    { listId, count: 20 },
    'data.list.members_timeline.timeline',
    parseUserEntry,
    count,
  );
}

/**
 * Get list details by ID.
 *
 * @deprecated getListById — use TwitterCrawler.start({ action: 'list_members', args: { listId } }) instead.
 * @param {HttpClient} http
 * @param {string} listId
 * @returns {Promise<{id: string, name: string, description: string, memberCount: number, subscriberCount: number, createdAt: string}|null>}
 */
export async function getListById(http, listId) {
  const ep = GRAPHQL_ENDPOINTS.ListByRestId;
  const url = buildGraphQLUrl(ep, { listId }, DEFAULT_FEATURES);
  const data = await http.get(url);

  const list = /** @type {Raw|undefined} */ (data.data?.list);
  if (!list) return null;

  return {
    id: /** @type {string} */ (list.id_str || listId),
    name: /** @type {string} */ (list.name || ''),
    description: /** @type {string} */ (list.description || ''),
    memberCount: /** @type {number} */ (list.member_count ?? 0),
    subscriberCount: /** @type {number} */ (list.subscriber_count ?? 0),
    createdAt: /** @type {string} */ (list.created_at || ''),
  };
}
