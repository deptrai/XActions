# Medirus — Claude Code Plugin

> Complete X/Twitter automation toolkit for Claude Code. 68 MCP tools for scraping, posting, engagement, analytics, and more. No API fees.

## What This Plugin Provides

### MCP Server (68 tools)
Connects Claude to X/Twitter via the Medirus MCP server. Tools cover:
- **Profiles & Social Graph**: Get profiles, followers, following, follow/unfollow
- **Tweets & Content**: Post tweets, threads, polls; schedule posts; delete tweets
- **Engagement**: Like, retweet, reply, auto-like by keyword
- **Scraping**: Profiles, followers, tweets, search results, trends, threads
- **Analytics**: Account analytics, post analytics, sentiment analysis, competitor analysis
- **DMs**: Send/receive/export direct messages
- **Moderation**: Mute, block, protected account toggle
- **Grok AI**: Query and summarize with X's Grok
- **Streaming**: Real-time monitoring of keywords, users, mentions
- **Workflows**: Create and run automation workflows
- **Data Portability**: Export, migrate, and diff account data
- **Media**: Download videos from tweets

### Skills (4)
- **x-automation**: Full tool reference for all 68 MCP tools
- **x-scraping**: Data collection and export workflows
- **x-engagement**: Growth strategies and engagement automation
- **x-management**: Account management, moderation, and cleanup

### Agents (3)
- **growth**: Automated growth — find targets, engage, analyze results
- **cleanup**: Account cleanup — unfollow non-followers, delete old content
- **scrape**: Data scraping — profiles, followers, tweets, export to JSON/CSV

### Commands (4)
- `/medirus:scrape-profile` — Scrape a user's profile
- `/medirus:unfollow-nonfollowers` — Unfollow non-followers
- `/medirus:grow` — Run growth engagement
- `/medirus:analytics` — Get account analytics

## Setup

### 1. Install Medirus
```bash
npm install medirus
```

### 2. Get Your Auth Token
1. Go to [x.com](https://x.com) and log in
2. Open DevTools (F12) → Application → Cookies
3. Copy the value of `auth_token`

### 3. Configure Environment
Set the `MEDIRUS_SESSION_COOKIE` environment variable:
```bash
export MEDIRUS_SESSION_COOKIE="your_auth_token_here"
```

Or pass it to the MCP server via the plugin's env configuration.

## Requirements

- Node.js 18+
- Chromium/Chrome (for Puppeteer)
- X/Twitter account with auth_token cookie

## Links

- **Homepage**: [medirus.online](https://medirus.online)
- **Repository**: [github.com/nirholas/xactions](https://github.com/nirholas/xactions)
- **npm**: [npmjs.com/package/medirus](https://www.npmjs.com/package/medirus)
- **Author**: [@nichxbt](https://x.com/nichxbt)
- **License**: Apache-2.0
