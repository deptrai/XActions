---
name: XActions
status: final
updated: 2026-09-25
product: XActions Dashboard
sources:
  - components/sidebar.tsx (audit)
---

# XActions — Experience Spine

> Internal social-intelligence & automation dashboard. Single-surface responsive web, desktop-first. Next.js 15 + Tailwind + lucide-react. `DESIGN.md` owns visual identity; this spine owns *how it works* — the information architecture, behaviors, states, and flows.

## Foundation

Desktop-web console for a small internal team (not SaaS). Left sidebar + top bar + scrollable canvas. Dark/light via `document.documentElement.classList` toggle in the header. Auth-gated — `/login` is the only public surface; every app surface sits behind the shell. The keyboard is a first-class input for power users (`⌘K`), the mouse is the default for everyone.

## Information Architecture

The 37 routes collapse into **6 task-oriented groups**. Grouping is by *what the user is trying to do*, not by platform — XActions is X-first; non-X scrapers live as sub-items under Intelligence → Universal Explorer.

| Group | Route(s) | Purpose |
|---|---|---|
| **Overview** | `/` | Dashboard home — health, quick stats, jump-points |
| **Intelligence** | `/analytics` `/osint` `/graph` `/price-correlation` `/benchmark` `/explorer` | Analysis & data. Universal Explorer = multi-platform scraper; `/facebook` lives here as a platform sub-surface of Explorer, not a separate top-level page. |
| **Automation** | `/workflows` `/automations` `/scheduler` `/calendar` `/run` `/a2a` `/agent` | Build & run automation — pipelines, schedules, A2A, and the Agent Persona builder. |
| **Content & AI** | `/thread-composer` `/thread` `/tweet-schedule` `/optimizer` `/viral-miner` `/ai` `/ai-api` `/playground` | Create + AI-assisted content, LLM tools |
| **Audience** | `/crm` `/unfollowers` `/accounts` `/sessions` `/proxies` `/platform` | Followers, accounts, sessions, platform connections |
| **System** (collapsed default) | `/monitor` `/status` `/security` `/mcp` `/jev-test` `/extension` `/api-docs` `/settings` | Ops, health, dev tools, config — nothing user-task-facing here |

**Sidebar behavior**
- 6 top-level group headers, each expandable. Groups toggle **independently** (multi-open, not strict accordion) — a flow may span groups without collapsing the one the user opened. On load, only the group containing the active route auto-expands; the rest stay collapsed.
- **Overview** is a direct link (no children).
- Each child page shows a small **group-context breadcrumb** under the page title (e.g. `Intelligence ▸ OSINT Lookup`) so a deep link or nav jump never strands the user.
- Badges roll up: a collapsed group shows a dot if any child is `Live`.
- Collapsed rail (`w-16`): top-level icons only + tooltip on hover — **no flyout submenus** (simple, per decision).
- `System` sits last, collapsed by default, visually separated by a divider — dev/ops tools out of the daily path.

**IA fixes baked in** — dedupe the two `/agent` entries (→ single "Agent Persona" under System); create `/settings` page or remove the dead link; wire orphans `/accounts` `/sessions` `/proxies` into Audience.

→ Composition reference: `mockups/sidebar-groups.html`, `mockups/command-palette.html`. Spine wins on conflict.

## Voice and Tone

Microcopy only. Brand voice lives in `DESIGN.md`.

| Do | Don't |
|---|---|
| "Search features… ⌘K" | "What would you like to do today?" |
| "3 automations running" | "You currently have 3 active automation processes." |
| "No results for '{q}'" | "We're sorry, we couldn't find anything!" |
| Group labels: "Intelligence" "Audience" | Jargon: "Data Plane" "Growth Ops" |
| Error: "Generation failed — backend offline" | "Oops! Something went wrong." |

Terse, technical, honest about failures. The team knows the tool; microcopy states facts, not cheer.

## Component Patterns

Behavioral. Visual specs in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| nav-group | Sidebar | Header is `<button aria-expanded aria-controls={panel-id}>`; click toggles expand/collapse (independent, multi-open); chevron rotates `aria-hidden`. Contains-active → auto-open on load. |
| nav-item | Sidebar | `usePathname()` → active state (blue wash + left accent bar), `aria-current="page"`. `target=_blank` only for `/api-docs`. |
| command-palette | Global `⌘K`/`Ctrl+K` | `role="listbox"` + `aria-activedescendant`; fuzzy-search all routes + high-value actions; `↑↓` navigate, `Enter` go, `Esc` close; result count announced via `aria-live="polite"`; footer shows recent surfaces. Top-bar search field shows a `⌘K` hint chip so it's discoverable. |
| sidebar-collapse | Sidebar footer | Toggle icon rail; state persists in `localStorage`. Collapsed icons carry `aria-label` + focus-visible tooltip (not `title`-only). |
| backend-status-pill | Top bar | Real `api/health` poll — green/degraded/red, `role="status"` so changes announce; click → `/status`. |

## State Patterns

| State | Treatment |
|---|---|
| Cold load | Sidebar skeleton groups; canvas shows `Skeleton` cards. |
| Backend offline | Top-bar pill red + toast "Backend offline — retrying"; nav still works (routes render error states). |
| Stale / degraded data | Live surfaces (Monitor, price-correlation): subtle "updated {time} ago" + amber dot when data is stale; manual refresh, no auto-reflow. |
| Permission denied | Internal tool — no per-user gating today; if a feature is ever gated, surface hides from its group (no "blocked" screen). |
| Palette loading | Command palette: input spinner + "Searching…" under 150ms debounce; never blocks typing. |
| Empty surface | `page-title` + one-line body + single primary action. No decorative empty art. |
| Command palette, no match | "No results for '{q}'" + 4 common commands. |
| Unknown route (404) | Keep shell; show "Not found" + link to Overview. |
| Group all-collapsed | Sidebar shows 6 group headers + Overview — 7 rows visible, scannable at a glance. |

## Interaction Primitives

**Keyboard** (power users):
- `⌘K` / `Ctrl+K` — command palette
- `g o` `g i` `g a` `g c` `g u` `g s` — jump to group (Overview/Intelligence/Automation/Content/Audience/System)
- `Esc` — close palette / collapse focused group
- `[` — toggle sidebar collapse

**Mouse:** click group to expand; click item to navigate; hover icon (collapsed rail) for tooltip. Hover-reveal avoids clutter — no hidden critical actions.

## Accessibility Floor

- Sidebar = `<nav>` with `aria-label="Primary"`; groups are `<button aria-expanded>` + `<ul>`.
- Active item: `aria-current="page"`. Chevron is decorative (`aria-hidden`).
- Full keyboard operability — every nav action reachable by Tab/Enter; `⌘K` doesn't require pointer.
- Focus ring visible on nav items; color contrast meets WCAG AA on both themes (blue-700 on blue-50 ≥ 4.5:1).
- `prefers-reduced-motion` → collapse/expand is instant, no slide animation.

## Key Flows

**Nam, automation engineer, morning stand-up prep.** Opens app → Overview. Clicks **Automation** group (expands) → **Scheduler** → sees the night's job failed → **Run Console** to re-trigger → toast "Job queued". 3 clicks, never scrolled the sidebar.

**Lan, analyst, hunting a profile.** `⌘K` → types "osint" → `Enter` → lands on OSINT Lookup → searches a handle → clicks through to **Social Graph**. Never touched the sidebar.

**Minh, ops on-call, alert ping.** Sidebar already on **System** (was collapsed) → red dot on group → expands → **Monitor** → sees live failure → **Status** for subsystem breakdown. Dev tools were out of the way until the moment they were needed.

**Hà, new team member, first session.** Opens app → sees 6 group headers, not 38 links. Reads group labels → opens **Audience** (the word maps to "followers" in her head) → finds **Follower CRM**. When unsure, she clicks the `⌘K` hint in the top bar and searches "unfollow". Wayfinding works even before she knows the IA.

---

## Open Items (for Finalize triage)

- `/settings` — create a real settings surface (theme, API keys, keyboard ref) **or** remove link. *[ASSUMPTION: create minimal page]*
- Non-X scrapers (FB/Chợ Tốt/BĐS) — confirm they surface under Universal Explorer rather than own top-level pages. *[ASSUMPTION: yes — single Explorer surface]*
- Command palette scope — routes only, or routes + actions (e.g., "run job")? *[ASSUMPTION: routes + a few high-value actions]*
