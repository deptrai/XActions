/**
 * Type definitions for Narrative Clustering & Rotation Detection.
 *
 * by nichxbt
 */

/** A single post in the narrative corpus (deduplicated by source_id). */
export interface NarrativeCorpusPost {
  /** Unique platform post id (e.g. `x:123`). */
  source_id: string;
  /** Post text content (may be NULL/empty for legacy rows). */
  content?: string | null;
  /** Token id this mention belongs to. */
  token_id?: string;
  /** Unix epoch milliseconds. */
  ts: number;
  /** Author follower count (any type; weighting tolerates non-numbers). */
  followers?: unknown;
  /** Engagement metrics object (any shape). */
  engagement?: unknown;
}

/** One narrative aggregate inside the requested window. */
export interface NarrativeItem {
  /** Narrative identifier (taxonomy id or `emerging:<bigram>`). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Weighted share of the active window corpus (0-100). */
  mindsharePct: number;
  /** Share delta vs the immediately-preceding 24h (null = no baseline). */
  delta24h: number | null;
  /** Share delta vs the trailing-7d baseline (null = insufficient baseline). */
  delta7d: number | null;
  /** Present when share growth exceeds mean + 3*sigma, or narrative is emergent. */
  emerging?: boolean;
  /** Present when baseline history is too thin to compute delta7d. */
  insufficientHistory?: boolean;
}

/** Result envelope of computeNarratives. */
export interface NarrativeComputeResult {
  narratives: NarrativeItem[];
  /** Degraded passthrough from healthFn (AD-3). */
  degraded: boolean;
  /** Scope of computation (Story 54.5 contract: 'watchlist'). */
  scope: 'watchlist';
  /** Window length in hours used for this computation. */
  windowHours: number;
  /** ISO-8601 generation timestamp. */
  generatedAt: string;
  /** Optional warning (e.g. token_mentions not initialized). */
  warning?: string;
  /** Degraded contract passthrough from healthFn. */
  consecutiveEmptyBatches?: number;
  degradedSince?: number;
}

/** Dominant-narrative entry per token. */
export interface TokenNarrativeEntry {
  narrativeId: string;
  narrativeDelta: number | null;
}

/** Post handed to classifyFn. */
export interface NarrativeClassifyPost {
  id: string;
  text: string;
}

/** classifyFn result item. */
export interface NarrativeClassification {
  id: string;
  narrativeId: string;
}

/** Seam: classify a batch of post texts into narrative ids. */
export type NarrativeClassifyFn = (
  posts: NarrativeClassifyPost[]
) => Promise<NarrativeClassification[]> | NarrativeClassification[];

/** Taxonomy entry. */
export interface NarrativeTaxonomyEntry {
  id: string;
  label: string;
  keywords?: string[];
}

/** Engine seam configuration. */
export interface NarrativeTrackerOptions {
  /** better-sqlite3 Database (or anything exposing prepare/exec). */
  db?: unknown;
  /** Freshness probe; returns { degraded, consecutiveEmptyBatches?, degradedSince? }. */
  healthFn?: () => {
    degraded?: boolean;
    consecutiveEmptyBatches?: number;
    degradedSince?: number;
  };
  /** Watchlist shape ({ tokens: [...] }). */
  watchlist?: { tokens?: Array<{ symbol?: string; contract?: string; chain?: string }> };
  /** Clock injection (ms). */
  now?: () => number;
  /** Narrative taxonomy entries. */
  taxonomy?: NarrativeTaxonomyEntry[];
  /** Default window hours (default 24). */
  hours?: number;
  /** Minimum distinct baseline days before delta7d is computed (default 3). */
  minBaselineDays?: number;
  /** Share threshold for emergent cluster promotion (default 0.05). */
  emergentMinShare?: number;
  /** Minimum posts for emergent cluster promotion (default 10). */
  emergentMinPosts?: number;
  /** Follower weighting bands (same shape as mindshare). */
  followerBands?: Array<{ min?: number; max?: number; weight?: number }>;
  /** Engagement weights { likes, retweets, replies }. */
  weights?: { likes?: number; retweets?: number; replies?: number };
  /** Injectable classifier; default = JevBrain batchDecide, keyword fallback on throw. */
  classifyFn?: NarrativeClassifyFn;
}

/** Engine returned by createNarrativeTracker. */
export interface NarrativeTracker {
  computeNarratives(options?: {
    hours?: number;
  }): Promise<NarrativeComputeResult>;
  tokenNarratives(options?: {
    hours?: number;
  }): Promise<Map<string, TokenNarrativeEntry>>;
  emergingNarratives(options?: { hours?: number }): Promise<NarrativeItem[]>;
  /** keywordMatch bound to engine taxonomy. */
  keywordMatch(text: string): string;
  extractBigrams(text: string): string[];
}

/** Create an isolated tracker instance (testable seam). */
export function createNarrativeTracker(opts?: NarrativeTrackerOptions): NarrativeTracker;

/** Process-lazy singleton. */
export function getDefaultNarrativeTracker(): NarrativeTracker;

/** Reset the process-lazy singleton (tests). */
export function resetDefaultNarrativeTracker(): void;

/** Deterministic keyword fallback: returns taxonomy id or '__other__'. */
export function keywordMatch(text: string, taxonomy?: NarrativeTaxonomyEntry[]): string;

/** Extract top bigrams from text (for emergent clustering). */
export function extractBigrams(text: string): string[];
