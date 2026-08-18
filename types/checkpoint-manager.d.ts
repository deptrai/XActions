// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript definitions for Checkpoint Manager (Story 10.4).
 * @author nich (@nichxbt)
 * @license MIT
 */

import type { PrismaClient } from '@prisma/client';

export type CheckpointStatus = 'running' | 'paused' | 'failed' | 'completed' | 'stalled';

export declare const CHECKPOINT_STATUSES: readonly CheckpointStatus[];

export interface ListCheckpointsOptions {
  platform?: string;
  targetType?: string;
  targetKey?: string;
  status?: CheckpointStatus;
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
  prisma?: PrismaClient;
}

export interface CrawlCheckpointRecord {
  id: string;
  platform: string;
  targetType: string;
  targetKey: string;
  status: CheckpointStatus;
  lastCursor?: string | null;
  lastTimestamp?: Date | null;
  lastCrawledAt?: Date | null;
  nextScheduledAt?: Date | null;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListCheckpointsResult {
  checkpoints: CrawlCheckpointRecord[];
  total: number;
  limit: number;
  offset: number;
}

export declare function listCheckpoints(
  options?: ListCheckpointsOptions
): Promise<ListCheckpointsResult>;

export declare function getCheckpoint(
  id: string,
  options?: { prisma?: PrismaClient }
): Promise<CrawlCheckpointRecord>;

export declare function resumeCheckpoint(
  id: string,
  options?: { prisma?: PrismaClient }
): Promise<CrawlCheckpointRecord>;

export declare function pauseCheckpoint(
  id: string,
  options?: { prisma?: PrismaClient }
): Promise<CrawlCheckpointRecord>;

export declare function retryCheckpoint(
  id: string,
  options?: { prisma?: PrismaClient }
): Promise<CrawlCheckpointRecord>;
