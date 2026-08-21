/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface Window {
  webkitRTCPeerConnection?: unknown;
}

/**
 * Shared, broad options bag used across the Facebook modules.
 * Per-function JSDoc @typedef overrides can add stricter properties.
 */
interface FacebookOptions {
  [key: string]: unknown;

  accountAgeDays?: number;
  action?: string;
  allowReactions?: boolean;
  args?: string[];
  authCookie?: FacebookLoginCookieOptions | string;
  batchFn?: (...args: unknown[]) => unknown;
  cancelFn?: (...args: unknown[]) => unknown;
  category?: string;
  content?: string;
  commentFn?: (...args: unknown[]) => unknown;
  composeFn?: (...args: unknown[]) => unknown;
  contentItem?: Record<string, unknown>;
  createOperation?: (...args: unknown[]) => Promise<Record<string, unknown>>;
  createPostFn?: (...args: unknown[]) => unknown;
  db?: Record<string, unknown> & { getAccountCreatedAt?: (...args: unknown[]) => Promise<Date | number | string | null | undefined> };
  delay?: (min?: number, max?: number) => Promise<void>;
  delayBetween?: number;
  delayFn?: ((ms: number) => Promise<void>) | ((min?: number, max?: number) => Promise<void>);
  delayMax?: number;
  delayMaxOpt?: number;
  delayMin?: number;
  delayMinOpt?: number;
  docId?: string;
  dryRun?: boolean;
  durationSeconds?: number;
  executablePath?: string;
  extraArgs?: string[];
  facebookAccountId?: string;
  fallbackExtractor?: (...args: unknown[]) => unknown;
  fetchImpl?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>;
  fingerprint?: Record<string, unknown>;
  force?: boolean;
  graphVersion?: string;
  groupUrls?: string[];
  headless?: boolean | 'shell' | 'new';
  includeReplies?: boolean;
  joinFn?: (...args: unknown[]) => unknown;
  keyword?: string;
  launchImpl?: (...args: unknown[]) => Promise<import('puppeteer').Browser>;
  likeFn?: (...args: unknown[]) => unknown;
  limit?: number;
  location?: Record<string, unknown> | string;
  maxBatch?: number;
  maxPrice?: number;
  maxRetries?: number;
  maxRetry?: number;
  maxScrolls?: number;
  maxStalls?: number;
  mediaUrls?: string[];
  mediaUrlsNote?: string;
  minPrice?: number;
  mode?: string;
  now?: () => number;
  nowFn?: () => number;
  olderThanDays?: number;
  onProgress?: (...args: unknown[]) => unknown;
  parallel?: boolean;
  postFn?: (...args: unknown[]) => unknown;
  previewContent?: Record<string, unknown>;
  proxy?: string;
  proxyAuth?: { username?: string; password?: string } | Record<string, unknown>;
  proxyLocation?: Record<string, unknown>;
  query?: string;
  randomDelay?: (min?: number, max?: number) => Promise<void>;
  rawReactProbability?: number;
  reactFn?: (...args: unknown[]) => unknown;
  reactProbability?: number;
  recipientUid?: string;
  requestFn?: (...args: unknown[]) => unknown;
  rng?: () => number;
  scheduledAt?: string;
  searchFn?: (...args: unknown[]) => unknown;
  searchFnOpt?: (...args: unknown[]) => unknown;
  segmentPicker?: (...args: unknown[]) => unknown;
  selectorTimeout?: number;
  sendMessageFn?: (page: import('puppeteer').Page, recipientName: string, message: string, options?: FacebookOptions) => Promise<{ ok: boolean; error?: string; sentVia?: string }>;
  shareFn?: (...args: unknown[]) => unknown;
  shouldStop?: (...args: unknown[]) => boolean;
  skipWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  startX?: number;
  startY?: number;
  stripEmoji?: boolean;
  targetUrl?: string;
  targets?: unknown[];
  type?: string;
  updateOperation?: (...args: unknown[]) => Promise<void>;
  useMbasic?: boolean;
  userDataDir?: string;
  userId?: string;
  value?: unknown;
}

/**
 * Fingerprint shape returned by generateFingerprint and consumed by applyFingerprint.
 */
interface FacebookFingerprint {
  ua: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: string;
}

/**
 * Normalized Facebook comment shape.
 */
interface FacebookComment {
  id: string | null;
  authorName: string | null;
  authorUrl: string | null;
  text: string | null;
  timestamp: string | null;
  likes: number;
  parentId: string | null;
  replies?: FacebookComment[];
}

/**
 * Normalized Facebook follower / member.
 */
interface FacebookFollower {
  name: string | null;
  username: string | null;
  url: string | null;
  platform: 'facebook';
}

/**
 * Normalized generic search result.
 */
interface FacebookSearchResult {
  id: string | null;
  text: string | null;
  author: string | Record<string, unknown> | null;
  timestamp: string | number | null;
  url: string | null;
  platform: 'facebook';
}

/**
 * Normalized post search result.
 */
interface FacebookPostSearchResult {
  id: string | null;
  text: string | null;
  author: string | Record<string, unknown> | null;
  timestamp: string | number | null;
  url: string | null;
  platform: 'facebook';
}

/**
 * Normalized people search result.
 */
interface FacebookPeopleSearchResult {
  id: string | null;
  name: string | null;
  username: string | null;
  profileUrl: string | null;
  image: string | null;
  platform: 'facebook';
}

/**
 * Normalized page search result.
 */
interface FacebookPageSearchResult {
  id: string | null;
  name: string | null;
  category: string | null;
  likes: string | number | null;
  pageUrl: string | null;
  image: string | null;
  platform: 'facebook';
}

/**
 * Normalized group search result.
 */
interface FacebookGroupSearchResult {
  id: string | null;
  name: string | null;
  members: string | number | null;
  privacy: string | null;
  groupUrl: string | null;
  image: string | null;
  platform: 'facebook';
}

/**
 * Normalized group member.
 */
interface FacebookGroupMember {
  name: string | null;
  username?: string;
  profileUrl: string;
  platform: 'facebook';
}

/**
 * Normalized marketplace listing.
 */
interface FacebookMarketplaceListing {
  id: string | null;
  title: string | null;
  price: string | null;
  location: string | null;
  image: string | null;
  listingUrl: string | null;
  seller: string | null;
  sellerUrl: string | null;
  category: string | null;
  platform: 'facebook';
  source: 'marketplace';
}

/**
 * Normalized proxy descriptor from proxy rotation providers.
 */
interface FacebookProxyDescriptor {
  proxy: string;
  server: string;
  username?: string;
  password?: string;
}

/**
 * Proxy provider configuration used by rotateProxy.
 */
interface FacebookProxyProvider {
  primaryUrl: (key: string) => string;
  fallbackUrl: (key: string) => string;
  method: string;
  headers: Record<string, string>;
  body?: (key: string) => string;
  primaryOk: (parsed: Record<string, unknown>) => boolean;
  fallbackOk: (parsed: Record<string, unknown>) => boolean;
}

/**
 * Options accepted by rotateProxy.
 */
interface FacebookProxyOptions {
  fetchImpl?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>;
}

/**
 * Credentials accepted by loginWithPassword.
 */
interface FacebookPasswordCreds {
  uid?: string;
  pass?: string;
  baitCookie?: { name: string; value: string; domain?: string } | null;
  seed?: string | null;
}

/**
 * Session-state values extracted from Facebook HTML.
 */
interface FacebookSessionState {
  [key: string]: string | undefined;
  hs?: string;
  hsi?: string;
  dyn?: string;
  csr?: string;
  hsdp?: string;
  hblp?: string;
  spin_r?: string;
  spin_t?: string;
  fb_dtsg?: string;
  lsd?: string;
  jazoest?: string;
  revision?: string;
}

/**
 * Options accepted by extractHydrationJson.
 */
interface FacebookHydrationOptions {
  fallbackExtractor?: (page: import('puppeteer').Page, typenames: string[]) => Promise<Record<string, unknown>[]>;
  limit?: number;
}

/**
 * Result item returned by runGuardedBatch and its wrappers.
 */
interface FacebookBatchItem {
  ok?: boolean;
  target?: unknown;
  error?: string;
  [key: string]: unknown;
}

/**
 * Structured result returned by runGuardedBatch and Facebook automation wrappers.
 */
interface FacebookBatchResult {
  dryRun: boolean;
  platform: string;
  attempted: number;
  succeeded: number;
  failed: number;
  preview: FacebookBatchItem[];
  results: FacebookBatchItem[];
  warning: string | null;
  [key: string]: unknown;
}

/**
 * Facebook cookie shape used by loginWithCookie.
 */
interface FacebookCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expires?: number;
}

/**
 * Options accepted by loginWithCookie.
 */
/**
 * Token values parsed from Facebook HTML.
 */
interface FacebookSessionTokens {
  [key: string]: string | null | undefined;
  fb_dtsg?: string | null;
  lsd?: string | null;
  jazoest?: string | null;
  hsi?: string | null;
  spin_r?: string | null;
  spin_t?: string | null;
}

/**
 * Input accepted by buildCampaignQueue.
 */
interface FacebookCampaignQueueInput {
  recipientsText?: string;
  recipients?: string[];
  linksText?: string;
  links?: string[];
  content?: string;
}

interface FacebookLoginCookieOptions {
  c_user?: string;
  xs?: string;
  sb?: string;
  datar?: string;
  fr?: string;
  fbl_st?: string;
  locale?: string;
  headless?: boolean;
  skipWarmup?: boolean;
  [key: string]: unknown;
}
