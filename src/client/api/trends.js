// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Trends API
 *
 * Fetch trending topics and explore tabs via Twitter's internal REST endpoint.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { GRAPHQL_ENDPOINTS, buildGraphQLUrl } from './graphqlQueries.js';

/** @typedef {import('./parsers.js').Raw} Raw */
/** @typedef {import('./parsers.js').HttpClient} HttpClient */

/**
 * Category to guide.json parameters mapping.
 * @private
 */
const CATEGORY_PARAMS = /** @type {Record<string, {include_page_configuration: boolean, initial_tab_id: string}>} */ ({
  trending: { include_page_configuration: true, initial_tab_id: 'trending' },
  for_you: { include_page_configuration: true, initial_tab_id: 'for_you' },
  news: { include_page_configuration: true, initial_tab_id: 'news' },
  sports: { include_page_configuration: true, initial_tab_id: 'sports' },
  entertainment: { include_page_configuration: true, initial_tab_id: 'entertainment' },
});

/**
 * Get trending topics.
 *
 * @param {HttpClient} http - HTTP client with get/post methods
 * @param {string} [category='trending'] - Category: 'trending', 'for_you', 'news', 'sports', 'entertainment'
 * @returns {Promise<Array<{name: string, tweetCount: string, url: string, context: string}>>}
 */
export async function getTrends(http, category = 'trending') {
  const endpoint = GRAPHQL_ENDPOINTS.Trends;
  const baseUrl = buildGraphQLUrl(endpoint);

  const params = /** @type {Record<string, string | boolean | number>} */ (CATEGORY_PARAMS[category] || CATEGORY_PARAMS.trending);
  const url = `${baseUrl}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;

  const data = await http.get(url);

  /** @type {Array<{name: string, tweetCount: string, url: string, context: string}>} */
  const trends = [];
  const timeline = /** @type {Raw|undefined} */ (data.timeline);
  if (!timeline) return trends;

  for (const instruction of /** @type {Raw[]} */ (timeline.instructions || [])) {
    const addEntries = /** @type {Raw|undefined} */ (instruction.addEntries);
    const entries = /** @type {Raw[]} */ (addEntries?.entries || []);
    for (const entry of entries) {
      const timelineModule = /** @type {Raw|undefined} */ (entry?.content?.timelineModule);
      const items = /** @type {Raw[]} */ (timelineModule?.items || []);
      for (const item of items) {
        const trend = /** @type {Raw|undefined} */ (item?.item?.content?.trend);
        if (trend) {
          const trendMetadata = /** @type {Raw|undefined} */ (trend.trendMetadata);
          const urlObj = /** @type {Raw|undefined} */ (trend.url);
          trends.push({
            name: /** @type {string} */ (trend.name || ''),
            tweetCount: /** @type {string} */ (trendMetadata?.metaDescription || ''),
            url: /** @type {string} */ (urlObj?.url || ''),
            context: /** @type {string} */ (trendMetadata?.domainContext || ''),
          });
        }
      }
    }
  }

  return trends;
}

/**
 * Get available explore tabs.
 *
 * @param {HttpClient} http - HTTP client with get/post methods
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
export async function getExploreTabs(http) {
  const endpoint = GRAPHQL_ENDPOINTS.Trends;
  const url = `${buildGraphQLUrl(endpoint)}?include_page_configuration=true`;

  const data = await http.get(url);

  /** @type {Array<{id: string, label: string}>} */
  const tabs = [];
  const timeline = /** @type {Raw|undefined} */ (data.timeline);
  const header = /** @type {Raw|undefined} */ (timeline?.instructions?.find(
    (/** @type {Raw} */ i) => i.type === 'TimelineAddEntries' || i.addEntries,
  ));

  const pageConfig = /** @type {Raw|undefined} */ (data.header)?.displayTreatment;
  if (pageConfig) {
    // Parse from page configuration if available
    return [{ id: 'trending', label: 'Trending' }];
  }

  // Try to extract tab configuration from the response
  const tabEntries = /** @type {Raw[]} */ (data.explore_tabs || data.tabs || []);
  for (const tab of tabEntries) {
    tabs.push({
      id: /** @type {string} */ (tab.id || tab.tab_id || ''),
      label: /** @type {string} */ (tab.label || tab.name || ''),
    });
  }

  // Fallback: return known default tabs
  if (tabs.length === 0) {
    return [
      { id: 'for_you', label: 'For You' },
      { id: 'trending', label: 'Trending' },
      { id: 'news', label: 'News' },
      { id: 'sports', label: 'Sports' },
      { id: 'entertainment', label: 'Entertainment' },
    ];
  }

  return tabs;
}
