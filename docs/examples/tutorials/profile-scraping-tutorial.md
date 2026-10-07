---
title: "Scrape X (Twitter) Profile Data — Free No-API Tool 2026"
description: "Scrape any X/Twitter profile's bio, followers, following, and more to JSON. Free browser script, no API needed."
keywords: ["scrape twitter profile", "twitter profile scraper free", "get twitter user data 2026", "how to scrape X profile without API", "twitter profile export JSON", "scrape twitter bio followers", "twitter user info scraper", "extract twitter profile data free", "medirus profile scraping", "twitter profile to JSON no API"]
canonical: "https://medirus.online/examples/profile-scraping"
author: "nich (@nichxbt)"
date: "2026-02-24"
---

# 👤 Scrape X (Twitter) Profile Data — Export Bio, Followers & Stats to JSON for Free

> **Extract any public profile's complete data from X (Twitter) — bio, follower count, following count, tweets, verified status, join date, profile image, and more — to a JSON file. Free, no API key, no paid plan.**

**Works on:** 🌐 Browser Console · 💻 CLI · 🤖 MCP (AI Agents)
**Difficulty:** 🟢 Beginner
**Time:** ⏱️ Under 1 minute
**Requirements:** A web browser logged into x.com

> 📖 For the quick-reference version, see [profile-scraping.md](../profile-scraping.md)

---

## 🎯 Real-World Scenario

You're preparing a pitch deck for investors and need competitive intelligence on 5 rival accounts. For each one, you need: follower count, bio, website, join date, tweet volume, and verified status. Normally you'd browse each profile and manually copy-paste into a spreadsheet — tedious and error-prone. Or you'd sign up for Twitter's API ($100/month Basic tier) just to pull profile data.

Medirus' profile scraper reads everything visible on a profile page and exports it to a structured JSON file in under 10 seconds. Run it on 5 profiles and your competitive analysis spreadsheet is done in under a minute.

**Before Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Competitive Research (Manual)                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  For each competitor (5 accounts):                   │
│  1. Go to their profile                              │
│  2. Copy their display name         (Ctrl+C → Tab)  │
│  3. Copy their bio                  (Ctrl+C → Tab)  │
│  4. Copy follower count             (Ctrl+C → Tab)  │
│  5. Copy following count            (Ctrl+C → Tab)  │
│  6. Copy website link               (Ctrl+C → Tab)  │
│  7. Copy join date                  (Ctrl+C → Tab)  │
│  8. Check if verified               (Ctrl+C → Tab)  │
│  9. Copy profile image URL          (right-click...) │
│                                                      │
│  Time per profile: ~5 minutes                        │
│  Total for 5 profiles: ~25 minutes                   │
│  Accuracy: ¯\_(ツ)_/¯                                │
└──────────────────────────────────────────────────────┘
```

**After Medirus:**

```
┌──────────────────────────────────────────────────────┐
│  Competitive Research (Medirus)                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  For each competitor (5 accounts):                   │
│  1. Go to their profile                              │
│  2. Paste script → Enter                             │
│  3. JSON auto-downloads with everything              │
│                                                      │
│  Time per profile: ~10 seconds                       │
│  Total for 5 profiles: ~1 minute                     │
│  Accuracy: 100% (reads directly from the DOM)        │
└──────────────────────────────────────────────────────┘
```

---

## 📋 What This Does (Step by Step)

1. 📍 **Detects the username** — reads it from the URL path
2. 🔍 **Extracts profile fields** — display name, bio, location, website, join date using `data-testid` selectors
3. 📊 **Parses follower/following counts** — handles K/M abbreviations (e.g., "5.8M" → 5800000)
4. ✅ **Checks verified status** — detects the blue/gold checkmark badge
5. 🖼️ **Gets profile/banner images** — extracts full-resolution image URLs
6. 📈 **Gets tweet count** — reads from the profile header
7. 💾 **Downloads JSON** — auto-downloads a structured JSON file with all data
8. 🖥️ **Stores on `window`** — access `window.scrapedProfile` for further use

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Navigate to x.com/USERNAME]                               │
│          │                                                  │
│          ▼                                                  │
│  [Read username from URL path]                              │
│          │                                                  │
│          ▼                                                  │
│  [Extract from DOM:]                                        │
│     ├── Display name    (UserName testid)                   │
│     ├── Bio             (UserDescription testid)            │
│     ├── Location        (UserLocation testid)               │
│     ├── Website         (UserUrl testid)                    │
│     ├── Join date       (UserJoinDate testid)               │
│     ├── Followers       (/followers link text)              │
│     ├── Following       (/following link text)              │
│     ├── Verified badge  (SVG aria-label)                    │
│     ├── Profile image   (/photo link img)                   │
│     └── Banner image    (/header_photo link img)            │
│          │                                                  │
│          ▼                                                  │
│  [Print summary to console]                                 │
│          │                                                  │
│          ▼                                                  │
│  [Download profile_USERNAME_timestamp.json]                  │
│          │                                                  │
│          ▼                                                  │
│  [Store on window.scrapedProfile ✅]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌐 Method 1: Browser Console (Copy-Paste)

**Best for:** Anyone — no installs, instant results.

### Prerequisites

- [x] Logged into X/Twitter in a web browser
- [x] On a desktop/laptop (not mobile)

### Step 1: Navigate to the target profile

> Go to **`x.com/USERNAME`** — any public profile.

```
┌──────────────────────────────────────────────────────┐
│ 🔍 x.com/nichxbt                                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  🖼️  [Banner Image]                                  │
│                                                      │
│  👤 nich @nichxbt                            ✅      │
│  Building Medirus — free X/Twitter automation       │
│  toolkit. Open source. No API fees.                  │
│                                                      │
│  📍 Internet  🔗 medirus.online  📅 Joined Jan 2023  │
│                                                      │
│  👥 12,847 Followers    👥 892 Following              │
│                                                      │
│  Tweets  Replies  Highlights  Media  Likes           │
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
// Medirus - Scrape X/Twitter Profile Data
// by nichxbt — https://medirus.online
// Go to: x.com/ANY_USERNAME
// Open console (F12 → Console), paste, Enter
// ============================================

(() => {
  const username = window.location.pathname.split('/')[1];

  // Validate we're on a profile page
  if (!username || username.startsWith('i/') ||
      ['home', 'explore', 'notifications', 'messages', 'search'].includes(username)) {
    console.error('❌ Please go to a user profile first!');
    console.log('   👉 Example: x.com/nichxbt');
    return;
  }

  console.log('');
  console.log('👤 Medirus - PROFILE SCRAPER');
  console.log('════════════════════════════════════════');
  console.log(`🎯 Scraping @${username}...`);
  console.log('');

  // Parse engagement numbers (handles K, M abbreviations)
  const parseNumber = (str) => {
    if (!str) return 0;
    const clean = str.replace(/,/g, '').trim();
    const num = parseFloat(clean);
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  // Build profile object
  const profile = {
    handle: username,
    displayName: '',
    bio: '',
    location: '',
    website: '',
    joinDate: '',
    followersCount: 0,
    followingCount: 0,
    tweetsCount: 0,
    verified: false,
    profileImageUrl: '',
    bannerImageUrl: '',
    scrapedAt: new Date().toISOString(),
  };

  // Display name
  const nameEl = document.querySelector('[data-testid="UserName"] span');
  profile.displayName = nameEl?.textContent || username;

  // Bio
  const bioEl = document.querySelector('[data-testid="UserDescription"]');
  profile.bio = bioEl?.textContent || '';

  // Location
  const locEl = document.querySelector('[data-testid="UserLocation"]');
  profile.location = locEl?.textContent || '';

  // Website
  const webEl = document.querySelector('[data-testid="UserUrl"] a');
  profile.website = webEl?.href || webEl?.textContent || '';

  // Join date
  const joinEl = document.querySelector('[data-testid="UserJoinDate"]');
  profile.joinDate = joinEl?.textContent || '';

  // Followers / Following counts
  const followLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
  followLinks.forEach(link => {
    const text = link.textContent || '';
    if (link.href.includes('/followers') && !link.href.includes('/followers_you_follow')) {
      profile.followersCount = parseNumber(text);
    } else if (link.href.includes('/following')) {
      profile.followingCount = parseNumber(text);
    }
  });

  // Verified badge
  profile.verified = !!document.querySelector('[data-testid="UserName"] svg[aria-label*="Verified"]');

  // Profile image (get full resolution)
  const profileImg = document.querySelector('a[href*="/photo"] img');
  if (profileImg) {
    profile.profileImageUrl = profileImg.src.replace('_normal', '_400x400');
  }

  // Banner image
  const bannerImg = document.querySelector('a[href*="/header_photo"] img');
  profile.bannerImageUrl = bannerImg?.src || '';

  // Tweet count
  const tweetCountEl = document.querySelector('[data-testid="primaryColumn"] h2')?.parentElement?.querySelector('span');
  if (tweetCountEl) {
    const match = tweetCountEl.textContent?.match(/[\d,.]+[KM]?/);
    if (match) profile.tweetsCount = parseNumber(match[0]);
  }

  // Print results
  console.log('════════════════════════════════════════');
  console.log(`👤 PROFILE: @${profile.handle}`);
  console.log('════════════════════════════════════════');
  console.log(`📛 Name:       ${profile.displayName}`);
  console.log(`📝 Bio:        ${profile.bio.slice(0, 80)}${profile.bio.length > 80 ? '...' : ''}`);
  console.log(`📍 Location:   ${profile.location || 'N/A'}`);
  console.log(`🔗 Website:    ${profile.website || 'N/A'}`);
  console.log(`📅 Joined:     ${profile.joinDate}`);
  console.log(`👥 Followers:  ${profile.followersCount.toLocaleString()}`);
  console.log(`👥 Following:  ${profile.followingCount.toLocaleString()}`);
  console.log(`📊 Tweets:     ${profile.tweetsCount.toLocaleString()}`);
  console.log(`${profile.verified ? '✅ Verified' : '❌ Not verified'}`);
  console.log('════════════════════════════════════════');

  // Download JSON
  const json = JSON.stringify(profile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profile_${username}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  console.log('💾 Downloaded profile JSON');

  // Copy to clipboard
  try {
    navigator.clipboard.writeText(json);
    console.log('📋 Copied to clipboard!');
  } catch (e) {}

  // Store globally
  window.scrapedProfile = profile;
  console.log('');
  console.log('✅ Done! Access data: window.scrapedProfile');
})();
```

### ✅ Expected Output

```
👤 Medirus - PROFILE SCRAPER
════════════════════════════════════════
🎯 Scraping @nichxbt...

════════════════════════════════════════
👤 PROFILE: @nichxbt
════════════════════════════════════════
📛 Name:       nich
📝 Bio:        Building Medirus — free X/Twitter automation toolkit. Open source. No AP...
📍 Location:   Internet
🔗 Website:    https://medirus.online
📅 Joined:     Joined January 2023
👥 Followers:  12,847
👥 Following:  892
📊 Tweets:     3,421
✅ Verified
════════════════════════════════════════
💾 Downloaded profile JSON
📋 Copied to clipboard!

✅ Done! Access data: window.scrapedProfile
```

---

## 💻 Method 2: CLI (Command Line)

```bash
# Install Medirus globally
npm install -g medirus

# Scrape a profile
npx medirus profile nichxbt

# With JSON output
npx medirus profile nichxbt --json

# Scrape multiple profiles (run sequentially)
for user in nichxbt karpathy levelsio; do
  npx medirus profile $user --output "profile_${user}.json"
done
```

### ✅ CLI Output Preview

```
⚡ Medirus v3.x.x

⚡ @nichxbt

  Name:      nich
  Bio:       Building Medirus — free X/Twitter automation toolkit
  Location:  Internet
  Website:   https://medirus.online
  Joined:    January 2023
  Followers: 12,847
  Following: 892
  Tweets:    3,421
  Verified:  ✅
```

### CLI Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | `false` | Output as raw JSON |
| `--output` | string | stdout | Save to file |

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
  "tool": "x_get_profile",
  "arguments": {
    "username": "nichxbt"
  }
}
```

### Claude Desktop example prompt:

> "Get the profile data for @nichxbt on X — I need their follower count, bio, website, and whether they're verified."

### Expected MCP response:

```json
{
  "handle": "nichxbt",
  "displayName": "nich",
  "bio": "Building Medirus — free X/Twitter automation toolkit. Open source. No API fees.",
  "location": "Internet",
  "website": "https://medirus.online",
  "joinDate": "Joined January 2023",
  "followersCount": 12847,
  "followingCount": 892,
  "tweetsCount": 3421,
  "verified": true
}
```

---

## 📊 Method Comparison

| Feature | 🌐 Browser Console | 💻 CLI | 🤖 MCP |
|---------|-------------------|--------|---------|
| Setup | None | `npm install` | Config JSON |
| Speed | Instant | ~5s | Via AI agent |
| Best for | Quick lookup | Scripts/pipelines | AI workflows |
| Export | JSON + clipboard | JSON, terminal | JSON |
| Profile image | ✅ full-res URL | ✅ | ✅ |
| Banner image | ✅ | ✅ | ✅ |
| Batch scraping | Manual per-profile | Shell loop | Multi-call |

---

## ⚙️ Fields Extracted

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `handle` | string | `"nichxbt"` | Username without @ |
| `displayName` | string | `"nich"` | Display name |
| `bio` | string | `"Building Medirus..."` | Profile bio text |
| `location` | string | `"Internet"` | Location field |
| `website` | string | `"https://medirus.online"` | Website URL |
| `joinDate` | string | `"Joined January 2023"` | Join date text |
| `followersCount` | number | `12847` | Number of followers |
| `followingCount` | number | `892` | Number following |
| `tweetsCount` | number | `3421` | Total tweets |
| `verified` | boolean | `true` | Has verification badge |
| `profileImageUrl` | string | `"https://pbs.twimg.com/..."` | Profile photo (400x400) |
| `bannerImageUrl` | string | `"https://pbs.twimg.com/..."` | Header/banner image |
| `scrapedAt` | string | `"2026-02-24T14:30:00Z"` | ISO timestamp of scrape |

---

## 📊 Sample Output / Results

### Example JSON Export

```json
{
  "handle": "nichxbt",
  "displayName": "nich",
  "bio": "Building Medirus — free X/Twitter automation toolkit. Open source. No API fees.",
  "location": "Internet",
  "website": "https://medirus.online",
  "joinDate": "Joined January 2023",
  "followersCount": 12847,
  "followingCount": 892,
  "tweetsCount": 3421,
  "verified": true,
  "profileImageUrl": "https://pbs.twimg.com/profile_images/1234567890/avatar_400x400.jpg",
  "bannerImageUrl": "https://pbs.twimg.com/profile_banners/1234567890/1708789200/1500x500",
  "scrapedAt": "2026-02-24T14:30:00.000Z"
}
```

### Batch Comparison (5 profiles → spreadsheet)

```
┌──────────────┬──────────┬───────────┬──────────┬─────────┐
│ Handle       │ Followers│ Following │ Tweets   │Verified │
├──────────────┼──────────┼───────────┼──────────┼─────────┤
│ @nichxbt     │  12,847  │    892    │   3,421  │ ✅      │
│ @competitor1 │  45,210  │  1,203    │  12,847  │ ✅      │
│ @competitor2 │   8,932  │    456    │   2,103  │ ❌      │
│ @competitor3 │ 128,400  │    312    │  18,923  │ ✅      │
│ @competitor4 │   3,210  │  2,847    │     892  │ ❌      │
└──────────────┴──────────┴───────────┴──────────┴─────────┘
```

---

## 💡 Pro Tips

1. **Run on a fully loaded profile page** — Wait for the profile to fully load (you should see the bio, follower count, and tweets) before pasting the script. If the page is still loading spinner, the script may miss fields.

2. **Get full-res profile images** — The script automatically replaces `_normal` with `_400x400` in the profile image URL. For the original resolution, change to `_original`:
   ```javascript
   profile.profileImageUrl = profileImg.src.replace('_normal', '_original');
   ```

3. **Batch scrape with the CLI** — Use a shell loop to scrape multiple profiles:
   ```bash
   for user in karpathy sama naval levelsio; do
     npx medirus profile $user --output "profiles/${user}.json"
     sleep 2
   done
   ```

4. **Calculate follower-to-following ratio** — After scraping, check the ratio in the console:
   ```javascript
   const p = window.scrapedProfile;
   console.log(`Ratio: ${(p.followersCount / p.followingCount).toFixed(1)}x`);
   ```

---

## ⚠️ Important Notes

- **Public profiles only** — The script reads what's visible on the page. Protected/private accounts will show limited data (no bio, no follower counts if not following).
- **Rate limits** — Profile scraping is read-only (no API calls, no clicks). X doesn't rate-limit page viewing, but don't scrape hundreds of profiles in rapid succession. Add 2–3 second delays between profiles.
- **DOM changes** — X uses `data-testid` attributes that are relatively stable but may change with UI updates. Check [medirus.online](https://medirus.online) for the latest selectors.
- **Accuracy** — Follower/following counts with K/M abbreviations are approximations (e.g., "5.8M" becomes 5,800,000). For exact counts, you'd need the API.

---

## 🔗 Related Features

| Feature | Use Case | Link |
|---------|----------|------|
| Followers Scraping | Export a user's full follower list | [→ Guide](../followers-scraping.md) |
| Following Scraping | Export who a user follows | [→ Guide](../following-scraping.md) |
| Tweet Scraping | Scrape a user's tweets | [→ Guide](../tweet-scraping.md) |
| Competitor Analysis | Compare metrics across multiple accounts | [→ Guide](../competitor-analysis.md) |
| Audit Followers | Detect bots and fake accounts in a follower list | [→ Guide](../audit-followers.md) |

---

## ❓ FAQ

### Q: How do I scrape a Twitter / X profile without the API in 2026?
**A:** Go to `x.com/USERNAME`, open your browser console (F12 → Console), paste the Medirus profile scraper script, and press Enter. The script reads the profile page's DOM and extracts all visible data — display name, bio, follower/following counts, website, join date, verified status, and profile image — then auto-downloads a JSON file. No API key, no rate limit fees.

### Q: What data can I get from a Twitter profile?
**A:** The Medirus profile scraper exports: username, display name, bio, location, website URL, join date, follower count, following count, tweet count, verified badge status, profile image URL (full resolution), and banner image URL. All extracted directly from the page DOM.

### Q: Can I scrape multiple profiles at once?
**A:** The browser script scrapes one profile per run. For batch scraping, use the Medirus CLI with a shell loop (`for user in user1 user2; do npx medirus profile $user; done`) or the MCP server with sequential tool calls.

### Q: Is scraping X profiles legal?
**A:** Scraping publicly visible profile data is generally acceptable for personal use and research. The data is public by design — anyone visiting the profile sees this information. Respect privacy, don't scrape protected accounts, and don't use data for harassment or unauthorized commercial purposes.

---

<footer>
Built with ⚡ by <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://medirus.online">medirus.online</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</footer>
