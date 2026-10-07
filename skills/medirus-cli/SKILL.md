---
name: medirus-cli
description: Command-line interface for scraping X/Twitter data, managing MCP server config, and running automation. Scrapes profiles, followers, tweets, search results, and more from terminal. Outputs text, JSON, or CSV. Uses Puppeteer stealth. Use when running Twitter operations from command line or automated pipelines.
license: Apache-2.0
compatibility: Requires Node.js 18+. Install with npm install -g medirus.
metadata:
  author: nichxbt
  version: "4.0"
---

# Medirus CLI

Entry point: `src/cli/index.js`. Config stored at `~/.medirus/config.json`.

## Installation

```bash
npm install -g medirus
```

## Authentication

```bash
medirus login    # Interactive prompt for auth_token cookie
medirus logout   # Removes saved cookie
medirus info     # Show current auth status and config
```

Get your auth_token: DevTools (F12) -> Application -> Cookies -> x.com -> copy `auth_token` value.

## Scraping Commands

```bash
medirus profile <username>
medirus followers <username> [-l <limit>] [-o json|csv]
medirus following <username> [-l <limit>] [-o json|csv]
medirus non-followers <username>
medirus tweets <username> [-l <limit>] [-o json|csv]
medirus search "<query>" [-l <limit>] [-o json|csv]
medirus hashtag <tag> [-l <limit>] [-o json|csv]
medirus thread <url>
medirus media <username> [-l <limit>]
```

## MCP Server Commands

```bash
medirus mcp-config                     # Generate config for Claude Desktop
medirus mcp-config --client cursor     # Generate for Cursor
medirus mcp-config --client windsurf   # Generate for Windsurf
medirus mcp-config --client vscode     # Generate for VS Code
medirus mcp-config --write             # Write config directly to file
```

The `mcp-config` command auto-detects your OS and generates the correct config file path.

## Output Flags

| Flag | Description |
|------|-------------|
| `-l, --limit <n>` | Maximum items to scrape |
| `-o, --output <format>` | `json` or `csv` — saves to `{username}_{command}.{ext}` |

Default output is pretty-printed to terminal with colored formatting.

## Programmatic API

The CLI wraps the same scraper API available as a library:

```javascript
import { createBrowser, createPage, loginWithCookie,
  scrapeProfile, scrapeFollowers, scrapeFollowing, scrapeTweets,
  searchTweets, scrapeHashtag, scrapeThread, scrapeMedia,
  exportToJSON, exportToCSV } from 'medirus';
```

## Examples

```bash
# Scrape a profile
medirus profile elonmusk

# Export followers as CSV
medirus followers nichxbt -l 200 -o csv

# Search tweets and save as JSON
medirus search "AI agents" -l 50 -o json

# Unroll a thread
medirus thread https://x.com/nichxbt/status/1234567890

# Generate Claude Desktop MCP config
medirus mcp-config --write
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Not authenticated" | Run `medirus login` first |
| Browser won't launch | Install Chromium: `npx puppeteer browsers install chrome` |
| Scraping returns empty | Account may be private or auth_token expired |
| Command not found | Reinstall: `npm install -g medirus` |
| MCP config path wrong | Use `--client` flag to specify your IDE |

## Related Skills
- **twitter-scraping** — Detailed scraper API documentation
- **medirus-mcp-server** — MCP server setup and tools
