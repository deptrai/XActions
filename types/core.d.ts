// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript declarations for the XActions core domain (Story 10.1).
 * @author nich (@nichxbt)
 * @license MIT
 */

export interface PostItem {
  id: string;
  platform: string;
  externalId: string;
  category: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  authorUrl?: string;
  postUrl?: string;
  content: string;
  mediaUrls?: string[];
  likesCount?: number;
  repostsCount?: number;
  repliesCount?: number;
  viewsCount?: number;
  metadata?: Record<string, unknown>;
  publishedAt?: Date;
  crawledAt: Date;
}

export interface CommentItem {
  id: string;
  platform: string;
  externalId: string;
  postId: string;
  parentCommentId?: string;
  depth?: number;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  likesCount?: number;
  subCommentsCount?: number;
  metadata?: Record<string, unknown>;
  publishedAt?: Date;
  crawledAt: Date;
}

export interface LoginResult {
  accountId: string;
  cookies: string;
  tokens: Record<string, unknown>;
  expiresAt?: Date;
}

export interface CrawlerCommand {
  action: string;
  args: Record<string, unknown>;
  session?: Record<string, unknown>;
}

export interface ActionDescriptor {
  action: string;
  description: string;
  requiredArgs: string[];
  optionalArgs?: string[];
  example: Record<string, unknown>;
  outputType: string;
}

export interface GovernorStatus {
  healthyProxyCount: number;
  totalProxyCount: number;
  healthyProxyRatio: number;
  currentReqPerSecond: number;
  redisConsumerLag: number;
  hibernatingAccounts: Array<{ accountId: string; remainingSeconds: number; reason: string }>;
  throttleLevel: string;
}

export interface ErrorEnvelope {
  code: string;
  type: string;
  message: string;
  statusCode: number;
  isRetryable: boolean;
  retryAfterMs: number;
  retryAfter: number;
  suggestedAction: string;
  accountId?: string;
  platform?: string;
  details?: unknown;
}

export const CATEGORIES: Readonly<{
  SOCIAL: 'social';
  ECOMMERCE: 'ecom';
  REAL_ESTATE: 'realestate';
  RECRUITMENT: 'recruitment';
  B2B: 'b2b';
}>;

export const CATEGORY_VALUES: ReadonlyArray<string>;

export function generatePostId(platform: string, externalId: string): string;
export function generateCommentId(platform: string, postExternalId: string, commentExternalId: string): string;
export function isValidCategory(category: string): boolean;

export const ErrorTypes: Readonly<{
  RATE_LIMIT: 'rate_limit';
  BOT_CHALLENGE: 'bot_challenge';
  AUTH_EXPIRED: 'auth_expired';
  PROXY_EXHAUSTED: 'proxy_exhausted';
  HIBERNATION: 'hibernation';
  INVALID_ARGS: 'invalid_args';
  INTERNAL: 'internal';
}>;

export const SuggestedActions: Readonly<{
  RETRY_AFTER_DELAY: 'retry_after_delay';
  ROTATE_PROXY: 'rotate_proxy';
  ROTATE_ACCOUNT: 'rotate_account';
  HIBERNATE_ACCOUNT: 'hibernate_account';
  RELOGIN: 'relogin';
  WAIT: 'wait';
  REDUCE_RATE: 'reduce_rate';
  CONTACT_SUPPORT: 'contact_support';
  USE_ACTIONS_LIST: 'use_x_actions_list';
}>;

export class PlatformError extends Error {
  code: string;
  type: string;
  statusCode: number;
  retryAfterMs: number;
  suggestedAction: string;
  accountId?: string;
  platform?: string;
  details?: unknown;
  constructor(opts?: {
    code?: string;
    type?: string;
    message?: string;
    statusCode?: number;
    retryAfterMs?: number;
    suggestedAction?: string;
    accountId?: string;
    platform?: string;
    details?: unknown;
  });
  get isRetryable(): boolean;
  get retryAfter(): number;
  toEnvelope(): ErrorEnvelope;
}

export class RateLimitError extends PlatformError {
  constructor(opts?: ConstructorParameters<typeof PlatformError>[0]);
}

export class BotChallengeError extends PlatformError {
  constructor(opts?: ConstructorParameters<typeof PlatformError>[0]);
}

export class AuthSessionExpiredError extends PlatformError {
  constructor(opts?: ConstructorParameters<typeof PlatformError>[0]);
}

export class ProxyDeadError extends PlatformError {
  constructor(opts?: ConstructorParameters<typeof PlatformError>[0]);
}

export abstract class AbstractCrawler {
  name: string;
  requiresAuth: boolean;
  governor: AdaptiveRateGovernor | null;
  accountPool: AccountPool | null;
  constructor(deps?: {
    client?: AbstractApiClient;
    store?: AbstractStore;
    sessionManager?: SessionManager;
    governor?: AdaptiveRateGovernor;
    accountPool?: AccountPool;
    requiresAuth?: boolean;
  });
  registerAction(action: string, handler: Function, descriptor?: Partial<Omit<ActionDescriptor, 'action'>>): void;
  registerAction(descriptor: Partial<ActionDescriptor> & { action: string; handler: Function }): void;
  listActions(): ActionDescriptor[];
  validateItem(item: PostItem | CommentItem): void;
  start(command: CrawlerCommand): Promise<unknown>;
  abstract init(): Promise<void>;
  abstract search(args: Record<string, unknown>): Promise<PostItem[]>;
  abstract getPostDetail(args: Record<string, unknown>): Promise<PostItem>;
  abstract getComments(args: Record<string, unknown>): Promise<CommentItem[]>;
  abstract cleanup(): Promise<void>;
}

export abstract class AbstractApiClient {
  name: string;
  platform: string;
  requiresAuth: boolean;
  httpClient: unknown;
  responseValidator: AbstractPlatformResponseValidator | null;
  cookies: Record<string, unknown>;
  maxProxyRetries: number;
  maxAccountRotations: number;
  backoffBaseMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  rateLimitHibernationMs: number;
  standbyBackoffMs: number;
  constructor(options?: {
    sessionManager?: SessionManager;
    proxyPool?: unknown;
    proxyProvider?: unknown;
    accountPool?: AccountPool;
    governor?: AdaptiveRateGovernor;
    responseValidator?: AbstractPlatformResponseValidator;
    platform?: string;
    client?: 'undici' | 'got';
    httpClient?: Function;
    requiresAuth?: boolean;
    maxProxyRetries?: number;
    maxAccountRotations?: number;
    backoffBaseMs?: number;
    backoffMultiplier?: number;
    maxBackoffMs?: number;
    rateLimitHibernationMs?: number;
    standbyBackoffMs?: number;
  });
  resolveProxy(accountId?: string, requiresResidential?: boolean): unknown;
  init(session: Record<string, unknown>): Promise<void>;
  request(method: string, url: string, options?: Record<string, unknown>): Promise<unknown>;
  sign(payload: Record<string, unknown>): Promise<unknown>;
  updateCookies(cookies: Record<string, unknown>): void;
  handleError(response: unknown, platform: string): never;
}

export abstract class AbstractLogin {
  name: string;
  constructor();
  abstract login(): Promise<LoginResult>;
  abstract refresh(): Promise<LoginResult>;
  abstract isAuthenticated(): Promise<boolean>;
}

export abstract class AbstractStore {
  constructor();
  abstract init(): Promise<void>;
  abstract storeContent(post: PostItem): Promise<void>;
  abstract storeBatch(posts: PostItem[]): Promise<void>;
  abstract storeComment(comment: CommentItem): Promise<void>;
  abstract storeCommentBatch(comments: CommentItem[]): Promise<void>;
  abstract close(): Promise<void>;
}

export abstract class AbstractPlatformResponseValidator {
  platform: string;
  constructor();
  abstract isValidPayload(response: unknown): boolean;
  abstract isBotChallenge(response: unknown): boolean;
  abstract isRateLimit(response: unknown): boolean;
}

export class ActionRegistry {
  constructor();
  clear(): void;
  registerPlatformActions(platform: string, descriptors: ActionDescriptor[]): void;
  listAll(): ActionDescriptor[];
  listByPlatform(platform?: string): ActionDescriptor[];
  get(platform: string, action: string): ActionDescriptor | undefined;
}

export const globalActionRegistry: ActionRegistry;

export class SessionManager {
  constructor();
  set(accountId: string, session: LoginResult): void;
  get(accountId: string): LoginResult | undefined;
  has(accountId: string): boolean;
  delete(accountId: string): void;
  accountIds(): IterableIterator<string>;
}

export const globalSessionManager: SessionManager;

export class AccountPool {
  constructor(deps?: { governor?: AdaptiveRateGovernor });
  registerAccounts(platform: string, accountIds: string[]): void;
  getNextAvailable(platform: string): string | null;
  hasAvailable(platform: string): boolean;
  markUnavailable(accountId: string): void;
  markAvailable(accountId: string): void;
  listPlatforms(): string[];
  listAccounts(platform: string): string[];
}

export const globalAccountPool: AccountPool;

export class StatusApi {
  constructor(deps?: { governor?: AdaptiveRateGovernor });
  getGovernorStatus(): GovernorStatus;
}

export const globalStatusApi: StatusApi;

export class PlatformRateLimit {
  platform: string;
  requiresAuth: boolean;
  safeRequestsPerMinute: number;
  baseReqPerSecondPerProxy: number;
  throttleFactor: number;
  burstWindow: number;
  constructor(platform: string, overrides?: Partial<PlatformRateLimit>);
}

export class AdaptiveRateGovernor {
  constructor(deps?: { proxyPool?: unknown; healthyProxyFloor?: number });
  setPlatformLimit(platform: string, limits?: Partial<PlatformRateLimit>): void;
  getPlatformLimit(platform: string): PlatformRateLimit;
  isAuthRequired(platform: string): boolean;
  updateState(state: { healthyProxyCount?: number; totalProxyCount?: number; redisConsumerLag?: number }): void;
  updateRedisConsumerLag(lag: number): void;
  getRedisConsumerLag(): number;
  refreshFromProxyPool(): void;
  getMaxThroughput(platform: string): number;
  recordRequest(accountId: string, platform?: string): void;
  getAccountVelocity(accountId: string, platform?: string): number;
  canAccountRequest(accountId: string, platform: string): boolean;
  hibernateAccount(accountId: string, reason: string, durationMs?: number, platform?: string): void;
  recordRateLimit(accountId: string, platform?: string, durationMs?: number): void;
  recordBotChallenge(accountId: string, platform?: string, durationMs?: number): void;
  wakeAccount(accountId: string, platform?: string): void;
  isHibernating(accountId: string, platform?: string): boolean;
  getStatus(): GovernorStatus;
}

export const globalAdaptiveRateGovernor: AdaptiveRateGovernor;

export class PreSignedTokenRing {
  constructor(options?: { capacity?: number });
  refill(tokens: string[]): void;
  next(): string | null;
  get size(): number;
}

export class SignerWorkerPagePool {
  constructor(options?: { minSize?: number; maxSize?: number; browser?: unknown });
  init(): Promise<void>;
  evaluate(script: string, args?: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}
