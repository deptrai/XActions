---
title: "Scrape Tweets on X (Twitter) — Free No-API Tool 2026"
description: "Search and scrape tweets from X/Twitter to JSON or CSV. Free browser script with keyword search, no API needed."
keywords: ["scrape tweets twitter", "twitter tweet scraper free", "search tweets X 2026", "how to scrape twitter without API", "twitter search export CSV", "scrape twitter search results", "tweet scraper no API", "export twitter search", "twitter data scraping free", "medirus tweet scraping"]
canonical: "https://medirus.online/examples/tweet-scraping"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 🔍 Scrape Tweets on X (Twitter) — Export Search Results to JSON/CSV for Free

> **Search any keyword on X (Twitter) and export every matching tweet to JSON or CSV — free, no API key, no rate limit fees.** Get tweet text, engagement metrics, URLs, and more.

**Works on:** 🌐 Browser Console · 💻 CLI · 🤖 MCP (AI Agents)
**Difficulty:** 🟢 Beginner
**Time:** ⏱️ 2–10 minutes (depending on volume)
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [tweet-scraping.md](../tweet-scraping.md)

---

## 🎯 Real-World Scenario

You're a product manager at a SaaS company and your CEO just asked: "What are people saying about us on Twitter?" You need to find every tweet mentioning your product from the last 30 days, export it to a spreadsheet, and sort by engagement to identify the loudest praise and complaints. Twitter's API charges $100/month for search access. You need this data **today** for a board meeting.

Medirus' tweet scraper searches X for your keyword, scrolls through results to collect hundreds of tweets, extracts the full text, author, engagement metrics (likes, retweets, replies, views), and exports everything to a clean JSON or CSV file — in under 5 minutes.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  The Manual Way                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. Go to X search, type your product name           │
│  2. Scroll through results one by one                │
│  3. Screenshot or copy-paste each tweet              │
│  4. Manually type into a spreadsheet:                │
│     - Who said it? How many likes?                   │
│     - When? What did they say exactly?               │
│  5. Repeat 300 times...                              │
│                                                      │
│  Time: ~6 hours     Accuracy: questionable           │
│  Cost: $0 but your sanity                            │
└──────────────────────────────────────────────────────┘
```

**After Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  The Medirus Way                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. Go to X search, type your product name           │
│  2. Open console, paste script, press Enter          │
│  3. Wait 3 minutes while it scrolls & collects       │
│  4. JSON + CSV auto-download with all 312 tweets     │
│                                                      │
│  Time: ~3 minutes   Accuracy: 100%                   │
│  Cost: $0 and you kept your sanity                   │
│  Bonus: Sorted by engagement, ready for analysis     │
└──────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

1. 🔍 **Reads the search query** — detects what you searched for from the URL
2. 📜 **Scrolls through results** — loads more tweets by scrolling down automatically
3. 📊 **Extracts tweet data** — captures text, author, handle, timestamp, likes, retweets, replies, views, and engagement score
4. 🧹 **De-duplicates** — uses tweet IDs to ensure no duplicates
5. 📈 **Sorts by engagement** — highest-engagement tweets come first
6. 💾 **Exports JSON + CSV** — auto-downloads both formats
7. 🖥️ **Stores on `window`** — access `window.scrapedSearch` for programmatic use

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Go to x.com/search?q=your+keyword]                       │
│          │                                                  │
│          ▼                                                  │
│  [Read search query from URL]                               │
│          │                                                  │
│          ▼                                                  │
│  [Scan visible tweet articles]                              │
│          │                                                  │
│     ┌────┴─────────────────────┐                            │
│     │ For each article:        │                            │
│     │  • Extract text, handle  │                            │
│     │  • Parse engagement nums │                            │
│     │  • Get tweet URL + ID    │                            │
│     │  • Add to Map (dedup)    │                            │
│     └────┬─────────────────────┘                            │
│          │                                                  │
│          ▼                                                  │
│  [Scroll down 800px] ──→ [Wait 1.5s]                       │
│          │                                                  │
│          ▼                                                  │
│  [Max tweets reached?] ──No──→ [Scan visible tweets]        │
│          │ Yes                                              │
│          ▼                                                  │
│  [Sort by engagement (desc)]                                │
│          │                                                  │
│          ▼                                                  │
│  [Download JSON] + [Download CSV]                           │
│          │                                                  │
│          ▼                                                  │
│  [Store on window.scrapedSearch ✅]                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Anyone — no installs, runs right in your browser.

### Prerequisites

- [x] Logged into X/Twitter in a web browser
- [x] On a desktop/laptop (not mobile)

### Step 1: Search for your keyword on X

> Go to **`x.com/search?q=YOUR+KEYWORD`** or use the search bar at the top of X.

```
┌──────────────────────────────────────────────────────┐
│ 🔍 x.com/search?q=medirus&src=typed_query&f=top    │
├──────────────────────────────────────────────────────┤
│  Top  |  Latest  |  People  |  Media  |  Lists      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  👤 @nichxbt · 2h                                    │
│  "Medirus v3 just dropped — auto-like, scrape,     │
│   unfollow, all from your browser console 🚀"       │
│  ❤️ 127  🔄 34  💬 18  👁️ 4,521                      │
│                                                      │
│  👤 @devtools_fan · 5h                               │
│  "Just tried Medirus for scraping my followers.    │
│   Exported 10K followers to CSV in 3 minutes."      │
│  ❤️ 45  🔄 12  💬 8  👁️ 1,892                        │
│                                                      │
│  ... hundreds more results                           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

> **Tip:** Choose the **"Latest"** tab for chronological results, or **"Top"** for highest engagement first.

### Step 2: Open Developer Console

| OS | Shortcut |
|----|----------|
| **Windows / Linux** | `F12` then click **Console** tab, or `Ctrl + Shift + J` |
| **Mac** | `Cmd + Option + J` |

### Step 3: Paste and Run

Copy the entire script below, paste it into the console, and press **Enter**:

```javascript
// ============================================
// Medirus - Scrape Twitter/X Search Results
// by nichxbt — https://medirus.online
// Go to: x.com/search?q=YOUR+KEYWORD
// Open console (F12 → Console), paste, Enter
// ============================================

(async () => {
  const CONFIG = {
    MAX_TWEETS: 500,       // Max tweets to collect
    SCROLL_DELAY: 1500,    // Delay between scrolls (ms)
    FORMAT: 'both',        // 'json', 'csv', 'both'
    MIN_LIKES: 0,          // Filter: minimum likes (0 = no filter)
  };

  // Verify we're on the search page
  if (!window.location.pathname.includes('/search')) {
    console.error('❌ Please go to Twitter search first!');
    console.log('   👉 Example: x.com/search?q=your+search+term');
    return;
  }

  const query = new URLSearchParams(window.location.search).get('q') || 'unknown';

  console.log('');
  console.log('🔍 Medirus - TWEET SCRAPER');
  console.log('════════════════════════════════════════');
  console.log(`📝 Query: "${query}"`);
  console.log(`🎯 Max tweets: ${CONFIG.MAX_TWEETS}`);
  console.log(`⏱️  Scroll delay: ${CONFIG.SCROLL_DELAY}ms`);
  console.log('════════════════════════════════════════');
  console.log('');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseNumber = (str) => {
    if (!str) return 0;
    const num = parseFloat(str.replace(/,/g, ''));
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  const extractTweet = (article) => {
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
      const handle = userName.match(/@(\w+)/)?.[1] || '';
      const displayName = userName.split('@')[0]?.trim() || '';

      const timeLink = article.querySelector('time')?.closest('a');
      const tweetUrl = timeLink?.href || '';
      const tweetId = tweetUrl.split('/status/')[1]?.split('?')[0] || '';
      const time = article.querySelector('time')?.getAttribute('datetime') || '';

      const buttons = article.querySelectorAll('[role="group"] button');
      let replies = 0, retweets = 0, likes = 0, views = 0;

      buttons.forEach(btn => {
        const label = btn.getAttribute('aria-label') || '';
        const num = parseNumber(label.match(/[\d,.]+[KM]?/)?.[0] || '0');
        if (label.includes('repl')) replies = num;
        else if (label.includes('repost') || label.includes('Retweet')) retweets = num;
        else if (label.includes('like')) likes = num;
        else if (label.includes('view')) views = num;
      });

      return {
        tweetId, handle, displayName, text: tweetText,
        url: tweetUrl, time, likes, retweets, replies, views,
        engagement: likes + retweets + replies,
      };
    } catch (e) { return null; }
  };

  // Scrape loop
  const tweets = new Map();
  let scrolls = 0;
  let noNewCount = 0;

  while (tweets.size < CONFIG.MAX_TWEETS && noNewCount < 5) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const before = tweets.size;

    articles.forEach(article => {
      const tweet = extractTweet(article);
      if (tweet && tweet.tweetId && !tweets.has(tweet.tweetId)) {
        if (tweet.likes >= CONFIG.MIN_LIKES) {
          tweets.set(tweet.tweetId, tweet);
        }
      }
    });

    const added = tweets.size - before;
    if (added > 0) {
      console.log(`🔍 Collected ${tweets.size} tweets...`);
      noNewCount = 0;
    } else {
      noNewCount++;
    }

    window.scrollBy(0, 800);
    await sleep(CONFIG.SCROLL_DELAY);
    scrolls++;
    if (scrolls > 100) break;
  }

  // Sort by engagement
  const tweetList = Array.from(tweets.values());
  tweetList.sort((a, b) => b.engagement - a.engagement);

  // Summary
  console.log('');
  console.log('════════════════════════════════════════');
  console.log(`🔍 SCRAPED ${tweetList.length} TWEETS FOR "${query}"`);
  console.log('════════════════════════════════════════');

  const totalLikes = tweetList.reduce((s, t) => s + t.likes, 0);
  const totalRTs = tweetList.reduce((s, t) => s + t.retweets, 0);
  console.log(`📊 Total engagement: ${totalLikes.toLocaleString()} likes, ${totalRTs.toLocaleString()} retweets`);
  console.log('');
  console.log('🏆 Top 5 by engagement:');
  tweetList.slice(0, 5).forEach((t, i) => {
    console.log(`   ${i + 1}. @${t.handle} (${t.likes} ❤️): "${t.text.slice(0, 50)}..."`);
  });

  // Export
  const safeQuery = query.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  const ts = Date.now();

  if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
    const data = { query, scrapedAt: new Date().toISOString(), count: tweetList.length, tweets: tweetList };
    download(JSON.stringify(data, null, 2), `search_${safeQuery}_${ts}.json`, 'application/json');
    console.log('💾 Downloaded JSON');
  }

  if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
    const csv = [
      'Handle,DisplayName,Text,Likes,Retweets,Replies,Views,URL,Time',
      ...tweetList.map(t =>
        `"@${t.handle}","${t.displayName.replace(/"/g, '""')}","${t.text.replace(/"/g, '""').replace(/\n/g, ' ')}",${t.likes},${t.retweets},${t.replies},${t.views},"${t.url}","${t.time}"`
      )
    ].join('\n');
    download(csv, `search_${safeQuery}_${ts}.csv`, 'text/csv');
    console.log('💾 Downloaded CSV');
  }

  window.scrapedSearch = { query, tweets: tweetList };
  console.log('');
  console.log('✅ Done! Access data: window.scrapedSearch');
  console.log(`📊 Total: ${tweetList.length} tweets exported`);
})();
```

### ✅ Expected Output

```
🔍 Medirus - TWEET SCRAPER
════════════════════════════════════════
📝 Query: "medirus"
🎯 Max tweets: 500
⏱️  Scroll delay: 1500ms
════════════════════════════════════════

🔍 Collected 24 tweets...
🔍 Collected 51 tweets...
🔍 Collected 89 tweets...
🔍 Collected 134 tweets...
🔍 Collected 178 tweets...
🔍 Collected 203 tweets...
🔍 Collected 247 tweets...
🔍 Collected 312 tweets...

════════════════════════════════════════
🔍 SCRAPED 312 TWEETS FOR "medirus"
════════════════════════════════════════
📊 Total engagement: 14,521 likes, 2,891 retweets

🏆 Top 5 by engagement:
   1. @nichxbt (823 ❤️): "Medirus v3 just dropped — auto-like, scrape, un..."
   2. @devtools_weekly (412 ❤️): "Best free Twitter automation tools in 2026: 1..."
   3. @startuptools (298 ❤️): "Thread: How I grew from 500→10K followers using ..."
   4. @ai_marc (187 ❤️): "Just tried the Medirus MCP server with Claude D..."
   5. @buildinpublic_ (143 ❤️): "Scraping Twitter without paying $100/mo for API?..."
💾 Downloaded JSON
💾 Downloaded CSV

✅ Done! Access data: window.scrapedSearch
📊 Total: 312 tweets exported
```

---

## 💻 Method 2: CLI (Command Line)

```bash
# Install Medirus globally
npm install -g medirus

# Search and export tweets
npx medirus search "AI startups" --limit 200 --output ai-tweets.json

# With more options
npx medirus search "your product name" \
  --limit 500 \
  --format csv \
  --output product-mentions.csv
```

### ✅ CLI Output Preview

```
⚡ Medirus v3.x.x
🔍 Searching for "AI startups"...
   📊 Collected 200 tweets
   💾 Saved to: ai-tweets.json
   ✅ Done!
```

### CLI Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | number | `100` | Maximum tweets to scrape |
| `--format` | string | `json` | Output format: `json` or `csv` |
| `--output` | string | auto | Output file path |
| `--min-likes` | number | `0` | Minimum likes filter |

---

## 🤖 Method 3: MCP Server (AI Agents)

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

### MCP Tool Call

```json
{
  "tool": "x_search_tweets",
  "arguments": {
    "query": "AI startups",
    "limit": 200,
    "sort_by": "engagement"
  }
}
```

### Claude Desktop example prompt:

> "Search X for tweets mentioning 'my product' from the last week. Export the top 100 by engagement to a CSV file."

---

## 📊 Method Comparison

| Feature | 🌐 Browser Console | 💻 CLI | 🤖 MCP |
|---------|-------------------|--------|---------|
| Setup | None | `npm install` | Config JSON |
| Speed | Fast | Fastest | Via AI agent |
| Best for | Quick searches | Data pipelines | AI workflows |
| Export | JSON + CSV | JSON, CSV | JSON |
| Max tweets | ~500 per scroll | Depends on auth | Depends on auth |
| Filter | Min likes | Min likes | Min likes |
| Sort | By engagement | By engagement | By engagement |

---

## ⚙️ Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `MAX_TWEETS` | number | `500` | Maximum tweets to collect |
| `SCROLL_DELAY` | number | `1500` | Delay between scrolls in ms |
| `FORMAT` | string | `'both'` | Export format: `'json'`, `'csv'`, or `'both'` |
| `MIN_LIKES` | number | `0` | Only include tweets with at least this many likes |

---

## 📊 Sample Output / Results

### Example JSON Export

```json
{
  "query": "AI startups",
  "scrapedAt": "2026-02-24T14:30:00.000Z",
  "count": 312,
  "tweets": [
    {
      "tweetId": "1893847562938475629",
      "handle": "nichxbt",
      "displayName": "nich",
      "text": "Medirus v3 just dropped — auto-like, scrape, unfollow, all from your browser console 🚀",
      "url": "https://x.com/nichxbt/status/1893847562938475629",
      "time": "2026-02-24T10:23:00.000Z",
      "likes": 823,
      "retweets": 217,
      "replies": 54,
      "views": 42100,
      "engagement": 1094
    },
    {
      "tweetId": "1893812345678901234",
      "handle": "devtools_weekly",
      "displayName": "Dev Tools Weekly",
      "text": "Best free Twitter automation tools in 2026: 1. Medirus...",
      "url": "https://x.com/devtools_weekly/status/1893812345678901234",
      "time": "2026-02-24T08:15:00.000Z",
      "likes": 412,
      "retweets": 89,
      "replies": 31,
      "views": 18500,
      "engagement": 532
    }
  ]
}
```

### Example CSV (opens in Excel/Google Sheets)

```csv
Handle,DisplayName,Text,Likes,Retweets,Replies,Views,URL,Time
"@nichxbt","nich","Medirus v3 just dropped — auto-like, scrape, unfollow...",823,217,54,42100,"https://x.com/nichxbt/status/1893847562938475629","2026-02-24T10:23:00.000Z"
"@devtools_weekly","Dev Tools Weekly","Best free Twitter automation tools in 2026...",412,89,31,18500,"https://x.com/devtools_weekly/status/1893812345678901234","2026-02-24T08:15:00.000Z"
```

---

## 💡 Pro Tips

1. **Use Twitter's advanced search operators** — Before running the scraper, refine your search: `"exact phrase"`, `from:username`, `since:2026-01-01`, `min_replies:10`, `filter:links`. The scraper works on whatever results X shows you.

2. **Switch to the "Latest" tab for chronological data** — The "Top" tab shows algorithmically ranked results (great for high-engagement tweets). The "Latest" tab gives you a time-ordered view — better for monitoring mentions over a specific date range.

3. **Increase `MAX_TWEETS` for comprehensive research** — The default 500 handles most searches. For exhaustive data collection, set it to 1000–2000 and be prepared to wait 5–10 minutes as the page scrolls.

4. **Post-process in Google Sheets or Python** — Open the CSV in Google Sheets, add filters, sort by likes, or create charts. For programmatic analysis, load the JSON with `pandas` in Python for sentiment analysis or trend detection.

5. **Set `MIN_LIKES` to filter noise** — If you only want popular tweets, set `MIN_LIKES: 10` or `MIN_LIKES: 50` to skip low-engagement posts.

---

## ⚠️ Important Notes

- **Rate limits** — The scraper scrolls passively and reads DOM content. It doesn't make API calls, so standard API rate limits don't apply. However, X may slow down page loading after extended scrolling. If results stop loading, wait a few minutes and try again.
- **Accuracy** — The scraper extracts what's visible on the page. If X's DOM structure changes, selectors may need updating. Check [medirus.online](https://medirus.online) for the latest version.
- **Search scope** — X's search results are not exhaustive. X may not show all matching tweets, especially older ones. For comprehensive historical data, consider multiple searches with date filters.
- **Data privacy** — All scraped tweets are public data. Respect users' privacy — don't use scraped data for harassment, spam, or unauthorized commercial purposes.

---

## 🔗 Related Features

| Feature | Use Case | Link |
|---------|----------|------|
| Hashtag Scraping | Scrape tweets by hashtag instead of keyword | [→ Guide](../hashtag-scraping.md) |
| Profile Scraping | Get detailed info on a specific user | [→ Guide](../profile-scraping.md) |
| Viral Tweet Scraper | Find the highest-engagement tweets in any niche | [→ Guide](../viral-tweet-scraper.md) |
| Thread Scraping | Save a full tweet thread as one document | [→ Guide](../thread-scraping.md) |
| Engagement Analytics | Analyze your own tweets' performance | [→ Guide](../engagement-analytics.md) |

---

## ❓ FAQ

### Q: How do I scrape tweets from Twitter / X without the API in 2026?
**A:** Go to `x.com/search?q=your+keyword`, open your browser console (F12 → Console), paste the Medirus tweet scraper script, and press Enter. The script scrolls through search results, extracts every tweet with full engagement metrics, and auto-downloads JSON and CSV files. No API key, no paid plan, no software to install.

### Q: How many tweets can I scrape at once?
**A:** The browser script can typically collect 300–500 tweets per search before X stops loading new results. Set `MAX_TWEETS` up to 1000–2000 for larger collections. For exhaustive scraping, run multiple searches with different date filters (e.g., `since:2026-02-01 until:2026-02-15`).

### Q: What data does the tweet scraper export?
**A:** Each tweet includes: tweet ID, author handle, display name, full text, tweet URL, timestamp, likes count, retweets count, replies count, views count, and total engagement score. Exported as both JSON (for developers) and CSV (for spreadsheets).

### Q: Is scraping tweets from X legal?
**A:** Scraping publicly available tweets is generally legal for personal use and research. However, respect X's Terms of Service, don't scrape private or protected accounts, and don't use scraped data for spam, harassment, or unauthorized commercial purposes. When in doubt, consult a legal professional.

---

<footer>
Built with ⚡ by <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</footer>
