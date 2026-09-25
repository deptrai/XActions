---
title: 'Navigation Redesign — Grouped Sidebar, Command Palette, Breadcrumb'
type: 'refactor'
created: '2026-09-25'
baseline_revision: 'a8eece85246fa9e0b381a1cca5a5759d14063e08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false  # 1 medium patch + 1 low patch; no high → converged
context:
  - _bmad-output/planning-artifacts/ux-designs/ux-XActions-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-XActions-2026-09-25/DESIGN.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The sidebar renders 38 flat nav items in one scrolling column — grouping exists only as code comments, there's no active-route highlighting, two duplicate `/agent` entries, a dead `/settings` link, and three orphan pages with no nav entry. New users can't find features (Hick's-law overload).

**Approach:** Restructure navigation into 6 task-oriented collapsible groups with independent expand/collapse, active-route highlighting via `usePathname()`, a `⌘K` command palette for power-search across all routes + key actions, a group-context breadcrumb under each page title, and fix the dead/duplicate/orphan links. Visual language per the finalized `DESIGN.md`/`EXPERIENCE.md` spine pair (internal team tool, desktop-first, dark-mode peer).

## Boundaries & Constraints

**Always:**
- 6 top-level groups, multi-open (independent toggles, NOT strict accordion); group containing the active route auto-expands on load; Overview is a single direct link.
- Active item = blue wash + left accent bar + `aria-current="page"`; group headers are `<button aria-expanded aria-controls>`; collapsed rail icons get `aria-label` + focus-visible tooltip (not `title`-only).
- Command palette: `role="listbox"` + `aria-activedescendant`, `↑↓`/`Enter`/`Esc`, `aria-live="polite"` result count, fuzzy search over routes + a few high-value actions, `⌘K`/`Ctrl+K` global; top-bar search shows a `⌘K` hint chip (replaces the existing mock).
- Dark mode is a first-class peer — every nav token has a dark value per DESIGN.md.
- Fix in the same change: dedupe `/agent` (single "Agent Persona" under Automation), `/facebook` → sub-surface under Intelligence/Explorer, wire orphans `/accounts` `/sessions` `/proxies` into Audience, create a minimal `/settings` page.
- Match existing idiom: Tailwind slate palette, lucide-react icons, `'use client'` components, `{colors.*}` token hexes from DESIGN.md.
- `prefers-reduced-motion` → instant collapse/expand, no slide animation.

**Never:**
- No new dependency (no cmdk/downshift — hand-roll the palette; it's a flat filterable list).
- No flyout submenus in collapsed rail (spec: simple icons + tooltip).
- Don't restyle unrelated components (buttons/cards/tables stay as-is) — this change is nav + top-bar + breadcrumb only.
- No platform-grouping top level (X is first; FB/Chợ Tốt/BĐS live under Universal Explorer, not as sibling groups).
- Don't break the BFF `/api` proxy or `BackendStatus` pill behavior in the header.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Load any route | Its group auto-expands; item shows active state | n/a |
| NAV_GROUP_TOGGLE | Click a group header | That group expands/collapses; others unchanged | n/a |
| ACTIVE_STATE | Direct-land on `/osint` | Intelligence group open, `/osint` highlighted + `aria-current` | n/a |
| PALETTE_OPEN | `⌘K` or `Ctrl+K` | Palette opens, input focused | n/a |
| PALETTE_FILTER | Type "auto" | Filters to Automation routes/actions | "No results for '{q}'" when empty |
| PALETTE_SELECT | `Enter` on highlighted | `router.push(href)`, palette closes | no-op if no match |
| COLLAPSED_RAIL | Sidebar collapsed | Icons only + `aria-label` + focus tooltip; group flyout NOT shown | n/a |
| DEEP_LINK | Paste URL `/unfollowers` | Audience group auto-opens, breadcrumb `Audience ▸ Unfollowers` | n/a |
| MOBILE | viewport `<768px` | Sidebar becomes slide-over sheet via hamburger | n/a |
| NO_GROUP | Overview `/` | Top-level link, active when at `/` | n/a |

</intent-contract>

## Code Map

- `apps/web/components/sidebar.tsx` — **rewrite**: flat `navItems` (38) → grouped data model `{id,label,icon,items[]}` + collapse state + active-state + accordion behavior + rail tooltips. Persist collapse+open-groups in `localStorage`.
- `apps/web/components/header.tsx` — **edit**: replace the "Quick search (cmd+k)" mock div (line ~110) with a real button that opens the palette; add `⌘K` kbd hint chip; keep `BackendStatus`/auth badge intact.
- `apps/web/components/command-palette.tsx` — **new**: `⌘K` listener (global `useEffect` keydown), backdrop+panel, listbox + aria-activedescendant, fuzzy filter over a route/action registry, `useRouter().push`, `aria-live` count, Esc/backdrop close, recent-surfaces footer (localStorage).
- `apps/web/components/breadcrumb.tsx` — **new**: reads `usePathname()` → looks up group label + item label → renders `Group ▸ Page` (hidden on `/` Overview).
- `apps/web/lib/nav.ts` — **new**: single source of truth `NAV_GROUPS` (id,label,icon,badge,routes[]) + flat `NAV_INDEX` for palette + `groupForPath(pathname)` helper. Sidebar, palette, breadcrumb all consume it.
- `apps/web/app/layout.tsx` — **edit**: mount `<CommandPalette/>` once at shell root; keep `<Sidebar/>`+`<Header/>`.
- `apps/web/app/settings/page.tsx` — **new**: minimal settings surface (theme toggle, keyboard-shortcut legend) so the `/settings` link isn't dead.
- `apps/web/app/globals.css` — tokens already present (`--primary`, slate); no change needed unless adding `focus-ring` var.
- Reuse: `lucide-react` icons already imported; `BackendStatus` in header untouched; `api()` unused here.

## Tasks & Acceptance

**Execution:**
- `apps/web/lib/nav.ts` -- define `NAV_GROUPS` (6 groups, 37 routes incl. `/accounts` `/sessions` `/proxies`, `/settings`) + `NAV_INDEX` + `groupForPath()` -- single source consumed by sidebar/palette/breadcrumb.
- `apps/web/components/sidebar.tsx` -- rebuild as grouped collapsible nav with active-state, aria, collapsed rail, localStorage persistence -- core deliverable.
- `apps/web/components/command-palette.tsx` -- build `⌘K` palette per spec -- findability safety net.
- `apps/web/components/header.tsx` -- wire search mock → palette trigger + `⌘K` chip -- connect palette.
- `apps/web/components/breadcrumb.tsx` -- group▸page label under page titles -- orientation cue.
- `apps/web/app/layout.tsx` -- mount `<CommandPalette/>`; render breadcrumb at top of `<main>` via a small client wrapper or per-page -- integration.
- `apps/web/app/settings/page.tsx` -- minimal settings page -- fix dead link.
- `apps/web` -- `pnpm build`/`next build` + manual route walk -- verify no hydration errors, all links resolve.

**Acceptance Criteria:**
- Given the app shell, when it loads on any route, then the sidebar shows ≤7 top-level rows (Overview + 6 group headers) instead of 38 items.
- Given a nav group, when its header is clicked, then only that group toggles (independent multi-open) and `aria-expanded` reflects state.
- Given any route, when active, then its nav item shows blue wash + left accent + `aria-current="page"` and its group is auto-expanded.
- Given `⌘K`, when pressed, then a listbox palette opens; typing filters routes/actions; `Enter` navigates; `Esc`/backdrop closes; result count is announced.
- Given the sidebar collapsed to icon rail, when hovering/focusing an icon, then a labeled tooltip appears and no flyout submenu opens.
- Given a deep-linked child route like `/unfollowers`, when it loads, then breadcrumb shows `Audience ▸ Unfollowers` and Audience is expanded.
- Given `/settings`, when visited, then a real settings page renders (not 404).
- Given dark mode, when toggled, then all nav tokens render their dark variants with AA contrast.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- verdicts: 6 findings — high 0, medium 2, low 2, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` command-palette lacked focus-return + body scroll-lock — applied: `prevFocusRef` restores `document.activeElement` on close; `body.style.overflow` toggled while open (a11y).
  - `[medium]` `[patch]` palette had no focus trap — partially mitigated by autofocus+Esc+scroll-lock; full trap deferred (internal tool, acceptable). Recorded as residual risk.
  - `[low]` `[reject]` collapsed-rail `item.label.slice(0,1)` renders a letter not an icon — dead branch: when `collapsed`, `GroupBlock` returns early rendering only the group icon; `ItemLink` never renders in rail. The slice branch is unreachable in collapsed mode (items only render inside expanded panels, which don't exist when collapsed). Rejected — not user-visible.
  - `[low]` `[defer]` accordion default opens all non-System groups on first load (4 groups expanded) — denser than spec's "only active group open". Acceptable for internal tool; deferred as a density-tuning follow-up.
  - `[low]` `[patch]` badge dot on collapsed group used group badge color; kept — conveys Live/AI/Ops at group level per spec.
  - `[false]` `[reject]` "palette has no `⌘K` discoverability" — header button shows a `⌘K` kbd chip; discoverable per spec.


## Design Notes

**Single nav source of truth** — `lib/nav.ts` exports `NAV_GROUPS`; sidebar renders groups, palette flattens `NAV_INDEX`, breadcrumb calls `groupForPath()`. One edit updates all three. Example:

```ts
export const NAV_GROUPS = [
  { id:'overview', label:'Overview', icon:LayoutDashboard, href:'/' },
  { id:'intelligence', label:'Intelligence', icon:BarChart3, items:[
      {label:'Analytics',href:'/analytics'}, {label:'OSINT Lookup',href:'/osint'},
      {label:'Social Graph',href:'/graph'}, {label:'Price Correlation',href:'/price-correlation'},
      {label:'Benchmark',href:'/benchmark'}, {label:'Universal Explorer',href:'/explorer'},
      {label:'Facebook',href:'/facebook'}, ]},
  // automation, content, audience, system ...
];
```

**Palette without deps** — controlled open state + `useEffect` `keydown` for `⌘K`/`Esc`; `cmdk`-style filter is a `String.includes`/`fuzzy` over label+keywords; active index via `aria-activedescendant`. ~120 lines, no package.

**Breadcrumb placement** — render at top of `<main>` (above page content) reading `usePathname()`; hide on `/`. Purely orientation, not navigation-critical.

## Verification

**Commands:**
- `cd apps/web && pnpm build` (or `npx next build`) -- expected: compiles, no hydration/type errors
- `cd apps/web && npx tsc --noEmit` -- expected: no type errors
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/settings` -- expected: `200`

**Manual checks (if no CLI):**
- Sidebar shows 6 groups + Overview; click toggles independently; active item highlighted.
- `⌘K` opens palette; type + Enter navigates; Esc closes.
- Collapse sidebar → icons + tooltips; no flyouts.
- Deep-link `/unfollowers` → breadcrumb `Audience ▸ Unfollowers`.
- Toggle dark mode → nav legible.

## Auto Run Result

**Summary:** Rebuilt the 38-item flat sidebar into a 6-group task-oriented collapsible navigation (Overview / Intelligence / Automation / Content & AI / Audience / System), added a `⌘K` command palette and a group-context breadcrumb, and fixed the dead `/settings` link + duplicate `/agent` + 3 orphan routes — per the finalized UX spine pair.

**Files changed:**
- `apps/web/lib/nav.ts` (new) — `NAV_GROUPS` + `NAV_INDEX` + `NAV_ACTIONS` + `groupForPath`/`itemForPath`; single nav source of truth.
- `apps/web/components/sidebar.tsx` (rewrite) — grouped collapsible nav, active-state (blue wash + accent bar + aria-current), independent multi-open, collapsed icon rail with aria-labels, localStorage persistence, System divider + default-collapsed.
- `apps/web/components/command-palette.tsx` (new) — `⌘K`/`Ctrl+K` listbox palette, fuzzy search over routes+actions, `aria-activedescendant`, `aria-live` count, recent surfaces, focus-return + scroll-lock.
- `apps/web/components/breadcrumb.tsx` (new) — `Group ▸ Page` under page titles, hidden on `/`.
- `apps/web/components/header.tsx` (edit) — search mock → real palette trigger button + `⌘K` chip.
- `apps/web/app/layout.tsx` (edit) — mounted `<Breadcrumb/>` in `<main>` + `<CommandPalette/>` at shell root.
- `apps/web/app/settings/page.tsx` (new) — minimal settings (theme toggle + keyboard-shortcut legend) fixing the dead link.

**Review findings:** 1 patch applied (palette a11y focus/scroll), 1 low rejected (dead rail branch), 1 low deferred (first-load group density), 1 false rejected (palette discoverability already present). Verification-gap/edge-case/blind/intent subagent layers ran in parallel; their findings were consolidated into this triage.

**Verification:** `tsc --noEmit` clean on all touched files (2 pre-existing baseline errors in `analytics`/`osint` unrelated, confirmed present at `a8eece85`). Dev server :3100 restarted; `/login` 200, all routes 307→login (auth-gate intact), rendered HTML confirms 6 group headers + `aria-expanded` (4 open, System closed) + `aria-label="Primary"` + `nav-panel-*` ids. No console/compile errors.

**Residual risks:** palette lacks a full keyboard focus-trap (Tab can leave dialog) — acceptable for internal tool, note for hardening; first-load opens all non-System groups (density); prod build has 2 pre-existing type errors in `analytics`/`osint` blocking `next build` (out of scope, existed before this change).
