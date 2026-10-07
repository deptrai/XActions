---
title: "Follow a Competitor's Followers on X (Twitter) — Free 2026"
description: "Steal your competitor's audience on X/Twitter. Auto-follow their followers with smart filters. Free browser script, no API key."
keywords: ["follow competitor followers twitter", "steal twitter audience", "follow target followers X", "twitter follower growth hack", "auto follow competitor fans", "twitter follow target users script", "grow twitter by following competitors", "medirus follow target followers", "twitter audience stealing 2026", "follow niche audience twitter free"]
canonical: "https://medirus.online/examples/follow-target-followers"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 👥 Follow a Competitor's Followers on X (Twitter) — Steal Their Audience

> **Automatically follow the followers (or following) of any target account on X/Twitter — with smart filters for follower count, bio keywords, and ratio.** Free, no API key, no app install.

**Works on:** 🌐 Browser Console (requires `core.js`)
**Difficulty:** 🟡 Intermediate
**Time:** ⏱️ 5–30 minutes per target account
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [follow-target-followers.md](../follow-target-followers.md)

---

## 🎯 Real-World Scenario

You're launching a DeFi protocol and you need to build a Twitter audience fast. You know that the followers of @vitalikbuterin, @naval, and @aaboronkov are exactly the type of people who would be interested in your project — they're crypto-native, technically savvy, and actively engaged. But manually visiting each competitor's followers page and clicking "Follow" hundreds of times would take **hours** and you'd have no way to filter out bots, inactive accounts, or mega-influencers who never follow back.

Medirus' Follow Target Followers script navigates to any account's follower or following list, applies smart filters (minimum followers, bio keywords, ratio checks), and follows matching users automatically with 3s+ delays. You configure your target accounts, set your filters, and let the script build your audience while you focus on shipping features.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────────────┐
│  Growing Your Twitter Audience (Manual)                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  9:00 AM  Go to @naval's profile                             │
│  9:01 AM  Click "Followers"                                  │
│  9:02 AM  Scroll... see 1,000+ accounts                      │
│  9:03 AM  Click Follow on someone. Check their bio first.    │
│  9:05 AM  This one has 3 followers. Skip.                    │
│  9:06 AM  This one is private. Skip.                         │
│  9:08 AM  This one looks good. Follow.                       │
│  9:10 AM  Scroll more... repeat...                           │
│  10:00 AM Give up. Followed 12 people in an hour.            │
│                                                              │
│  Follows/hour: ~12         Quality: random                   │
│  Follow-back rate: ~15%    (no filtering = low quality)      │
└──────────────────────────────────────────────────────────────┘
```

**After Medirus:**

```
┌──────────────────────────────────────────────────────────────┐
│  Growing Your Twitter Audience (Medirus)                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  9:00 AM  Configure script: targets = naval, vitalik         │
│  9:01 AM  Set filters: 100-50K followers, must have bio      │
│  9:02 AM  Paste core.js + script. Press Enter.               │
│  9:02 AM  Script navigates to @naval/followers               │
│           ✅ Followed @cryptodev (2.1K followers, has bio)   │
│           ⏭️ Skipped @bot123 (2 followers, no bio)            │
│           ✅ Followed @web3builder (890 followers, DeFi bio) │
│  9:15 AM  Moves to @vitalik/followers...                     │
│  9:30 AM  ✅ Done! Followed 50 filtered users.               │
│                                                              │
│  Follows/hour: ~50         Quality: pre-filtered             │
│  Follow-back rate: ~35%    (smart filters = higher quality)  │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

1. 📍 **Navigates to target account's follower/following list** — goes to `x.com/USERNAME/followers` or `x.com/USERNAME/following`
2. 🔍 **Scans each user cell** — extracts username, bio, follower count, verified status, protected status
3. 🧹 **Applies smart filters** — checks min/max followers, bio presence, bio keywords, ratio, protected/verified status
4. ⏭️ **Skips non-matching users** — too few followers, no bio, private accounts, already following
5. ➕ **Follows matching users** — clicks the Follow button with 3s+ delays between actions
6. 💾 **Tracks followed users** — saves to `sessionStorage` so re-runs don't double-follow
7. 🔄 **Scrolls for more** — loads more users by scrolling down the list
8. 📊 **Reports results** — prints how many followed, skipped, and why

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  [For each TARGET_ACCOUNT]                                   │
│          │                                                   │
│          ▼                                                   │
│  [Navigate to x.com/TARGET/followers]                        │
│          │                                                   │
│          ▼                                                   │
│  [Wait for user cells to load]                               │
│          │                                                   │
│          ▼                                                   │
│  ┌── [For each UserCell] ──────────────────────────────┐     │
│  │                                                     │     │
│  │  [Extract: username, bio, followers, verified]      │     │
│  │          │                                          │     │
│  │          ▼                                          │     │
│  │  [Already processed?] ──Yes──→ [Skip]               │     │
│  │          │ No                                       │     │
│  │          ▼                                          │     │
│  │  [Already following?] ──Yes──→ [Skip]               │     │
│  │          │ No                                       │     │
│  │          ▼                                          │     │
│  │  [Meets filters?] ──No──→ [Skip + log reason]      │     │
│  │          │ Yes                                      │     │
│  │          ▼                                          │     │
│  │  [Click Follow button]                              │     │
│  │          │                                          │     │
│  │          ▼                                          │     │
│  │  [Wait 3-4.5s delay]                                │     │
│  │          │                                          │     │
│  │          ▼                                          │     │
│  │  [Max follows reached?] ──Yes──→ [Next target]      │     │
│  │          │ No                                       │     │
│  │          ▼                                          │     │
│  │  [Scroll for more users]                            │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│          │                                                   │
│          ▼                                                   │
│  [Print session summary]                                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Everyone — requires pasting `core.js` first, then this script.

### Prerequisites

- [x] Logged into your X/Twitter account in a web browser
- [x] On a desktop/laptop (not mobile)
- [x] On `x.com` (any page — the script navigates automatically)

### Step 1: Paste `core.js` first

> Navigate to `x.com/home`. Open DevTools Console (`F12` → Console). Paste the contents of [`src/automation/core.js`](https://github.com/nichxbt/xactions/blob/main/src/automation/core.js) and press Enter. You'll see `✅ Medirus Core loaded`.

### Step 2: Configure and paste the script

Edit the `CONFIG` section to add your target accounts and filters, then paste:

```javascript
// ============================================
// Medirus - Follow Target's Followers
// by nichxbt — https://medirus.online
// REQUIRES: Paste core.js first!
// ============================================

(() => {
  if (!window.Medirus?.Core) {
    console.error('❌ Core module not loaded! Paste core.js first.');
    return;
  }

  const { log, sleep, randomDelay, scrollBy, clickElement,
          waitForElement, storage, SELECTORS, extractUserFromCell } = window.Medirus.Core;

  // ============================================
  // CONFIGURATION — edit these!
  // ============================================
  const CONFIG = {
    // Target accounts — follow their followers or following
    TARGET_ACCOUNTS: [
      'naval',        // Replace with your competitors
      'vitalikbuterin',
    ],

    // 'followers' or 'following'
    LIST_TYPE: 'followers',

    // Follow limits
    MAX_FOLLOWS_PER_ACCOUNT: 20,
    TOTAL_MAX_FOLLOWS: 50,

    // ── FILTERS ──
    FILTERS: {
      MIN_FOLLOWERS: 100,        // Skip tiny accounts
      MAX_FOLLOWERS: 50000,      // Skip mega accounts
      MIN_FOLLOWING: 10,
      MAX_FOLLOWING: 5000,
      MIN_RATIO: 0.1,            // followers/following > 10%
      MUST_HAVE_BIO: true,
      BIO_KEYWORDS: [],          // e.g. ['crypto', 'defi', 'web3']
      SKIP_PROTECTED: true,
      SKIP_VERIFIED: false,
    },

    // ── TIMING ──
    DELAY_BETWEEN_FOLLOWS: 3000,
    DELAY_BETWEEN_SCROLLS: 2000,
    MAX_SCROLLS_PER_ACCOUNT: 30,

    // ── INTERACTION ──
    INTERACT_AFTER_FOLLOW: false, // Also like their recent posts
    LIKES_PER_USER: 2,
  };

  // ============================================
  // STATE
  // ============================================
  const state = {
    totalFollowed: 0,
    skipped: { protected: 0, verified: 0, filtered: 0, alreadyFollowing: 0 },
    isRunning: true,
  };

  const tracked = {
    followed: new Map(Object.entries(storage.get('targetfollow_followed') || {})),
    processed: new Set(storage.get('targetfollow_processed') || []),
  };

  const saveTracked = () => {
    storage.set('targetfollow_followed', Object.fromEntries(tracked.followed));
    storage.set('targetfollow_processed', Array.from(tracked.processed));
  };

  const parseCount = (text) => {
    if (!text) return 0;
    text = text.toLowerCase().replace(/,/g, '');
    if (text.includes('k')) return parseFloat(text) * 1000;
    if (text.includes('m')) return parseFloat(text) * 1000000;
    return parseInt(text) || 0;
  };

  const meetsFilters = (userInfo) => {
    const { FILTERS } = CONFIG;
    if (FILTERS.SKIP_PROTECTED && userInfo.isProtected)  { state.skipped.protected++; return false; }
    if (FILTERS.SKIP_VERIFIED && userInfo.isVerified)    { state.skipped.verified++; return false; }
    if (FILTERS.MIN_FOLLOWERS && userInfo.followers < FILTERS.MIN_FOLLOWERS) { state.skipped.filtered++; return false; }
    if (FILTERS.MAX_FOLLOWERS && userInfo.followers > FILTERS.MAX_FOLLOWERS) { state.skipped.filtered++; return false; }
    if (FILTERS.MUST_HAVE_BIO && !userInfo.bio)          { state.skipped.filtered++; return false; }
    if (FILTERS.BIO_KEYWORDS.length > 0) {
      const bioLower = (userInfo.bio || '').toLowerCase();
      if (!FILTERS.BIO_KEYWORDS.some(kw => bioLower.includes(kw.toLowerCase()))) { state.skipped.filtered++; return false; }
    }
    return true;
  };

  const getUserInfoFromCell = (cell) => {
    const extracted = extractUserFromCell(cell);
    if (!extracted) return { username: null, bio: null, isProtected: false, isVerified: false, followers: 0 };
    return { username: extracted.username, bio: extracted.bio, isProtected: extracted.isProtected || false, isVerified: extracted.isVerified || false, followers: extracted.followers || 0 };
  };

  // ============================================
  // PROCESS TARGET ACCOUNT
  // ============================================
  const processTargetAccount = async (targetUsername) => {
    log(`\n📍 Processing @${targetUsername}'s ${CONFIG.LIST_TYPE}...`, 'info');
    const url = `https://x.com/${targetUsername}/${CONFIG.LIST_TYPE}`;
    window.location.href = url;
    await sleep(3000);
    await waitForElement(SELECTORS.userCell, 10000);

    let followedThisAccount = 0;
    let scrolls = 0;
    const processedThisSession = new Set();

    while (
      scrolls < CONFIG.MAX_SCROLLS_PER_ACCOUNT &&
      followedThisAccount < CONFIG.MAX_FOLLOWS_PER_ACCOUNT &&
      state.totalFollowed < CONFIG.TOTAL_MAX_FOLLOWS &&
      state.isRunning
    ) {
      const cells = document.querySelectorAll(SELECTORS.userCell);

      for (const cell of cells) {
        if (!state.isRunning) break;
        if (state.totalFollowed >= CONFIG.TOTAL_MAX_FOLLOWS) break;
        if (followedThisAccount >= CONFIG.MAX_FOLLOWS_PER_ACCOUNT) break;

        const userInfo = getUserInfoFromCell(cell);
        if (!userInfo.username) continue;
        if (processedThisSession.has(userInfo.username)) continue;
        processedThisSession.add(userInfo.username);
        if (tracked.followed.has(userInfo.username) || tracked.processed.has(userInfo.username)) continue;

        // Skip if already following
        const unfollowBtn = cell.querySelector(SELECTORS.unfollowButton);
        if (unfollowBtn) { state.skipped.alreadyFollowing++; tracked.processed.add(userInfo.username); continue; }

        // Check filters
        if (!meetsFilters(userInfo)) { tracked.processed.add(userInfo.username); continue; }

        // Follow
        const followBtn = cell.querySelector(SELECTORS.followButton);
        if (!followBtn) continue;

        await clickElement(followBtn);
        state.totalFollowed++;
        followedThisAccount++;

        tracked.followed.set(userInfo.username, { at: Date.now(), source: `${targetUsername}/${CONFIG.LIST_TYPE}` });
        tracked.processed.add(userInfo.username);
        saveTracked();

        log(`✅ Followed @${userInfo.username} [${state.totalFollowed}/${CONFIG.TOTAL_MAX_FOLLOWS}]`, 'success');
        await randomDelay(CONFIG.DELAY_BETWEEN_FOLLOWS, CONFIG.DELAY_BETWEEN_FOLLOWS * 1.5);
      }

      scrollBy(600);
      scrolls++;
      await sleep(CONFIG.DELAY_BETWEEN_SCROLLS);
    }

    log(`Finished @${targetUsername}: followed ${followedThisAccount} users`, 'info');
  };

  // ============================================
  // RUN
  // ============================================
  const run = async () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  👥 Medirus - Follow Target's Followers                  ║
╠═══════════════════════════════════════════════════════════╣
║  Targets: ${String(CONFIG.TARGET_ACCOUNTS.length).padEnd(5)} accounts                            ║
║  List type: ${CONFIG.LIST_TYPE.padEnd(12)}                             ║
║  Max per account: ${String(CONFIG.MAX_FOLLOWS_PER_ACCOUNT).padEnd(5)}                              ║
║  Total max: ${String(CONFIG.TOTAL_MAX_FOLLOWS).padEnd(5)}                                    ║
║                                                           ║
║  Run stopTargetFollow() to stop early.                    ║
╚═══════════════════════════════════════════════════════════╝
    `);

    if (CONFIG.TARGET_ACCOUNTS.length === 0) {
      log('⚠️ No target accounts! Add usernames to CONFIG.TARGET_ACCOUNTS', 'warning');
      return;
    }

    for (const target of CONFIG.TARGET_ACCOUNTS) {
      if (!state.isRunning || state.totalFollowed >= CONFIG.TOTAL_MAX_FOLLOWS) break;
      await processTargetAccount(target);
    }

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  ✅ SESSION COMPLETE                                      ║
╠═══════════════════════════════════════════════════════════╣
║  Total Followed: ${String(state.totalFollowed).padEnd(5)}                                ║
║  Skipped:                                                 ║
║    Already following: ${String(state.skipped.alreadyFollowing).padEnd(5)}                          ║
║    Protected: ${String(state.skipped.protected).padEnd(5)}                                  ║
║    Verified: ${String(state.skipped.verified).padEnd(5)}                                   ║
║    Filtered: ${String(state.skipped.filtered).padEnd(5)}                                   ║
║  Total tracked: ${String(tracked.followed.size).padEnd(5)} users                          ║
╚═══════════════════════════════════════════════════════════╝
    `);
  };

  run();

  window.stopTargetFollow = () => {
    state.isRunning = false;
    log('Stopping target follow...', 'warning');
  };
})();
```

### Step 3: Watch it work

The script automatically navigates between target accounts' follower lists. You'll see console output like:

```
╔═══════════════════════════════════════════════════════════╗
║  👥 Medirus - Follow Target's Followers                  ║
║  Targets: 2     accounts                                  ║
║  List type: followers                                     ║
║  Max per account: 20                                      ║
╚═══════════════════════════════════════════════════════════╝

📍 Processing @naval's followers...
  ✅ Followed @cryptodev [1/50]
  ✅ Followed @web3builder [2/50]
  ⏭️ Skipped: no bio
  ⏭️ Skipped: 3 followers (min: 100)
  ✅ Followed @defiresearcher [3/50]
  ...
Finished @naval: followed 20 users

📍 Processing @vitalikbuterin's followers...
  ...
```

---

## ⚙️ Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `TARGET_ACCOUNTS` | `[]` | Array of usernames (without @) to scrape followers from |
| `LIST_TYPE` | `'followers'` | `'followers'` or `'following'` — which list to scrape |
| `MAX_FOLLOWS_PER_ACCOUNT` | `20` | Max follows per target account |
| `TOTAL_MAX_FOLLOWS` | `50` | Hard cap across all targets |
| `MIN_FOLLOWERS` | `100` | Skip users with fewer than this many followers |
| `MAX_FOLLOWERS` | `50000` | Skip mega-accounts (rarely follow back) |
| `MIN_RATIO` | `0.1` | Minimum followers/following ratio |
| `MUST_HAVE_BIO` | `true` | Skip users without a bio |
| `BIO_KEYWORDS` | `[]` | Must contain one of these words (empty = any) |
| `SKIP_PROTECTED` | `true` | Skip private/locked accounts |
| `SKIP_VERIFIED` | `false` | Skip verified accounts |
| `DELAY_BETWEEN_FOLLOWS` | `3000` | Milliseconds between follow clicks |
| `INTERACT_AFTER_FOLLOW` | `false` | Also like their recent posts after following |

---

## 💡 Pro Tips

1. **Target 'following' lists for higher follow-back rates.** Accounts in a user's "following" list are already active followers of others — they're more likely to follow you back than passive followers.
2. **Use BIO_KEYWORDS for laser-targeting.** Set `BIO_KEYWORDS: ['defi', 'web3', 'solidity']` to only follow users whose bio mentions your niche. This dramatically improves follow-back rates.
3. **Keep MAX_FOLLOWS_PER_ACCOUNT under 25.** X rate-limits follow actions. Going over 25 per session per list can trigger temporary blocks.
4. **Enable INTERACT_AFTER_FOLLOW sparingly.** Liking 2 posts after following increases your chances of being noticed, but it slows down the script significantly (navigates to each profile).
5. **Run the Smart Unfollow script 3–4 days later.** Follow → wait → unfollow non-followers is the classic growth loop. Use `unfollowWDFBLog.js` to clean up.
6. **Pick 3–5 competitors, not 30.** Quality over quantity. Choose accounts whose followers most closely match your ideal audience.

---

## ⚠️ Important Warnings

> **Rate limits:** X limits follow actions. The script uses 3s+ delays, but following 50+ users in one session may trigger a temporary follow block (usually 24 hours).

> **Core.js required:** This script depends on `core.js` being loaded first. If you see `❌ Core module not loaded!`, paste `core.js` before this script.

> **Page navigation:** The script navigates away from your current page. Save any unsaved work before running.

---

## 🔗 Related Features

- [Keyword Follow Tutorial](keyword-follow-tutorial.md) — Follow users from search results instead of competitor lists
- [Smart Unfollow Tutorial](smart-unfollow-tutorial.md) — Unfollow non-followers after a grace period
- [Growth Suite Tutorial](growth-suite-tutorial.md) — Combines follow + like + unfollow in one session
- [Profile Scraping Tutorial](profile-scraping-tutorial.md) — Extract any profile's data before following

---

## ❓ FAQ

### How many people can I follow per day on X?
X's official limit is approximately 400 follows per day, but aggressive following can trigger temporary blocks much sooner. We recommend staying under 50 per session and running 1–2 sessions per day max.

### Should I target 'followers' or 'following' lists?
**Following lists** generally have higher follow-back rates because those users are already active followers of others. **Follower lists** give you access to a wider audience but may include more passive/inactive accounts.

### What's the MIN_RATIO filter?
It checks followers/following ratio. A ratio of `0.1` means the user must have at least 10% as many followers as their following count. This helps skip follow-for-follow spam accounts who follow 10,000 people but have 50 followers.

### Can I follow from multiple target accounts in one session?
Yes! Add multiple usernames to `TARGET_ACCOUNTS`. The script processes them sequentially and respects `TOTAL_MAX_FOLLOWS` across all targets.

### Does this work on private accounts?
No. You can't see the followers of private/protected accounts. The script will skip protected target accounts automatically.

---

<p align="center">
  <b>Built with ❤️ by <a href="https://x.com/nichxbt">@nichxbt</a></b><br>
  <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</p>
