import type { Browser, Page } from 'puppeteer';

export function createBrowser(
  options?: Record<string, unknown> & { adapter?: string | 'puppeteer' | 'playwright' }
): Promise<Browser>;

export function createPage(browser: Browser, options?: Record<string, unknown>): Promise<Page>;

export function loginWithCookie(page: Page, authToken: string): Promise<Page>;

export function scrapeProfile(
  page: Page,
  username: string
): Promise<Record<string, unknown>>;

export function scrapeFollowers(
  page: Page,
  username: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeFollowing(
  page: Page,
  username: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeTweets(
  page: Page,
  username: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function searchTweets(
  page: Page,
  query: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeThread(
  page: Page,
  tweetUrl: string
): Promise<Record<string, unknown>>;

export function scrapeLikes(
  page: Page,
  tweetUrl: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeHashtag(
  page: Page,
  hashtag: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeMedia(
  page: Page,
  username: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeListMembers(
  page: Page,
  listUrl: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeBookmarks(
  page: Page,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeNotifications(
  page: Page,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeTrending(
  page: Page,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeCommunityMembers(
  page: Page,
  communityUrl: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function scrapeSpaces(
  page: Page,
  query: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>[]>;

export function exportToJSON(data: unknown, filename: string): Promise<string>;

export function exportToCSV(data: unknown, filename: string): Promise<string>;

export function scrape(
  platform: string,
  action: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown> | Record<string, unknown>[]>;

declare const _default: Record<string, (...args: unknown[]) => unknown>;
export default _default;
