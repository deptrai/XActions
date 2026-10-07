---
title: "Auto-Comment on X (Twitter) — Free Script 2026"
description: "Auto-reply to tweets on X/Twitter with custom comments. Free browser script for engagement growth. No API needed."
keywords: ["auto comment twitter", "twitter auto reply script", "auto comment X 2026", "how to auto reply on twitter", "twitter auto commenter free", "auto reply tweets script", "twitter engagement bot free", "auto comment tweets by keyword", "medirus auto commenter", "twitter reply automation"]
canonical: "https://medirus.online/examples/auto-commenter"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 💬 Auto-Comment on X (Twitter) — Build Engagement on Autopilot

> **Automatically reply to new tweets from any user on X (Twitter) with your custom comments — free, no API key, no app install.** Monitor a profile for new posts and drop thoughtful replies before the crowd arrives.

**Works on:** 🌐 Browser Console · 🤖 MCP (AI Agents)
**Difficulty:** 🟡 Intermediate
**Time:** ⏱️ Runs continuously (1–30 min sessions recommended)
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [auto-commenter.md](../auto-commenter.md)

---

## 🎯 Real-World Scenario

You're building your personal brand in crypto/web3. You've noticed that the people who consistently reply to big accounts like @VitalikButerin and @CZ_Binance with thoughtful comments get massive exposure — their replies sit at the top and get thousands of views. But you can't refresh their profiles all day waiting for a new tweet.

You want an automated system that monitors a target user's profile, detects when they post something new, and drops one of your pre-written comments within the first few minutes — before thousands of other replies bury yours. Medirus' auto-commenter does exactly that.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Your Engagement Strategy (Manual)                   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  9:00 AM  Check @VitalikButerin's profile            │
│  9:05 AM  No new tweets... refresh                   │
│  9:10 AM  Still nothing... refresh                   │
│  9:30 AM  Got distracted, forgot to check            │
│  10:45 AM Check again — he posted at 9:37 AM!        │
│           Already 2,847 replies. You're invisible.   │
│                                                      │
│  Success rate: ~5% (caught 1 in 20 posts)            │
│  Time wasted: hours of refreshing                    │
│  Replies noticed: almost none                        │
└──────────────────────────────────────────────────────┘
```

**After Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Your Engagement Strategy (Automated)                │
├──────────────────────────────────────────────────────┤
│                                                      │
│  9:00 AM  Start auto-commenter on @VitalikButerin    │
│  9:37 AM  🔔 New tweet detected!                     │
│  9:38 AM  💬 Auto-replied within 60 seconds          │
│           Your reply: "Great point! 🔥" (Reply #3)  │
│  9:39 AM  Script checks again in 60 seconds...       │
│                                                      │
│  Success rate: ~95% (catches nearly every post)      │
│  Time spent: 0 (runs in background tab)              │
│  Reply position: Top 5 (early = visible)             │
└──────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

1. 📍 **Opens target user's profile** — you navigate to `x.com/USERNAME`
2. 🔄 **Monitors for new tweets** — checks the profile every 60 seconds (configurable)
3. 🔍 **Filters posts** — skips retweets, replies (optional), and already-commented tweets
4. ⏰ **Checks post age** — only comments on tweets between 30 seconds and 30 minutes old
5. 💬 **Posts a random comment** — picks from your pre-written comment pool
6. ⌨️ **Types like a human** — uses `execCommand` to simulate real typing in the reply box
7. 💾 **Remembers commented tweets** — stores IDs in `sessionStorage` to avoid duplicates
8. 🔁 **Repeats** — schedules the next check automatically until max comments reached

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Navigate to x.com/TARGET_USER]                            │
│          │                                                  │
│          ▼                                                  │
│  [Start monitoring loop]                                    │
│          │                                                  │
│          ▼                                                  │
│  [Scroll to top, scan tweets]                               │
│          │                                                  │
│     ┌────┴──────────────────────────┐                       │
│     │ For each tweet:               │                       │
│     │  • Already commented? → Skip  │                       │
│     │  • Is RT/reply? → Skip        │                       │
│     │  • Too old (>30m)? → Skip     │                       │
│     │  • Too new (<30s)? → Skip     │                       │
│     │  • Keyword match? → Continue  │                       │
│     └────┬──────────────────────────┘                       │
│          │                                                  │
│          ▼                                                  │
│  [Click reply button on tweet]                              │
│          │                                                  │
│          ▼                                                  │
│  [Wait for reply textarea to appear]                        │
│          │                                                  │
│          ▼                                                  │
│  [Pick random comment from pool]                            │
│          │                                                  │
│          ▼                                                  │
│  [Type comment via execCommand]                             │
│          │                                                  │
│          ▼                                                  │
│  [Click "Reply" / "Post" button]                            │
│          │                                                  │
│          ▼                                                  │
│  [Save tweet ID → sessionStorage]                           │
│          │                                                  │
│          ▼                                                  │
│  [Max comments reached?] ──Yes──→ [Stop ✅]                 │
│          │ No                                               │
│          ▼                                                  │
│  [Wait 60s] ──→ [Scroll to top, scan tweets]                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Anyone — no installs, runs right in your browser. Keep the tab open.

### Prerequisites

- [x] Logged into your X/Twitter account in a web browser
- [x] On a desktop/laptop (not mobile)
- [x] On the target user's profile page

### Step 1: Navigate to the target user's profile

> Go to **`x.com/USERNAME`** — replace with the handle you want to monitor.

```
┌──────────────────────────────────────────────────────┐
│ 🔍 x.com/VitalikButerin                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  👤 vitalik.eth @VitalikButerin                      │
│  Ethereum co-founder. Building the decentralized...  │
│  📍 Earth  🔗 vitalik.eth                            │
│  👥 5.8M followers  👥 892 following                  │
│                                                      │
│  📌 Pinned tweet                                     │
│  "The most important problems in crypto right now..."│
│                                                      │
│  Latest:                                             │
│  👤 @VitalikButerin · 2h                             │
│  "I think the future of Ethereum L2s is..."         │
│  ❤️ 8,432  🔄 2,103  💬 1,847                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Step 2: Open Developer Console

| OS | Shortcut |
|----|----------|
| **Windows / Linux** | `F12` then click **Console** tab, or `Ctrl + Shift + J` |
| **Mac** | `Cmd + Option + J` |

### Step 3: Paste and Run

Copy the entire script below, paste it into the console, and press **Enter**:

```javascript
// ============================================
// Medirus - Auto-Comment on X/Twitter
// by nichxbt — https://medirus.online
// Go to: x.com/TARGET_USERNAME
// Open console (F12 → Console), paste, Enter
// Keep this tab open!
// ============================================

(async () => {
  // ============================================
  // CONFIGURATION — customize your comments
  // ============================================
  const CONFIG = {
    // Your comment pool — script picks randomly
    COMMENTS: [
      '🔥',
      'Great point!',
      'This is so true 👏',
      'Interesting take!',
      'Love this perspective',
      '💯',
      'Facts!',
    ],

    // Monitoring
    CHECK_INTERVAL_SECONDS: 60,    // Check for new posts every 60s
    MAX_COMMENTS_PER_SESSION: 5,   // Stop after 5 comments

    // Filters
    ONLY_ORIGINAL_TWEETS: true,    // Skip replies and retweets
    REQUIRE_KEYWORD: false,        // Only comment if post contains a keyword
    KEYWORDS: [],                  // Keywords to match (if REQUIRE_KEYWORD = true)

    // Safety
    MIN_POST_AGE_SECONDS: 30,      // Don't comment on posts younger than 30s
    MAX_POST_AGE_MINUTES: 30,      // Don't comment on posts older than 30 min
    COMMENT_DELAY_MIN: 3000,       // Min delay before commenting (ms)
    COMMENT_DELAY_MAX: 6000,       // Max delay after commenting (ms)
  };

  // ============================================
  // STATE
  // ============================================
  let commentCount = 0;
  let checkCount = 0;
  let isRunning = true;
  const commentedTweets = new Set();

  // Load previous session
  try {
    const saved = JSON.parse(sessionStorage.getItem('medirus_commented') || '[]');
    saved.forEach(id => commentedTweets.add(id));
    if (commentedTweets.size > 0) {
      console.log(`📦 Loaded ${commentedTweets.size} previously commented tweet IDs`);
    }
  } catch (e) {}

  // Get target username from URL
  const username = window.location.pathname.split('/')[1] || 'unknown';

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  💬 Medirus Auto-Commenter                          ║');
  console.log('║                                                       ║');
  console.log(`║  Watching: @${username.padEnd(40)}║`);
  console.log(`║  Interval: Every ${String(CONFIG.CHECK_INTERVAL_SECONDS).padEnd(3)}seconds                       ║`);
  console.log(`║  Max comments: ${String(CONFIG.MAX_COMMENTS_PER_SESSION).padEnd(38)}║`);
  console.log('║                                                       ║');
  console.log('║  Keep this tab open!                                  ║');
  console.log('║  Run stopAutoComment() to stop.                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`💬 Comment pool: ${CONFIG.COMMENTS.join(' | ')}`);
  console.log('');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const randomDelay = (min, max) => sleep(min + Math.random() * (max - min));

  // ============================================
  // HELPERS
  // ============================================

  const getRandomComment = () =>
    CONFIG.COMMENTS[Math.floor(Math.random() * CONFIG.COMMENTS.length)];

  const getTweetId = (article) => {
    const link = article.querySelector('a[href*="/status/"]');
    if (link) {
      const match = link.href.match(/status\/(\d+)/);
      return match ? match[1] : null;
    }
    return null;
  };

  const getTweetAge = (article) => {
    const timeEl = article.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) return Date.now() - new Date(dt).getTime();
    }
    return null;
  };

  const isReply = (article) => !!article.textContent?.includes('Replying to');
  const isRetweet = (article) => !!article.textContent?.includes('reposted');

  const matchesKeywords = (text) => {
    if (!CONFIG.REQUIRE_KEYWORD) return true;
    if (CONFIG.KEYWORDS.length === 0) return true;
    const lower = text.toLowerCase();
    return CONFIG.KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
  };

  // ============================================
  // POST A COMMENT
  // ============================================

  const postComment = async (article, tweetId) => {
    // Click the reply button
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (!replyBtn) {
      console.log('   ⚠️ Reply button not found, skipping');
      return false;
    }

    replyBtn.click();
    await sleep(1200);

    // Wait for reply textarea
    const textarea = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!textarea) {
      console.log('   ⚠️ Reply textarea not found, closing');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return false;
    }

    // Type the comment
    const comment = getRandomComment();
    textarea.focus();
    await sleep(300);
    document.execCommand('insertText', false, comment);
    await sleep(500);

    // Click the "Reply" post button
    const postBtn = document.querySelector('[data-testid="tweetButton"]');
    if (!postBtn) {
      console.log('   ⚠️ Post button not found, closing');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return false;
    }

    postBtn.click();
    await sleep(1000);

    // Save state
    commentedTweets.add(tweetId);
    try {
      sessionStorage.setItem('medirus_commented', JSON.stringify(Array.from(commentedTweets)));
    } catch (e) {}
    commentCount++;

    console.log(`   ✅ Commented "${comment}" (${commentCount}/${CONFIG.MAX_COMMENTS_PER_SESSION})`);
    return true;
  };

  // ============================================
  // CHECK FOR NEW TWEETS
  // ============================================

  const check = async () => {
    if (!isRunning || commentCount >= CONFIG.MAX_COMMENTS_PER_SESSION) {
      console.log('');
      console.log('════════════════════════════════════════');
      console.log('💬 AUTO-COMMENTER — STOPPED');
      console.log('════════════════════════════════════════');
      console.log(`✅ Comments posted: ${commentCount}`);
      console.log(`🔍 Checks performed: ${checkCount}`);
      console.log(`💾 Tweets tracked: ${commentedTweets.size}`);
      console.log('════════════════════════════════════════');
      return;
    }

    checkCount++;
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] 🔍 Check #${checkCount}...`);

    // Scroll to top to see newest tweets
    window.scrollTo(0, 0);
    await sleep(2000);

    // Find new tweets to comment on
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let found = 0;

    for (const article of articles) {
      if (commentCount >= CONFIG.MAX_COMMENTS_PER_SESSION) break;

      const tweetId = getTweetId(article);
      if (!tweetId || commentedTweets.has(tweetId)) continue;

      // Filter: only original tweets
      if (CONFIG.ONLY_ORIGINAL_TWEETS) {
        if (isReply(article) || isRetweet(article)) continue;
      }

      // Filter: post age
      const ageMs = getTweetAge(article);
      if (ageMs !== null) {
        const ageSec = ageMs / 1000;
        const ageMin = ageSec / 60;
        if (ageSec < CONFIG.MIN_POST_AGE_SECONDS) continue;
        if (ageMin > CONFIG.MAX_POST_AGE_MINUTES) continue;
      }

      // Filter: keywords
      const text = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      if (!matchesKeywords(text)) continue;

      // Found a new tweet to comment on!
      found++;
      const preview = text.substring(0, 50).replace(/\n/g, ' ');
      console.log(`   💬 New tweet: "${preview}..."`);

      await randomDelay(CONFIG.COMMENT_DELAY_MIN, CONFIG.COMMENT_DELAY_MAX);
      await postComment(article, tweetId);
      await randomDelay(3000, 6000);
    }

    if (found === 0) {
      console.log(`   No new tweets from @${username}`);
    }

    // Schedule next check
    if (isRunning && commentCount < CONFIG.MAX_COMMENTS_PER_SESSION) {
      console.log(`   ⏰ Next check in ${CONFIG.CHECK_INTERVAL_SECONDS}s...`);
      setTimeout(check, CONFIG.CHECK_INTERVAL_SECONDS * 1000);
    }
  };

  // Start
  await check();

  // Expose stop function
  window.stopAutoComment = () => {
    isRunning = false;
    console.log('⛔ Stopping auto-commenter...');
  };
})();
```

### ✅ Expected Output

```
╔═══════════════════════════════════════════════════════╗
║  💬 Medirus Auto-Commenter                          ║
║                                                       ║
║  Watching: @VitalikButerin                            ║
║  Interval: Every 60 seconds                           ║
║  Max comments: 5                                      ║
║                                                       ║
║  Keep this tab open!                                  ║
║  Run stopAutoComment() to stop.                       ║
╚═══════════════════════════════════════════════════════╝

💬 Comment pool: 🔥 | Great point! | This is so true 👏 | Interesting take! | Love this perspective | 💯 | Facts!

[10:23:45] 🔍 Check #1...
   💬 New tweet: "I think the future of Ethereum L2s is about..."
   ✅ Commented "Great point!" (1/5)
   ⏰ Next check in 60s...
[10:24:48] 🔍 Check #2...
   No new tweets from @VitalikButerin
   ⏰ Next check in 60s...
[10:25:50] 🔍 Check #3...
   No new tweets from @VitalikButerin
   ⏰ Next check in 60s...
[10:37:12] 🔍 Check #14...
   💬 New tweet: "Just published my thoughts on zkEVM progress..."
   ✅ Commented "🔥" (2/5)
   ⏰ Next check in 60s...
```

---

## 🤖 Method 2: MCP Server (AI Agents)

> Use with Claude Desktop, GPT, Cursor, or any MCP-compatible AI agent.

### Setup

```json
{
  "mcpServers": {
    "medirus": {
      "command": "npx",
      "args": ["-y", "medirus", "mcp"]
    }
  }
}
```

### Claude Desktop example prompt:

> "Monitor @VitalikButerin on X for new tweets. When he posts, reply with a relevant comment from this list: 'Great point!', 'Interesting take 🔥', 'This is so true 👏'. Limit to 3 comments."

---

## 📊 Method Comparison

| Feature | 🌐 Browser Console | 🤖 MCP |
|---------|-------------------|---------|
| Setup | None | Config JSON |
| Best for | Quick monitoring | AI-managed engagement |
| Custom comments | ✅ Edit CONFIG | ✅ Prompt-based |
| Session memory | ✅ sessionStorage | ❌ |
| Stop mid-run | `stopAutoComment()` | Cancel tool |
| Runs in background | Tab must stay open | Via AI agent |

---

## ⚙️ Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `COMMENTS` | string[] | `['🔥', 'Great point!', ...]` | Pool of comments to pick from randomly |
| `CHECK_INTERVAL_SECONDS` | number | `60` | How often to check for new posts (seconds) |
| `MAX_COMMENTS_PER_SESSION` | number | `5` | Stop after this many comments |
| `ONLY_ORIGINAL_TWEETS` | boolean | `true` | Skip replies and retweets from the target user |
| `REQUIRE_KEYWORD` | boolean | `false` | Only comment if post contains a keyword |
| `KEYWORDS` | string[] | `[]` | Keywords to filter by (if `REQUIRE_KEYWORD` is true) |
| `MIN_POST_AGE_SECONDS` | number | `30` | Don't comment on posts younger than this |
| `MAX_POST_AGE_MINUTES` | number | `30` | Don't comment on posts older than this |
| `COMMENT_DELAY_MIN` | number | `3000` | Min delay before clicking reply (ms) |
| `COMMENT_DELAY_MAX` | number | `6000` | Max delay after posting comment (ms) |

---

## 📊 Comment Strategy Examples

### Generic Engagement (safe, low effort)
```javascript
COMMENTS: ['🔥', '💯', 'This!', 'Great point!', 'So true 👏', 'Facts!']
```

### Thoughtful AI/Tech (higher engagement)
```javascript
COMMENTS: [
  'Really interesting perspective on this 🧵',
  'This is one of the most underrated takes of 2026',
  'Been thinking about this a lot lately — spot on 💯',
  'This thread deserves way more attention',
  'Saving this for later — great breakdown 🔖',
]
```

### Keyword-Filtered (targeted topics only)
```javascript
REQUIRE_KEYWORD: true,
KEYWORDS: ['Ethereum', 'L2', 'rollup', 'zkEVM'],
COMMENTS: [
  'The L2 ecosystem is evolving so fast!',
  'Great analysis of the rollup landscape 📊',
  'Been following this closely — exciting progress',
]
```

---

## 💡 Pro Tips

1. **Write comments that add value** — Generic "🔥" works, but thoughtful comments like "This reminds me of [related concept]" get 10x more engagement and followers. Craft your comment pool carefully.

2. **Set `MAX_COMMENTS_PER_SESSION` to 3–5** — X flags accounts that reply too frequently to the same user. 3–5 comments per session is safe. Take a 2-hour break between sessions.

3. **Target mid-tier accounts (10K–100K followers)** — Big accounts get thousands of replies and yours may get buried. Mid-tier accounts have engaged audiences and are more likely to notice and follow back.

4. **Use `REQUIRE_KEYWORD` for relevance** — If the target user tweets about multiple topics, use keywords to only comment on posts relevant to your niche. This makes your replies more authentic.

5. **Keep the tab open** — The script runs via `setTimeout` in the browser. If you close the tab, it stops. Use a dedicated browser window/tab for monitoring.

---

## ⚠️ Important Notes

- **Spam risk is REAL** — X aggressively detects spam replies. If your comments are too generic, too frequent, or always the same, you will get limited or suspended. Vary your comments, limit frequency, and don't target more than 2–3 accounts at a time.
- **Rate limits** — X limits the number of tweets/replies per day (~300 total). The default 5 comments per session is very safe. Don't increase `MAX_COMMENTS_PER_SESSION` beyond 10.
- **Session memory** — Commented tweet IDs are saved in `sessionStorage`. Closing the browser tab clears the state. This is intentional — it prevents stale state from accumulating.
- **Authenticity matters** — The best results come from using auto-commenter as an **alert system** rather than a fully autonomous bot. Let it detect new posts, then manually craft a thoughtful reply for the most important ones.
- **Don't combine with other automations** — Running auto-commenter + auto-liker + auto-follow simultaneously is a recipe for suspension.

---

## 🔗 Related Features

| Feature | Use Case | Link |
|---------|----------|------|
| Auto-Liker | Auto-like tweets alongside commenting | [→ Guide](../auto-liker.md) |
| Follow Engagers | Follow people who liked a specific tweet | [→ Guide](../follow-engagers.md) |
| Growth Suite | Combined growth campaign (like + follow + unfollow) | [→ Guide](../growth-suite.md) |
| Monitor Account | Track a user's follower count changes | [→ Guide](../monitor-account.md) |
| Keyword Follow | Auto-follow people tweeting about your niche | [→ Guide](../keyword-follow.md) |

---

## ❓ FAQ

### Q: How do I auto-reply to tweets on Twitter / X in 2026?
**A:** Go to the target user's profile on `x.com/USERNAME`, open your browser console (F12 → Console), paste the Medirus auto-commenter script, and press Enter. Configure your comment pool and check interval. The script monitors the profile for new tweets and replies automatically. Keep the browser tab open while it runs.

### Q: Is auto-commenting on Twitter safe?
**A:** With conservative limits, yes. Keep sessions to 3–5 comments max, use varied comment templates, and target 1–2 accounts per session. X detects and penalizes repetitive or spammy replies. The Medirus script uses randomized delays and comment rotation to mimic natural behavior.

### Q: Can I auto-comment on tweets that mention specific keywords?
**A:** Yes. Set `REQUIRE_KEYWORD: true` and fill the `KEYWORDS` array with your target terms. The script will only comment on the target user's tweets that contain at least one of your keywords.

### Q: Will the target user know I'm using a bot?
**A:** Not if your comments are varied and thoughtful. If you only post "🔥" on every tweet within 30 seconds, it looks automated. Use diverse, relevant comments and natural delays. The best strategy: use auto-commenter to alert you of new posts, then manually write the actual reply.

### Q: How do I stop the auto-commenter?
**A:** Type `stopAutoComment()` in the browser console and press Enter. Or simply close the browser tab — the script stops immediately.

---

<footer>
Built with ⚡ by <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</footer>
