export interface MindshareTopVoice {
  author: string;
  weightedVolume: number;
  mentions: number;
}

export interface MindshareTokenResult {
  token: string;
  mindsharePct: number;
  delta24h: number | null;
  delta7d: number | null;
  topVoices: MindshareTopVoice[];
  degraded: boolean;
  insufficientHistory?: boolean;
  narrativeId?: string;
  narrativeDelta?: number | null;
}

export interface MindshareComputeResult {
  tokens: MindshareTokenResult[];
  degraded: boolean;
  scope: 'watchlist';
  windowHours: number;
  warning?: string;
  consecutiveEmptyBatches?: number;
  degradedSince?: number;
  generatedAt: string;
}

export interface MindshareEngine {
  computeMindshare(
    tokenId?: string,
    options?: { hours?: number }
  ): Promise<MindshareComputeResult>;
  getEngineConfig(): {
    topN: number;
    minBaselineDays: number;
    weights: { likes: number; retweets: number; replies: number };
    followerBands: readonly { max: number; weight: number }[];
  };
}

export function createMindshareEngine(opts?: Record<string, unknown>): MindshareEngine;
export function getDefaultMindshare(): MindshareEngine;
export function resetDefaultMindshare(): void;

export const DEFAULT_WEIGHTS: Readonly<{ likes: number; retweets: number; replies: number }>;
export const DEFAULT_FOLLOWER_BANDS: ReadonlyArray<{ max: number; weight: number }>;
export function followerWeight(followers: number | string | null | undefined, bands: ReadonlyArray<{ max: number; weight: number }>): number;
export function engagementScore(engagementRaw: unknown, weights: { likes?: number; retweets?: number; replies?: number }): number;
export function computeRowWeight(row: unknown, followerBands: ReadonlyArray<{ max: number; weight: number }>, weights: { likes?: number; retweets?: number; replies?: number }): number;

declare const _default: {
  createMindshareEngine: typeof createMindshareEngine;
  getDefaultMindshare: typeof getDefaultMindshare;
};
export default _default;
