---
status: draft
updated: 2026-06-19
colors:
  primary: "#1a73e8"
  primary-hover: "#1557b0"
  secondary: "#f8f9fa"
  accent-facebook: "#1877f2"
  accent-twitter: "#000000"
  success: "#34a853"
  warning: "#f9ab00"
  error: "#ea4335"
  dryrun: "#4285f4"
  surface: "#ffffff"
  surface-alt: "#f8f9fa"
  border: "#e0e0e0"
  text-primary: "#202124"
  text-secondary: "#5f6368"
  text-muted: "#9aa0a6"
typography:
  family: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
  mono: "'JetBrains Mono', 'Fira Code', monospace"
  scale:
    h1: "1.75rem/2.25rem 600"
    h2: "1.25rem/1.75rem 600"
    h3: "1rem/1.5rem 600"
    body: "0.875rem/1.5rem 400"
    caption: "0.75rem/1rem 400"
    code: "0.8125rem/1.25rem 400"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  action-card:
    border: "1px solid {colors.border}"
    border-radius: "{rounded.md}"
    padding: "{spacing.lg}"
    shadow: "0 1px 3px rgba(0,0,0,0.08)"
    shadow-hover: "0 4px 12px rgba(0,0,0,0.12)"
  button-primary:
    bg: "{colors.primary}"
    color: "#ffffff"
    border-radius: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.lg}"
    font: "{typography.scale.body} 500"
  button-live:
    bg: "#e65100"
    color: "#ffffff"
    border-radius: "{rounded.sm}"
  button-preview:
    bg: "{colors.dryrun}"
    color: "#ffffff"
    border-radius: "{rounded.sm}"
  sidebar:
    width: "260px"
    bg: "{colors.surface}"
    border-right: "1px solid {colors.border}"
  tab-bar:
    border-bottom: "2px solid {colors.border}"
    active-border: "2px solid {colors.primary}"
    active-color: "{colors.primary}"
  result-panel:
    border-radius: "{rounded.md}"
    padding: "{spacing.md}"
    variants:
      success: "bg: #e8f5e9; border-left: 4px solid {colors.success}"
      warning: "bg: #fff8e1; border-left: 4px solid {colors.warning}"
      error: "bg: #fbe9e7; border-left: 4px solid {colors.error}"
      dryrun: "bg: #e3f2fd; border-left: 4px solid {colors.dryrun}"
  account-selector:
    border: "1px solid {colors.border}"
    border-radius: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  platform-badge:
    facebook: "bg: {colors.accent-facebook}; color: #fff; border-radius: {rounded.sm}"
    twitter: "bg: {colors.accent-twitter}; color: #fff; border-radius: {rounded.sm}"
---

# DESIGN.md — XActions Unified Dashboard

## Brand & Style

XActions is a developer/power-user tool for social media automation. The visual identity is:
- **Clean and functional** — no decorative elements, information density over whitespace
- **Trust through clarity** — dry-run indicators, clear status colors, explicit state labels
- **Platform-neutral** — unified layout that doesn't favor X or Facebook visually
- **Dark affordances** — action buttons and status indicators are the only saturated color; surfaces are neutral

The emoji system (`✅ ❌ ⚠️ 🛡️ 🚀`) is part of brand voice — retained in UI microcopy and log output.

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | #1a73e8 | Primary actions, active tabs, links |
| `accent-facebook` | #1877f2 | Facebook platform badge only |
| `accent-twitter` | #000000 | X/Twitter platform badge only |
| `success` | #34a853 | Completed operations, success results |
| `warning` | #f9ab00 | NFR-8 warnings, partial success |
| `error` | #ea4335 | Failed operations, validation errors |
| `dryrun` | #4285f4 | Dry-run indicators, preview results |
| `surface` | #ffffff | Card backgrounds, main content |
| `surface-alt` | #f8f9fa | Page background, sidebar |
| `border` | #e0e0e0 | Card borders, dividers |
| `text-primary` | #202124 | Headings, body text |
| `text-secondary` | #5f6368 | Descriptions, labels |

## Typography

- **Headings:** Inter 600 (1.75rem page title, 1.25rem section, 1rem card title)
- **Body:** Inter 400 0.875rem — compact for information density
- **Code/Results:** JetBrains Mono 0.8125rem — JSON results, URLs, technical output
- **No serif fonts anywhere** — developer tool aesthetic

## Layout & Spacing

- **Sidebar:** 260px fixed, collapses to icon-only at 1024px
- **Content area:** max-width 900px, centered with `{spacing.xl}` padding
- **Cards:** `{spacing.lg}` internal padding, `{spacing.md}` gap between cards
- **Tab content:** `{spacing.lg}` top padding below tab bar
- **Sections within tab:** `{spacing.xl}` between action cards

## Elevation & Depth

- **Flat by default** — cards use border, not shadow, at rest
- **Hover elevation** — `shadow-hover` on action cards (subtle lift)
- **Modal overlay** — backdrop `rgba(0,0,0,0.4)`, modal `shadow: 0 8px 24px rgba(0,0,0,0.2)`
- **No floating elements** — results inline, no popovers for data display

## Shapes

- **Cards:** `rounded.md` (10px) — visually grouped containers
- **Buttons:** `rounded.sm` (6px) — clearly interactive, not pill-shaped
- **Badges:** `rounded.full` (pill) — status indicators, platform labels
- **Inputs:** `rounded.sm` (6px) — matches buttons

## Components

### Action Card

The primary interaction unit. One card per automation feature.

```
┌─────────────────────────────────────────────────┐
│  [icon]  Action Title                    [?]    │  ← h3, text-primary
│  Brief description of what this does            │  ← body, text-secondary
│─────────────────────────────────────────────────│
│                                                 │
│  [Input fields — varies per action]             │
│                                                 │
│  ┌─ Options ───────────────────────────────┐   │
│  │ ☑ Dry-run    Max batch: [20]            │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [▶ Preview]  (button-preview)                  │  ← OR [⚡ Run Live] (button-live)
│                                                 │
│  ┌─ Result (dryrun variant) ───────────────┐   │
│  │ 🛡️ Preview: 3 posts will be liked      │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Platform Tab Bar

```
───[Actions]───[Growth]───[Scrape]───[Monitor]───
       ═══                                        ← active: primary underline
```

- Tabs use `text-secondary` default, `primary` + border-bottom when active
- No background color change — underline only (clean)

### Account Selector

```
┌───────────────────────────────────────────┐
│ 📘 Account: [▼ Sang-Test          ] [+]  │
│      Status: 🟢 Active                    │
└───────────────────────────────────────────┘
```

- Full-width bar above tab content
- Dropdown styled with `border`, `rounded.sm`
- "+" button: `primary` color, opens inline form

### Result Panel Variants

| Variant | Left border | Background | Icon |
|---------|-------------|------------|------|
| Success | `success` 4px | #e8f5e9 | ✅ |
| Warning | `warning` 4px | #fff8e1 | ⚠️ |
| Error | `error` 4px | #fbe9e7 | ❌ |
| Dry-run | `dryrun` 4px | #e3f2fd | 🛡️ |

### Sidebar Navigation

```
┌─────────────────────────┐
│ ⚡ XActions             │  ← brand, text-primary, h2
│─────────────────────────│
│ 🏠 Home                 │  ← nav items: icon + label
│ 📱 Platforms        ▾   │  ← expandable, bold when section active
│    𝕏 X/Twitter          │  ← indent, text-secondary
│    📘 Facebook           │  ← indent, primary when active
│ ⚙️ Automations          │
│ 📅 Scheduler            │
│ 📊 Analytics            │
│ 🤖 AI / MCP             │
│ 👥 Accounts             │
│ 📖 Docs                 │
│─────────────────────────│
│ [avatar] local_admin    │
│ @local_admin            │
└─────────────────────────┘
```

- Active item: `primary` text + light blue background (`#e8f3ff`)
- Hover: `surface-alt` background
- Icons: emoji (consistent with project voice)

## Do's and Don'ts

**Do:**
- Show operation result inline (below button, same card)
- Use dry-run as default state everywhere
- Show live count of items in batch inputs
- Keep all actions one-click away (no wizards, no multi-step)
- Use emoji for status (✅ ❌ ⚠️ 🛡️) — project brand voice

**Don't:**
- Don't use modals for results (inline always)
- Don't hide features behind hamburger menus on desktop
- Don't use different layouts for Facebook vs X (unified)
- Don't require cookie paste per-action (account selector handles it)
- Don't show raw JSON by default (structured result panel; JSON in collapsible "Raw" section)
