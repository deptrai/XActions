---
name: XActions
status: final
updated: 2026-09-25
description: Internal social-intelligence & automation dashboard for a small team. Next.js + Tailwind (slate palette), lucide icons, system font stack, light/dark. This DESIGN.md specifies the visual identity deltas only — everything unlisted inherits the existing Tailwind slate base.
colors:
  # Existing globals.css tokens (inherited). Brand layer below.
  primary: '#2563EB'          # blue-600 — brand, active nav, primary actions
  primary-foreground: '#FFFFFF'
  primary-dark: '#3B82F6'     # blue-500 dark-mode
  surface-sidebar: '#FFFFFF'
  surface-sidebar-dark: '#0F172A'   # slate-900
  surface-base: '#F8FAFC'           # slate-50
  surface-base-dark: '#090D16'
  card: '#FFFFFF'                   # globals.css --card (restated so refs resolve)
  card-dark: '#111827'              # globals.css --card dark
  focus-ring: '#2563EB'             # primary — visible on both themes
  focus-ring-dark: '#3B82F6'
  nav-group-label: '#94A3B8'        # slate-400 — collapsed group captions
  nav-item-active-bg: '#EFF6FF'     # blue-50  — active item wash
  nav-item-active-bg-dark: '#1E3A8A33' # blue-900/20 dark
  nav-item-active-text: '#1D4ED8'   # blue-700 — on blue-50 ≥4.5:1 (AA)
  nav-item-active-text-dark: '#BFDBFE' # blue-200 — on blue-900/20 over slate-900 (verified AA)
  badge-live: '#10B981'      # emerald-500 — Live status
  badge-live-dark: '#34D399' # emerald-400 — on slate-900
  badge-ai: '#8B5CF6'        # violet-500 — AI feature
  badge-ai-dark: '#A78BFA'   # violet-400
  badge-ops: '#F59E0B'       # amber-500 — Ops/dev tooling
  badge-ops-dark: '#FBBF24'  # amber-400
typography:
  # System font stack inherited from globals.css — no web-font override.
  body:   { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }
  nav-item: { fontSize: 13px, fontWeight: '500', lineHeight: '1.4' }
  nav-group-label: { fontSize: 11px, fontWeight: '600', letterSpacing: '0.08em' }
  page-title: { fontSize: 22px, fontWeight: '700', lineHeight: '1.25', letterSpacing: '-0.01em' }
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  nav-item-y: 6px        # py-1.5 — tighter than current py-2.5; density for 30+ items
  nav-group-gap: 16px    # space between collapsible groups
  sidebar-w: 256px       # w-64 expanded
  sidebar-w-collapsed: 64px  # w-16 icon rail
components:
  nav-group:
    label-color: '{colors.nav-group-label}'
    label-case: 'uppercase'
    chevron: 'right-side, rotates 90deg on expand'
  top-bar:
    background: '{colors.card}'
    note: 'inherits existing header idiom; hosts ⌘K hint chip, backend-status pill, theme, account'
  backend-status-pill:
    note: 'inherits existing idiom; green/degraded/red dot + label'
  sidebar-collapse:
    note: 'inherits existing idiom; chevron button in sidebar footer'
  nav-item:
    radius: '{rounded.md}'
    active-bg: '{colors.nav-item-active-bg}'
    active-bg-dark: '{colors.nav-item-active-bg-dark}'
    active-text: '{colors.nav-item-active-text}'
    active-text-dark: '{colors.nav-item-active-text-dark}'
    inactive-text: 'slate-600 / slate-300(dark)'
    hover-bg: 'slate-100 / slate-800(dark)'
  command-palette:
    backdrop: 'slate-900/50 backdrop-blur'
    panel-bg: '{colors.card}'
    result-active-bg: '{colors.primary}'
    result-active-fg: '{colors.primary-foreground}'
---

## Brand & Style

XActions is an **internal intelligence-and-automation workbench** for a small team — not a consumer SaaS. The visual posture is *calm engineering console*: dense, legible, low-chrome, dark-mode-first-tolerant. The interface's job is to get out of the way of ~30 power features; ornament is a bug. The one brand color is **Electric Blue (`#2563EB`)** — used for primary actions and the *active navigation state*. Everything else is the neutral slate surface that lets badges and live-data do the talking.

The product already runs Tailwind's slate palette with light/dark and a system font stack. This DESIGN.md specifies only the **navigation + layout brand layer**; it does not restyle every component. Buttons, cards, inputs, tables inherit existing Tailwind/shadcn-idiom styles.

## Colors

Two functional accent families on a neutral slate base:

- **Electric Blue (`primary`)** — brand + wayfinding. Active nav items, primary buttons, links, focus rings. The single most important job of blue is *"you are here."*
- **Semantic badges** — `Live` (emerald) = streaming/realtime surface; `AI` (violet) = LLM-backed feature; `Ops` (amber) = developer/ops tooling. Badges are the *only* color-coding; they carry meaning, never decoration.
- **Slate neutrals** — background/sidebar/borders/muted. Dark mode is a first-class peer, not an inversion; every nav token has an explicit `-dark` value.

Avoid: gradients, more than one brand hue, coloring nav items by destination category (color means *state*, not *type*), colored page backgrounds.

## Typography

System font stack throughout — no web fonts; legibility and zero-cost load beat brand type. Three roles matter:

- **`page-title`** 22px/700 — top of each surface, sentence-case.
- **`nav-item`** 13px/500 — compact; ~30 features must stay scannable.
- **`nav-group-label`** 11px/600 uppercase +8% tracking — the collapsible group captions; small enough to recede, distinct enough to orient.

## Layout & Spacing

Desktop web primary. Three zones: **icon rail / sidebar** (left), **top bar** (status, search, theme, account), **content canvas** (scrollable, `p-6`).

- Sidebar expanded `w-64`; collapsed `w-16` icon rail. Tailwind 4-pt spacing scale; nav items tightened to `py-1.5` (density matters at 30 items).
- Content `max-w-none` — data-dense tables and graphs need the full canvas; no artificial reading column.
- Responsive floor: `<md` (768px) the sidebar becomes a slide-over `Sheet`; hamburger in top bar. Mobile is usable, not optimized — internal tool.

## Elevation & Depth

Flat surfaces; depth only on overlays (command palette, sheets, dropdowns) via `shadow-lg` + `backdrop-blur`. No elevation as hierarchy — the slate tonal scale does that work.

## Shapes

`rounded-md` (8px) is the workhorse — cards, nav items, buttons, inputs. `rounded-lg` (12px) for dialogs/palette. `rounded-full` only for badges and avatars. Sharper than consumer apps, softer than a terminal.

## Components

Visual specs for the redesign surface — nav-group, nav-item, command-palette (see frontmatter). All other components inherit the existing codebase idiom.

## Do's and Don'ts

**Do** — one blue accent; badges only for Live/AI/Ops; explicit dark tokens; dense scannable nav; keyboard affordances (`⌘K`) visible in top bar.

**Don't** — color nav by category; add gradients/shadows for decoration; a second brand hue; hide the active state; sacrifice density for whitespace on a 30-feature console.
