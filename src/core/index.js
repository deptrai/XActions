// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Core — platform-agnostic contracts and shared types.
 * @author nich (@nichxbt)
 * @license MIT
 */

export { AbstractCrawler } from './base-crawler.js';
export { AbstractApiClient } from './base-client.js';
export { AbstractLogin } from './base-login.js';
export { AbstractStore } from './base-store.js';
export {
  PlatformError,
  RateLimitError,
  BotChallengeError,
  AuthSessionExpiredError,
  ProxyDeadError,
  ErrorTypes,
  SuggestedActions,
} from './error-envelope.js';
export { ActionRegistry, globalActionRegistry } from './action-registry.js';
export { SessionManager, globalSessionManager } from './session-manager.js';
export { AccountPool, globalAccountPool } from './account-pool.js';
export { StatusApi } from './status-api.js';
export { AdaptiveRateGovernor, PlatformRateLimit } from './adaptive-governor.js';
export { AbstractPlatformResponseValidator } from './platform-validator.js';
export { PreSignedTokenRing, SignerWorkerPagePool } from './signer-pool.js';
export {
  CATEGORIES,
  CATEGORY_VALUES,
  generatePostId,
  generateCommentId,
  isValidCategory,
} from './types.js';
