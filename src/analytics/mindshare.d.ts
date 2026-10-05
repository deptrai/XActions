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

declare const _default: {
  createMindshareEngine: typeof createMindshareEngine;
  getDefaultMindshare: typeof getDefaultMindshare;
};
export default _default;
