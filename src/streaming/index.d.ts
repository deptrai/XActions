// Type declarations for src/streaming/index.js
// These are intentionally broad to satisfy the JSDoc migration while the
// implementation files are typed in a later phase.

import type { Server } from 'socket.io';

export interface StreamOptions extends Record<string, unknown> {
  type?: string;
  username?: string;
  interval?: number;
  authToken?: string;
  userId?: string;
}

export function createStream(options: StreamOptions): Promise<Record<string, unknown>>;
export function stopStream(streamId: string): Promise<Record<string, unknown>>;
export function stopAllStreams(): Promise<Record<string, unknown>>;
export function pauseStream(streamId: string): Promise<Record<string, unknown>>;
export function resumeStream(streamId: string): Promise<Record<string, unknown>>;
export function updateStream(streamId: string, options: StreamOptions): Promise<Record<string, unknown>>;
export function listStreams(): Promise<Record<string, unknown>[]>;
export function getStreamHistory(streamId: string, limit?: number, eventType?: string): Promise<Record<string, unknown>[]>;
export function getStreamStatus(streamId: string): Promise<Record<string, unknown> | null>;
export function getStreamStats(): Record<string, unknown>;
export function isHealthy(): Promise<boolean>;
export function setIO(io: Server): void;
export function shutdown(): Promise<void>;
export const STREAM_TYPES: string[];
export function getPoolStatus(): Record<string, unknown>;

export function pollTweets(options: StreamOptions): Promise<Record<string, unknown>>;
export function pollFollowers(options: StreamOptions): Promise<Record<string, unknown>>;
export function pollMentions(options: StreamOptions): Promise<Record<string, unknown>>;

export function acquireBrowser(): Promise<Record<string, unknown>>;
export function releaseBrowser(browser: Record<string, unknown>): Promise<void>;
export function acquirePage(): Promise<Record<string, unknown>>;
export function releasePage(page: Record<string, unknown>): Promise<void>;
export function closeAll(): Promise<void>;
export function getBrowserPoolStatus(): Record<string, unknown>;
export function isBrowserPoolHealthy(): boolean;

export interface ReplayOptions {
  streamKey?: string;
  streamId?: string;
  since?: string | number | Date;
  cursor?: string;
  limit?: number;
  deliver?: 'webhook';
  subscriptionId?: string;
  redisClient?: unknown;
  dispatcher?: unknown;
  subscriptionStore?: unknown;
  streamMeta?: Record<string, unknown> | null;
}

export interface ReplayResult {
  events: Array<{ id: string; data: Record<string, unknown> }>;
  hasMore: boolean;
  nextCursor: string | null;
  count: number;
  streamInfo: {
    streamKey: string;
    firstEntry: string | null;
    lastEntry: string | null;
    length: number;
  };
  warning?: string;
  delivered?: number;
  deliveryResults?: Array<Record<string, unknown>>;
}

export function getStreamReplay(options?: ReplayOptions): Promise<ReplayResult>;
export function validateCursor(cursor: unknown): string;
export function validateSince(since: unknown): number;
export function getStreamInfo(client: unknown, streamKey: string): Promise<{ streamKey: string; firstEntry: string | null; lastEntry: string | null; length: number }>;
export const DEFAULT_REPLAY_STREAM_KEY: string;
export const DEFAULT_REPLAY_LIMIT: number;
export const MAX_REPLAY_LIMIT: number;


export function createSignature(payload: unknown, secret?: string): string;
export function verifySignature(payload: unknown, secretOrSignature: string, signatureOrSecret: string): boolean;
export function isValidWebhookUrl(url: string): boolean;

export class WebhookSubscriptionStore {
  constructor(options?: Record<string, unknown>);
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  get(id: string): Promise<Record<string, unknown> | null>;
  list(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<boolean>;
  matchSubscriptions(platform: string): Promise<Record<string, unknown>[]>;
}
export const defaultWebhookSubscriptionStore: WebhookSubscriptionStore;

export class OutboundWebhookDispatcher {
  constructor(options?: Record<string, unknown>);
  start(opts?: Record<string, unknown>): Promise<void>;
  stop(gracePeriodMs?: number): Promise<void>;
  deliverToSubscription(subscription: Record<string, unknown>, payload: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  dispatchReplay(events: unknown[], subscriptionOrId: string | Record<string, unknown>): Promise<Record<string, unknown>[]>;
  getMetrics(subscriptionId: string): Promise<Record<string, unknown>>;
  getDeliveryLogs(options?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  retryDlqEntry?(dlqId: string): Promise<Record<string, unknown>>;
}
export const defaultWebhookDispatcher: OutboundWebhookDispatcher;
export function createWebhookDispatcher(options?: Record<string, unknown>): OutboundWebhookDispatcher;
