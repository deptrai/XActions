// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevVariantJudge (Story 42.9) public surface.
 * Jev-as-a-Judge variant selection + cringe filter for generated
 * tweets/replies. See jevVariantJudge.js for full docs.
 */

export interface JudgePostVariantsOptions {
  /** injected JevBrain (tests fake at this IO boundary) */
  brain?: any;
  /** cringe ceiling override (default: env JEV_THRESHOLD_CRINGE / 0.30) */
  cringeThreshold?: number;
}

export interface JudgePostVariantsResult {
  /** 0-based winning variant, or -1 when every variant fails the cringe gate */
  selectedIndex: number;
  /** per-variant cringe (noul) scores aligned with input ([] when degraded) */
  cringe: number[];
  /** Jev's raw pick ('variant_N' | 'none_good' | null) — observability, not trusted */
  pickChoice: string | null;
  /** confidence of Jev's pick (0 when absent) — exposed, never gates */
  pickConfidence: number;
  /** true on kill-switch / missing key / degraded plane / error — variants pass through */
  degraded: boolean;
}

export declare function isJevVariantJudgeEnabled(
  val?: string | boolean | undefined | null,
): boolean;

export declare function resolveCringeThreshold(
  val?: string | number | undefined | null,
): number;

export declare function resolveVariantJudgeMaxReroll(
  val?: string | number | undefined | null,
): number;

export declare function judgePostVariants(
  texts: Array<string | any>,
  options?: JudgePostVariantsOptions,
): Promise<JudgePostVariantsResult>;

declare const _default: {
  judgePostVariants: typeof judgePostVariants;
  isJevVariantJudgeEnabled: typeof isJevVariantJudgeEnabled;
  resolveCringeThreshold: typeof resolveCringeThreshold;
  resolveVariantJudgeMaxReroll: typeof resolveVariantJudgeMaxReroll;
};

export default _default;
