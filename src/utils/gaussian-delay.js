// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Gaussian delay helpers for CDP human-behavior simulation.
 * Reuses Box-Muller implementation from `antiDetection.js` and clamps the
 * result to the requested [min, max] interval.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { gaussianRandom as baseGaussianRandom } from '../agents/antiDetection.js';

/**
 * Validate arguments shared by gaussianRandom and gaussianDelay.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} [mean]
 * @param {number} [stdDev]
 */
function validateJitterArgs(min, max, mean, stdDev) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new TypeError('gaussian jitter min and max must be finite numbers');
  }
  if (min < 0 || max < 0) {
    throw new TypeError('gaussian jitter min and max must be non-negative');
  }
  if (mean !== undefined && !Number.isFinite(mean)) {
    throw new TypeError('gaussian jitter mean must be a finite number');
  }
  if (stdDev !== undefined && (!Number.isFinite(stdDev) || stdDev < 0)) {
    throw new TypeError('gaussian jitter stdDev must be a finite non-negative number');
  }
}

/**
 * Generate a Gaussian-distributed random value clamped to [min, max].
 *
 * @param {number} [min=3000]
 * @param {number} [max=7000]
 * @param {number} [mean]
 * @param {number} [stdDev]
 * @returns {number}
 */
export function gaussianRandom(min = 3000, max = 7000, mean, stdDev) {
  validateJitterArgs(min, max, mean, stdDev);
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  const targetMean = mean ?? (lo + hi) / 2;
  const targetStdDev = stdDev ?? (hi - lo) / 6;
  const raw = baseGaussianRandom(targetMean, targetStdDev);
  return Math.min(Math.max(raw, lo), hi);
}

/**
 * Sleep for a Gaussian-distributed duration with optional cancellation signal.
 *
 * @param {number} [min=3000]
 * @param {number} [max=7000]
 * @param {number} [mean]
 * @param {number} [stdDev]
 * @param {AbortSignal} [signal]
 * @returns {Promise<number>} milliseconds slept
 */
export async function gaussianDelay(min = 3000, max = 7000, mean, stdDev, signal) {
  const ms = Math.max(0, Math.round(gaussianRandom(min, max, mean, stdDev)));
  if (signal?.aborted) return 0;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(undefined);
      }, { once: true });
    }
  });
  return ms;
}
