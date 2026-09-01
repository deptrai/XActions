---
status: draft
created: 2026-09-01
author: Sally (UX Designer)
scope: /platforms/:platform — Universal platform automation page
supersedes: dashboard/facebook.html (legacy grid layout)
---

# UX Spec — Universal Platform Page Redesign

## 1. Purpose

Redesign the platform-specific automation page so one URL (`/platforms/:platform`) serves Facebook, X/Twitter, Threads, TikTok, Bluesky, and Mastodon with a unified, balanced, and optimized UI.

The current mockup suffers from:
- Visual imbalance (heavy sidebar, detached account selector, weak tab affordance)
- Information overload (six action cards visible at once)
- No clear hierarchy between source, action, and output
- Weak feedback loop (dry-run state unclear, results not inline)
- Poor scalability (adding a new action breaks the grid)

## 2. Design Principles

1. **One screen, one intent** — each tab has a single purpose.
2. **Progressive disclosure** — only one action form is expanded at a time.
3. **Source → Action → Output** — every card follows the same three-zone structure.
4. **Global dry-run as safety default** — every run starts in preview mode.
5. **Universal by default** — platform is detected from URL; layout and available tabs adapt automatically.

## 3. Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚡ XActions                                                        │
├────────┬────────────────────────────────────────────────────────────┤
│        │  [Platform badge] Platform Automation   [🛡️ Dry-run]      │
│        │  Account: [▼ Sang-Test    ] [+ Add]  🟢 Active · 2m ago    │
│        ├────────────────────────────────────────────────────────────┤
│        │  [Actions] [Growth] [Scrape] [Monitor]                     │
│        │  ───════════════════════════════════════════════════════   │
│        │                                                            │
│        │  ┌─ Quick Actions ──────────────────────────────────────┐  │
│        │  │ [👍 Like] [💬 Comment] [📝 Post] [🔗 Share] [💌 Msg]│  │
│        │  └───────────────────────────────────────────────────────┘  │
│        │                                                            │
│        │  ┌─ Active Action: 👍 Like Posts ────────────────────────┐  │
│        │  │ Post URLs                                     3 URLs  │  │
│        │  │ ┌─────────────────────────────────────────────────┐   │  │
│        │  │ │ https://...                                     │   │  │
│        │  │ └─────────────────────────────────────────────────┘   │  │
│        │  │ Max batch: [20 ▼]    Delay: [2s ▼]                  │  │
│        │  │ [▶ Preview]                                       │  │
│        │  │ ┌─ Result ───────────────────────────────────────┐  │  │
│        │  │ │ 🛡️ Preview: 3 posts will be liked              │  │  │
│        │  │ └──────────────────────────────────────────────────┘  │  │
│        │  └────────────────────────────────────────────────────────┘  │
│        │                                                            │
└────────┴────────────────────────────────────────────────────────────┘
```

## 4. Component Spec

### 4.1 Platform Badge
- Slug resolved from URL query `?platform=`. Supported: `facebook`, `x`, `threads`, `tiktok`, `bluesky`, `mastodon`.
- Icon and color follow `DESIGN.md` platform tokens:
  - Facebook: `#1877f2`
  - X: `#000000`
  - Threads: `#000000` (light surface) or `#ffffff` (dark)
  - TikTok: `#ff0050` / `#00f2ea`
  - Bluesky: `#0066ff`
  - Mastodon: `#6364ff`

### 4.2 Account Bar
- Sticky below page header.
- Left: `Account:` dropdown + `+ Add` button.
- Right: status indicator (`🟢 Active`, `🟡 Hibernating`, `🔴 Expired`) + last verified timestamp.
- Disable all primary CTAs until an account is selected, except for open platforms (Bluesky, Mastodon) in Scrape/Monitor tabs.

### 4.3 Global Dry-run Toggle
- Default: **ON**.
- When ON: every primary button is `▶ Preview` with `dryrun` color (`#4285f4`).
- When OFF: every primary button is `⚡ Run Live` with `live` color (`#e65100`).
- First time user switches OFF in a session, show an inline confirmation banner: "Real actions will be performed. Continue? [Yes, run live] [Cancel]".

### 4.4 Tab Bar
- Four tabs: `Actions`, `Growth`, `Scrape`, `Monitor`.
- For open/federated platforms (Bluesky, Mastodon): only `Scrape` and `Monitor` are visible.
- Active tab has `primary` underline (`#1a73e8`), inactive uses `text-secondary`.
- Tab state persisted in URL hash: `#actions`, `#growth`, `#scrape`, `#monitor`.

### 4.5 Quick Action Template Bar
- Horizontal row of icon + label buttons.
- Selecting a template expands a single action card below the bar.
- Only one form is visible at a time, reducing cognitive load.
- On mobile: horizontal scroll or 2×3 grid.

### 4.6 Action Card (single expanded)
```
┌─────────────────────────────────────────────┐
│ [icon] Action Title              [? tooltip]│  ← Header
├─────────────────────────────────────────────┤
│ [input fields specific to action]           │  ← Body
│ [options: dry-run, max batch, delay]        │  ← Options
├─────────────────────────────────────────────┤
│ [▶ Preview]                                 │  ← Action
├─────────────────────────────────────────────┤
│ 🛡️ Result panel                             │  ← Output
└─────────────────────────────────────────────┘
```

### 4.7 Batch Input
- Textarea for URL lists.
- Live count badge (e.g., "3 URLs").
- Invalid URL highlighted inline with red border.
- Max batch dropdown: 5, 10, 20, 50.

### 4.8 Result Panel
- Inline below the primary button.
- Variants from `DESIGN.md`:
  - `dryrun`: `#e3f2fd` left border, `🛡️`
  - `success`: `#e8f5e9` left border, `✅`
  - `warning`: `#fff8e1` left border, `⚠️`
  - `error`: `#fbe9e7` left border, `❌`
- Collapsible "Raw JSON" section for technical users.
- `aria-live="polite"` so screen readers announce results.

## 5. Responsive

- **Desktop (>1024px):** sidebar 275px, content max 900px, right sidebar optional.
- **Tablet (768–1024px):** sidebar collapses to icon rail, content full width.
- **Mobile (<768px):** bottom tab bar, quick actions stacked or horizontally scrollable, cards single column.

## 6. Accessibility

- Keyboard tab order: account dropdown → dry-run toggle → tab bar → quick action → inputs → options → primary button → result panel.
- ARIA: `role="tablist"`, `aria-selected`, `aria-controls` for tabs; `aria-live="polite"` for result.
- Focus ring: `box-shadow: var(--ring)` from `common.css`.
- Never rely on color alone; pair status color with icon + text.

## 7. Platform Rules

| Platform | Account required | Tabs | Notes |
|---|---|---|---|
| facebook | yes | Actions, Growth, Scrape, Monitor | Cookie login (c_user, xs) |
| x | yes | Actions, Growth, Scrape, Monitor | Cookie or CDP attach |
| threads | yes | Actions, Growth, Scrape, Monitor | Meta auth |
| tiktok | yes | Actions, Growth, Scrape, Monitor | `a_bogus` signer bridge |
| bluesky | optional | Scrape, Monitor | Public AT Protocol; optional identifier/password |
| mastodon | optional | Scrape, Monitor | Public REST; requires instance + optional accessToken |

## 8. API Contract

- `GET /{platform}/accounts` — list saved accounts
- `POST /{platform}/accounts` — add account
- `POST /{platform}/automate` — run an automation action
- `POST /{platform}/scrape` — run a scrape action
- `GET /operations?platform={platform}&limit=20` — operation history for Monitor tab

## 9. Files to Change

1. `dashboard/platform.html` — new universal template.
2. `dashboard/_redirects` — add `/platforms/:platform /platform.html?platform=:platform 200`.
3. `dashboard/css/common.css` or new `dashboard/css/platform.css` — quick actions, account bar, and action card styles.
4. `dashboard/facebook.html` — keep as a legacy fallback or redirect to `/platforms/facebook`.
5. `dashboard/js/platform.js` (optional) — shared behavior for tab switching, account loading, and action dispatch.
