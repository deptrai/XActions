# Advanced Automation Techniques

> Chaining scripts, persistent workflows, debugging strategies, and power-user patterns.

---

## Table of Contents

- [Chaining Scripts Together](#chaining-scripts-together)
- [Sustainable Growth Cycles](#sustainable-growth-cycles)
- [State Management Across Sessions](#state-management-across-sessions)
- [Debugging Techniques](#debugging-techniques)
- [DOM Discovery & Selector Updates](#dom-discovery--selector-updates)
- [Custom Script Patterns](#custom-script-patterns)
- [Performance Optimization](#performance-optimization)
- [Account Safety Strategies](#account-safety-strategies)

---

## Chaining Scripts Together

Scripts coexist in the same browser tab because they all share `window.Medirus`. The order you paste them determines what's available.

### Pattern 1: Growth + Protection + Tracking

```
1. Paste core.js                    → window.Medirus.Core ready
2. Paste sessionLogger.js           → Starts logging all actions
3. Paste protectActiveUsers.js      → Scans your posts, builds whitelist
4. Paste growthSuite.js             → Growth automation runs
```

**What happens:** sessionLogger records everything. protectActiveUsers writes to `medirus_protected_users`. smartUnfollow (inside growthSuite) skips protected users. The session log captures the full audit trail.

### Pattern 2: Research → Follow → Engage

```
1. Paste core.js
2. Paste actions.js                 → Full Medirus.* API
3. Navigate to a viral tweet in your niche
4. Paste followEngagers.js          → Follow the likers
5. Paste autoLiker.js               → Like related content
```

**What happens:** followEngagers builds a list of engaged users. autoLiker independently likes matching content on the page. Both track their actions separately.

### Pattern 3: Control Panel + Any Script

```
1. Paste core.js
2. Paste controlPanel.js            → Floating UI appears
3. Select an automation from the dropdown
4. Configure via the panel's inputs
5. Click Start
```

**What happens:** The control panel replaces individual script configuration. It provides visual controls for start/pause/resume and real-time progress tracking.

### Pattern 4: Actions Library Interactive Use

```
1. Paste core.js
2. Paste actions.js
3. Run commands interactively:
```

```javascript
// Interactive exploration
await Medirus.search.advanced({
  from: 'elonmusk',
  minFaves: 1000,
  since: '2025-01-01',
});

// Get results and like them
const tweets = Medirus.search.getResults();
for (const tweet of tweets.slice(0, 5)) {
  await Medirus.engage.like(tweet);
  await Medirus.Core?.sleep(2000); // Access Core through closure
}

// Export your bookmarks
const bookmarks = await Medirus.utils.exportBookmarks(100);
console.table(bookmarks);
```

---

## Sustainable Growth Cycles

### The Weekly Cycle

| Day | Action | Script |
|-----|--------|--------|
| Mon-Fri | Follow 20 targeted users | `keywordFollow.js` |
| Mon-Fri | Like 30 posts in your niche | `autoLiker.js` |
| Saturday | Scan posts for engaged users | `protectActiveUsers.js` |
| Sunday | Unfollow non-followers from 7+ days ago | `smartUnfollow.js` |

### Setting Up the Cycle

**Monday-Friday:**
```javascript
// keywordFollow.js config
const OPTIONS = {
  KEYWORDS: ['your niche keyword 1', 'your niche keyword 2'],
  MAX_FOLLOWS_PER_KEYWORD: 10,
  MAX_FOLLOWS_TOTAL: 20,
  MIN_FOLLOWERS: 100,
  MAX_FOLLOWERS: 50000,
  MUST_HAVE_BIO: true,
};
```

Every follow is recorded with a timestamp in `medirus_followed_users`.

**Saturday:**
```javascript
// protectActiveUsers.js config
const CONFIG = {
  POSTS_TO_SCAN: 20,   // Check your last 20 posts
};
```

Builds list of users who engage with your content.

**Sunday:**
```javascript
// smartUnfollow.js config
const OPTIONS = {
  DAYS_TO_WAIT: 7,       // 1 week grace period
  MAX_UNFOLLOWS: 50,
  DRY_RUN: true,         // Run dry first to preview!
  ONLY_TRACKED: true,    // Only unfollow users we tracked from keywordFollow
  WHITELIST: [],
};
```

### Growth Math

If you follow 20 users/day and ~40% follow back:
- Week 1: +100 follows → ~40 new followers
- Week 2: +100 more → ~40 more followers, unfollow ~60 non-followers from Week 1
- Month 1: ~160 new followers, following count stays stable

---

## State Management Across Sessions

### How Data Persists

| Storage | Survives Refresh | Survives Tab Close | Used For |
|---------|-----------------|-------------------|----------|
| `localStorage` (via `Core.storage`) | ✅ | ✅ | Tracked users, liked tweets, rate limits |
| `sessionStorage` | ✅ | ❌ | Navigation state, processed pages |
| In-memory variables | ❌ | ❌ | Current session counters |

### Viewing All Stored Data

```javascript
// List all Medirus keys
window.Medirus.Core.storage.list();

// View specific data
window.Medirus.Core.storage.get('followed_users');
window.Medirus.Core.storage.get('liked_tweets');
window.Medirus.Core.storage.get('my_followers');
window.Medirus.Core.storage.get('protected_users');
window.Medirus.Core.storage.get('session_log');

// View rate limit status
window.Medirus.Core.rateLimit.getRemaining('follow', 100, 'day');
window.Medirus.Core.rateLimit.getRemaining('like', 200, 'day');
```

### Exporting Data

```javascript
// Export all Medirus data as JSON
const allData = {};
window.Medirus.Core.storage.list().forEach(key => {
  allData[key] = window.Medirus.Core.storage.get(key);
});
console.log(JSON.stringify(allData, null, 2));

// Copy to clipboard
copy(JSON.stringify(allData, null, 2));
```

### Importing Data (Restore from Backup)

```javascript
const backup = { /* your exported data */ };
Object.entries(backup).forEach(([key, value]) => {
  window.Medirus.Core.storage.set(key, value);
});
```

### Clearing Data

```javascript
// Clear specific key
window.Medirus.Core.storage.remove('followed_users');

// Clear all Medirus data
window.Medirus.Core.storage.clear();

// Nuclear option — clear ALL X data from localStorage
Medirus.utils.clearXData(); // Requires actions.js loaded
```

---

## Debugging Techniques

### Enable Verbose Logging

```javascript
window.Medirus.Core.CONFIG.DEBUG = true;
```

### Check Extraction Quality

After running any script that extracts user data:

```javascript
window.Medirus.Core.extractionStats.report();
```

This shows which extraction strategies are working:
```
📊 Extraction Strategy Report:
  bio: 45 extractions
    testid: 40 (88.9%) ████████████████
    dir-auto: 5 (11.1%) ██
```

If `testid` drops below 50%, X has changed their DOM. Check [dom-selectors.md](../dom-selectors.md) for updates.

### Visual DOM Inspector

```javascript
// After loading actions.js:
Medirus.utils.devMode();
```

This outlines every `data-testid` element in red with tooltip labels. Hover over elements to see their selector names.

### Find All Selectors on Current Page

```javascript
Medirus.utils.getAllSelectors();
// Returns sorted array of all data-testid values
```

### Check Rate Limit Status

```javascript
['follow', 'like', 'unfollow', 'comment'].forEach(action => {
  const hourly = window.Medirus.Core.rateLimit.getRemaining(action, 50, 'hour');
  const daily = window.Medirus.Core.rateLimit.getRemaining(action, 200, 'day');
  console.log(`${action}: ${hourly} left this hour, ${daily} left today`);
});
```

### Test DOM Selection Without Acting

```javascript
const { SELECTORS } = window.Medirus.Core;

// Count tweets on page
document.querySelectorAll(SELECTORS.tweet).length;

// Check if follow buttons exist
document.querySelectorAll(SELECTORS.followButton).length;

// Test user extraction on first cell
const cell = document.querySelector(SELECTORS.userCell);
if (cell) console.log(window.Medirus.Core.extractUserFromCell(cell));
```

---

## DOM Discovery & Selector Updates

X/Twitter changes their DOM frequently. Here's how to find new selectors:

### Method 1: `devMode()`

```javascript
Medirus.utils.devMode();
// Now hover over elements — each data-testid is shown as a tooltip
```

### Method 2: Element Inspector

1. Right-click any element → Inspect
2. Look for `data-testid` attribute in the element tree
3. That's your selector: `[data-testid="the-value"]`

### Method 3: JavaScript Discovery

```javascript
// Find all data-testid values on the page
const selectors = new Set();
document.querySelectorAll('[data-testid]').forEach(el => {
  selectors.add(el.getAttribute('data-testid'));
});
console.log([...selectors].sort());
```

### Method 4: Monitor New Selectors

```javascript
// Watch for new data-testid elements appearing
const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) {
        const testId = node.getAttribute?.('data-testid');
        if (testId) console.log('New element:', testId);
        node.querySelectorAll?.('[data-testid]').forEach(el => {
          console.log('New element:', el.getAttribute('data-testid'));
        });
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
```

---

## Custom Script Patterns

### Template: Custom Automation Script

```javascript
(() => {
  if (!window.Medirus?.Core) {
    console.error('❌ Core module not loaded! Paste core.js first.');
    return;
  }

  const { log, sleep, randomDelay, scrollBy, clickElement,
          waitForElement, storage, rateLimit, SELECTORS } = window.Medirus.Core;

  // ============================================
  // CONFIGURATION
  // ============================================
  const OPTIONS = {
    MAMEDIRUS: 10,
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
  };

  // ============================================
  // STATE
  // ============================================
  let actionCount = 0;
  let isRunning = true;
  const processed = new Set(storage.get('my_script_processed') || []);

  // ============================================
  // MAIN LOGIC
  // ============================================
  const processItem = async (element) => {
    // Your logic here
    actionCount++;
    rateLimit.increment('my_action', 'hour');
    log(`Action #${actionCount}`, 'success');
  };

  const run = async () => {
    log('🚀 Starting custom automation...', 'info');

    while (isRunning && actionCount < OPTIONS.MAMEDIRUS) {
      // Check rate limits
      if (!rateLimit.check('my_action', 50, 'hour')) {
        log('Rate limit reached', 'warning');
        break;
      }

      // Find elements to process
      const elements = document.querySelectorAll(SELECTORS.tweet);
      for (const el of elements) {
        if (!isRunning || actionCount >= OPTIONS.MAMEDIRUS) break;
        await processItem(el);
        await randomDelay(OPTIONS.MIN_DELAY, OPTIONS.MAX_DELAY);
      }

      // Scroll for more
      scrollBy(600);
      await sleep(2000);
    }

    // Save state
    storage.set('my_script_processed', Array.from(processed));
    log(`✅ Done! ${actionCount} actions performed.`, 'success');
  };

  // Stop function
  window.stopMyScript = () => {
    isRunning = false;
    log('Stopping...', 'warning');
  };

  run();
})();
```

### Pattern: Scroll & Collect (No Actions)

```javascript
const collectData = async () => {
  const data = [];
  let lastHeight = 0;

  while (data.length < 100) {
    const items = document.querySelectorAll('[data-testid="tweet"]');
    items.forEach(item => {
      const link = item.querySelector('a[href*="/status/"]')?.href;
      const text = item.querySelector('[data-testid="tweetText"]')?.textContent;
      if (link && !data.find(d => d.link === link)) {
        data.push({ link, text: text?.substring(0, 100) });
      }
    });

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await window.Medirus.Core.sleep(2000);

    if (document.body.scrollHeight === lastHeight) break;
    lastHeight = document.body.scrollHeight;
  }

  return data;
};

const results = await collectData();
console.table(results);
```

---

## Performance Optimization

### Delay Tuning

| Risk Level | Min Delay | Max Delay | Actions/Hour |
|-----------|-----------|-----------|--------------|
| **Conservative** | 5000ms | 10000ms | ~25 |
| **Moderate** | 2000ms | 5000ms | ~50 |
| **Aggressive** | 1000ms | 2000ms | ~100+ |

> **Recommendation:** Start conservative. Only increase speed after testing for weeks without issues.

### Memory Management

Long-running scripts (algorithmTrainer, autoCommenter with monitoring) can accumulate data:

```javascript
// Check memory of tracked sets
const followed = window.Medirus.Core.storage.get('followed_users');
console.log(`Tracking ${Object.keys(followed || {}).length} users`);

// Prune old entries (older than 30 days)
const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
for (const [user, data] of Object.entries(followed)) {
  if (data.followedAt < cutoff) delete followed[user];
}
window.Medirus.Core.storage.set('followed_users', followed);
```

---

## Account Safety Strategies

### The 80/20 Rule

Keep your automation-to-manual ratio at 80% manual, 20% automated (by volume). Use automation for the tedious parts (finding users, scrolling) and do genuine engagement manually.

### Warm-Up Period

New accounts should not run automation immediately. Use the algorithm scripts first:

```
Week 1-2: algorithmTrainer.js only (browsing, not acting)
Week 3:   Add autoLiker.js with very low limits (5-10/day)
Week 4:   Add keywordFollow.js with very low limits (5-10/day)
Month 2+: Gradually increase limits
```

### Signs You're Being Rate Limited

- Actions start failing silently
- Follow buttons don't respond
- You see "You are unable to perform this action" messages
- Toast notifications about limits appear

**What to do:**
1. Stop all automation immediately
2. Wait at least 1 hour (24 hours if severe)
3. Reduce your limits by 50%
4. Increase delays between actions

### What NOT to Do

- Don't run the same script across multiple browser tabs
- Don't exceed 100 follows/day or 200 likes/day
- Don't comment the same text repeatedly
- Don't automate 24/7 without breaks
- Don't run automation on accounts less than 1 month old
