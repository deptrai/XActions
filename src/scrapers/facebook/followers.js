// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @deprecated Use `src/scrapers/social/facebook/index.js` (`FacebookCrawler`, `FacebookClient`) instead. See docs/deprecation-plan.md.
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — followers.js
import { randomDelay, FACEBOOK_BASE, NON_PROFILE_SEGMENTS, assertFacebookUrlLocal } from './core.js';
import { normalizeHandle, normalizeFollower, normalizeGroupMember } from './normalize.js';


// ============================================================================
// Followers Scraper
// ============================================================================

/**
 * Scrape followers of a Facebook profile or page.
 * Returns an array when the list is publicly accessible (Pages),
 * or a note object when restricted (personal profiles).
 *
 * @deprecated Use `FacebookCrawler.start({ action: 'followers', args: { username, limit } })` from `src/scrapers/social/facebook/crawler.js` instead.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} username - Handle, @handle, or full facebook.com URL
 * @param {FacebookOptions} options
 * @returns {Promise<Record<string, unknown>[] | { note: string, username: string, platform: 'facebook' }>} Follower array OR { note, username, platform } if restricted
 */
export async function scrapeFollowers(page, username, options = {}) {
  const { limit = 100, onProgress, maxRetries = 10, delay = randomDelay } = options;
  const handle = normalizeHandle(username);
  // profile.php?id=N takes the followers tab via &sk=followers, not a /followers path
  // (appending /followers to a query string lands inside the query value and breaks).
  const followersUrl = /^profile\.php\?id=\d+/i.test(handle)
    ? `${FACEBOOK_BASE}/${handle}&sk=followers`
    : `${FACEBOOK_BASE}/${handle}/followers`;

  await page.goto(followersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000, 4000);

  // Deterministic exposure check: a real, public follower list renders follower
  // rows as [role="listitem"]. The mere presence of the word "followers" in page
  // chrome/headings is NOT a signal (it appears on every /followers page, including
  // restricted profiles) — so we rely solely on actual list-item rows.
  const exposedCount = await page.evaluate(
    () => document.querySelectorAll('[role="listitem"]').length
  );

  if (exposedCount === 0) {
    return {
      note: 'Facebook follower list is not publicly exposed for this profile. Only Pages with public follower settings expose individual follower data.',
      username: handle,
      platform: /** @type {'facebook'} */ ('facebook'),
    };
  }

  const followers = new Map();
  let retries = 0;

  while (followers.size < limit && retries < maxRetries) {
    const rawFollowers = /** @type {Record<string, unknown>[]} */ (await page.evaluate((nonProfile) => {
      const items = document.querySelectorAll('[role="listitem"]');
      const NON_PROFILE = new Set(nonProfile);
      return Array.from(items).map((item) => {
        const anchors = Array.from(item.querySelectorAll('a[href]'));
        let url = null;
        let username = null;
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          // profile.php?id=N → canonical numeric identifier
          const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
          if (idMatch) {
            url = `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
            username = `profile.php?id=${idMatch[1]}`;
            break;
          }
          // vanity handle as first path segment (skip known non-profile segments)
          const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
          if (segMatch && !NON_PROFILE.has(segMatch[1].toLowerCase())) {
            url = abs.split('?')[0];
            username = segMatch[1];
            break;
          }
        }
        const nameEl = item.querySelector('span, strong');
        const name = nameEl?.textContent?.trim() || null;
        const id = url || name;
        return { id, name, username, url };
      }).filter((f) => f.id);
    }, NON_PROFILE_SEGMENTS));

    const prevSize = followers.size;
    for (const raw of rawFollowers) {
      if (!followers.has(raw.id)) {
        followers.set(raw.id, normalizeFollower({ name: raw.name, username: raw.username, url: raw.url }));
      }
    }

    if (onProgress) onProgress({ scraped: followers.size, limit });
    if (followers.size === prevSize) { retries++; } else { retries = 0; }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(followers.values()).slice(0, limit));
}

/**
 * Scrape the member list of a Facebook group (Story 4.6 — FR-20).
 * READ-ONLY scrape — NOT routed through runGuardedBatch (NFR-7 lists only writes).
 * No account-risk warning (NFR-8 lists only writes). Standard 1-3s scroll delay (NFR1).
 *
 * Returns an array of normalized members when the list is accessible,
 * or a { note, platform } object when the list is restricted/unavailable.
 *
 * @deprecated Use `FacebookCrawler.start({ action: 'group_members', args: { groupUrl, limit } })` from `src/scrapers/social/facebook/crawler.js` instead.
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com group URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>[] | { note: string, platform: 'facebook' }>}
 */
export async function scrapeGroupMembers(page, groupUrl, options = {}) {
  const {
    limit = 100,
    maxStalls = 5,
    delay = randomDelay,
    onProgress,
  } = options;

  // AC5: URL validation before any navigation (SSRF guard).
  assertFacebookUrlLocal(groupUrl, 'scrapeGroupMembers: groupUrl');

  // Navigate to the group members tab (UNVERIFIED URL pattern — see selectors-facebook.md).
  const membersUrl = groupUrl.replace(/\/$/, '') + '/members';
  await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(1000, 3000);

  // Detect member list — look for member links pattern: /groups/{groupId}/user/{userId}/
  // This is the actual Facebook DOM structure (verified August 2026).
  let containerFound = false;
  try {
    // Wait for any member link to appear
    await page.waitForSelector('a[href*="/groups/"][href*="/user/"]', { timeout: 8000 });
    containerFound = true;
  } catch (_) {
    // Member list not accessible → restricted group
  }

  if (!containerFound) {
    return {
      note: 'Facebook group member list is not accessible. The group may be private, membership may be required, or the admin has disabled the member list.',
      platform: /** @type {'facebook'} */ ('facebook'),
    };
  }

  // AC4: Bounded scroll loop — stall detection + limit cap.
  const members = new Map();
  let stalls = 0;

  while (members.size < limit && stalls < maxStalls) {
    const prevSize = members.size;

    // Extract member links directly from DOM.
    // Facebook renders members as links: /groups/{groupId}/user/{userId}/
    const rawMembers = /** @type {FacebookGroupMember[]} */ (await page.evaluate(() => {
      /** @type {FacebookGroupMember[]} */
      const results = [];
      document.querySelectorAll('a[href*="/groups/"][href*="/user/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const name = a.textContent?.trim() || '';
        if (name && href && name.length > 1 && name.length < 100) {
          const fullUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          results.push({
            name,
            profileUrl: fullUrl.split('?')[0],
            username: href.split('/').filter(Boolean).pop() || undefined,
            platform: /** @type {'facebook'} */ ('facebook'),
          });
        }
      });
      return results;
    }));

    for (const raw of rawMembers) {
      if (!members.has(raw.profileUrl)) {
        members.set(raw.profileUrl, normalizeGroupMember(raw));
      }
      if (members.size >= limit) break;
    }

    if (onProgress) onProgress({ scraped: members.size, limit });

    if (members.size === prevSize) {
      stalls++;
    } else {
      stalls = 0;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000, 3000);
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(members.values()).slice(0, limit));
}
