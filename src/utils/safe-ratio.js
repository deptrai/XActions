// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Safe Ratio Utility (metrics-catalog.md) — prevents division by zero or NaN crashes.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Perform division with safe fallback for zero/null/undefined denominators.
 * @param {number | null | undefined} numerator
 * @param {number | null | undefined} denominator
 * @param {number} [fallback=1.0]
 * @returns {number}
 */
export function safeRatio(numerator, denominator, fallback = 1.0) {
  if (
    denominator === 0 ||
    denominator === null ||
    denominator === undefined ||
    Number.isNaN(Number(denominator))
  ) {
    return fallback;
  }
  if (
    numerator === null ||
    numerator === undefined ||
    Number.isNaN(Number(numerator))
  ) {
    return 0;
  }
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : fallback;
}
