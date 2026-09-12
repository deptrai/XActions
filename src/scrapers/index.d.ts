import type { Browser, Page } from 'puppeteer';

declare class FacebookClient {
  constructor(deps?: Record<string, unknown>);
  request(method: string, url: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  ensureTokens(accountId?: string | null, cookies?: string | Record<string, string>, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  requestGraphQl(docId: string, variables?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  clearTokenCache(): void;
  close(): Promise<void>;
}

declare class FacebookCrawler {
  client: FacebookClient;
  constructor(deps?: Record<string, unknown>);
  start(command: { action: string; args?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  init(): Promise<void>;
  cleanup(): Promise<void>;
  search(args: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  listActions(): Array<{ action: string; [key: string]: unknown }>;
  registerAction(action: string | Record<string, unknown>, handler?: unknown, descriptor?: Record<string, unknown>): void;
}

declare class FacebookActions {
  constructor(deps?: Record<string, unknown>);
  like(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  comment(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  post(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  share(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  messengerShare(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  shareLinkByUid(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  joinGroup(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  sendFriendRequest(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
}

export function createFacebookClient(browserOptions?: Record<string, unknown>): FacebookClient;
export function createFacebookCrawler(client: FacebookClient, browserOptions?: Record<string, unknown>): FacebookCrawler;
export function dispatchFacebookHybrid(action: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;

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

// ── Platform Registry (Story 25.1) ──────────────────────────────────────────
export const platforms: Record<string, Record<string, unknown>>;
export function getPlatform(platform: string): Record<string, unknown>;

// ── Crawler/Client Factories (Story 25.1) ───────────────────────────────────
declare class BlueskyClient { constructor(options?: Record<string, unknown>); }
declare class BlueskyCrawler { constructor(deps?: Record<string, unknown>); }
export function createBlueskyClient(options?: Record<string, unknown>): BlueskyClient;
export function createBlueskyCrawler(client: BlueskyClient, options?: Record<string, unknown>): BlueskyCrawler;

declare class MastodonClient { constructor(options?: Record<string, unknown>); }
declare class MastodonCrawler { constructor(deps?: Record<string, unknown>); }
export function createMastodonClient(options?: Record<string, unknown>): MastodonClient;
export function createMastodonCrawler(client: MastodonClient, options?: Record<string, unknown>): MastodonCrawler;

declare class MaSoThueClient { constructor(options?: Record<string, unknown>); }
declare class MaSoThueCrawler { constructor(deps?: Record<string, unknown>); }
export function createMaSoThueClient(options?: Record<string, unknown>): MaSoThueClient;
export function createMaSoThueCrawler(client: MaSoThueClient, options?: Record<string, unknown>): MaSoThueCrawler;

declare class AutomotiveClient { constructor(options?: Record<string, unknown>); }
declare class AutomotiveCrawler { constructor(deps?: Record<string, unknown>); }
export function createAutomotiveClient(options?: Record<string, unknown>): AutomotiveClient;
export function createAutomotiveCrawler(client: AutomotiveClient, options?: Record<string, unknown>): AutomotiveCrawler;

declare class B2BRegistryExtendedClient { constructor(options?: Record<string, unknown>); }
declare class B2BRegistryExtendedCrawler { constructor(deps?: Record<string, unknown>); }
export function createB2BRegistryExtendedClient(options?: Record<string, unknown>): B2BRegistryExtendedClient;
export function createB2BRegistryExtendedCrawler(client: B2BRegistryExtendedClient, options?: Record<string, unknown>): B2BRegistryExtendedCrawler;

declare class RedditClient { constructor(options?: Record<string, unknown>); }
declare class RedditCrawler { constructor(deps?: Record<string, unknown>); }
export function createRedditClient(options?: Record<string, unknown>): RedditClient;
export function createRedditCrawler(clientOrDeps: RedditClient | Record<string, unknown>, options?: Record<string, unknown>): RedditCrawler;

declare class MediumClient { constructor(options?: Record<string, unknown>); }
declare class MediumCrawler { constructor(deps?: Record<string, unknown>); }
export function createMediumClient(options?: Record<string, unknown>): MediumClient;
export function createMediumCrawler(clientOrDeps: MediumClient | Record<string, unknown>, options?: Record<string, unknown>): MediumCrawler;
