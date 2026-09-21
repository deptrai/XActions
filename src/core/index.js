// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Core — platform-agnostic contracts and shared types.
 * @author nich (@nichxbt)
 * @license MIT
 */

export { AbstractCrawler } from './base-crawler.js';
export { AbstractApiClient } from './base-client.js';
export { AbstractLogin } from './base-login.js';
export { TerminalQrLogin } from './login/terminal-qr.js';
export {
  launchBrowserWithCdp,
  launchChrome,
  getChromeExecutablePath,
  buildChromeArgs,
  fetchCdpWsEndpoint,
  getDefaultUserDataDir,
} from './cdp-launcher.js';
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
export { StatusApi, globalStatusApi } from './status-api.js';
export { AdaptiveRateGovernor, PlatformRateLimit, globalAdaptiveRateGovernor } from './adaptive-governor.js';
export { AbstractPlatformResponseValidator } from './platform-validator.js';
export { PreSignedTokenRing, SignerWorkerPagePool, PureCryptoSignerRegistry } from './signer-pool.js';
export { FingerprintManager, globalFingerprintManager } from './fingerprint-manager.js';
export { SessionHealthOrchestrator, globalSessionHealthOrchestrator } from './session-health-orchestrator.js';
export { ChallengeSignatureDetector, globalChallengeSignatureDetector } from './challenge-signature-detector.js';
export {
  JevChallengeDiagnoser,
  globalJevChallengeDiagnoser,
  extractSnippet,
  isJevChallengeDiagEnabled,
  resolvePageStatusThreshold,
} from './jev-challenge-diagnoser.js';
export { TlsProfileProvider, globalTlsProfileProvider, browserFamilyFromUA } from './tls-profile-provider.js';
export {
  CATEGORIES,
  CATEGORY_VALUES,
  generatePostId,
  generateCommentId,
  isValidCategory,
} from './types.js';
export { SchemaDriftGuard, globalSchemaDriftGuard } from './schema-drift-guard.js';
export { default as metadataSchemaRegistry, MetadataSchemaRegistry, validateSchemaNode } from './metadata-schema-registry.js';
export { SelectorCanary, globalSelectorCanary } from '../services/selector-canary.js';
export {
  AutoSelectorFallback,
  globalAutoSelectorFallback,
  FIELD_SHAPES,
  suggestSelectors,
} from './auto-selector-fallback.js';
export {
  DistributedTokenBucket,
  globalDistributedTokenBucket,
  parseRateLimitHeaders,
} from './distributed-token-bucket.js';
export {
  ProxyBudgetGovernor,
  globalProxyBudgetGovernor,
  TIER_COST_USD_PER_GB,
} from './proxy-budget-governor.js';
