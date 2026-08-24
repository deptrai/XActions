// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Standard Gaussian random number using Box-Muller transform.
 * @param {number} [mean=0]
 * @param {number} [stdev=1]
 * @returns {number}
 */
function boxMuller(mean = 0, stdev = 1) {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z * stdev + mean;
}

/**
 * Generate a random number with Gaussian distribution clamped to [min, max].
 *
 * @param {number} [min=3000] - Minimum delay in milliseconds.
 * @param {number} [max=7000] - Maximum delay in milliseconds.
 * @param {number} [mean] - Target average delay.
 * @param {number} [stdDev] - Standard deviation (default covers ~99.7% of range in 3 sigma).
 * @returns {number} Delay in milliseconds clamped to [min, max].
 */
export function gaussianRandom(min = 3000, max = 7000, mean, stdDev) {
  const [lo, hi] = min <= max ? [min, max] : [max, min];
  const targetMean = mean ?? (lo + hi) / 2;
  const targetStdDev = stdDev ?? (hi - lo) / 6;
  const raw = boxMuller(targetMean, targetStdDev);
  return Math.min(Math.max(raw, lo), hi);
}

/**
 * Asynchronously wait for a Gaussian-distributed delay.
 *
 * @param {number} [min=3000] - Minimum delay in ms.
 * @param {number} [max=7000] - Maximum delay in ms.
 * @param {number} [mean] - Mean delay in ms.
 * @param {number} [stdDev] - Standard deviation in ms.
 * @returns {Promise<number>} Resolves with the actual delay in ms.
 */
export async function gaussianDelay(min = 3000, max = 7000, mean, stdDev) {
  const ms = Math.round(gaussianRandom(min, max, mean, stdDev));
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}
