// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Streaming — barrel export
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

export {
  createStream,
  stopStream,
  stopAllStreams,
  pauseStream,
  resumeStream,
  updateStream,
  listStreams,
  getStreamHistory,
  getStreamStatus,
  getStreamStats,
  isHealthy,
  setIO,
  shutdown,
  STREAM_TYPES,
  getPoolStatus,
  activeAdapters,
} from './streamManager.js';

export { pollTweets } from './tweetStream.js';
export { pollFollowers } from './followerStream.js';
export { pollMentions } from './mentionStream.js';

export {
  BasePushAdapter,
  JetstreamAdapter,
  normalizeJetstreamCommit,
  JETSTREAM_ENDPOINTS,
  MastodonSSEAdapter,
  CDCAdapter,
} from './adapters/index.js';

export {
  acquireBrowser,
  releaseBrowser,
  acquirePage,
  releasePage,
  closeAll as closeAllBrowsers,
  getPoolStatus as getBrowserPoolStatus,
  isHealthy as isBrowserPoolHealthy,
} from './browserPool.js';

export {
  OutboundWebhookDispatcher,
  defaultWebhookDispatcher,
  createWebhookDispatcher,
  createSignature,
  verifySignature,
} from './outbound-webhook-dispatcher.js';

export {
  WebhookSubscriptionStore,
  defaultWebhookSubscriptionStore,
  isValidWebhookUrl,
} from './webhook-subscription-store.js';

export {
  getStreamReplay,
  validateCursor,
  validateSince,
  getStreamInfo,
  DEFAULT_REPLAY_STREAM_KEY,
  DEFAULT_REPLAY_LIMIT,
  MAX_REPLAY_LIMIT,
} from './stream-replay.js';

