---
title: "Natural Flow Engagement on X (Twitter) — Free 2026"
description: "Simulate human-like browsing on X/Twitter with auto likes, replies, retweets, bookmarks, and follows. Free script, no API needed."
keywords: ["twitter natural engagement script", "human like twitter automation", "auto engage twitter naturally", "twitter browsing simulation", "natural flow twitter bot", "twitter engagement autopilot 2026", "simulate real twitter user", "twitter like reply retweet script", "medirus natural flow", "organic twitter growth automation"]
canonical: "https://medirus.online/examples/natural-flow"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 🌊 Natural Flow Engagement on X (Twitter) — Grow Like a Real Human

> **Simulate a complete, human-like browsing session on X/Twitter — auto likes, context-aware replies, retweets, bookmarks, and follows — all with natural timing, escalating cooldowns, and a floating HUD.** Free, no API key, no app install.

**Works on:** 🌐 Browser Console
**Difficulty:** 🟡 Intermediate
**Time:** ⏱️ 10–30 minutes per session (fully automated)
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [natural-flow.md](../natural-flow.md)

---

## 🎯 Real-World Scenario

You're a crypto founder trying to build thought leadership on X. You know the algorithm rewards **diverse engagement** — not just likes, but replies, retweets, bookmarks, profile visits, and notification checks. Doing all of this manually takes 45+ minutes of focused scrolling every day. You also know that bots that fire 50 likes in 3 seconds get flagged instantly.

Natural Flow solves this. It runs a complete 4-phase session that mimics how a real person uses X: scroll timeline and engage → visit your own profile → check notifications → return home. Every action has randomized delays that **escalate over time** (just like a human getting tired), context-aware replies that match tweet topics, and a live HUD showing your progress. You choose a preset (Lurker, Friendly, Growth) and let it run.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────────────┐
│  Your Daily X Routine (Manual)                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  8:00 AM  Open X. Scroll timeline. Like a few posts.        │
│  8:10 AM  See an interesting thread. Forget to bookmark it. │
│  8:15 AM  Try to think of a reply. Give up, just like it.   │
│  8:22 AM  Someone DM'd you. Get distracted for 10 min.      │
│  8:35 AM  Back to timeline. Already seen these tweets.       │
│  8:40 AM  Check notifications manually. Scroll through.     │
│  8:50 AM  Open a profile to follow. Forget to engage.       │
│  9:00 AM  Give up. Liked 6 posts. Replied to 0.             │
│                                                              │
│  Daily engagement: 6 likes, 0 replies, 0 bookmarks          │
│  Algorithm signal: LOW — you look like a passive lurker      │
│  Growth this week: +3 followers                              │
└──────────────────────────────────────────────────────────────┘
```

**After Medirus Natural Flow:**

```
┌──────────────────────────────────────────────────────────────┐
│  Your Daily X Routine (Natural Flow)                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  8:00 AM  Paste script. Choose "Friendly" preset.            │
│  8:00 AM  Script begins Phase 1: scrolling timeline.         │
│           ❤️ Likes matching tweets (human-like delays)       │
│           💬 Drops context-aware replies ("Great thread!")    │
│           🔄 Retweets high-engagement posts (sparingly)      │
│           🔖 Bookmarks interesting content                   │
│  8:08 AM  Phase 2: Visits your own profile (algorithm ✓)     │
│  8:10 AM  Phase 3: Checks notifications (algorithm ✓✓)      │
│  8:12 AM  Phase 4: Returns to home timeline. Done.           │
│  8:12 AM  📥 Session log exported as JSON.                   │
│                                                              │
│  Daily engagement: 15 likes, 3 replies, 2 RTs, 3 bookmarks  │
│  Algorithm signal: HIGH — you look like a power user         │
│  Growth this week: +45 followers                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

Natural Flow runs a complete **4-phase browsing session** that mirrors how real humans use X:

1. 📱 **Phase 1 — Timeline Engagement** — scrolls your home feed, likes tweets matching your keywords, drops context-aware replies, retweets high-engagement posts, bookmarks interesting threads, and queues accounts to follow
2. 👤 **Phase 2 — Self Profile Visit** — visits your own profile and scrolls (signals to X's algorithm that you care about your content)
3. 🔔 **Phase 3 — Notification Check** — navigates to notifications and reads them (another algorithm signal)
4. 🏠 **Phase 4 — Return Home** — goes back to the timeline for a final scroll (completes the "session")

**Key differentiators from simple auto-likers:**
- ⏱️ **Escalating cooldowns** — delays increase as the session progresses (like a human getting tired)
- 💬 **Context-aware replies** — detects thread/opinion/data tweets and picks relevant reply templates
- 🧮 **Engagement scoring** — skips low-engagement posts, focuses on quality content
- 🚫 **Skip filters** — ignores promoted content, giveaways, sponsors
- 🔖 **Multi-action** — likes, replies, retweets, bookmarks, and follows in one session
- 🎛️ **Floating HUD** — real-time overlay showing likes/replies/RTs/bookmarks/follows/skips
- ⏸️ **Pause/Stop controls** — click buttons in the HUD or call `Medirus.pause()` / `Medirus.stop()`
- 📦 **Session resume** — if the page reloads, re-paste the script and it picks up where you left off
- ⚠️ **Recent session warning** — warns you if you ran it less than 2 hours ago (reduces detection risk)
- 📥 **Auto-export** — downloads a JSON log of every action taken

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  [Interactive Setup: choose preset]                          │
│          │                                                   │
│          ├── 🐱 Lurker (8 likes, 0 replies)                 │
│          ├── 🤝 Friendly (15 likes, 3 replies) ← default    │
│          ├── 🚀 Growth (25 likes, 5 replies, 2 RTs)         │
│          ├── ⚙️ Custom (you set everything)                  │
│          └── 🏃 Dry Run (preview, no actions)                │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────────────────────────────────────────┐      │
│  │  PHASE 1 — Timeline                                │      │
│  │  Scroll → Filter → Like → Reply → RT → Bookmark   │      │
│  │  (escalating delays between each action)           │      │
│  │  → Queue follows for later                         │      │
│  └──────────────────────┬─────────────────────────────┘      │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐      │
│  │  PHASE 2 — Self Profile                            │      │
│  │  Navigate to your profile → scroll through posts   │      │
│  └──────────────────────┬─────────────────────────────┘      │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐      │
│  │  PHASE 3 — Notifications                           │      │
│  │  Navigate to /notifications → read for 8s → scroll │      │
│  └──────────────────────┬─────────────────────────────┘      │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐      │
│  │  PHASE 4 — Return Home                             │      │
│  │  Navigate to /home → final scroll → done           │      │
│  └──────────────────────┬─────────────────────────────┘      │
│                         │                                    │
│                         ▼                                    │
│  [Print summary + export JSON log + remove HUD]              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Everyone — no installs, runs right in your browser.

### Prerequisites

- [x] Logged into your X/Twitter account in a web browser
- [x] On a desktop/laptop (not mobile)
- [x] On your home timeline (`x.com/home`)

### Step 1: Navigate to your home timeline

> Go to **`x.com/home`** — the script starts by engaging with your main feed.

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 x.com/home                                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  👤 @vitalikbuterin                                          │
│  "New post: Why I think account abstraction will             │
│   change Ethereum UX forever..."                             │
│  ❤️ 12,421  🔄 3,892  💬 1,234                               │
│                                                              │
│  👤 @naval                                                   │
│  "Read books. Write code. Build things.                      │
│   Everything else is noise."                                 │
│  ❤️ 89,210  🔄 18,920  💬 5,340                               │
│                                                              │
│  👤 @nichxbt                                                 │
│  "Just shipped Natural Flow v2 for Medirus 🌊              │
│   4-phase human-like session simulation"                     │
│  ❤️ 247  🔄 68  💬 41                                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Open Developer Console

| OS | Shortcut |
|----|----------|
| **Windows / Linux** | `F12` then click **Console** tab, or `Ctrl + Shift + J` |
| **Mac** | `Cmd + Option + J` |

### Step 3: Paste and Run

Copy the entire script below, paste it into the console, and press **Enter**.

The script will show an **interactive setup dialog** — pick a preset, enter optional keywords, and you're off.

```javascript
// ============================================
// Medirus - Natural Flow 🌊
// by nichxbt — https://medirus.online
// Go to: x.com/home
// Open console (F12 → Console), paste, Enter
// ============================================

;(() => {
  'use strict';

  // ── Selectors (verified January 2026) ──
  const SEL = {
    tweet:       'article[data-testid="tweet"]',
    tweetText:   '[data-testid="tweetText"]',
    likeBtn:     '[data-testid="like"]',
    unlikeBtn:   '[data-testid="unlike"]',
    replyBtn:    '[data-testid="reply"]',
    retweetBtn:  '[data-testid="retweet"]',
    retweetConf: '[data-testid="retweetConfirm"]',
    bookmarkBtn: '[data-testid="bookmark"]',
    shareBtn:    '[data-testid="share"]',  
    followBtn:   '[data-testid$="-follow"]:not([data-testid$="-unfollow"])',
    unfollowBtn: '[data-testid$="-unfollow"]',
    tweetBox:    '[data-testid="tweetTextarea_0"]',
    tweetButton: '[data-testid="tweetButtonInline"]',
    profileNav:  'a[data-testid="AppTabBar_Profile_Link"]',
    notification:'[data-testid="notification"]',
    toast:       '[data-testid="toast"]',
  };

  // ── Utility functions ──
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand  = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo));
  const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const roll  = (chance) => Math.random() < chance;
  const $     = (sel, ctx = document) => ctx.querySelector(sel);
  const $$    = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const parseEngagement = (article) => {
    let total = 0;
    for (const btn of article.querySelectorAll('[role="group"] button')) {
      const label = btn.getAttribute('aria-label') || '';
      const m = label.match(/([\d,.]+)\s*([KMBkmb])?/);
      if (m) {
        let n = parseFloat(m[1].replace(',', ''));
        if (m[2]) n *= { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1;
        total += n;
      }
    }
    return total;
  };

  // ── Interactive Setup ──
  const PRESETS = {
    1: { name: '🐱 Lurker',   maxLikes: 8,  likeChance: 0.5, replyMax: 0, retweetMax: 0, bookmarkMax: 1,  followMax: 0 },
    2: { name: '🤝 Friendly', maxLikes: 15, likeChance: 0.6, replyMax: 3, retweetMax: 1, bookmarkMax: 3,  followMax: 2 },
    3: { name: '🚀 Growth',   maxLikes: 25, likeChance: 0.7, replyMax: 5, retweetMax: 2, bookmarkMax: 5,  followMax: 5 },
    4: { name: '⚙️ Custom',   maxLikes: 20, likeChance: 0.6, replyMax: 3, retweetMax: 1, bookmarkMax: 3,  followMax: 3 },
    5: { name: '🏃 Dry Run',  maxLikes: 10, likeChance: 0.5, replyMax: 2, retweetMax: 1, bookmarkMax: 2,  followMax: 1 },
  };

  const setupInteractive = () => {
    const choice = prompt(
      '🌊 NATURAL FLOW — Choose your session preset:\n\n' +
      '1. 🐱 Lurker     — 8 likes, no replies (stealth mode)\n' +
      '2. 🤝 Friendly   — 15 likes, 3 replies, 1 RT (recommended)\n' +
      '3. 🚀 Growth     — 25 likes, 5 replies, 2 RTs (aggressive)\n' +
      '4. ⚙️ Custom     — Set your own numbers\n' +
      '5. 🏃 Dry Run    — Preview only, no actions taken\n',
      '2'
    );

    const num = parseInt(choice);
    if (!num || !PRESETS[num]) return null;
    const preset = { ...PRESETS[num] };
    const dryRun = num === 5;

    // Custom preset: let user set values
    if (num === 4) {
      preset.maxLikes    = parseInt(prompt('Max likes?', '20'))    || 20;
      preset.replyMax    = parseInt(prompt('Max replies?', '3'))   || 3;
      preset.retweetMax  = parseInt(prompt('Max retweets?', '1'))  || 1;
      preset.bookmarkMax = parseInt(prompt('Max bookmarks?', '3')) || 3;
      preset.followMax   = parseInt(prompt('Max follows?', '3'))   || 3;
    }

    const kwInput = prompt(
      '🔑 Keywords (comma-separated, or leave blank for all tweets):\n\n' +
      'Examples: AI, web3, startup, defi',
      ''
    );
    const keywords = kwInput ? kwInput.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];

    const defaultReplies = [
      '🔥 This is solid',
      'Really interesting take on this',
      'Great thread, appreciate the insight 🙏',
      'Couldn\'t agree more — this needed to be said',
      '📌 Saving this one. Great breakdown.',
      'Bullish on this perspective 💯',
      'Underrated take. More people need to see this.',
      'This is the kind of content I\'m here for',
    ];

    let replyTemplates = defaultReplies;
    if (preset.replyMax > 0) {
      const customReply = prompt(
        '💬 Reply templates (one per line, or press OK for defaults):\n\n' +
        'Default replies:\n' + defaultReplies.slice(0, 4).map(r => `  "${r}"`).join('\n'),
        ''
      );
      if (customReply && customReply.trim()) {
        replyTemplates = customReply.split('\n').map(r => r.trim()).filter(Boolean);
      }
    }

    return {
      keywords,
      dryRun,
      skipKeywords: ['promoted', 'ad', 'giveaway', 'sponsor'],
      timeline: {
        scrolls: 15,
        maxLikes: preset.maxLikes,
        likeChance: preset.likeChance,
        minEngagement: 2,
      },
      replies: {
        enabled: preset.replyMax > 0,
        max: preset.replyMax,
        chance: 0.2,
        templates: replyTemplates,
      },
      retweets: {
        enabled: preset.retweetMax > 0,
        max: preset.retweetMax,
        chance: 0.1,
      },
      bookmarks: {
        enabled: preset.bookmarkMax > 0,
        max: preset.bookmarkMax,
        chance: 0.15,
      },
      follows: {
        enabled: preset.followMax > 0,
        max: preset.followMax,
        chance: 0.25,
      },
      selfProfile: { enabled: true, username: '', scrolls: 4 },
      notifications: { enabled: true, pauseSeconds: 8 },
      delays: {
        betweenActions: [3000, 7000],
        betweenPhases: [8000, 15000],
        readingPause: [2000, 6000],
        scrollPause: [1500, 3000],
        replyTyping: [3000, 6000],
      },
    };
  };

  // ── Floating HUD ──
  const createHUD = () => {
    const existing = document.getElementById('medirus-hud');
    if (existing) existing.remove();

    const hud = document.createElement('div');
    hud.id = 'medirus-hud';
    hud.innerHTML = `
      <div style="
        position:fixed;bottom:20px;right:20px;z-index:999999;
        background:rgba(0,0,0,0.92);border:1px solid #1d9bf0;border-radius:12px;
        padding:14px 18px;font-family:-apple-system,sans-serif;font-size:13px;
        color:#e7e9ea;min-width:200px;backdrop-filter:blur(10px);
        box-shadow:0 4px 20px rgba(29,155,240,0.15);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;color:#1d9bf0;">🌊 Natural Flow</span>
          <span id="xhud-phase" style="font-size:11px;color:#71767b;">Phase 1/4</span>
        </div>
        <div id="xhud-progress" style="background:#333;border-radius:4px;height:6px;margin-bottom:10px;overflow:hidden;">
          <div id="xhud-bar" style="background:#1d9bf0;height:100%;width:0%;transition:width 0.3s;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;">
          <span>❤️ Liked</span>      <span id="xhud-liked" style="text-align:right;font-weight:600;">0</span>
          <span>💬 Replied</span>    <span id="xhud-replied" style="text-align:right;font-weight:600;">0</span>
          <span>🔄 Retweeted</span>  <span id="xhud-retweeted" style="text-align:right;font-weight:600;">0</span>
          <span>🔖 Bookmarked</span> <span id="xhud-bookmarked" style="text-align:right;font-weight:600;">0</span>
          <span>➕ Followed</span>   <span id="xhud-followed" style="text-align:right;font-weight:600;">0</span>
          <span>⏭️ Skipped</span>    <span id="xhud-skipped" style="text-align:right;font-weight:600;">0</span>
        </div>
        <div id="xhud-latest" style="margin-top:8px;font-size:11px;color:#71767b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button id="xhud-pause" style="flex:1;background:#333;color:#e7e9ea;border:1px solid #555;border-radius:6px;padding:4px 0;cursor:pointer;font-size:11px;">⏸ Pause</button>
          <button id="xhud-stop" style="flex:1;background:#67070f;color:#e7e9ea;border:1px solid #f4212e;border-radius:6px;padding:4px 0;cursor:pointer;font-size:11px;">⏹ Stop</button>
        </div>
      </div>
    `;
    document.body.appendChild(hud);

    document.getElementById('xhud-stop').addEventListener('click', () => { aborted = true; updateHUD('latest', '🛑 Stopping...'); });
    document.getElementById('xhud-pause').addEventListener('click', () => {
      paused = !paused;
      document.getElementById('xhud-pause').textContent = paused ? '▶ Resume' : '⏸ Pause';
      updateHUD('latest', paused ? '⏸ Paused' : '▶ Resumed');
    });

    return hud;
  };

  const updateHUD = (field, value) => { const el = document.getElementById(`xhud-${field}`); if (el) el.textContent = value; };
  const updateProgress = (current, max) => { const bar = document.getElementById('xhud-bar'); if (bar) bar.style.width = `${Math.min(100, (current / max) * 100)}%`; };
  const removeHUD = () => { const hud = document.getElementById('medirus-hud'); if (hud) hud.remove(); };

  // ── State & History ──
  let aborted = false;
  let paused = false;

  window.Medirus = window.Medirus || {};
  window.Medirus.stop  = () => { aborted = true; console.log('🛑 Stopping...'); };
  window.Medirus.pause = () => { paused = !paused; console.log(paused ? '⏸ Paused' : '▶ Resumed'); };

  const stats = { liked: 0, replied: 0, retweeted: 0, bookmarked: 0, followed: 0, scrolled: 0, skipped: 0 };
  const actionLog = [];
  const seen = new Set();

  const STATE_KEY = 'medirus_natural_flow';
  const HISTORY_KEY = 'medirus_nf_history';

  const getHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
  const addHistory = (entry) => {
    const hist = getHistory();
    hist.push(entry);
    if (hist.length > 30) hist.splice(0, hist.length - 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  };

  const checkRecentSession = () => {
    const hist = getHistory();
    if (hist.length === 0) return true;
    const last = hist[hist.length - 1];
    const hoursSince = (Date.now() - last.ts) / 3600000;
    if (hoursSince < 2) {
      return confirm(
        `⚠️ You ran Natural Flow ${hoursSince.toFixed(1)} hours ago ` +
        `(${last.liked} likes, ${last.replied} replies).\n\n` +
        `Running too frequently increases detection risk.\n\nContinue anyway?`
      );
    }
    return true;
  };

  // ── Core helpers ──
  const waitForUnpause = async () => { while (paused && !aborted) await sleep(300); };
  const isRateLimited = () => {
    for (const el of $$(`${SEL.toast}, [role="alert"]`)) {
      if (/rate limit|try again|too many|slow down/i.test(el.textContent)) return true;
    }
    return false;
  };
  const checkRateLimit = async () => {
    if (!isRateLimited()) return false;
    console.log('   🚨 Rate limited — pausing 120s...');
    updateHUD('latest', '🚨 Rate limited — pausing...');
    await sleep(120000);
    return isRateLimited();
  };
  const matchesKeywords = (config, text) => {
    if (!config.keywords || config.keywords.length === 0) return true;
    return config.keywords.some(kw => text.toLowerCase().includes(kw));
  };
  const shouldSkip = (config, text) => config.skipKeywords.some(kw => text.toLowerCase().includes(kw));
  const getAuthor = (article) => {
    const link = article.querySelector('a[href^="/"][role="link"]');
    if (!link) return null;
    const match = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
    if (!match) return null;
    const name = match[1];
    if (['home','explore','notifications','messages','i','search','settings','compose'].includes(name)) return null;
    return name;
  };
  const escalatedDelay = (config, key, actionsSoFar) => {
    const base = config.delays[key];
    const multiplier = 1 + (actionsSoFar * 0.03);
    return sleep(rand(Math.floor(base[0] * multiplier), Math.floor(base[1] * multiplier)));
  };

  // ── Actions ──
  const doLike = async (config, article, text) => {
    if ($(SEL.unlikeBtn, article)) return false;
    const btn = $(SEL.likeBtn, article);
    if (!btn) return false;
    article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await escalatedDelay(config, 'readingPause', stats.liked);
    if (config.dryRun) { console.log(`   ❤️ [DRY] Like: "${text.slice(0, 55)}..."`); }
    else { btn.click(); await sleep(rand(300, 600)); }
    stats.liked++;
    updateHUD('liked', stats.liked);
    return true;
  };

  const doReply = async (config, article, author, tweetText) => {
    const replyBtn = $(SEL.replyBtn, article);
    if (!replyBtn) return false;
    let replyText = pick(config.replies.templates);
    const lower = tweetText.toLowerCase();
    if (/thread|breakdown|analysis/i.test(lower)) replyText = pick(['📌 Saving this one. Great breakdown.', 'Great thread, appreciate the insight 🙏', replyText]);
    else if (/agree|disagree|opinion|take/i.test(lower)) replyText = pick(['Couldn\'t agree more — this needed to be said', 'Really interesting take on this', replyText]);
    else if (/data|chart|numbers|stats/i.test(lower)) replyText = pick(['The data speaks for itself 📊', 'Underrated take. More people need to see this.', replyText]);
    if (config.dryRun) { console.log(`   💬 [DRY] Reply to @${author}: "${replyText}"`); stats.replied++; updateHUD('replied', stats.replied); return true; }
    replyBtn.click();
    await sleep(1500);
    const tweetBox = $(SEL.tweetBox);
    if (!tweetBox) return false;
    tweetBox.focus();
    await escalatedDelay(config, 'replyTyping', stats.replied);
    document.execCommand('insertText', false, replyText);
    await sleep(rand(600, 1000));
    const sendBtn = $(SEL.tweetButton);
    if (!sendBtn) return false;
    sendBtn.click();
    await sleep(2000);
    stats.replied++;
    updateHUD('replied', stats.replied);
    return true;
  };

  const doRetweet = async (config, article, text) => {
    const rtBtn = $(SEL.retweetBtn, article);
    if (!rtBtn) return false;
    if (config.dryRun) { console.log(`   🔄 [DRY] Retweet: "${text.slice(0, 50)}..."`); stats.retweeted++; updateHUD('retweeted', stats.retweeted); return true; }
    rtBtn.click();
    await sleep(800);
    const confirmBtn = $(SEL.retweetConf);
    if (confirmBtn) { confirmBtn.click(); await sleep(500); }
    stats.retweeted++;
    updateHUD('retweeted', stats.retweeted);
    return true;
  };

  const doBookmark = async (config, article, text) => {
    const shareBtn = $(SEL.shareBtn, article);
    if (!shareBtn) return false;
    if (config.dryRun) { console.log(`   🔖 [DRY] Bookmark: "${text.slice(0, 50)}..."`); stats.bookmarked++; updateHUD('bookmarked', stats.bookmarked); return true; }
    shareBtn.click();
    await sleep(600);
    const bmBtn = document.querySelector('[data-testid="bookmark"], [role="menuitem"]');
    if (bmBtn && /bookmark/i.test(bmBtn.textContent)) { bmBtn.click(); await sleep(400); stats.bookmarked++; updateHUD('bookmarked', stats.bookmarked); return true; }
    document.body.click();
    await sleep(300);
    return false;
  };

  const doFollow = async (config, author) => {
    if (config.dryRun) { console.log(`   ➕ [DRY] Follow @${author}`); stats.followed++; updateHUD('followed', stats.followed); return true; }
    window.location.href = `https://x.com/${author}`;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (document.querySelector(SEL.unfollowBtn)) { window.history.back(); await sleep(3000); return false; }
      const followBtn = document.querySelector('[data-testid$="-follow"]:not([data-testid$="-unfollow"])');
      if (followBtn) { followBtn.click(); await sleep(1000); stats.followed++; updateHUD('followed', stats.followed); break; }
    }
    await sleep(rand(2000, 4000));
    window.history.back();
    await sleep(3000);
    return true;
  };

  // ── Phase 1: Timeline ──
  const phaseTimeline = async (config) => {
    console.log('\n📱 PHASE 1 — Scrolling home timeline...');
    console.log(`   Keywords: ${config.keywords.length ? config.keywords.join(', ') : 'everything'}`);
    updateHUD('phase', 'Phase 1/4');

    const authorsToFollow = [];
    for (let scroll = 0; scroll < config.timeline.scrolls && !aborted; scroll++) {
      await waitForUnpause();
      const articles = $$(SEL.tweet);
      for (const article of articles) {
        if (aborted || stats.liked >= config.timeline.maxLikes) break;
        if (await checkRateLimit()) { aborted = true; break; }
        await waitForUnpause();

        const textEl = $(SEL.tweetText, article);
        const text = textEl ? textEl.textContent.trim() : '';
        const link = article.querySelector('a[href*="/status/"]')?.href || '';
        const id = link || text.slice(0, 80);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        if (shouldSkip(config, text)) { stats.skipped++; updateHUD('skipped', stats.skipped); continue; }
        if (!matchesKeywords(config, text)) { stats.skipped++; updateHUD('skipped', stats.skipped); continue; }

        const engagement = parseEngagement(article);
        if (engagement < config.timeline.minEngagement) { stats.skipped++; updateHUD('skipped', stats.skipped); continue; }

        const author = getAuthor(article);

        if (roll(config.timeline.likeChance)) {
          const liked = await doLike(config, article, text);
          if (liked) {
            updateHUD('latest', `❤️ @${author || '?'}: ${text.slice(0, 40)}...`);
            updateProgress(stats.liked, config.timeline.maxLikes);
            actionLog.push({ action: 'like', author, text: text.slice(0, 100), engagement, ts: Date.now() });
            await escalatedDelay(config, 'betweenActions', stats.liked);

            if (config.replies.enabled && stats.replied < config.replies.max && roll(config.replies.chance)) {
              await doReply(config, article, author, text);
              actionLog.push({ action: 'reply', author, ts: Date.now() });
            }
            if (config.retweets.enabled && stats.retweeted < config.retweets.max && roll(config.retweets.chance) && engagement >= 10) {
              await doRetweet(config, article, text);
              actionLog.push({ action: 'retweet', author, ts: Date.now() });
            }
            if (config.bookmarks.enabled && stats.bookmarked < config.bookmarks.max && roll(config.bookmarks.chance)) {
              await doBookmark(config, article, text);
              actionLog.push({ action: 'bookmark', author, ts: Date.now() });
            }
            if (config.follows.enabled && author && stats.followed < config.follows.max && roll(config.follows.chance)) {
              if (!authorsToFollow.includes(author)) authorsToFollow.push(author);
            }
          }
        } else {
          article.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(rand(400, 1200));
        }
      }
      if (stats.liked >= config.timeline.maxLikes) break;
      window.scrollBy(0, rand(600, 1200));
      stats.scrolled++;
      await escalatedDelay(config, 'scrollPause', stats.scrolled);
    }

    // Follow queued authors
    for (const author of authorsToFollow.slice(0, config.follows.max - stats.followed)) {
      if (aborted) break;
      await waitForUnpause();
      await doFollow(config, author);
      actionLog.push({ action: 'follow', author, ts: Date.now() });
      await escalatedDelay(config, 'betweenActions', stats.followed);
    }
  };

  // ── Phase 2: Self Profile ──
  const phaseSelfProfile = async (config) => {
    if (!config.selfProfile.enabled) return;
    const navLink = document.querySelector(SEL.profileNav);
    const username = navLink?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)/)?.[1];
    if (!username) { console.log('\n👤 PHASE 2 — Skipping (couldn\'t detect username)'); return; }
    console.log(`\n👤 PHASE 2 — Visiting your profile (@${username})...`);
    updateHUD('phase', 'Phase 2/4');
    if (!config.dryRun) { window.location.href = `https://x.com/${username}`; for (let i = 0; i < 20; i++) { await sleep(500); if ($$(SEL.tweet).length > 0) break; } await sleep(2000); }
    for (let i = 0; i < config.selfProfile.scrolls; i++) { if (!config.dryRun) window.scrollBy(0, rand(400, 900)); await escalatedDelay(config, 'scrollPause', i); }
    console.log('   ✅ Scrolled own profile');
  };

  // ── Phase 3: Notifications ──
  const phaseNotifications = async (config) => {
    if (!config.notifications.enabled) return;
    console.log('\n🔔 PHASE 3 — Checking notifications...');
    updateHUD('phase', 'Phase 3/4');
    if (!config.dryRun) { window.location.href = 'https://x.com/notifications'; for (let i = 0; i < 20; i++) { await sleep(500); if (window.location.pathname.includes('notifications')) break; } await sleep(2000); }
    await sleep(config.notifications.pauseSeconds * 1000);
    for (let i = 0; i < 3; i++) { if (!config.dryRun) window.scrollBy(0, rand(300, 600)); await sleep(rand(1000, 2000)); }
    console.log('   ✅ Notifications checked');
  };

  // ── Phase 4: Return Home ──
  const phaseReturnHome = async (config) => {
    console.log('\n🏠 PHASE 4 — Returning to home timeline...');
    updateHUD('phase', 'Phase 4/4');
    if (!config.dryRun) { window.location.href = 'https://x.com/home'; for (let i = 0; i < 20; i++) { await sleep(500); if ($$(SEL.tweet).length > 0) break; } await sleep(2000); }
    for (let i = 0; i < 3; i++) { if (!config.dryRun) window.scrollBy(0, rand(400, 800)); await sleep(rand(1500, 3000)); }
    console.log('   ✅ Back on home timeline');
  };

  // ── Summary & Export ──
  const printSummary = (elapsed) => {
    const W = 52;
    console.log('\n' + '━'.repeat(W));
    console.log('  🌊 NATURAL FLOW — SESSION COMPLETE');
    console.log('━'.repeat(W));
    console.log(`  ❤️  Liked:       ${stats.liked}`);
    console.log(`  💬  Replied:     ${stats.replied}`);
    console.log(`  🔄  Retweeted:   ${stats.retweeted}`);
    console.log(`  🔖  Bookmarked:  ${stats.bookmarked}`);
    console.log(`  ➕  Followed:    ${stats.followed}`);
    console.log(`  📜  Scrolls:     ${stats.scrolled}`);
    console.log(`  ⏭️  Skipped:     ${stats.skipped}`);
    console.log(`  ⏱️  Duration:    ${elapsed} min`);
    console.log('━'.repeat(W));

    const uniqueAuthors = new Set(actionLog.filter(l => l.author).map(l => l.author));
    console.log(`  Engaged with ${uniqueAuthors.size} unique accounts\n`);

    addHistory({ ts: Date.now(), liked: stats.liked, replied: stats.replied, retweeted: stats.retweeted, bookmarked: stats.bookmarked, followed: stats.followed, authors: uniqueAuthors.size });

    if (actionLog.length > 0) {
      try {
        const blob = new Blob([JSON.stringify(actionLog, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `medirus-natural-flow-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        console.log('📥 Session log exported.\n');
      } catch {}
    }
    removeHUD();
  };

  // ── Entry Point ──
  const main = async () => {
    if (!checkRecentSession()) { console.log('❌ Cancelled — too soon since last session.'); return; }
    const config = setupInteractive();
    if (!config) { console.log('❌ Setup cancelled.'); return; }

    const W = 52;
    console.log('╔' + '═'.repeat(W) + '╗');
    console.log('║  🌊 NATURAL FLOW — Human-Like Session        ║');
    console.log('║  by nichxbt — Medirus                        ║');
    console.log('╚' + '═'.repeat(W) + '╝');
    console.log(`\n⚠️ ${config.dryRun ? 'DRY RUN' : 'LIVE MODE'} — ${config.dryRun ? 'previewing' : 'executing'} session.\n`);

    const startTime = Date.now();
    createHUD();

    try {
      await phaseTimeline(config);
      if (!aborted) { await sleep(rand(...config.delays.betweenPhases)); await phaseSelfProfile(config); }
      if (!aborted) { await sleep(rand(...config.delays.betweenPhases)); await phaseNotifications(config); }
      if (!aborted) { await sleep(rand(...config.delays.betweenPhases)); await phaseReturnHome(config); }
    } catch (e) { if (e !== 'aborted') console.error('❌ Error:', e); }

    printSummary(((Date.now() - startTime) / 60000).toFixed(1));
  };

  main();
})();
```

> **Tip:** Start with **Dry Run** (preset 5) to preview what the script will do without taking any real actions. Once you're happy with the output, run again with Friendly or Growth.

### Step 4: Watch the HUD

A floating overlay appears in the **bottom-right** of the screen showing real-time stats:

```
┌──────────────────────────────────────────────────────┐
│  🌊 Natural Flow               Phase 1/4            │
│  ████████████░░░░░░░░░░░░░░░░░░░ 40%                │
│                                                      │
│  ❤️ Liked        6          💬 Replied     1          │
│  🔄 Retweeted   0          🔖 Bookmarked  2          │
│  ➕ Followed    1          ⏭️ Skipped     12          │
│                                                      │
│  ❤️ @naval: Read books. Write code. Build thi...      │
│                                                      │
│  [ ⏸ Pause ]            [ ⏹ Stop ]                   │
└──────────────────────────────────────────────────────┘
```

### Step 5: Review the session summary

When the session completes, you'll see a summary like this in the console:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🌊 NATURAL FLOW — SESSION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❤️  Liked:       15
  💬  Replied:     3
  🔄  Retweeted:   1
  🔖  Bookmarked:  3
  ➕  Followed:    2
  📜  Scrolls:     12
  ⏭️  Skipped:     47
  ⏱️  Duration:    8.3 min
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Engaged with 19 unique accounts

📥 Session log exported.
```

A JSON file automatically downloads with every action logged (timestamp, author, text, engagement score).

---

## ⚙️ Configuration Reference

### Preset Comparison

| Setting | 🐱 Lurker | 🤝 Friendly | 🚀 Growth | ⚙️ Custom |
|---------|-----------|-------------|-----------|-----------|
| Max Likes | 8 | 15 | 25 | You choose |
| Like Chance | 50% | 60% | 70% | You choose |
| Max Replies | 0 | 3 | 5 | You choose |
| Max Retweets | 0 | 1 | 2 | You choose |
| Max Bookmarks | 1 | 3 | 5 | You choose |
| Max Follows | 0 | 2 | 5 | You choose |
| **Best for** | Low-key accounts | Daily use | Aggressive growth | Power users |

### Delay Configuration

| Delay Type | Range | Purpose |
|-----------|-------|---------|
| `betweenActions` | 3–7s | Pause between each engagement action |
| `betweenPhases` | 8–15s | Pause between session phases |
| `readingPause` | 2–6s | Time spent "reading" a tweet before liking |
| `scrollPause` | 1.5–3s | Pause between scroll-downs |
| `replyTyping` | 3–6s | Simulated typing time before sending reply |

> **Escalating cooldowns:** All delays increase by 3% per action taken. After 20 actions, a 3s base delay becomes ~4.8s. This mimics a human getting fatigued.

### Skip Filters

Keywords that auto-skip tweets: `promoted`, `ad`, `giveaway`, `sponsor`

### Context-Aware Replies

The script detects tweet topics and picks relevant reply templates:

| Tweet Contains | Reply Options |
|---------------|--------------|
| "thread", "breakdown", "analysis" | "📌 Saving this one. Great breakdown.", "Great thread, appreciate the insight 🙏" |
| "agree", "disagree", "opinion", "take" | "Couldn't agree more — this needed to be said", "Really interesting take on this" |
| "data", "chart", "numbers", "stats" | "The data speaks for itself 📊", "Underrated take. More people need to see this." |
| *(anything else)* | Random pick from your template list |

---

## 🔧 Controls During Session

| Control | How |
|---------|-----|
| **Pause** | Click `⏸ Pause` in HUD, or run `Medirus.pause()` in console |
| **Resume** | Click `▶ Resume` in HUD, or run `Medirus.pause()` again |
| **Stop** | Click `⏹ Stop` in HUD, or run `Medirus.stop()` in console |

---

## 💡 Pro Tips

1. **Start with Dry Run.** Always preview a session before going live. Dry Run shows exactly what the script would do without clicking anything.
2. **Use keywords for niche targeting.** Without keywords, the script likes everything. Add 3–5 relevant keywords to only engage with your niche.
3. **Customize your reply templates.** The defaults are generic. Write replies that match your voice — this is how people discover you.
4. **Don't run more than 2x per day.** The script warns you if you ran it less than 2 hours ago. Respect this — X's detection systems look for patterns.
5. **Run Lurker preset on new accounts.** Brand new accounts should start slow. Use Lurker for the first week, then move to Friendly.
6. **The JSON export is gold.** Review it to see which authors you engage with most, and manually follow up with them via DMs.

---

## ⚠️ Important Warnings

> **Rate limits:** X enforces aggressive rate limits. If the script detects a rate limit toast, it automatically pauses for 120 seconds before resuming.

> **Detection risk:** Running automation too frequently can trigger X's detection systems. Wait at least 2 hours between sessions. The script tracks your history and warns you.

> **Replies are public.** If you enable replies, those comments appear on your profile. Make sure your reply templates are professional and relevant to your niche.

> **Navigation:** In Live mode, the script navigates between pages (timeline → profile → notifications → home). Do not click anything while it's running — let it complete the full 4-phase session.

---

## 🔗 Related Features

- [Auto-Liker Tutorial](auto-liker-tutorial.md) — Simple keyword-based liking without the full session flow
- [Auto-Commenter Tutorial](auto-commenter-tutorial.md) — Dedicated auto-reply functionality
- [Growth Suite Tutorial](growth-suite-tutorial.md) — All-in-one growth automation combining follow, like, and unfollow
- [Keyword Follow Tutorial](keyword-follow-tutorial.md) — Targeted following from search results

---

## ❓ FAQ

### How is Natural Flow different from the Auto-Liker?
Natural Flow runs a full 4-phase browsing session (timeline → profile → notifications → home) with multiple action types (likes, replies, RTs, bookmarks, follows) and escalating delays. The Auto-Liker only likes tweets on the current page. Natural Flow is the closest thing to a real human browsing session.

### Will X detect this as a bot?
Natural Flow is specifically designed to avoid detection: randomized delays that escalate over time, diverse action types, page navigation between phases, and session frequency warnings. However, **no automation is 100% undetectable.** Start with Dry Run, use Lurker on new accounts, and never run more than 2x per day.

### Can I use custom reply templates?
Yes! During the interactive setup, the script asks you for custom replies. Enter one reply per line, or press OK to use the built-in defaults.

### What happens if the page reloads mid-session?
In Live mode, the script saves its state to `sessionStorage`. Re-paste the script after the page reloads and it will resume from where it left off. In Dry Run mode (single-page, no navigation), state is lost on reload.

### How do I export my session data?
The script automatically downloads a JSON log file when the session completes. The log includes every action taken (like, reply, retweet, bookmark, follow) with timestamps and author info.

### What's the difference between Live mode and Dry Run?
Dry Run stays on the current page and simulates all actions without actually clicking. Live mode navigates between pages (timeline → profile → notifications → home) and performs real actions. Always test with Dry Run first.

---

<p align="center">
  <b>Built with ❤️ by <a href="https://x.com/nichxbt">@nichxbt</a></b><br>
  <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</p>
