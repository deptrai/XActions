---
status: final
updated: 2026-08-26
sources:
  - dashboard/facebook.html (current Facebook UI)
  - dashboard/index.html (current X/Twitter dashboard)
  - api/services/facebookAutomation.js (all features)
  - api/routes/facebook.js (API surface)
---

# EXPERIENCE.md — XActions Unified Dashboard

## Foundation

- **Form-factor:** Web (desktop-first, responsive to tablet)
- **UI system:** Vanilla CSS with CSS custom properties (current stack — no framework dependency)
- **Visual identity:** See DESIGN.md
- **Platform scope:** X/Twitter, Facebook, Threads, TikTok, Bluesky, Mastodon, and other domains unified in one dashboard. Bluesky/Mastodon are open/federated social platforms with optional auth and read-only Scrape/Monitor tabs.

## Information Architecture

### Primary Navigation (Left Sidebar — persistent)

```
⚡ XActions (logo)
─────────────────
🏠 Home              → /
📱 Platforms          → /platforms (expanded below)
  ├─ 𝕏 X/Twitter     → /platforms/x
  ├─ 📘 Facebook     → /platforms/facebook
  ├─ 🧵 Threads      → /platforms/threads
  ├─ 🎵 TikTok       → /platforms/tiktok
  ├─ 🦋 Bluesky      → /platforms/bluesky
  └─ 🐘 Mastodon     → /platforms/mastodon
⚙️ Automations       → /automations
📅 Scheduler         → /scheduler
📊 Analytics         → /analytics
🤖 AI / MCP          → /mcp
👥 Accounts          → /accounts
📖 Docs              → /docs
─────────────────
[User avatar + name]
```

### Platform Pages — Unified Layout

Each platform page (`/platforms/facebook`, `/platforms/x`) shares identical layout:

```
┌─────────────────────────────────────────────────────┐
│ [Platform Icon] Facebook Automation                  │
│ Account: [dropdown: saved accounts] + [Add new]     │
├─────────────────────────────────────────────────────┤
│ Tabs: [Actions] [Growth] [Scrape] [Monitor]         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Tab content area                                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Facebook — Tab Structure

**Tab 1: Actions** (core social actions)
| Feature | UI Element | Status |
|---------|-----------|--------|
| Like posts | URL list + Run | ✅ exists |
| Comment on posts | URL list + text + Run | ✅ exists |
| Create post | Text + Run | ✅ exists |
| Share posts | URL list + Run | ❌ NEW |
| Messenger share | Recipients + links + message + Run | ✅ exists |
| Schedule post | Text + datetime picker + Run | ❌ NEW |

**Tab 2: Growth** (account growth automation)
| Feature | UI Element | Status |
|---------|-----------|--------|
| Send friend requests | Profile URL list + Run | ❌ NEW |
| Cancel friend requests | olderThanDays slider + Run | ❌ NEW |
| Join groups | Group URL list + Run | ❌ NEW |
| Post to groups | Group URL list + content + Run | ❌ NEW |
| Account warmup | Duration slider + reactions toggle + Run | ❌ NEW |
| View boost (scroll feed) | Target URL + duration + Run | ❌ NEW |

**Tab 3: Scrape** (read-only data extraction)
| Feature | UI Element | Status |
|---------|-----------|--------|
| Scrape profile | URL + Run | ✅ exists |
| Scrape posts | URL + Run | ✅ exists |
| Scrape followers | URL + Run | ✅ exists |
| Search posts | Query + Run | ✅ exists |
| Scrape group members | Group URL + Run | ❌ NEW |

**Tab 4: Monitor** (live status)
| Feature | UI Element | Status |
|---------|-----------|--------|
| Active operations | Live list with progress | ✅ partial |
| Operation history | Table with status/results | ❌ NEW |
| Account health | Session validity indicator | ❌ NEW |

## Voice and Tone

- **Microcopy:** Direct, action-oriented. "Run" not "Execute". "Like 3 posts" not "Perform like operations on 3 URLs".
- **Warnings:** Yellow banner, emoji prefix (⚠️). Non-dismissible for NFR-8 warnings.
- **Success:** Green toast, auto-dismiss 5s. "✅ Liked 3 posts (2.1s)"
- **Errors:** Red inline below the action button. Never modal. Show actionable fix.
- **Dry-run:** Blue info banner. "🛡️ Preview mode — no real actions. Uncheck to go live."

## Component Patterns

### Action Card (behavioral)

Every automation action follows identical pattern:

```
┌──────────────────────────────────────────┐
│ [Icon] Action Name           [?] tooltip │
├──────────────────────────────────────────┤
│                                          │
│  [Input fields specific to action]       │
│                                          │
│  ☑ Dry-run (preview only)               │
│                                          │
│  [▶ Run Action]  [result area below]    │
│                                          │
│  ┌─ Result ─────────────────────────┐   │
│  │ ✅ 3/3 succeeded (2.1s)          │   │
│  │ • post/123 — liked               │   │
│  │ • post/456 — liked               │   │
│  │ • post/789 — already liked       │   │
│  └───────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

**Behavioral rules:**
- Dry-run ON by default (always)
- Unchecking dry-run shows confirmation: "Real actions will be performed. Continue?"
- Button text changes: "▶ Preview" (dry-run) → "⚡ Run Live" (real)
- Button color changes: blue (dry-run) → orange (real)
- Results render inline below button (no modal, no page navigation)
- Progress spinner replaces button during execution
- Operation persisted to history on completion

### Account Selector (behavioral)

Top of each platform page:

```
┌──────────────────────────────────────────┐
│ Account: [▼ Sang-Test        ] [+ Add]  │
│ Status: 🟢 Active (last verified 2m ago) │
└──────────────────────────────────────────┘
```

- Dropdown lists saved accounts (from `/api/facebook/accounts`)
- "Add" opens inline form (label + c_user + xs)
- Selected account auto-fills cookie for all actions on page
- Status indicator polls session validity
- No need to copy/paste cookies into each action

### Batch Input (behavioral)

For actions that take URL lists:

```
┌──────────────────────────────────────────┐
│ Post URLs (one per line)          3 URLs │
│ ┌────────────────────────────────────┐   │
│ │ https://facebook.com/post/1        │   │
│ │ https://facebook.com/post/2        │   │
│ │ https://facebook.com/post/3        │   │
│ └────────────────────────────────────┘   │
│ Max batch: [20 ▼]                        │
└──────────────────────────────────────────┘
```

- Live count badge updates as user types
- Invalid URLs highlighted red inline
- Max batch dropdown (5/10/20/50)

## State Patterns

| State | Visual | Behavior |
|-------|--------|----------|
| Idle | Default card | Ready for input |
| Validating | Button shows spinner | Client-side validation |
| Running | Button replaced with progress bar | WebSocket updates |
| Success | Green result panel | Auto-scroll to result |
| Partial | Yellow result panel | Show succeeded + failed items |
| Failed | Red result panel | Show error + retry button |
| Dry-run result | Blue result panel | Show preview data |

## Interaction Primitives

- **Click to run:** Single button per action (no multi-step wizards)
- **Inline results:** Results appear below the action, no page navigation
- **Tab persistence:** Active tab remembered in URL hash (`#actions`, `#growth`, `#scrape`)
- **Account persistence:** Selected account saved in localStorage
- **Dry-run toggle:** Global per page (affects all actions) + per-action override

## Accessibility Floor

- All interactive elements keyboard-accessible (tab order: inputs → toggle → button)
- ARIA labels on all buttons and form controls
- Color not sole indicator (icons + text accompany status colors)
- Focus visible ring on all interactive elements
- Screen reader: results announced via `aria-live="polite"` region

## Key Flows

### Flow 1: Mai likes 5 posts on Facebook (first time)

Mai is a social media manager. She opens XActions for the first time to boost engagement on her client's posts.

1. Mai opens `/platforms/facebook` — sees empty account selector
2. Clicks "+ Add" — inline form appears (label, c_user, xs)
3. Copies cookies from DevTools, pastes, saves → account appears in dropdown ✅
4. Mai is now on "Actions" tab (default)
5. Pastes 5 post URLs into the Like action card
6. Dry-run is ON — clicks "▶ Preview" → sees 5 pending items in blue panel
7. **Climax:** Unchecks dry-run → confirmation appears → clicks "⚡ Run Live"
8. Progress bar fills → "✅ 5/5 liked (8.2s)" in green panel
9. Result shows each URL with status

### Flow 2: Thanh warms up a new account

Thanh manages 3 Facebook accounts. He wants to warm up a fresh one before running heavier automation.

1. Opens `/platforms/facebook` → selects "Account-3 (new)" from dropdown
2. Clicks "Growth" tab
3. Finds "Account Warmup" card — sees duration slider (default 120s) + reactions toggle (OFF)
4. Leaves reactions OFF (pure scroll), sets duration to 300s
5. Dry-run ON → clicks Preview → sees `{durationSeconds: 300, allowReactions: false}` preview
6. **Climax:** Unchecks dry-run → "⚡ Run Live" → progress bar with elapsed time
7. After 5min → "✅ Warmup complete (142 scrolls, 0 reactions)"

### Flow 3: Linh sends friend requests to group members

Linh wants to grow her network by connecting with people in a marketing group.

1. Opens `/platforms/facebook` → selects her account
2. "Scrape" tab → "Scrape Group Members" card → pastes group URL → Run
3. Gets list of 50 member profile URLs in result panel
4. Copies URLs → "Growth" tab → "Send Friend Requests" card → pastes
5. Dry-run → Preview shows 50 pending requests
6. **Climax:** Sets max batch to 10 (safety), unchecks dry-run → "⚡ Run Live"
7. Progress: "✅ 10/10 sent (62s)" — remaining 40 shown as "remaining: 40"

### Bluesky / Mastodon — Public Scrape Flow

1. Opens `/platforms/bluesky` → no account selector (public by default).
2. Optional auth section collapsible (identifier/password for Bluesky; accessToken + instance for Mastodon).
3. Tabs: `[Scrape] [Monitor]` only (no Actions/Growth because open platforms are read-only in this phase).
4. Scrape tab cards: `Search posts`, `Profile feed`, `Followers`, `Following`, `Hashtag`, `Trending` (Mastodon).
5. User enters a Bluesky handle or search query → Dry-run preview.
6. Result panel: posts/profiles with `bluesky` or `mastodon` platform badge.
7. User exports JSONL or streams to Redis.

### Flow 4: Operator uses `xactions admin` CLI

Hùng is an internal operator. He needs to monitor and control the scraper from a terminal without opening the web dashboard.

```
$ xactions admin --help
status      → governor, proxy, account, stream overview
proxies     → list / quarantine / release proxy
accounts    → list / wake / rotate account
checkpoints → list / resume / pause / retry
stream      → metrics / alerts / test
```

#### Wireframe 4a: `xactions admin status`

```
$ xactions admin status
Proxy pool:        12/15 healthy
Current req/s:     482
Redis consumer lag: 1,240
Throttle level:    2
Hibernating:       [fb:123 18m left]
```

#### Wireframe 4b: `xactions admin proxies`

```
$ xactions admin proxies list
proxy-1   healthy    203.0.113.5   expiry: 2026-08-27 02:00
proxy-2   quarantined  198.51.100.7  until: 2026-08-26 15:05

$ xactions admin proxy quarantine proxy-2
✅ proxy-2 quarantined for 5 minutes.

$ xactions admin proxy release proxy-2
✅ proxy-2 released.
```

#### Wireframe 4c: `xactions admin accounts`

```
$ xactions admin accounts list --platform facebook
fb:123    active      velocity: 12/min  proxy: proxy-1
fb:124    hibernating until 15:45       reason: bot_challenge

$ xactions admin account wake fb:124
✅ fb:124 woken.

$ xactions admin account rotate fb:124 facebook
✅ fb:124 rotated to fb:125.
```

#### Wireframe 4d: `xactions admin checkpoints`

```
$ xactions admin checkpoints list
twitter:search:ai   running   cursor: 2026-08-26T10:00:00Z
facebook:group:ml   failed    lastError: 429

$ xactions admin checkpoint retry facebook:group:ml
✅ facebook:group:ml retried, status: running.
```

#### Wireframe 4e: `xactions admin stream`

```
$ xactions admin stream metrics
pendingMessages: 1,240
lastAckTime:     12s
consumers:       3

$ xactions admin stream alerts
checkpoint: pendingMessages > 50,000
status:     OK

$ xactions admin stream test
✅ test alert fired to configured webhook.
```

## Responsive & Platform

- **Desktop (>1024px):** Full sidebar + content + optional right panel
- **Tablet (768-1024px):** Collapsible sidebar (hamburger) + full-width content
- **Mobile (<768px):** Bottom tab bar (Home/Platforms/Automations/Accounts) + stacked cards
- Facebook automation pages prioritize desktop (copy-paste URLs workflow)
