// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevUnfollowGuard (Story 42.8) public surface.
 * Cognitive classification of non-followers before unfollow — fail-safe
 * toward keeping. See jevUnfollowGuard.js for full docs.
 */

export interface UnfollowVerdict {
  choice: string;
  confidence: number;
}

export interface EvaluateUnfollowTargetsOptions {
  /** injected JevBrain (tests fake at this IO boundary) */
  brain?: any;
  /** per-run evaluation cap override (default: env / 300) */
  maxEvals?: number;
  /** injected p-limit factory (tests) */
  pLimit?: any;
}

export interface EvaluateUnfollowTargetsResult {
  /** username -> raw Jev answer (includes keep_* and low-confidence entries) */
  verdicts: Map<string, UnfollowVerdict>;
  /** count of candidates whose evaluation produced no signal */
  degraded: number;
}

export declare function isJevCognitiveUnfollowEnabled(
  val?: string | boolean | undefined | null,
): boolean;

export declare function resolveUnfollowThreshold(
  val?: string | number | undefined | null,
): number;

export declare function resolveUnfollowMaxEvals(
  val?: string | number | undefined | null,
): number;

export declare function isConfidentUnfollowVerdict(
  verdict?: { choice?: string; confidence?: number } | null,
  threshold?: number,
): boolean;

export declare function evaluateUnfollowTargets(
  users: Array<Record<string, any>>,
  options?: EvaluateUnfollowTargetsOptions,
): Promise<EvaluateUnfollowTargetsResult>;

declare const _default: {
  evaluateUnfollowTargets: typeof evaluateUnfollowTargets;
  isJevCognitiveUnfollowEnabled: typeof isJevCognitiveUnfollowEnabled;
  resolveUnfollowThreshold: typeof resolveUnfollowThreshold;
  resolveUnfollowMaxEvals: typeof resolveUnfollowMaxEvals;
  isConfidentUnfollowVerdict: typeof isConfidentUnfollowVerdict;
};

export default _default;
