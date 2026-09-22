// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../../lib/prisma.js';
import { getTwitterClient } from '../../routes/twitter.js';
import {
  evaluateUnfollowTargets,
  isJevCognitiveUnfollowEnabled,
  isConfidentUnfollowVerdict,
  resolveUnfollowMaxEvals,
} from '../../../src/automation/jevUnfollowGuard.js';

/**
 * @typedef {object} UnfollowNonFollowersConfig
 * @property {number} [maxUnfollows]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} ProcessUnfollowNonFollowersOptions
 * @property {string} operationId
 * @property {string} userId
 * @property {UnfollowNonFollowersConfig} config
 */

/**
 * @param {ProcessUnfollowNonFollowersOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function processUnfollowNonFollowers({ operationId, userId, config }) {
  try {
    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'processing', startedAt: new Date() }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.twitterAccessToken) {
      throw new Error('User not found or Twitter not connected');
    }

    const client = /** @type {import('axios').AxiosInstance} */ (await getTwitterClient(user));
    const { maxUnfollows = 100, dryRun = false } = config;

    const meResponse = await client.get('/users/me');
    const meData = /** @type {TwitterApiEnvelope} */ (meResponse.data);
    const meInner = /** @type {Record<string, unknown>} */ (meData.data);
    const myTwitterId = String(meInner.id);

    const followingResponse = await client.get(`/users/${myTwitterId}/following`, {
      params: {
        max_results: 1000,
        // Story 42.8 — Jev guard needs bio/verified/follower count to classify;
        // username-only would starve the verdict to a low-confidence keep.
        'user.fields': 'username,name,description,verified,public_metrics'
      }
    });
    const followingData = /** @type {TwitterApiEnvelope} */ (followingResponse.data);
    /** @type {TwitterApiUser[]} */
    const following = /** @type {TwitterApiUser[]} */ (followingData.data || []);

    /** @type {TwitterApiUser[]} */
    const nonFollowers = [];
    /** @type {string[]} — accounts the Jev guard kept (keep_* / low-conf / degraded / beyond-budget) */
    const keptByJev = [];
    /** @type {Array<{username: string, choice: string | null, confidence: number}>} — per-user Jev verdicts (preview parity with the browser path) */
    const jevVerdicts = [];
    let unfollowedCount = 0;
    let jevDegraded = 0;
    // Story 42.8 — paid-call budget for the fused loop: at most
    // JEV_UNFOLLOW_MAX_EVALS decide calls per run (default 300). Candidates
    // beyond the budget are KEPT (deferred), never unfollowed unevaluated.
    const jevActive = isJevCognitiveUnfollowEnabled();
    const jevBudget = jevActive ? Math.max(0, resolveUnfollowMaxEvals()) : 0;
    let jevEvaluated = 0;

    for (const followedUser of following) {
      // Cap both unfollows performed AND candidates scanned — Jev-kept
      // accounts no longer advance unfollowedCount, so without the second
      // bound the loop would scan the whole following list.
      if (unfollowedCount >= maxUnfollows || nonFollowers.length >= maxUnfollows) break;

      try {
        const followersResponse = await client.get(`/users/${followedUser.id}/followers`, {
          params: {
            max_results: 1000
          }
        });
        const followersData = /** @type {TwitterApiEnvelope} */ (followersResponse.data);
        /** @type {TwitterApiUser[]} */
        const followerList = /** @type {TwitterApiUser[]} */ (followersData.data || []);

        const followsBack = followerList.some(/** @param {TwitterApiUser} follower */ (follower) =>
          String(follower.id) === myTwitterId
        );

        if (!followsBack) {
          nonFollowers.push(followedUser);

          // Story 42.8 — inline Jev guard inside the fused loop, right before
          // the delete. Fail-safe: only a confident `unfollow_*` verdict
          // permits the unfollow; keep_*/low-conf/degraded all keep — and
          // candidates beyond the eval budget are kept too (deferred).
          let jevKeep = false;
          if (jevActive) {
            if (jevEvaluated < jevBudget) {
              jevEvaluated++;
              try {
                const { verdicts, degraded } = await evaluateUnfollowTargets([{
                  username: followedUser.username,
                  name: followedUser.name,
                  bio: followedUser.description,
                  verified: followedUser.verified,
                  followersCount: followedUser.public_metrics?.followers_count,
                }]);
                jevDegraded += degraded;
                const verdict = verdicts.get(String(followedUser.username || ''));
                jevKeep = !isConfidentUnfollowVerdict(verdict);
                jevVerdicts.push({
                  username: String(followedUser.username || ''),
                  choice: verdict?.choice ?? null,
                  confidence: verdict?.confidence ?? 0,
                });
              } catch {
                // Guard never throws by design — a total failure keeps the account.
                jevDegraded++;
                jevKeep = true;
              }
            } else {
              // Eval budget exhausted — keep (defer), never unfollow unevaluated.
              jevKeep = true;
            }
            if (jevKeep && followedUser.username) keptByJev.push(followedUser.username);
          }

          if (!dryRun && !jevKeep) {
            await client.delete(`/users/${myTwitterId}/following/${followedUser.id}`);
            unfollowedCount++;

            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error checking user ${followedUser.username}:`, message);
      }
    }

    return {
      unfollowedCount: dryRun ? 0 : unfollowedCount,
      nonFollowersFound: nonFollowers.length,
      nonFollowers: nonFollowers.map(/** @param {TwitterApiUser} u */ (u) => u.username),
      keptByJev,
      jevDegraded,
      verdicts: jevVerdicts,
      dryRun
    };
  } catch (error) {
    console.error('❌ Unfollow non-followers error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export { processUnfollowNonFollowers };
