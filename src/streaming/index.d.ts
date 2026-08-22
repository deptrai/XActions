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
