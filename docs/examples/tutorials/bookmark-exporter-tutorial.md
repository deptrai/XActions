---
title: "Export X (Twitter) Bookmarks to JSON/CSV — Free 2026"
description: "Export all your X/Twitter bookmarks to JSON or CSV. Free browser script, no API needed. Backup before they're gone."
keywords: ["export twitter bookmarks", "twitter bookmark exporter free", "save X bookmarks 2026", "how to export bookmarks from twitter", "twitter bookmark backup", "download twitter bookmarks CSV", "twitter bookmarks to spreadsheet", "export bookmarks X free", "medirus bookmark exporter", "backup twitter bookmarks no API"]
canonical: "https://medirus.online/examples/bookmark-exporter"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 📚 Export X (Twitter) Bookmarks — Backup Everything to JSON/CSV for Free

> **Export all your X (Twitter) bookmarks to JSON and CSV in minutes — free, no API key, no paid plan.** Save tweet text, author, engagement metrics, images, and links before they're gone.

**Works on:** 🌐 Browser Console · 💻 CLI · 🤖 MCP (AI Agents)
**Difficulty:** 🟢 Beginner
**Time:** ⏱️ 2–8 minutes (depending on bookmark count)
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [bookmark-exporter.md](../bookmark-exporter.md)

---

## 🎯 Real-World Scenario

Over the past two years, you've been bookmarking the best tweets you find — startup advice, coding tutorials, AI research papers, motivational threads. You have **847 bookmarks** and use them as your personal knowledge base. But you just read that X might make bookmarks a premium-only feature, and you can't search or organize them natively anyway. You want to export everything to a searchable spreadsheet or Notion database before it's too late.

Manual option: Open each bookmark, copy the text, paste into a doc. 847 times. That's about **7 hours of mindless copy-pasting.** Medirus exports them all in under 5 minutes.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Your Bookmarks (847 saved)                          │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📌 @paulg — "The best founders do things that..."  │
│  📌 @karpathy — "Here's how to build a GPT from..." │
│  📌 @levelsio — "Revenue crossed $50K/mo..."        │
│  📌 @naval — "Specific knowledge is knowledge..."   │
│  ...                                                 │
│  📌 843 more bookmarks buried below                  │
│                                                      │
│  Can you search them? No.                            │
│  Can you export them? Not natively.                  │
│  Can you organize them? Not really.                  │
│  What if they disappear? 😬                          │
└──────────────────────────────────────────────────────┘
```

**After Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Your Bookmarks → Exported ✅                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📁 bookmarks_1708789200.json   (Full data, 847)    │
│  📁 bookmarks_1708789200.csv    (Spreadsheet-ready) │
│  📋 Summary copied to clipboard                      │
│                                                      │
│  Now you can:                                        │
│  ✅ Search bookmarks in Google Sheets / Excel        │
│  ✅ Import into Notion, Obsidian, or Airtable        │
│  ✅ Sort by engagement, author, or date              │
│  ✅ Never worry about losing them                    │
└──────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

1. 📍 **Verifies you're on the bookmarks page** — checks that the URL is `x.com/i/bookmarks`
2. 📜 **Scrolls through all bookmarks** — loads your full bookmark list by scrolling down
3. 📊 **Extracts rich data per bookmark** — tweet text, author, handle, URL, timestamp, likes, retweets, replies, views, images, and external links
4. 🧹 **De-duplicates** — uses tweet IDs to ensure no duplicates
5. 💾 **Downloads JSON + CSV** — auto-downloads both formats to your computer
6. 📋 **Copies summary to clipboard** — quick paste into notes or Slack
7. 🖥️ **Stores on `window`** — access `window.exportedBookmarks` for further processing

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Navigate to x.com/i/bookmarks]                            │
│          │                                                  │
│          ▼                                                  │
│  [Verify URL contains /bookmarks]                           │
│          │                                                  │
│          ▼                                                  │
│  [Scan visible bookmark articles]                           │
│          │                                                  │
│     ┌────┴───────────────────────┐                          │
│     │ For each article:          │                          │
│     │  • Extract text, author    │                          │
│     │  • Parse engagement metrics│                          │
│     │  • Collect image URLs      │                          │
│     │  • Collect external links  │                          │
│     │  • Add to Map (dedup)      │                          │
│     └────┬───────────────────────┘                          │
│          │                                                  │
│          ▼                                                  │
│  [Scroll down 800px] ──→ [Wait 1.5s]                       │
│          │                                                  │
│          ▼                                                  │
│  [No new bookmarks 5x?] ──No──→ [Scan visible articles]    │
│          │ Yes                                              │
│          ▼                                                  │
│  [Download JSON] + [Download CSV]                           │
│          │                                                  │
│          ▼                                                  │
│  [Copy summary to clipboard ✅]                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Anyone — no installs, runs right in your browser.

### Prerequisites

- [x] Logged into your X/Twitter account in a web browser
- [x] On a desktop/laptop (not mobile)
- [x] Have bookmarks saved (obviously!)

### Step 1: Navigate to your Bookmarks page

> Go to **`x.com/i/bookmarks`**

```
┌──────────────────────────────────────────────────────┐
│ 🔍 x.com/i/bookmarks                                 │
├──────────────────────────────────────────────────────┤
│  📚 Bookmarks                                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📌 @paulgraham · Jan 15                             │
│  "The best founders do things that don't scale..."  │
│  ❤️ 12,483  🔄 3,201  💬 892                          │
│                                                      │
│  📌 @karpathy · Jan 12                               │
│  "Here's how to build a GPT from scratch in         │
│   Python — a complete tutorial thread 🧵"           │
│  ❤️ 8,721  🔄 2,148  💬 456                           │
│                                                      │
│  📌 @levelsio · Jan 8                                │
│  "Revenue crossed $50K/mo with just HTML, CSS,      │
│   and vanilla JS. No framework. No VC."             │
│  ❤️ 5,432  🔄 1,876  💬 324                           │
│                                                      │
│  ... 844 more bookmarks                              │
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
// Medirus - Export X/Twitter Bookmarks
// by nichxbt — https://medirus.online
// Go to: x.com/i/bookmarks
// Open console (F12 → Console), paste, Enter
// ============================================

(async () => {
  const CONFIG = {
    MAX_BOOKMARKS: 1000,   // Max bookmarks to export
    SCROLL_DELAY: 1500,    // Delay between scrolls (ms)
    FORMAT: 'both',        // 'json', 'csv', 'both'
  };

  // Verify we're on the bookmarks page
  if (!window.location.pathname.includes('/bookmarks')) {
    console.error('❌ Please go to x.com/i/bookmarks first!');
    return;
  }

  console.log('');
  console.log('📚 Medirus - BOOKMARK EXPORTER');
  console.log('════════════════════════════════════════');
  console.log(`🎯 Max bookmarks: ${CONFIG.MAX_BOOKMARKS}`);
  console.log(`📁 Format: ${CONFIG.FORMAT}`);
  console.log('════════════════════════════════════════');
  console.log('');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const parseNumber = (str) => {
    if (!str) return 0;
    const num = parseFloat(str.replace(/,/g, ''));
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const extractBookmark = (article) => {
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

      // Extract images
      const images = Array.from(article.querySelectorAll('img[src*="media"]'))
        .map(img => img.src)
        .filter(src => !src.includes('profile'));

      // Extract external links
      const links = Array.from(article.querySelectorAll('a[href^="http"]'))
        .map(a => a.href)
        .filter(href => !href.includes('x.com') && !href.includes('twitter.com'));

      return {
        tweetId, handle, displayName, text: tweetText,
        url: tweetUrl, time, likes, retweets, replies, views,
        images, links,
      };
    } catch (e) { return null; }
  };

  // Scrape loop
  const bookmarks = new Map();
  let scrolls = 0;
  let noNewCount = 0;

  while (bookmarks.size < CONFIG.MAX_BOOKMARKS && noNewCount < 5) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const before = bookmarks.size;

    articles.forEach(article => {
      const bm = extractBookmark(article);
      if (bm && bm.tweetId && !bookmarks.has(bm.tweetId)) {
        bookmarks.set(bm.tweetId, bm);
      }
    });

    const added = bookmarks.size - before;
    if (added > 0) {
      console.log(`📖 Collected ${bookmarks.size} bookmarks...`);
      noNewCount = 0;
    } else {
      noNewCount++;
    }

    window.scrollBy(0, 800);
    await sleep(CONFIG.SCROLL_DELAY);
    scrolls++;
    if (scrolls > 100) break;
  }

  const bookmarkList = Array.from(bookmarks.values());

  // Summary
  console.log('');
  console.log('════════════════════════════════════════');
  console.log(`📚 EXPORTED ${bookmarkList.length} BOOKMARKS`);
  console.log('════════════════════════════════════════');
  console.log('');

  // Preview
  console.log('📋 Preview:');
  bookmarkList.slice(0, 5).forEach((b, i) => {
    console.log(`   ${i + 1}. @${b.handle}: "${b.text.slice(0, 60)}..."`);
  });
  if (bookmarkList.length > 5) {
    console.log(`   ... and ${bookmarkList.length - 5} more`);
  }

  // Export JSON
  const ts = Date.now();
  if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
    const data = {
      exportedAt: new Date().toISOString(),
      count: bookmarkList.length,
      bookmarks: bookmarkList,
    };
    download(JSON.stringify(data, null, 2), `bookmarks_${ts}.json`, 'application/json');
    console.log('💾 Downloaded bookmarks.json');
  }

  // Export CSV
  if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
    const csv = [
      'Handle,DisplayName,Text,URL,Time,Likes,Retweets,Replies,Views',
      ...bookmarkList.map(b =>
        `"@${b.handle}","${b.displayName.replace(/"/g, '""')}","${b.text.replace(/"/g, '""').replace(/\n/g, ' ')}","${b.url}","${b.time}",${b.likes},${b.retweets},${b.replies},${b.views}`
      )
    ].join('\n');
    download(csv, `bookmarks_${ts}.csv`, 'text/csv');
    console.log('💾 Downloaded bookmarks.csv');
  }

  // Copy summary to clipboard
  try {
    const summary = bookmarkList
      .map(b => `@${b.handle}: ${b.text.slice(0, 100)}... — ${b.url}`)
      .join('\n');
    await navigator.clipboard.writeText(summary);
    console.log('📋 Summary copied to clipboard!');
  } catch (e) {}

  // Store globally
  window.exportedBookmarks = bookmarkList;
  console.log('');
  console.log('✅ Done! Access data: window.exportedBookmarks');
  console.log(`📊 Total: ${bookmarkList.length} bookmarks exported`);
})();
```

### ✅ Expected Output

```
📚 Medirus - BOOKMARK EXPORTER
════════════════════════════════════════
🎯 Max bookmarks: 1000
📁 Format: both
════════════════════════════════════════

📖 Collected 38 bookmarks...
📖 Collected 94 bookmarks...
📖 Collected 187 bookmarks...
📖 Collected 312 bookmarks...
📖 Collected 498 bookmarks...
📖 Collected 647 bookmarks...
📖 Collected 782 bookmarks...
📖 Collected 847 bookmarks...

════════════════════════════════════════
📚 EXPORTED 847 BOOKMARKS
════════════════════════════════════════

📋 Preview:
   1. @paulgraham: "The best founders do things that don't scale. Here's what I ..."
   2. @karpathy: "Here's how to build a GPT from scratch in Python — a comple..."
   3. @levelsio: "Revenue crossed $50K/mo with just HTML, CSS, and vanilla JS..."
   4. @naval: "Specific knowledge is knowledge that you cannot be trained ..."
   5. @sama: "The most important quality for a startup founder is determin..."
   ... and 842 more
💾 Downloaded bookmarks.json
💾 Downloaded bookmarks.csv
📋 Summary copied to clipboard!

✅ Done! Access data: window.exportedBookmarks
📊 Total: 847 bookmarks exported
```

---

## 💻 Method 2: CLI (Command Line)

The Medirus CLI currently focuses on scraping and search. For bookmark export, use the browser console method above or the MCP server method below.

```bash
# Install Medirus
npm install -g medirus

# The MCP server supports bookmark export via AI agents:
npx medirus mcp
```

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
  "tool": "x_get_bookmarks",
  "arguments": {
    "limit": 500,
    "format": "json"
  }
}
```

### Claude Desktop example prompt:

> "Export all my X bookmarks to a JSON file. Include tweet text, author, engagement metrics, and any images."

---

## 📊 Method Comparison

| Feature | 🌐 Browser Console | 💻 CLI | 🤖 MCP |
|---------|-------------------|--------|---------|
| Setup | None | `npm install` | Config JSON |
| Speed | Fast | N/A | Via AI agent |
| Best for | Quick export | — | AI workflows |
| Export | JSON + CSV | — | JSON |
| Image URLs | ✅ | — | ✅ |
| External links | ✅ | — | ✅ |
| Clipboard copy | ✅ | — | ❌ |

---

## ⚙️ Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `MAX_BOOKMARKS` | number | `1000` | Maximum bookmarks to export |
| `SCROLL_DELAY` | number | `1500` | Delay between scrolls in ms |
| `FORMAT` | string | `'both'` | Export format: `'json'`, `'csv'`, or `'both'` |

---

## 📊 Sample Output / Results

### Example JSON Export

```json
{
  "exportedAt": "2026-02-24T14:30:00.000Z",
  "count": 847,
  "bookmarks": [
    {
      "tweetId": "1893847562938475629",
      "handle": "paulgraham",
      "displayName": "Paul Graham",
      "text": "The best founders do things that don't scale. Here's what I mean by that, and why it's so important for early-stage startups...",
      "url": "https://x.com/paulgraham/status/1893847562938475629",
      "time": "2026-01-15T09:23:00.000Z",
      "likes": 12483,
      "retweets": 3201,
      "replies": 892,
      "views": 2400000,
      "images": [],
      "links": ["https://paulgraham.com/ds.html"]
    },
    {
      "tweetId": "1893812345678901234",
      "handle": "karpathy",
      "displayName": "Andrej Karpathy",
      "text": "Here's how to build a GPT from scratch in Python — a complete tutorial thread 🧵",
      "url": "https://x.com/karpathy/status/1893812345678901234",
      "time": "2026-01-12T15:45:00.000Z",
      "likes": 8721,
      "retweets": 2148,
      "replies": 456,
      "views": 890000,
      "images": ["https://pbs.twimg.com/media/example1.jpg"],
      "links": ["https://github.com/karpathy/nanoGPT"]
    }
  ]
}
```

### Example CSV (opens in any spreadsheet app)

```csv
Handle,DisplayName,Text,URL,Time,Likes,Retweets,Replies,Views
"@paulgraham","Paul Graham","The best founders do things that don't scale...","https://x.com/paulgraham/status/1893847562938475629","2026-01-15T09:23:00.000Z",12483,3201,892,2400000
"@karpathy","Andrej Karpathy","Here's how to build a GPT from scratch in Python...","https://x.com/karpathy/status/1893812345678901234","2026-01-12T15:45:00.000Z",8721,2148,456,890000
```

---

## 💡 Pro Tips

1. **Export regularly — don't wait until it's too late** — X has hinted at making bookmarks a premium feature. Run this monthly as a backup. It takes 3 minutes.

2. **Import into Notion with the JSON** — Notion's API can ingest JSON. Build a searchable bookmark database with tags, authors, and engagement scores. See [Notion's CSV import](https://www.notion.so/help/import-data-into-notion) for the quick method.

3. **Filter by engagement post-export** — Open the CSV in Google Sheets, sort by the "Likes" column descending, and you instantly have your most valuable bookmarks at the top.

4. **Use `window.exportedBookmarks` for custom filtering** — After running the script, type this in the console to filter:
   ```javascript
   // Only bookmarks with 1000+ likes
   window.exportedBookmarks.filter(b => b.likes > 1000)
   
   // Only bookmarks from a specific author
   window.exportedBookmarks.filter(b => b.handle === 'karpathy')
   
   // Only bookmarks with external links
   window.exportedBookmarks.filter(b => b.links.length > 0)
   ```

5. **Combine with bookmark organizer** — After exporting, use [bookmark-organizer.md](../bookmark-organizer.md) to tag and categorize your bookmarks directly inside X.

---

## ⚠️ Important Notes

- **Bookmarks are private** — Only you can see your bookmarks. The script reads from your logged-in session and exports locally to your computer. Nothing is sent to any server.
- **Scroll loading limitations** — X loads bookmarks in batches as you scroll. Very large bookmark libraries (2,000+) may take longer. If the scraper stops early, increase `MAX_BOOKMARKS` and run again.
- **No official export** — X does not provide a native bookmark export feature. This script fills that gap. The data archive download from Settings includes bookmarks but in a raw format that's harder to use.
- **X DOM changes** — If X updates their UI, the `data-testid` selectors may change. Check [medirus.online](https://medirus.online) or the [GitHub repo](https://github.com/nichxbt/xactions) for the latest version.

---

## 🔗 Related Features

| Feature | Use Case | Link |
|---------|----------|------|
| Bookmark Organizer | Tag and categorize bookmarks inside X | [→ Guide](../bookmark-organizer.md) |
| Tweet Scraping | Scrape tweets by keyword search | [→ Guide](../tweet-scraping.md) |
| Likes Scraping | Export tweets you've liked | [→ Guide](../likes-scraping.md) |
| Thread Scraping | Save a full tweet thread as one document | [→ Guide](../thread-scraping.md) |
| Video Downloader | Download videos from bookmarked tweets | [→ Guide](../video-downloader.md) |

---

## ❓ FAQ

### Q: How do I export my Twitter / X bookmarks in 2026?
**A:** Go to `x.com/i/bookmarks`, open your browser console (F12 → Console), paste the Medirus bookmark exporter script, and press Enter. The script scrolls through your entire bookmark list, extracts every tweet with full metadata, and auto-downloads both JSON and CSV files. Free, no API key, no app install.

### Q: Can I export bookmarks to a spreadsheet?
**A:** Yes. The script automatically generates a CSV file that opens directly in Google Sheets, Excel, or LibreOffice Calc. Each row is one bookmarked tweet with columns for author, text, engagement metrics, URL, and timestamp.

### Q: Are my bookmarks private? Will this expose them?
**A:** Your bookmarks remain private. The script runs entirely in your browser and saves files to your local computer. No data is sent to any server or third party. Only you can see your bookmarks on X, and only you have the exported files.

### Q: How many bookmarks can I export?
**A:** The script can typically export 500–1,000 bookmarks per run. For larger collections, you may need to run it multiple times. X loads bookmarks dynamically as you scroll, so extremely large libraries (2,000+) may require patience.

---

<footer>
Built with ⚡ by <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</footer>
