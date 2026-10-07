# Medirus CLI Reference

> **The Complete X/Twitter Automation Toolkit**  
> Author: nich ([@nichxbt](https://x.com/nichxbt)). Run `medirus --version` for the version you have installed.

The Medirus CLI provides command-line tools for X/Twitter automation, scraping, and data extraction. No Twitter API required, which saves $100-$5,000+/month in API costs.

**Most read commands need no account at all.** Profiles, timelines, threads, and media all work on the guest tier the moment you install. Logging in unlocks search, followers, following, likes, bookmarks, and DMs. `medirus doctor` tells you which tier you are on right now.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Finding your way around](#finding-your-way-around)
  - [medirus quickstart](#medirus-quickstart)
  - [medirus completion](#medirus-completion)
- [Authentication](#authentication)
  - [medirus login](#medirus-login)
  - [medirus logout](#medirus-logout)
- [Scraping Commands](#commands)
  - [medirus profile](#medirus-profile)
  - [medirus followers](#medirus-followers)
  - [medirus following](#medirus-following)
  - [medirus non-followers](#medirus-non-followers)
  - [medirus tweets](#medirus-tweets)
  - [medirus search](#medirus-search)
  - [medirus hashtag](#medirus-hashtag)
  - [medirus thread](#medirus-thread)
  - [medirus media](#medirus-media)
  - [medirus info](#medirus-info)
- [Persona Commands](#medirus-persona-create)
  - [medirus persona create](#medirus-persona-create)
  - [medirus persona list](#medirus-persona-list)
  - [medirus persona run](#medirus-persona-run)
  - [medirus persona status](#medirus-persona-status)
  - [medirus persona edit](#medirus-persona-edit)
  - [medirus persona delete](#medirus-persona-delete)
- [Agent Commands](#agent-commands)
- [Plugin Commands](#plugin-commands)
- [Stream Commands](#stream-commands)
- [Workflow Commands](#workflow-commands)
- [Graph Commands](#graph-commands)
- [Portability Commands](#portability-commands)
- [Cross-Platform Scraping](#cross-platform-scraping)
- [AI Writer Commands](#ai-writer-commands)
- [AI Content Optimizer](#ai-content-optimizer)
- [Analytics Commands](#analytics-commands)
- [CRM Commands](#crm-commands)
- [Scheduling Commands](#scheduling-commands)
- [RSS Monitor](#rss-monitor)
- [Notifications](#notification-commands)
- [Dataset Management](#dataset-management)
- [Team Management](#team-management)
- [Bulk Operations](#bulk-operations)
- [Import/Export Compatibility](#importexport-compatibility)
- [MCP Config](#mcp-config)
- [Output Formats](#output-formats)
- [Environment Variables](#environment-variables)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Canary Commands](#canary-commands-epic-39)

---

## Installation

Install Medirus globally using npm:

```bash
npm install -g medirus
```

Verify the installation:

```bash
medirus --version
medirus doctor      # checks Node, the browser, the MCP server, and what works right now
```

### Requirements

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- An X/Twitter account **only** for search, followers, following, likes, bookmarks, and DMs. Everything else works logged out.

---

## Quick Start

```bash
npm install -g medirus

medirus quickstart          # guided first run, adapts to what you have set up
medirus doctor              # verify the install and see which tier you are on

medirus profile NASA        # works with no account
medirus tweets NASA --limit 20
medirus analyze NASA        # engagement rate, cadence, content mix, best posting hour

medirus connect             # log in once, in a real browser, to unlock the rest
medirus search "your topic" --limit 50
medirus followers yourhandle --limit 500 --output followers.json
```

Prefer `medirus connect` over `medirus login`: it drives a real browser, you log in normally, and the session is captured for you. `login` is the manual fallback for pasting cookies out of DevTools yourself.

---

## Finding your way around

There are more than fifty commands. Running `medirus` with no arguments prints them grouped by task rather than alphabetically:

```
Start here              Set up and verify the install
Read an account         Works with no login at all
Followers and audience  Who follows whom, and who is worth your time
Search and monitor      Find posts, then keep watching them
Write and grow          Draft, sharpen, schedule, and recycle posts
Automate                Run it without you
Move data               Export, import, convert, migrate, diff
Low level               The raw HTTP client
```

`medirus help <command>` gives the full flag list for any one command.

### medirus quickstart

A guided first run. Reads what you already have configured and prints the three commands that will produce a result on your machine, then the directions worth exploring next.

```bash
medirus quickstart
medirus quickstart --json    # just the detected setup state, for scripts
```

The JSON form reports the config directory, whether a session is saved, and which tier (`guest` or `session`) you are on.

### medirus completion

Tab completion for bash, zsh, and fish. The script is generated from the live command tree, so it covers every command, sub-command, and flag, and stays correct as commands are added.

```bash
# bash
medirus completion bash > /etc/bash_completion.d/medirus
# or, without root:
echo 'source <(medirus completion bash)' >> ~/.bashrc

# zsh
medirus completion zsh > "${fpath[1]}/_medirus" && compinit
# or:
echo 'source <(medirus completion zsh)' >> ~/.zshrc

# fish
medirus completion fish > ~/.config/fish/completions/medirus.fish
```

Regenerate it after upgrading Medirus so newly added commands complete.

---

## Authentication

Medirus uses your X/Twitter session cookie for authentication. This approach bypasses API rate limits and doesn't require expensive API access.

### medirus login

Set up authentication with your X/Twitter session cookie.

**Syntax:**

```bash
medirus login
```

**Usage:**

```bash
$ medirus login

⚡ Medirus Login Setup

To get your auth_token cookie:
1. Go to x.com and log in
2. Open DevTools (F12) → Application → Cookies
3. Find "auth_token" and copy its value

? Enter your auth_token cookie: ********

✓ Authentication saved!
```

**How to get your auth_token:**

1. Open [x.com](https://x.com) in your browser and log in
2. Press `F12` to open Developer Tools
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Expand **Cookies** → click on `https://x.com`
5. Find the cookie named `auth_token`
6. Copy the **Value** (a long hexadecimal string)
7. Paste it when prompted by `medirus login`

> ⚠️ **Security Note**: Your auth_token is stored locally in `~/.medirus/config.json`. Never share this token with anyone.

---

### medirus logout

Remove saved authentication credentials.

**Syntax:**

```bash
medirus logout
```

**Example:**

```bash
$ medirus logout
✓ Logged out successfully
```

---

## Commands

### medirus profile

Fetch detailed profile information for any X/Twitter user.

**Syntax:**

```bash
medirus profile <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | X/Twitter username (without the @) | Yes      |

**Options:**

| Option         | Alias | Description          | Default |
|----------------|-------|----------------------|---------|
| `--json`       | `-j`  | Output as raw JSON   | false   |

**Examples:**

```bash
# Get profile with formatted output
medirus profile elonmusk

# Output:
# ⚡ @elonmusk
#
#   Name:      Elon Musk
#   Bio:       Mars & Cars, Chips & Dips
#   Location:  𝕏
#   Website:   x.com
#   Joined:    June 2009
#   Following: 800  Followers: 195.2M
#   ✓ Verified

# Get profile as JSON
medirus profile elonmusk --json

# Output:
# {
#   "username": "elonmusk",
#   "name": "Elon Musk",
#   "bio": "Mars & Cars, Chips & Dips",
#   "location": "𝕏",
#   "website": "x.com",
#   "joined": "June 2009",
#   "following": 800,
#   "followers": 195200000,
#   "verified": true
# }
```

---

### medirus followers

Scrape the followers list for any user.

**Syntax:**

```bash
medirus followers <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | X/Twitter username (without the @) | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum followers to scrape    | 100     |
| `--output <file>` | `-o` | Output file (.json or .csv)  | stdout  |

**Examples:**

```bash
# Scrape 100 followers (default)
medirus followers nichxbt

# Scrape 500 followers and save to JSON
medirus followers nichxbt --limit 500 --output followers.json

# Scrape 1000 followers and save to CSV
medirus followers nichxbt -l 1000 -o followers.csv

# Pipe output to jq for processing
medirus followers nichxbt --limit 50 | jq '.[].username'
```

**Output Schema (JSON):**

```json
[
  {
    "username": "user1",
    "name": "User One",
    "bio": "Developer & Creator",
    "followers": 1500,
    "following": 200,
    "verified": false,
    "followsBack": true
  }
]
```

---

### medirus following

Scrape the accounts a user is following.

**Syntax:**

```bash
medirus following <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | X/Twitter username (without the @) | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum accounts to scrape     | 100     |
| `--output <file>` | `-o` | Output file (.json or .csv)  | stdout  |

**Examples:**

```bash
# Scrape following list
medirus following nichxbt

# Scrape 200 accounts and save to JSON
medirus following nichxbt --limit 200 --output following.json

# Get following as CSV for spreadsheet analysis
medirus following nichxbt -l 500 -o following.csv
```

---

### medirus non-followers

Analyze follow relationships to find accounts that don't follow you back.

**Syntax:**

```bash
medirus non-followers <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | Your X/Twitter username            | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum accounts to analyze    | 500     |
| `--output <file>` | `-o` | Output file for full list    | stdout  |

**Examples:**

```bash
# Analyze your follow relationships
medirus non-followers nichxbt

# Output:
# 📊 Follow Analysis
#
#   Total Following: 450
#   Mutuals:         320
#   Non-Followers:   130
#
# Non-followers:
#   @user1 - John Doe
#   @user2 - Jane Smith
#   @user3 - Bob Wilson
#   ... and 127 more

# Save full list of non-followers to file
medirus non-followers nichxbt --limit 1000 --output non-followers.json

# Analyze and export for batch unfollowing
medirus non-followers myaccount -l 2000 -o cleanup-list.json
```

---

### medirus tweets

Scrape tweets from a user's timeline.

**Syntax:**

```bash
medirus tweets <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | X/Twitter username (without the @) | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum tweets to scrape       | 50      |
| `--replies`     | `-r`  | Include replies in results     | false   |
| `--output <file>` | `-o` | Output file (.json or .csv)  | stdout  |

**Examples:**

```bash
# Scrape recent tweets
medirus tweets elonmusk

# Scrape 200 tweets including replies
medirus tweets elonmusk --limit 200 --replies

# Save tweets to JSON file
medirus tweets elonmusk -l 100 -o elon-tweets.json

# Export to CSV for spreadsheet analysis
medirus tweets nichxbt --limit 500 --output tweets.csv
```

**Output Schema (JSON):**

```json
[
  {
    "id": "1234567890123456789",
    "text": "Just shipped a new feature! 🚀",
    "timestamp": "2025-12-15T10:30:00.000Z",
    "likes": 1500,
    "retweets": 200,
    "replies": 50,
    "views": 50000,
    "isReply": false,
    "isRetweet": false
  }
]
```

---

### medirus search

Search for tweets matching a query.

**Syntax:**

```bash
medirus search <query> [options]
```

**Arguments:**

| Argument | Description           | Required |
|----------|-----------------------|----------|
| `query`  | Search query string   | Yes      |

**Options:**

| Option           | Alias | Description                                      | Default  |
|------------------|-------|--------------------------------------------------|----------|
| `--limit <n>`    | `-l`  | Maximum results to return                        | 50       |
| `--filter <type>`| `-f`  | Filter type: `latest`, `top`, `people`, `photos`, `videos` | `latest` |
| `--output <file>`| `-o`  | Output file                                      | stdout   |

**Examples:**

```bash
# Search for tweets about Bitcoin
medirus search "bitcoin"

# Search with filter for top tweets
medirus search "AI agents" --filter top --limit 100

# Search for photos only
medirus search "sunset photography" -f photos -l 50 -o photos.json

# Search for people/accounts
medirus search "web3 developer" --filter people

# Complex query with quotes
medirus search '"machine learning" from:openai' --limit 200

# Save search results
medirus search "typescript tips" -o ts-tips.json
```

**Search Operators:**

| Operator            | Description                        | Example                          |
|---------------------|------------------------------------|----------------------------------|
| `from:username`     | Tweets from a specific user        | `from:nichxbt`                   |
| `to:username`       | Replies to a specific user         | `to:elonmusk`                    |
| `"exact phrase"`    | Match exact phrase                 | `"artificial intelligence"`      |
| `filter:links`      | Only tweets with links             | `web3 filter:links`              |
| `filter:images`     | Only tweets with images            | `sunset filter:images`           |
| `min_faves:n`       | Minimum likes                      | `javascript min_faves:100`       |
| `min_retweets:n`    | Minimum retweets                   | `breaking min_retweets:50`       |
| `since:YYYY-MM-DD`  | Tweets since date                  | `bitcoin since:2025-01-01`       |
| `until:YYYY-MM-DD`  | Tweets until date                  | `crypto until:2025-06-01`        |
| `-word`             | Exclude word                       | `crypto -scam`                   |
| `OR`                | Match either term                  | `bitcoin OR ethereum`            |

---

### medirus hashtag

Scrape tweets containing a specific hashtag.

**Syntax:**

```bash
medirus hashtag <tag> [options]
```

**Arguments:**

| Argument | Description                      | Required |
|----------|----------------------------------|----------|
| `tag`    | Hashtag to search (with or without #) | Yes |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum tweets to scrape       | 50      |
| `--output <file>` | `-o` | Output file                  | stdout  |

**Examples:**

```bash
# Scrape tweets with #buildinpublic
medirus hashtag buildinpublic

# With the # symbol (both work)
medirus hashtag "#100DaysOfCode"

# Scrape 200 tweets and save
medirus hashtag AI --limit 200 --output ai-tweets.json

# Track trending hashtag
medirus hashtag trending -l 500 -o trending.json
```

---

### medirus thread

Scrape an entire tweet thread/conversation.

**Syntax:**

```bash
medirus thread <url> [options]
```

**Arguments:**

| Argument | Description                            | Required |
|----------|----------------------------------------|----------|
| `url`    | URL of any tweet in the thread         | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--output <file>` | `-o` | Output file                  | stdout  |

**Examples:**

```bash
# Scrape a thread (formatted output)
medirus thread https://x.com/nichxbt/status/1234567890123456789

# Output:
# 🧵 Thread:
#
# 1. First tweet in the thread explaining the concept...
#    Dec 15, 2025
#
# 2. Continuing with more details about implementation...
#    Dec 15, 2025
#
# 3. Final thoughts and call to action...
#    Dec 15, 2025

# Save thread to file
medirus thread https://x.com/user/status/123456789 -o thread.json
```

---

### medirus media

Scrape media (images, videos, GIFs) from a user's timeline.

**Syntax:**

```bash
medirus media <username> [options]
```

**Arguments:**

| Argument   | Description                        | Required |
|------------|-------------------------------------|----------|
| `username` | X/Twitter username (without the @) | Yes      |

**Options:**

| Option          | Alias | Description                    | Default |
|-----------------|-------|--------------------------------|---------|
| `--limit <n>`   | `-l`  | Maximum media items to scrape  | 50      |
| `--output <file>` | `-o` | Output file                  | stdout  |

**Examples:**

```bash
# Scrape media from a user
medirus media nichxbt

# Scrape 100 media items
medirus media photographer --limit 100 --output media.json

# Short form
medirus media artist -l 200 -o artist-media.json
```

**Output Schema (JSON):**

```json
[
  {
    "type": "image",
    "url": "https://pbs.twimg.com/media/...",
    "tweetId": "1234567890123456789",
    "tweetUrl": "https://x.com/user/status/1234567890123456789",
    "timestamp": "2025-12-15T10:30:00.000Z",
    "alt": "Image description"
  }
]
```

---

### medirus info

Display Medirus information, version, and links.

**Syntax:**

```bash
medirus info
```

**Example:**

```bash
$ medirus info

⚡ Medirus v3.5.0

The Complete X/Twitter Automation Toolkit

Features:
  • Scrape profiles, followers, following, tweets
  • Search tweets and hashtags
  • Extract threads, media, and more
  • Export to JSON or CSV
  • No Twitter API required (saves $100-$5000+/mo)

Author:
  nich (@nichxbt) - https://github.com/nirholas

Links:
  Website:  https://medirus.online
  GitHub:   https://github.com/nirholas/xactions
  Docs:     https://medirus.online/docs

Run "medirus --help" for all commands
```

---

### medirus persona create

Interactively create a new persona for the algorithm builder. Guides you through choosing a niche preset, engagement strategy, and activity pattern.

**Syntax:**

```bash
medirus persona create [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--name <name>` | Persona name (skips prompt) |
| `--preset <preset>` | Niche preset (skips prompt) |
| `--strategy <strategy>` | Engagement strategy (skips prompt) |
| `--activity <pattern>` | Activity pattern (skips prompt) |

**Available Presets:**

| Preset | Description |
|--------|-------------|
| `crypto-degen` | Crypto/DeFi/Web3 with degen slang |
| `tech-builder` | Indie hacker / building in public |
| `ai-researcher` | AI/ML papers and research |
| `growth-marketer` | Content strategy and audience growth |
| `finance-investor` | Markets, investing, economics |
| `creative-writer` | Writing craft and storytelling |
| `custom` | Define your own topics and tone |

**Available Strategies:**

| Strategy | Follows/day | Likes/day | Comments/day | Posts/day |
|----------|-------------|-----------|--------------|-----------|
| `aggressive` | 80 | 150 | 40 | 5 |
| `moderate` | 40 | 80 | 20 | 3 |
| `conservative` | 15 | 40 | 8 | 1 |
| `thoughtleader` | 20 | 60 | 30 | 4 |

**Available Activity Patterns:**

| Pattern | Description |
|---------|-------------|
| `night-owl` | Active late night, peak midnight–2am |
| `early-bird` | Active from 5am, peak morning |
| `nine-to-five` | Checks before/after work, active evenings |
| `always-on` | Active throughout the day |
| `weekend-warrior` | Light weekdays, heavy weekends |

**Examples:**

```bash
# Interactive creation
$ medirus persona create

# One-liner
$ medirus persona create --name "CryptoBot" --preset crypto-degen --strategy aggressive --activity night-owl

# Custom niche (interactive prompts for topics, search terms, etc.)
$ medirus persona create --preset custom
```

---

### medirus persona list

List all saved personas with their stats and last activity.

**Syntax:**

```bash
medirus persona list
```

**Example:**

```bash
$ medirus persona list

🤖 Saved Personas

  ● CryptoBot (persona_1234567890)
    Preset: crypto-degen | Strategy: aggressive
    Sessions: 42 | Follows: 320 | Likes: 1200 | Comments: 180
    Last active: 1/15/2025, 3:42:00 AM

  ○ AIResearcher (persona_0987654321)
    Preset: ai-researcher | Strategy: thoughtleader
    Sessions: 0 | Follows: 0 | Likes: 0 | Comments: 0
```

---

### medirus persona run

Start the 24/7 algorithm builder for a persona. Launches a Puppeteer browser, logs in, and runs automated sessions with sleep cycles.

**Syntax:**

```bash
medirus persona run <personaId> [options]
```

**Arguments:**

| Argument | Description | Required |
|----------|-------------|----------|
| `personaId` | The persona ID (shown in `persona list`) | Yes |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--headless` | Run browser in headless mode | `true` |
| `--no-headless` | Show the browser window | - |
| `--dry-run` | Preview actions without executing | `false` |
| `--sessions <n>` | Stop after N sessions (0 = infinite) | `0` |
| `--token <token>` | X auth token (overrides saved config) | - |

**Environment Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `MEDIRUS_SESSION_COOKIE` | Yes* | X auth token (alt: `--token` or `medirus login`) |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key for LLM-generated comments/posts |

**Examples:**

```bash
# Start with saved auth
$ medirus persona run persona_1234567890

# With visible browser for debugging
$ medirus persona run persona_1234567890 --no-headless

# Dry run — preview without executing
$ medirus persona run persona_1234567890 --dry-run

# Run 5 sessions then stop
$ medirus persona run persona_1234567890 --sessions 5

# Explicit auth token
$ medirus persona run persona_1234567890 --token "abc123hex..."
```

---

### medirus persona status

Display detailed status, config, and lifetime stats for a persona.

**Syntax:**

```bash
medirus persona status <personaId>
```

**Example:**

```bash
$ medirus persona status persona_1234567890

🤖 CryptoBot — Status Report

Identity
  ID: persona_1234567890
  Preset: crypto-degen
  Created: 1/10/2025, 9:00:00 AM

Niche
  Topics: crypto, defi, web3, bitcoin, ethereum, solana, memecoins
  Search terms: 7
  Target accounts: 0xCygaar, blaboratory, DefiIgnas

Strategy
  Growth: aggressive
  Activity: night-owl
  Daily limits: 80 follows, 150 likes, 40 comments

Lifetime Stats
  Sessions: 42
  Follows: 320
  Likes: 1200
  Comments: 180
  Posts: 24
  Searches: 89
  Last active: 1/15/2025, 3:42:00 AM

Follow Graph
  Users followed: 280
  Current followers: 145
  Target: 10,000
```

---

### medirus persona edit

Modify an existing persona's config without recreating it.

**Syntax:**

```bash
medirus persona edit <personaId> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--topics <topics>` | Set topics (comma-separated) |
| `--search-terms <terms>` | Set search terms (comma-separated) |
| `--target-accounts <accounts>` | Set target accounts (comma-separated, no @) |
| `--strategy <strategy>` | Set engagement strategy |
| `--activity <pattern>` | Set activity pattern |

**Examples:**

```bash
# Change topics
$ medirus persona edit persona_123 --topics "ai,llm,agents,agi"

# Switch to conservative strategy
$ medirus persona edit persona_123 --strategy conservative

# Update target accounts
$ medirus persona edit persona_123 --target-accounts "elonmusk,sama,karpathy"
```

---

### medirus persona delete

Permanently delete a saved persona and all its data.

**Syntax:**

```bash
medirus persona delete <personaId>
```

**Example:**

```bash
$ medirus persona delete persona_1234567890
? Delete persona persona_1234567890? This cannot be undone. (y/N) y
✅ Persona persona_1234567890 deleted
```

---

## Agent Commands

### medirus agent setup

Interactive 8-step setup wizard for first-time agent configuration.

```bash
medirus agent setup
```

Walks through niche selection, persona creation, LLM provider setup, timezone, intensity level, browser login, test run, and saves config to `data/agent-config.json`.

### medirus agent start

Start the autonomous thought leader agent.

```bash
medirus agent start [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to agent config file | `data/agent-config.json` |

**Example:**

```bash
medirus agent start --config data/agent-config.json
```

### medirus agent test

Run the agent for 5 minutes in test mode.

```bash
medirus agent test [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to agent config file | `data/agent-config.json` |

### medirus agent login

Open a visible browser for manual X.com login. Saves session cookies for headless runs.

```bash
medirus agent login
```

### medirus agent status

Show current agent status and today's action counts.

```bash
medirus agent status [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to agent config file | `data/agent-config.json` |

**Example output:**

```
📊 Agent Status — Today
  Likes:      47 / 150
  Follows:    12 / 80
  Comments:   8  / 25
  Posts:       2  / 5
  LLM cost:   $0.34
```

### medirus agent report

Generate a growth report for the last N days.

```bash
medirus agent report [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --days <n>` | Number of days to report on | `7` |

---

## Plugin Commands

### medirus plugin install

Install a plugin from npm or a local path.

```bash
medirus plugin install <name>
```

**Example:**

```bash
$ medirus plugin install medirus-plugin-sentiment
✅ Installed medirus-plugin-sentiment@1.2.0
   Tools: 3 | Scrapers: 1 | Routes: 2 | Actions: 1
```

### medirus plugin remove

Remove an installed plugin.

```bash
medirus plugin remove <name>
```

### medirus plugin list

List all installed plugins with status.

```bash
$ medirus plugin list
 ✅ medirus-plugin-sentiment  v1.2.0  Sentiment analysis tools
 ⏸  medirus-plugin-analytics  v0.9.1  Advanced analytics (disabled)
```

### medirus plugin enable / disable

Enable or disable a plugin without removing it.

```bash
medirus plugin enable <name>
medirus plugin disable <name>
```

### medirus plugin discover

Scan `node_modules` for `medirus-plugin-*` packages.

```bash
medirus plugin discover
```

---

## Stream Commands

### medirus stream start

Start a real-time stream for an account.

```bash
medirus stream start <type> <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --interval <seconds>` | Poll interval | `60` |

**Types:** `tweet`, `follower`, `mention`

**Example:**

```bash
$ medirus stream start tweet nichxbt -i 30
🔴 Stream started: stream_abc123
   Type: tweet | User: nichxbt | Interval: 30s
```

### medirus stream stop

Stop an active stream.

```bash
medirus stream stop <streamId>
```

### medirus stream list

List all active streams and browser pool status.

```bash
$ medirus stream list
Active Streams:
  stream_abc123  tweet     nichxbt   ✅ running  polls:142  errors:0
  stream_def456  follower  nichxbt   ⏸  paused   polls:89   errors:1

Browser Pool: 2/5 active
```

### medirus stream history

Show recent events for a stream.

```bash
medirus stream history <streamId> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Number of events | `20` |
| `-t, --type <eventType>` | Filter by event type | all |

### medirus stream pause / resume

Pause or resume a stream without losing state.

```bash
medirus stream pause <streamId>
medirus stream resume <streamId>
```

### medirus stream status

Get detailed status of a specific stream.

```bash
medirus stream status <streamId>
```

### medirus stream stop-all

Stop all active streams.

```bash
medirus stream stop-all
```

---

## Workflow Commands

### medirus workflow create

Create a workflow from a JSON file or interactively.

```bash
medirus workflow create [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --file <path>` | Load workflow from JSON file | interactive |

**Interactive mode** prompts for: name, description, trigger type (manual/schedule/webhook), cron expression.

### medirus workflow run

Run a workflow by name or ID.

```bash
medirus workflow run <name> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--auth <token>` | Auth token for browser actions | from config |

### medirus workflow list

List all saved workflows.

```bash
$ medirus workflow list
 ✅ morning-engage  wf_001  schedule (0 9 * * *)  5 steps  Morning engagement routine
 ✅ weekly-report   wf_002  manual                 3 steps  Generate weekly analytics
```

### medirus workflow delete

Delete a workflow.

```bash
medirus workflow delete <id>
```

### medirus workflow actions

List all available workflow actions grouped by category.

```bash
medirus workflow actions
```

### medirus workflow runs

Show execution history for a workflow.

```bash
medirus workflow runs <workflowId> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Number of runs to show | `10` |

---

## Graph Commands

### medirus graph build

Build a social graph by crawling an account's network.

```bash
medirus graph build <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --depth <n>` | Crawl depth | `2` |
| `-n, --max-nodes <n>` | Maximum nodes to collect | `500` |
| `--auth <token>` | Auth token | from config |

**Example:**

```bash
$ medirus graph build nichxbt -d 2 -n 200
🕸️ Building graph for nichxbt...
   Depth: 2 | Max nodes: 200
   ████████████████████ 100%
✅ Graph saved: graph_abc123 (187 nodes, 2,341 edges)
```

### medirus graph analyze

Run cluster, influence, and bridge analysis on a graph.

```bash
medirus graph analyze <graphId>
```

**Output:** Clusters, top influencers, bridge accounts, orbit analysis.

### medirus graph recommend

Get follow/engage/unfollow recommendations from a graph.

```bash
medirus graph recommend <graphId>
```

**Output:** Suggested follows, engagement targets, watch list, safe-to-unfollow.

### medirus graph export

Export a graph for visualization.

```bash
medirus graph export <graphId> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --format <format>` | Output format: html, gexf, d3 | `html` |
| `-o, --output <path>` | Output file path | auto |

### medirus graph list

List all saved graphs.

```bash
medirus graph list
```

### medirus graph delete

Delete a saved graph.

```bash
medirus graph delete <graphId>
```

---

## Portability Commands

### medirus export

Export a full Twitter account (profile, tweets, followers, following, bookmarks).

```bash
medirus export <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --format <formats>` | Comma-separated: json,csv,xlsx,md,html | `json,csv,md,html` |
| `--only <phases>` | Limit to: profile,tweets,followers,following,bookmarks,likes | all |
| `-l, --limit <n>` | Items per phase | `500` |
| `-o, --output <dir>` | Output directory | `exports/<username>` |

**Example:**

```bash
medirus export nichxbt -f json,csv --only profile,tweets -l 1000
```

### medirus migrate

Migrate Twitter data to Bluesky or Mastodon.

```bash
medirus migrate <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--to <platform>` | Target: bluesky or mastodon | **required** |
| `--dry-run` | Preview without executing | `true` |
| `--execute` | Actually perform migration | `false` |
| `--export-dir <dir>` | Use existing export data | auto |
| `-l, --limit <n>` | Items to migrate | `50` |

### medirus diff

Compare two account exports and show changes.

```bash
medirus diff <dirA> <dirB> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Save diff report | stdout |

**Output:** Follower/following deltas, tweet count changes, engagement trends, profile diffs.

---

## Cross-Platform Scraping

### medirus scrape

Multi-platform scraping for Twitter, Bluesky, Mastodon, and Threads.

```bash
medirus scrape <action> [target] [options]
```

**Actions:** `profile`, `followers`, `following`, `tweets`, `search`, `hashtag`, `trending`

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --platform <platform>` | twitter, bluesky, mastodon, threads | `twitter` |
| `-u, --username <username>` | Target username | — |
| `-q, --query <query>` | Search query | — |
| `-l, --limit <n>` | Max items | `100` |
| `-i, --instance <url>` | Mastodon instance URL | — |
| `-o, --output <file>` | Output file | stdout |
| `-j, --json` | Force JSON output | `false` |

**Examples:**

```bash
medirus scrape profile -p bluesky -u nichxbt.bsky.social
medirus scrape followers -p mastodon -u user -i https://mastodon.social -l 500
medirus scrape trending -p twitter
```

### medirus platforms

List supported social media platforms.

```bash
medirus platforms
```

---

## AI Writer Commands

### medirus ai analyze

Analyze a user's writing voice from their tweets.

```bash
medirus ai analyze <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Tweets to analyze | `100` |
| `-o, --output <file>` | Save voice profile | — |
| `--json` | JSON output | `false` |

### medirus ai generate

Generate tweets or threads in a user's voice.

```bash
medirus ai generate <topic> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --voice <username>` | Voice to mimic | **required** |
| `-c, --count <n>` | Number of variations | `3` |
| `-s, --style <style>` | casual, professional, provocative | — |
| `-t, --type <type>` | tweet or thread | `tweet` |
| `-m, --model <model>` | LLM model | auto |
| `-k, --api-key <key>` | OpenRouter API key | from env |

### medirus ai rewrite

Rewrite a tweet in a user's voice with a goal.

```bash
medirus ai rewrite <text> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --voice <username>` | Voice to mimic | **required** |
| `-g, --goal <goal>` | more_engaging, shorter, more_professional, funnier | `more_engaging` |
| `-c, --count <n>` | Number of variations | `3` |

### medirus ai calendar

Generate a weekly content calendar.

```bash
medirus ai calendar <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --days <n>` | Days to plan | `7` |
| `-p, --posts-per-day <n>` | Posts per day | `3` |
| `-t, --topics <topics>` | Comma-separated topic list | auto |
| `-o, --output <file>` | Save calendar | — |

---

## AI Content Optimizer

### medirus optimize

AI-optimize a tweet for engagement.

```bash
medirus optimize <text> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--goal <goal>` | engagement, clarity, growth, viral | `engagement` |

### medirus hashtags

Suggest hashtags for tweet text.

```bash
medirus hashtags <text> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --count <n>` | Number of suggestions | `5` |

### medirus predict

Predict tweet performance (score, reach, strengths, weaknesses).

```bash
medirus predict <text>
```

### medirus variations

Generate tweet variations.

```bash
medirus variations <text> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --count <n>` | Number of variations | `3` |

---

## Analytics Commands

### medirus sentiment

Analyze sentiment of text or tweet content.

```bash
medirus sentiment <text> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --mode <mode>` | rules or llm | `rules` |
| `-o, --output <file>` | Save results | stdout |

### medirus monitor

Start monitoring sentiment for a username or keyword.

```bash
medirus monitor <target> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | mentions, keyword, replies | `mentions` |
| `-i, --interval <seconds>` | Check interval | `900` |
| `-m, --mode <mode>` | rules or llm | `rules` |
| `--threshold <n>` | Alert threshold | `-0.3` |
| `--webhook <url>` | Webhook for alerts | — |

### medirus report

Generate a reputation report for a monitored username.

```bash
medirus report <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --period <period>` | 24h, 7d, 30d, all | `7d` |
| `-f, --format <format>` | json or markdown | `markdown` |
| `-o, --output <file>` | Save report | stdout |

### medirus history

View account history over time.

```bash
medirus history <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --days <n>` | Days of history | `30` |
| `-i, --interval <interval>` | hour, day, week | `day` |
| `-f, --format <format>` | json or csv | `json` |
| `--export <path>` | Export to file | — |

### medirus snapshot

Start auto-snapshotting an account (long-running).

```bash
medirus snapshot <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --interval <minutes>` | Snapshot interval | `60` |

### medirus audience

Analyze follower overlap between two accounts.

```bash
medirus audience <username1> <username2> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--max <n>` | Max followers to compare | `5000` |

### medirus evergreen

Find and recycle top-performing evergreen content.

```bash
medirus evergreen <username> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--min-likes <n>` | Minimum likes threshold | `50` |
| `--min-age <days>` | Minimum age in days | `30` |
| `--analyze` | Analyze only (don't queue) | `false` |

---

## CRM Commands

### medirus crm sync

Sync followers to the built-in CRM.

```bash
medirus crm sync <username>
```

### medirus crm tag

Tag a contact.

```bash
medirus crm tag <username> <tag>
```

### medirus crm search

Search contacts by query.

```bash
medirus crm search <query>
```

### medirus crm score

Auto-score all contacts based on engagement.

```bash
medirus crm score
```

### medirus crm segment

Get members of a segment.

```bash
medirus crm segment <name>
```

---

## Scheduling Commands

### medirus schedule add

Add a scheduled job.

```bash
medirus schedule add <name> <cron> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --command <cmd>` | Command to execute | **required** |

**Example:**

```bash
medirus schedule add morning-scrape "0 9 * * *" -c "medirus followers nichxbt -l 100 -o daily.json"
```

### medirus schedule list

List all scheduled jobs.

```bash
$ medirus schedule list
 ✅ morning-scrape  0 9 * * *   Next: 2025-01-20 09:00
 ⏸  weekly-export   0 0 * * 1   Next: 2025-01-27 00:00 (disabled)
```

### medirus schedule remove

Remove a scheduled job.

```bash
medirus schedule remove <name>
```

### medirus schedule run

Run a job immediately (ignoring cron schedule).

```bash
medirus schedule run <name>
```

---

## RSS Monitor

### medirus rss add

Add an RSS feed for monitoring and auto-drafting.

```bash
medirus rss add <name> <url> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --template <template>` | Tweet template | `📰 {title}\n\n{link}` |

**Example:**

```bash
medirus rss add techcrunch https://techcrunch.com/feed/ -t "🔗 {title}\n{description}\n\n{link}"
```

### medirus rss list

List all monitored feeds.

```bash
medirus rss list
```

### medirus rss check

Check feeds for new items and create draft posts.

```bash
medirus rss check [name]    # Check specific feed or all feeds
```

### medirus rss drafts

View draft posts generated from RSS items.

```bash
medirus rss drafts
```

---

## Notification Commands

### medirus notify test

Send a test notification to a specific channel.

```bash
medirus notify test <channel>    # slack, discord, telegram, email
```

### medirus notify send

Send a notification to all configured channels.

```bash
medirus notify send <message> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --title <title>` | Notification title | `Medirus Alert` |
| `-s, --severity <level>` | info, warning, critical | `info` |

### medirus notify configure

Interactive configuration for notification channels (Slack, Discord, Telegram, email).

```bash
medirus notify configure
```

---

## Dataset Management

### medirus dataset list

List all stored scraping datasets.

```bash
medirus dataset list
```

### medirus dataset export

Export a dataset to file.

```bash
medirus dataset export <name> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --format <format>` | json, csv, jsonl | `json` |
| `-o, --output <path>` | Output file | stdout |

### medirus dataset delete

Delete a stored dataset.

```bash
medirus dataset delete <name>
```

---

## Team Management

### medirus team create

Create a new team.

```bash
medirus team create <name> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-u, --owner <username>` | Team owner | current user |

### medirus team invite

Invite a user to a team.

```bash
medirus team invite <teamId> <email> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --role <role>` | admin, member, viewer | `member` |

### medirus team members

List team members.

```bash
medirus team members <teamId>
```

### medirus team activity

View team activity log.

```bash
medirus team activity <teamId> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Number of entries | `20` |

---

## Bulk Operations

Run actions in bulk from a CSV, JSON, or TXT file.

```bash
medirus bulk <action> <file> [options]
```

**Actions:** `follow`, `unfollow`, `block`, `mute`, `scrape`

| Option | Description | Default |
|--------|-------------|---------|
| `--delay <ms>` | Delay between actions | `2000` |
| `--dry-run` | Preview without executing | `false` |
| `--resume` | Resume from last position | `false` |

**Example:**

```bash
medirus bulk follow targets.csv --delay 3000
medirus bulk scrape usernames.txt -o results.json
```

---

## Import/Export Compatibility

### medirus import

Import data from Apify, Phantombuster, or CSV.

```bash
medirus import <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--from <source>` | apify, phantombuster, auto | `auto` |
| `-o, --output <path>` | Output file | — |

### medirus export-data

Export data in external tool format.

```bash
medirus export-data <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--to <target>` | apify, phantombuster, socialblade, csv | `csv` |
| `--type <type>` | profile, tweet, followers | `profile` |
| `-o, --output <path>` | Output file | — |

### medirus convert

Convert between data formats.

```bash
medirus convert <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--from <source>` | Source format | `apify` |
| `--to <target>` | Target format | `csv` |
| `-o, --output <path>` | Output file | — |

---

## MCP Config

Generate MCP server configuration for AI tools.

```bash
medirus mcp-config [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-w, --write` | Write to config file | `false` |
| `-c, --client <client>` | claude, cursor, windsurf, vscode | `claude` |

**Example:**

```bash
# Generate config for Claude Desktop
medirus mcp-config -c claude

# Write directly to Claude config file
medirus mcp-config -c claude --write
```

---

## Output Formats

Medirus supports two output formats: **JSON** and **CSV**.

### JSON Output

JSON is the default format when using `--output` with a `.json` extension.

```bash
# Save as JSON
medirus followers nichxbt -o followers.json
```

**Features:**
- Preserves all data types (numbers, booleans, nested objects)
- Easy to process with `jq`, Node.js, Python, etc.
- Suitable for programmatic use

### CSV Output

Use `.csv` extension to export as comma-separated values.

```bash
# Save as CSV
medirus followers nichxbt -o followers.csv
```

**Features:**
- Opens directly in Excel, Google Sheets, Numbers
- Great for data analysis and reporting
- Flattens nested data structures

### Stdout Output

Without `--output`, data is printed to stdout as JSON.

```bash
# Print to terminal
medirus followers nichxbt

# Pipe to jq for processing
medirus followers nichxbt | jq '.[].username'

# Pipe to file
medirus followers nichxbt > followers.json

# Pipe to another command
medirus followers nichxbt | wc -l
```

---

## Environment Variables

Medirus supports the following environment variables:

| Variable              | Description                                      | Default              |
|-----------------------|--------------------------------------------------|----------------------|
| `MEDIRUS_AUTH_TOKEN` | X/Twitter auth_token cookie (alternative to login) | —                  |
| `MEDIRUS_CONFIG_DIR` | Custom config directory path                     | `~/.medirus`        |
| `MEDIRUS_HEADLESS`   | Run browser in headless mode                     | `true`               |
| `MEDIRUS_TIMEOUT`    | Request timeout in milliseconds                  | `30000`              |
| `MEDIRUS_PROXY`      | HTTP/SOCKS proxy URL                             | —                    |
| `PROXY_DAILY_BUDGET_USD` | Daily proxy spend ceiling in USD (Epic 40); exhausted budget returns `BUDGET_CEILING_REACHED` soft degradation | `50` |
| `DEBUG`               | Enable debug logging (`medirus:*`)              | —                    |

### Examples

```bash
# Use auth token from environment
export MEDIRUS_AUTH_TOKEN="your_auth_token_here"
medirus followers nichxbt

# Use a proxy
export MEDIRUS_PROXY="http://proxy.example.com:8080"
medirus profile elonmusk

# Enable debug mode
DEBUG=medirus:* medirus followers nichxbt

# Custom config directory
MEDIRUS_CONFIG_DIR=/custom/path medirus login

# Inline environment variables
MEDIRUS_HEADLESS=false medirus profile nichxbt
```

---

## Configuration

Medirus stores configuration in `~/.medirus/config.json`.

### Config File Location

```
~/.medirus/
├── config.json      # Authentication and settings
├── personas/        # Saved persona configurations
│   ├── persona_123.json
│   └── persona_456.json
└── cache/           # Temporary cache (optional)
```

### Config File Structure

```json
{
  "authToken": "your_auth_token_here",
  "headless": true,
  "timeout": 30000,
  "proxy": null
}
```

### Manual Configuration

You can manually edit the config file:

```bash
# View current config
cat ~/.medirus/config.json

# Edit config
nano ~/.medirus/config.json
```

---

## Troubleshooting

### Common Issues

**1. "Authentication required" error**

```bash
# Solution: Run login command
medirus login
```

**2. "Timeout" errors**

```bash
# Increase timeout
MEDIRUS_TIMEOUT=60000 medirus followers nichxbt
```

**3. "Browser not found" error**

Medirus requires Chromium/Chrome. Install it:

```bash
# macOS
brew install --cask chromium

# Ubuntu/Debian
sudo apt install chromium-browser

# Or use Puppeteer's bundled Chromium
npm install puppeteer
```

**4. Rate limiting**

If you're being rate limited:
- Reduce the `--limit` value
- Add delays between commands
- Consider using a proxy

**5. "Page not loading" issues**

```bash
# Run with visible browser for debugging
MEDIRUS_HEADLESS=false medirus profile nichxbt
```

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
DEBUG=medirus:* medirus followers nichxbt
```

### Getting Help

- **Documentation**: https://medirus.online/docs
- **GitHub Issues**: https://github.com/nirholas/xactions/issues
- **Twitter/X**: [@nichxbt](https://x.com/nichxbt)

---

## Command Reference Summary

| Command | Description | Example |
|---------|-------------|---------|
| `login` | Set up authentication | `medirus login` |
| `logout` | Remove authentication | `medirus logout` |
| `profile` | Get user profile | `medirus profile elonmusk --json` |
| `followers` | Scrape followers | `medirus followers user -l 500 -o f.json` |
| `following` | Scrape following | `medirus following user -l 500` |
| `non-followers` | Find non-followers | `medirus non-followers myuser` |
| `tweets` | Scrape tweets | `medirus tweets user -l 100 --replies` |
| `search` | Search tweets | `medirus search "query" -f top` |
| `hashtag` | Scrape hashtag | `medirus hashtag AI -l 200` |
| `thread` | Scrape thread | `medirus thread <url>` |
| `media` | Scrape media | `medirus media user -l 50` |
| `info` | Show info | `medirus info` |
| `persona create` | Create a persona | `medirus persona create` |
| `persona list` | List personas | `medirus persona list` |
| `persona run` | Start algorithm builder | `medirus persona run <id>` |
| `persona status` | Show persona stats | `medirus persona status <id>` |
| `persona edit` | Modify persona | `medirus persona edit <id> --strategy aggressive` |
| `persona delete` | Delete a persona | `medirus persona delete <id>` |
| `agent setup` | Agent setup wizard | `medirus agent setup` |
| `agent start` | Start thought leader agent | `medirus agent start` |
| `agent test` | 5-minute test run | `medirus agent test` |
| `agent login` | Manual browser login | `medirus agent login` |
| `agent status` | Today's agent metrics | `medirus agent status` |
| `agent report` | Growth report | `medirus agent report -d 30` |
| `plugin install` | Install plugin | `medirus plugin install medirus-plugin-*` |
| `plugin remove` | Remove plugin | `medirus plugin remove <name>` |
| `plugin list` | List plugins | `medirus plugin list` |
| `plugin enable` | Enable plugin | `medirus plugin enable <name>` |
| `plugin disable` | Disable plugin | `medirus plugin disable <name>` |
| `plugin discover` | Discover plugins | `medirus plugin discover` |
| `stream start` | Start real-time stream | `medirus stream start tweet nichxbt -i 30` |
| `stream stop` | Stop stream | `medirus stream stop <id>` |
| `stream list` | List streams | `medirus stream list` |
| `stream history` | Stream event history | `medirus stream history <id> -l 50` |
| `stream pause` | Pause stream | `medirus stream pause <id>` |
| `stream resume` | Resume stream | `medirus stream resume <id>` |
| `stream status` | Stream details | `medirus stream status <id>` |
| `stream stop-all` | Stop all streams | `medirus stream stop-all` |
| `workflow create` | Create workflow | `medirus workflow create -f flow.json` |
| `workflow run` | Run workflow | `medirus workflow run morning-engage` |
| `workflow list` | List workflows | `medirus workflow list` |
| `workflow delete` | Delete workflow | `medirus workflow delete <id>` |
| `workflow actions` | List actions | `medirus workflow actions` |
| `workflow runs` | Execution history | `medirus workflow runs <id>` |
| `graph build` | Build social graph | `medirus graph build nichxbt -d 2` |
| `graph analyze` | Analyze graph | `medirus graph analyze <id>` |
| `graph recommend` | Get recommendations | `medirus graph recommend <id>` |
| `graph export` | Export graph | `medirus graph export <id> -f html` |
| `graph list` | List graphs | `medirus graph list` |
| `graph delete` | Delete graph | `medirus graph delete <id>` |
| `export` | Export account | `medirus export nichxbt -f json,csv` |
| `migrate` | Migrate to Bluesky/Mastodon | `medirus migrate user --to bluesky` |
| `diff` | Compare exports | `medirus diff export1/ export2/` |
| `scrape` | Cross-platform scrape | `medirus scrape profile -p bluesky -u user` |
| `platforms` | List platforms | `medirus platforms` |
| `ai analyze` | Analyze writing voice | `medirus ai analyze nichxbt` |
| `ai generate` | Generate tweets | `medirus ai generate "AI" -v nichxbt` |
| `ai rewrite` | Rewrite tweet | `medirus ai rewrite "text" -v nichxbt` |
| `ai calendar` | Content calendar | `medirus ai calendar nichxbt -d 7` |
| `optimize` | Optimize tweet | `medirus optimize "my tweet"` |
| `hashtags` | Suggest hashtags | `medirus hashtags "my tweet" -n 5` |
| `predict` | Predict performance | `medirus predict "my tweet"` |
| `variations` | Generate variations | `medirus variations "my tweet" -n 5` |
| `sentiment` | Analyze sentiment | `medirus sentiment "great news!"` |
| `monitor` | Monitor reputation | `medirus monitor nichxbt -i 300` |
| `report` | Reputation report | `medirus report nichxbt -p 7d` |
| `history` | Account history | `medirus history nichxbt -d 30` |
| `snapshot` | Auto-snapshot | `medirus snapshot nichxbt -i 60` |
| `audience` | Follower overlap | `medirus audience user1 user2` |
| `evergreen` | Recycle top content | `medirus evergreen nichxbt` |
| `crm sync` | Sync followers to CRM | `medirus crm sync nichxbt` |
| `crm tag` | Tag contact | `medirus crm tag user vip` |
| `crm search` | Search contacts | `medirus crm search "ai"` |
| `crm score` | Auto-score contacts | `medirus crm score` |
| `crm segment` | Get segment | `medirus crm segment influencers` |
| `schedule add` | Add scheduled job | `medirus schedule add job "0 9 * * *" -c "..."` |
| `schedule list` | List jobs | `medirus schedule list` |
| `schedule remove` | Remove job | `medirus schedule remove <name>` |
| `schedule run` | Run job now | `medirus schedule run <name>` |
| `rss add` | Add RSS feed | `medirus rss add tech https://...` |
| `rss list` | List feeds | `medirus rss list` |
| `rss check` | Check for new items | `medirus rss check` |
| `rss drafts` | View draft posts | `medirus rss drafts` |
| `notify test` | Test notification | `medirus notify test slack` |
| `notify send` | Send notification | `medirus notify send "Alert!"` |
| `notify configure` | Configure channels | `medirus notify configure` |
| `dataset list` | List datasets | `medirus dataset list` |
| `dataset export` | Export dataset | `medirus dataset export my-data -f csv` |
| `dataset delete` | Delete dataset | `medirus dataset delete my-data` |
| `team create` | Create team | `medirus team create "My Team"` |
| `team invite` | Invite member | `medirus team invite <id> user@email.com` |
| `team members` | List members | `medirus team members <id>` |
| `team activity` | Activity log | `medirus team activity <id>` |
| `bulk` | Bulk operations | `medirus bulk follow targets.csv` |
| `import` | Import data | `medirus import data.json --from apify` |
| `export-data` | Export to format | `medirus export-data data.json --to csv` |
| `convert` | Convert formats | `medirus convert data.json --to csv` |
| `mcp-config` | Generate MCP config | `medirus mcp-config -c claude --write` |
| `canary status` | Selector drift status | `medirus canary status --json` |
| `canary probe` | Run canary probe cycle | `medirus canary probe` |
| `canary heal` | GitOps selector healing | `medirus canary heal --platform twitter --preview` |

---

## Canary Commands (Epic 39)

Selector drift detection and GitOps healing. Targets are configured in `config/canary-targets.json` (`{ platform: [{ name, url, selectorChain, expectedShape }] }`). Healing is manual-trigger only — auto-heal on detection is prohibited (AD-44).

### medirus canary status

Display per-platform drift status from the rate governor (`platformDrift`): success rate, consecutive failures, last probe time, and last working selector.

```bash
medirus canary status
medirus canary status --json
```

### medirus canary probe

Run a single `SelectorCanary` probe cycle across all configured targets. Reports `successRate`, `drift`, and whether a fallback selector was used per platform.

```bash
medirus canary probe
medirus canary probe --json
```

### medirus canary heal

Heal drifted selectors via the GitOps pipeline (`SelectorCanary` → `AutoSelectorFallback` → `SelectorSandbox` → `CanaryHealer` → GitHub Draft PR). Never mutates selectors at runtime.

```bash
# Preview the unified-diff without creating anything
medirus canary heal --platform twitter --target twitter-profile --preview

# Create a GitHub Draft PR (branch canary-heal/<platform>-<target>-<ts>)
medirus canary heal --platform twitter

# Heal every target for a platform
medirus canary heal --platform facebook

# Heal all configured targets
medirus canary heal

# Write a patch file instead of a PR
medirus canary heal --output fix.patch

# Structured JSON output
medirus canary heal --json
```

| Option | Description |
|--------|-------------|
| `--platform <platform>` | Platform to heal (`twitter`, `facebook`, `youtube`, `threads`) |
| `--target <target>` | Target name inside the platform (e.g. `twitter-profile`); requires `--platform` |
| `--preview` | Print the diff to stdout, do not create a PR |
| `--output <path>` | Write a patch file instead of creating a PR |
| `--json` | Emit structured JSON results |

Result statuses: `preview`, `draft-pr`, `patch-file`, `no-candidates` (an issue is filed automatically when no validated replacement is found), `error`.

---

## License

Apache 2.0 License - see [LICENSE](../LICENSE) for details.

---

<p align="center">
  <strong>⚡ Medirus</strong><br>
  Built by <a href="https://x.com/nichxbt">nich (@nichxbt)</a><br>
  <a href="https://medirus.online">https://medirus.online</a>
</p>
