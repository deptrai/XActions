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
  dataQuality?: DataQualityMetadata;
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
  dataQuality?: DataQualityMetadata;
}

export interface ProfileItem {
  id: string;
  platform: string;
  externalId: string;
  username?: string;
  name?: string;
  authorName?: string;
  bio?: string;
  avatar?: string;
  profileUrl?: string;
  followersCount?: number;
  followingCount?: number;
  metadata?: Record<string, unknown>;
  crawledAt: Date;
  dataQuality?: DataQualityMetadata;
}

export interface ThinEvent {
  id: string;
  platform: string;
  externalId: string;
  category: string;
  authorId: string;
  crawledAt: string;
  storageRef: string;
  scraperId?: string;
  benchmark_health?: 'A' | 'B' | 'C' | 'UNKNOWN';
  benchmark_alert?: boolean | string;
}

export interface StreamMetrics {
  eventsPerSecond: number;
  pendingMessages: number;
  consumerLag: number;
  droppedEvents: number;
  lastAckTime: number;
  maxLen: number;
  minId: string | null;
}

export interface RedisClientLike {
  xAdd?: Function;
  xadd?: Function;
  xLen?: Function;
  xlen?: Function;
  xInfoStream?: Function;
  xInfo?: Function;
  xinfo?: Function;
  xInfoConsumers?: Function;
  xGroupCreate?: Function;
  xgroup?: Function;
  xPending?: Function;
  xpending?: Function;
  sendCommand?: Function;
  isOpen?: boolean | Function;
  quit?: Function;
  disconnect?: Function;
  status?: string;
}

export interface LoginResult {
  accountId: string;
  cookies: string | Record<string, unknown>;
  tokens: Record<string, unknown>;
  expiresAt?: Date;
  cdpUrl?: string;
  details?: Record<string, unknown>;
}

export interface CrawlerCommand {
  action: string;
  args: Record<string, unknown>;
  session?: Record<string, unknown>;
}

export interface CheckpointResolution {
  targetType: string;
  targetKey: string;
  cursorField?: string;
  fallbackCursorFields?: string[];
}

export interface ActionDescriptor {
  action: string;
  description: string;
  requiredArgs: string[];
  optionalArgs?: string[];
  example: Record<string, unknown>;
  outputType: string;
  checkpointResolver?: (args: Record<string, unknown>) => CheckpointResolution | null | Promise<CheckpointResolution | null>;
}

export interface GovernorStatus {
  healthyProxyCount: number;
  totalProxyCount: number;
  healthyProxyRatio: number;
  currentReqPerSecond: number;
  redisConsumerLag: number;
  hibernatingAccounts: Array<{ accountId: string; remainingSeconds: number; reason: string }>;
  throttleLevel: string;
  /** Dual-pool partition stats (AD-20). */
  dualPool: import('./proxy.js').DualPoolStats;
  /** Per-consumer quota status (AD-20). */
  consumerQuotas: Record<string, ConsumerStatus>;
}

/** Consumer quota configuration (AD-20). */
export interface ConsumerQuotaConfig {
  consumerId: string;
  /** Requests per minute; Infinity means unmetered. */
  rpmLimit: number;
  burstLimit?: number;
  priority?: number;
}

/** Observability snapshot for a single consumer (AD-20). */
export interface ConsumerStatus {
  consumerId: string;
  rpmLimit: number;
  burstLimit: number;
  priority: number;
  usedInWindow: number;
  remaining: number;
  isThrottled: boolean;
  overBurst: boolean;
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
  /** Consumer identity for quota errors (AD-20). */
  consumerId?: string;
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
  NOT_FOUND: 'not_found';
  TARGET_NOT_FOUND: 'target_not_found';
  INTERNAL: 'internal';
  DEPRECATED: 'deprecated';
  DEGRADED_DATA: 'degraded_data';
}>;

export const SuggestedActions: Readonly<{
  RETRY_AFTER_DELAY: 'retry_after_delay';
  ROTATE_PROXY: 'rotate_proxy';
  ROTATE_ACCOUNT: 'rotate_account';
  HIBERNATE_ACCOUNT: 'hibernate_account';
  RATE_LIMIT_BACKOFF: 'rate_limit_backoff';
  RELOGIN: 'relogin';
  WAIT: 'wait';
  REDUCE_RATE: 'reduce_rate';
  CONTACT_SUPPORT: 'contact_support';
  USE_ACTIONS_LIST: 'use_x_actions_list';
  VERIFY_URL: 'verify_url';
  RETRY_WITH_DIFFERENT_ACCOUNT: 'retry_with_different_account';
}>;

export class PlatformError extends Error {
  code: string;
  type: string;
  statusCode: number;
  retryAfterMs: number;
  suggestedAction: string;
  accountId?: string;
  platform?: string;
  consumerId?: string;
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
    consumerId?: string;
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
  cdpUrl: string | null;
  governor: AdaptiveRateGovernor | null;
  accountPool: AccountPool | null;
  challengeDetector: ChallengeSignatureDetector | null;
  healthOrchestrator: SessionHealthOrchestrator | null;
  driftGuard: SchemaDriftGuard | null;
  constructor(deps?: {
    client?: AbstractApiClient;
    store?: AbstractStore;
    sessionManager?: SessionManager;
    governor?: AdaptiveRateGovernor;
    accountPool?: AccountPool;
    requiresAuth?: boolean;
    cdpUrl?: string;
    challengeDetector?: ChallengeSignatureDetector;
    healthOrchestrator?: SessionHealthOrchestrator;
    driftGuard?: SchemaDriftGuard;
  });
  registerAction(action: string, handler: Function, descriptor?: Partial<Omit<ActionDescriptor, 'action'>>): void;
  registerAction(descriptor: Partial<ActionDescriptor> & { action: string; handler: Function }): void;
  listActions(): ActionDescriptor[];
  getItemSchemaType(item: unknown): string;
  validateItem(item: PostItem | CommentItem | ProfileItem | unknown): void;
  filterValidItems<T>(items: T[]): T[];
  start(command: CrawlerCommand): Promise<unknown>;
  resolveCheckpoint(action: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
  shouldStopPagination(items: Array<{ id: string }>): Promise<boolean>;
  launchBrowserWithCdp(cdpUrl?: string, options?: Record<string, unknown>): Promise<unknown>;
  delayWithJitter(min?: number, max?: number): Promise<number>;
  abstract init(): Promise<void>;
  abstract search(args: Record<string, unknown>): Promise<PostItem[]>;
  abstract getPostDetail(args: Record<string, unknown>): Promise<PostItem>;
  abstract getComments(args: Record<string, unknown>): Promise<CommentItem[]>;
  abstract cleanup(): Promise<void>;
  detectChallengeOnPage(page: unknown, opts?: { accountId?: string }): Promise<ChallengeResult>;
}

export interface SignPayload {
  signType?: 'token' | 'page' | 'pure_algorithm' | 'custom' | string;
  /** Tier 0 pure-algorithm name; auto-detected when registered and signType is not 'token'/'page'. */
  algorithm?: string;
  location?: 'header' | 'query' | 'cookie';
  name?: string;
  prefix?: string;
  script?: string | Function;
  args?: unknown[];
  timeoutMs?: number;
  warmup?: boolean;
  [key: string]: unknown;
}

export interface SignResult {
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  cookies?: Record<string, string>;
  signature?: unknown;
  [key: string]: unknown;
}

export abstract class AbstractApiClient {
  name: string;
  platform: string;
  requiresAuth: boolean;
  httpClient: unknown;
  responseValidator: AbstractPlatformResponseValidator | null;
  cookies: Record<string, string>;
  tokenRing: PreSignedTokenRing | null;
  signerPool: SignerWorkerPagePool | null;
  pureSigners: PureCryptoSignerRegistry | null;
  maxProxyRetries: number;
  maxAccountRotations: number;
  backoffBaseMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  rateLimitHibernationMs: number;
  standbyBackoffMs: number;
  challengeDetector: ChallengeSignatureDetector | null;
  healthOrchestrator: SessionHealthOrchestrator | null;
  constructor(options?: {
    sessionManager?: SessionManager;
    proxyPool?: unknown;
    proxyProvider?: unknown;
    accountPool?: AccountPool;
    governor?: AdaptiveRateGovernor;
    responseValidator?: AbstractPlatformResponseValidator;
    tokenRing?: PreSignedTokenRing;
    signerPool?: SignerWorkerPagePool;
    pureSigners?: PureCryptoSignerRegistry | Record<string, (payload: SignPayload) => SignResult | string | null | undefined> | Map<string, (payload: SignPayload) => SignResult | string | null | undefined>;
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
    challengeDetector?: ChallengeSignatureDetector;
    healthOrchestrator?: SessionHealthOrchestrator;
  });
  resolveProxy(
    accountId?: string,
    requiresResidential?: boolean,
    requiresAuth?: boolean,
    options?: { pool?: import('./proxy.js').PoolName; consumerId?: string }
  ): string | Record<string, unknown> | null;
  init(session: Record<string, unknown>): Promise<void>;
  request(method: string, url: string, options?: Record<string, unknown>): Promise<unknown>;
  requestWithSign(method: string, url: string, payload?: SignPayload, options?: Record<string, unknown>): Promise<unknown>;
  sign(payload: SignPayload): Promise<SignResult | unknown>;
  updateCookies(cookies?: Record<string, unknown>): void;
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
  isLoginWall(response: unknown): boolean;
  isAuthExpired(response: unknown): boolean;
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
  /** Set or update a consumer quota (AD-20). */
  setConsumerQuota(consumerId: string, config: Partial<Omit<ConsumerQuotaConfig, 'consumerId'>>): void;
  /** True when the consumer has remaining quota in the current sliding window (AD-20). */
  canConsumerRequest(consumerId: string): boolean;
  /** Record a consumer request against the sliding window (AD-20). */
  recordConsumerRequest(consumerId: string): void;
  /** Observability snapshot for one consumer (AD-20). */
  getConsumerStatus(consumerId: string): ConsumerStatus;
  /** Seconds until the consumer's sliding window frees a slot (AD-20). */
  getConsumerRetryAfterSeconds(consumerId: string): number;
  getStatus(): GovernorStatus;
}

export const globalAdaptiveRateGovernor: AdaptiveRateGovernor;

export class PreSignedTokenRing {
  constructor(options?: { capacity?: number });
  refill(tokens: string[]): void;
  next(): string | null;
  get size(): number;
  get capacity(): number;
  get isEmpty(): boolean;
}

export class PureCryptoSignerRegistry {
  constructor();
  register(algorithm: string, fn: (payload: SignPayload) => SignResult | string | null | undefined): this;
  get(algorithm: string): ((payload: SignPayload) => SignResult | string | null | undefined) | null;
  has(algorithm: string): boolean;
  unregister(algorithm: string): boolean;
  list(): string[];
  get size(): number;
}

export class SignerWorkerPagePool {
  constructor(options?: {
    minSize?: number;
    maxSize?: number;
    defaultTimeoutMs?: number;
    warmupTimeoutMs?: number;
    browser?: unknown;
  });
  init(options?: { warmupScript?: string; warmupArgs?: unknown[] }): Promise<void>;
  evaluate(
    script: string | Function,
    args?: unknown[],
    options?: { timeoutMs?: number; warmup?: boolean }
  ): Promise<unknown>;
  close(): Promise<void>;
  get size(): number;
  get activeCount(): number;
  get idleCount(): number;
  get minSize(): number;
  get maxSize(): number;
}

// ---------------------------------------------------------------------------
// Story 27.1 — FingerprintManager & TLS Profile Provider
// ---------------------------------------------------------------------------

export interface FingerprintWebGL {
  vendor: string;
  renderer: string;
}

export interface Fingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  timezone: string;
  locale: string;
  colorDepth: number;
  platform: string;
  webgl: FingerprintWebGL;
  fonts: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  browserFamily: 'chrome' | 'firefox' | 'safari' | 'unknown';
  osFamily: 'windows' | 'mac' | 'linux';
  region?: string;
}

export interface TlsProfile {
  browserFamily: 'chrome' | 'firefox' | 'safari' | 'unknown';
  cipherSuites: string[];
  minVersion: string;
  maxVersion: string;
  alpnProtocols: string[];
  sigAlgs?: string[];
}

export class TlsProfileProvider {
  constructor(options?: { overrides?: Record<string, Partial<TlsProfile>> });
  getProfile(familyOrUa: string): TlsProfile | null;
  forFingerprint(fingerprint: { userAgent?: string }): TlsProfile | null;
}

export function browserFamilyFromUA(ua?: string): 'chrome' | 'firefox' | 'safari' | 'unknown';

export interface FingerprintStore {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

export class FingerprintManager {
  constructor(options?: {
    prisma?: unknown;
    tlsProvider?: TlsProfileProvider;
    store?: FingerprintStore;
  });
  bindProxyRegion(accountId: string, region: string): void;
  getForAccount(
    platform: string,
    accountId: string,
    options?: { proxy?: string | { region?: string; country?: string } }
  ): Promise<Fingerprint>;
  rotateForAccount(
    platform: string,
    accountId: string,
    options?: { proxy?: string | { region?: string; country?: string } }
  ): Promise<Fingerprint>;
  tlsProfileFor(fingerprintOrUa: Fingerprint | string): TlsProfile | null;
  has(platform: string, accountId: string): boolean;
  get size(): number;
}

export const globalFingerprintManager: FingerprintManager;
export const globalTlsProfileProvider: TlsProfileProvider;

// ---------------------------------------------------------------------------
// Story 27.2 — SessionHealthOrchestrator & Circuit Breaker
// ---------------------------------------------------------------------------

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  nextProbeAt: number;
  openedAt: number;
}

export interface SessionHealthStatus {
  healthScores: Record<string, number>;
  circuitBreakerStates: Record<string, CircuitBreakerState>;
}

export type ProbeResult = { success: boolean; complete?: boolean; challenge?: boolean };
export type ProbeFn = (accountId: string, platform: string) => Promise<ProbeResult> | ProbeResult;

export class SessionHealthOrchestrator {
  constructor(options?: {
    governor?: unknown;
    accountPool?: unknown;
    sickThreshold?: number;
    baseCooldownMs?: number;
    maxCooldownMs?: number;
    now?: () => number;
  });
  recordSuccess(platform: string, accountId: string): void;
  recordError(platform: string, accountId: string): void;
  recordRateLimit(platform: string, accountId: string): void;
  recordBotChallenge(platform: string, accountId: string): void;
  recordLatency(platform: string, accountId: string, latencyMs: number): void;
  recordPayload(platform: string, accountId: string, complete: boolean): void;
  recordProxyHealth(platform: string, accountId: string, healthy: boolean): void;
  getHealthScore(platform: string, accountId: string): number;
  registerProbe(platform: string, accountId: string, probeFn: ProbeFn): void;
  checkRecovery(platform: string, accountId: string): Promise<CircuitBreakerState>;
  wake(platform: string, accountId: string): void;
  isAvailable(platform: string, accountId: string): boolean;
  getStatus(): SessionHealthStatus;
}

export const globalSessionHealthOrchestrator: SessionHealthOrchestrator;

// ---------------------------------------------------------------------------
// Story 27.3 — ChallengeSignatureDetector
// ---------------------------------------------------------------------------

export type ChallengeType =
  | 'cloudflare_managed'
  | 'cloudflare_turnstile'
  | 'cloudflare_interstitial'
  | 'arkose'
  | 'recaptcha'
  | 'hcaptcha'
  | 'platform_checkpoint'
  | 'platform_unusual_login'
  | 'platform_account_locked'
  | 'platform_challenge_required'
  | 'generic_captcha'
  | 'unknown';

export interface ChallengePattern {
  kind: 'substr' | 'regex' | 'header' | 'status';
  value: string | number;
  weight: number;
  headerValue?: string;
}

export interface ChallengeSignature {
  id: string;
  type: ChallengeType;
  patterns: ChallengePattern[];
  hibernationMs?: number;
  appliesTo?: 'http' | 'dom' | 'both';
  platform?: string;
}

export interface ChallengeResult {
  detected: boolean;
  type: ChallengeType;
  confidence: number;
  suggestedHibernationMs: number;
  signature: string | null;
  matchedPatterns: string[];
}

export interface ChallengeDetectInput {
  body?: string | Buffer | object;
  data?: string | Buffer | object;
  headers?: Record<string, string>;
  statusCode?: number;
  status?: number;
  url?: string;
  platform?: string;
}

export class ChallengeSignatureDetector {
  constructor();
  registerPlatformSignatures(platform: string, sigs: ChallengeSignature[]): void;
  detect(input: ChallengeDetectInput): ChallengeResult;
  detectFromHtml(html: string, opts?: { url?: string; platform?: string }): ChallengeResult;
  detectFromResponse(response: unknown, opts?: { platform?: string }): ChallengeResult;
}

export const globalChallengeSignatureDetector: ChallengeSignatureDetector;

// ---------------------------------------------------------------------------
// Story 28.1 — SchemaDriftGuard: Runtime Contract Validation & Completeness Classification
// ---------------------------------------------------------------------------

export interface DataQualityMetadata {
  score: number;
  missingFields: string[];
  classification: 'degraded';
}

export type DriftClassification = 'complete' | 'degraded' | 'corrupted';

export interface DriftValidationResult {
  classification: DriftClassification;
  score: number;
  missingFields: string[];
  typeErrors: string[];
}

export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  title?: string;
  description?: string;
  version?: string;
}

export function validateSchemaNode(
  schema: JsonSchema | undefined | null,
  data: unknown,
  dataPath?: string
): string[];

export class MetadataSchemaRegistry {
  constructor();
  registerSchema(platform: string, category: string, schema: JsonSchema): void;
  getSchema(platform: string, category: string): JsonSchema | null;
  hasSchema(platform: string, category: string): boolean;
  loadSchemasFromDisk(schemasDir: string): void;
  listSchemas(): Array<{
    platform: string;
    category: string;
    title: string;
    description: string;
    version: string;
    propertiesCount: number;
  }>;
  validateMetadata(
    platform: string,
    category: string,
    metadata: unknown
  ): { valid: boolean; errors: string[] };
}

export const metadataSchemaRegistry: MetadataSchemaRegistry;

export class SchemaDriftGuard {
  registry: MetadataSchemaRegistry;
  constructor(deps?: { registry?: MetadataSchemaRegistry });
  registerItemSchema(type: string, schema: JsonSchema): void;
  getSchema(platform: string, schemaType: string): JsonSchema | null;
  inferItemType(item: unknown): string;
  validate(
    platform: string,
    item: unknown,
    opts?: { schemaType?: string }
  ): DriftValidationResult;
  validateOrThrow(
    platform: string,
    item: unknown,
    opts?: { schemaType?: string }
  ): DriftValidationResult;
}

export const globalSchemaDriftGuard: SchemaDriftGuard;

