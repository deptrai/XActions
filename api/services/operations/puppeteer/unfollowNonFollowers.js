// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import {
  createPage,
  navigateToTwitter,
  checkAuthentication,
  getFollowing,
  getFollowers,
  unfollowUser,
  randomDelay,
} from '../../browserAutomation.js';
import {
  evaluateUnfollowTargets,
  isJevCognitiveUnfollowEnabled,
  isConfidentUnfollowVerdict,
  resolveUnfollowMaxEvals,
} from '../../../../src/automation/jevUnfollowGuard.js';

/**
 * @typedef {object} UnfollowNonFollowersBrowserConfig
 * @property {string} sessionCookie
 * @property {string} [username]
 * @property {number} [maxUsers]
 * @property {number} [limit]
 * @property {number} [maxUnfollows]
 * @property {boolean} [dryRun]
 * @property {string[]} [excludeUsernames]
 * @property {boolean} [excludeVerified]
 * @property {number} [delayMs]
 */

/**
 * @param {string} userId
 * @param {UnfollowNonFollowersBrowserConfig} config
 * @param {(message: string) => void} updateProgress
 * @returns {Promise<Record<string, unknown>>}
 */
async function unfollowNonFollowersBrowser(userId, config, updateProgress) {
  const page = await createPage(config.sessionCookie);

  try {
    await navigateToTwitter(page);

    const isAuth = await checkAuthentication(page);
    if (!isAuth) {
      throw new Error('Session expired - please reconnect your X account');
    }

    // Callers may omit config.username (e.g. the session-cookie AI API) —
    // derive the logged-in handle from the profile nav link on the home page.
    let accountUsername = config.username;
    if (!accountUsername) {
      try {
        accountUsername =
          (await page.evaluate(() => {
            const href =
              document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '';
            return href.replace(/^\//, '').split('/')[0] || '';
          })) || undefined;
      } catch {
        accountUsername = undefined;
      }
    }
    if (!accountUsername) {
      throw new Error('Could not detect account username — pass config.username');
    }

    const maxUsers = config.maxUsers || 1000;

    updateProgress('Fetching your following list...');
    const following = await getFollowing(config.sessionCookie, accountUsername, maxUsers);

    updateProgress(`Found ${following.length} accounts you follow`);

    updateProgress('Fetching your followers list...');
    const followers = await getFollowers(config.sessionCookie, accountUsername, maxUsers);

    updateProgress(`Found ${followers.length} followers`);

    const followerUsernames = new Set(followers.map((f) => String(f.username || '')));
    const excluded = new Set(
      (Array.isArray(config.excludeUsernames) ? config.excludeUsernames : [])
        .map((u) => String(u || '').replace(/^@/, '').toLowerCase()),
    );
    const nonFollowers = following.filter((f) => {
      const uname = String(f.username || '');
      if (followerUsernames.has(uname)) return false;
      if (excluded.has(uname.toLowerCase())) return false;
      if (config.excludeVerified && f.verified) return false;
      return true;
    });

    updateProgress(`Identified ${nonFollowers.length} accounts that don't follow you back`);

    if (nonFollowers.length === 0) {
      return {
        success: true,
        dryRun: Boolean(config.dryRun),
        unfollowed: [],
        failed: [],
        keptByJev: [],
        verdicts: [],
        wouldUnfollow: [],
        jevDegraded: 0,
        totalProcessed: 0,
        message: 'Everyone you follow also follows you back!',
      };
    }

    /** @type {string[]} */
    const unfollowed = [];
    /** @type {Record<string, unknown>[]} */
    const failed = [];
    /** @type {string[]} — accounts the Jev guard kept (keep_* / low-conf / degraded) */
    const keptByJev = [];
    // Routes send config.maxUnfollows; older callers send config.limit.
    const limit = config.limit ?? config.maxUnfollows ?? nonFollowers.length;
    const delayMs = Math.max(Number(config.delayMs) || 2000, 1000);

    // Story 42.8 — Jev cognitive unfollow guard (fail-safe toward keeping).
    // Pre-pass over the operative slice, separated from browser pacing: paid
    // decide calls run at p-limit(8) before the slow 3–7s unfollow loop.
    // Fail-safe on budget too: when the guard is enabled, the operative slice
    // is capped at the eval budget — beyond-budget candidates are kept
    // (deferred to a later run), never unfollowed unevaluated.
    const jevActive = isJevCognitiveUnfollowEnabled();
    const maxEvals = jevActive ? Math.max(0, resolveUnfollowMaxEvals()) : 0;
    const total = jevActive
      ? Math.min(nonFollowers.length, limit, maxEvals)
      : Math.min(nonFollowers.length, limit);
    const candidates = nonFollowers.slice(0, total);

    /** @type {Map<string, {choice: string, confidence: number}>} */
    let verdicts = new Map();
    let jevDegraded = 0;
    /** @type {Set<string>} — usernames the guard evaluated and did NOT clear for unfollow */
    const kept = new Set();
    if (jevActive && candidates.length > 0) {
      updateProgress(`Jev is evaluating ${candidates.length} non-followers...`);
      try {
        const res = await evaluateUnfollowTargets(candidates, { maxEvals });
        verdicts = res.verdicts;
        jevDegraded = res.degraded;
      } catch {
        // Guard is designed never to throw — belt & suspenders: a total
        // failure keeps every evaluated candidate (fail-safe polarity).
        jevDegraded = candidates.length;
      }
      // Same validity filter the guard applies before its own slice: entries
      // without a non-empty username never got a verdict and are skipped by
      // the loop anyway (kept membership is keyed by username).
      for (const user of candidates) {
        if (!user || typeof user !== 'object') continue;
        const username = String(user.username || '');
        if (!username) continue;
        if (!isConfidentUnfollowVerdict(verdicts.get(username))) kept.add(username);
      }
    }

    // Story 42.8 — dryRun handling (pre-existing gap: routes already pass
    // config.dryRun but the executor ignored it, so queued dry-runs unfollowed
    // for real). Evaluate for preview verdicts, never call unfollowUser.
    if (config.dryRun) {
      const preview = candidates.map((user) => {
        const username = String(user.username || '');
        const v = verdicts.get(username);
        const keptFlag = jevActive && (!username || kept.has(username));
        if (keptFlag && username) keptByJev.push(username);
        return {
          username,
          choice: v?.choice ?? null,
          confidence: v?.confidence ?? 0,
          wouldUnfollow: !keptFlag,
        };
      });
      return {
        success: true,
        dryRun: true,
        verdicts: preview,
        wouldUnfollow: preview.filter((p) => p.wouldUnfollow).map((p) => p.username),
        keptByJev,
        jevDegraded,
        unfollowed: [],
        failed: [],
        totalProcessed: 0,
        nonFollowers: nonFollowers.map((u) => u.username),
      };
    }

    for (let i = 0; i < total; i++) {
      const user = nonFollowers[i];
      const username = String(user.username || '');

      // Degenerate entry — never unfollow a nameless account.
      if (!username) continue;

      if (kept.has(username)) {
        const v = verdicts.get(username);
        keptByJev.push(username);
        updateProgress(
          `Keeping ${username} (${i + 1}/${total})` +
            (v ? ` — Jev: ${v.choice || 'no-verdict'} conf=${v.confidence.toFixed(2)}` : ' — Jev: degraded'),
        );
        // Kept accounts still occupy a pacing slot — honor the safety pause.
        if ((i + 1) % 10 === 0) {
          updateProgress(`Pausing for safety (${i + 1}/${total} completed)...`);
          await randomDelay(15000, 30000);
        }
        continue;
      }

      const v = verdicts.get(username);
      updateProgress(
        `Unfollowing ${username} (${i + 1}/${total})` +
          (jevActive && v ? ` — Jev: ${v.choice} conf=${v.confidence.toFixed(2)}` : ''),
      );

      const result = await unfollowUser(page, username);

      if (result.success) {
        unfollowed.push(username);
      } else {
        failed.push({ username, error: result.error });
      }

      await randomDelay(delayMs, delayMs + 4000);

      if ((i + 1) % 10 === 0) {
        updateProgress(`Pausing for safety (${i + 1}/${total} completed)...`);
        await randomDelay(15000, 30000);
      }
    }

    return {
      success: true,
      unfollowed,
      failed,
      keptByJev,
      jevDegraded,
      nonFollowers: nonFollowers.map((u) => u.username),
      totalProcessed: unfollowed.length + failed.length + keptByJev.length,
    };
  } finally {
    await page.close();
  }
}

export { unfollowNonFollowersBrowser };
