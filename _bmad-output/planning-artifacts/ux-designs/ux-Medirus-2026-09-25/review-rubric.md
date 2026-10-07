# Spine Pair Review — XActions

## Overall verdict
The spine pair is a usable, well-structured contract that solves the stated problem (38 flat nav → 6 task groups). Strongest on IA clarity, fixes, and interaction primitives; weakest on token completeness for dark-mode nav states and a few coverage gaps in component/state specs. Fixable before Finalize — no structural rework needed.

## 1. Flow coverage — adequate
Checked EXPERIENCE.md Key Flows against stated needs. Three named-protagonist flows present (Nam/Lan/Minh) with numbered steps and a climax; failure paths partially covered.
### Findings
- **[medium]** No journey covers the *first-run / wayfinding* case — the exact pain (new team member facing the nav) that motivated this redesign. Add a "first-session orientation" flow. (§Key Flows). *Fix:* add a 4th flow for a new user discovering a feature by group browsing.
- **[low]** No journey exercises the collapsed-rail or ⌘K error/empty path. (§Key Flows). *Fix:* one line noting palette empty-state lands in a flow.

## 2. Token completeness — adequate
DESIGN.md frontmatter tokens extracted; `{path.to.token}` refs checked.
### Findings
- **[high]** `command-palette` component references `{colors.card}` — but `card` is NOT defined in this DESIGN.md (it's in globals.css, not the frontmatter). Downstream resolver can't resolve it. (§components.command-palette). *Fix:* either add `card`/`card-dark` to colors frontmatter or mark `note: 'inherits globals.css --card'`.
- **[medium]** Badge colors (`badge-live/ai/ops`) have no `-dark` variants while every other nav token does. Dark-mode badge contrast unspecified. (§colors). *Fix:* add `badge-*-dark` tokens or a note that same hex works on dark.
- **[low]** `nav-item-active-bg-dark: '#1E3A8A33'` uses 8-digit hex (alpha) — valid CSS but confirm resolver passes it through as a color. *Fix:* keep, but note alpha-hex convention.

## 3. Component coverage — adequate
Component names cross-checked between DESIGN.Components and EXPERIENCE.Component Patterns.
### Findings
- **[medium]** `nav-group` is in DESIGN.Components but EXPERIENCE "Nav group header" row is the behavioral spec — names don't match exactly (`nav-group` vs `Nav group header`). (both). *Fix:* align component names verbatim.
- **[medium]** `Backend status pill`, `Sidebar collapse` appear in EXPERIENCE.Component Patterns but have no DESIGN.Components visual spec. (§Component Patterns). *Fix:* add minimal frontmatter entries or mark "inherits existing idiom".
- **[low]** Top bar / header referenced in IA but not listed as a component anywhere. *Fix:* add a `top-bar` row (even "inherits existing").

## 4. State coverage — adequate
Walked IA surfaces vs State Patterns table.
### Findings
- **[medium]** No `permission-denied` / role state — relevant if any feature is ever gated (admin/system). Currently "System" is collapsed-not-hidden, so consistent, but state isn't named. (§State Patterns). *Fix:* add a row stating internal-tool = no per-user gating, or add the state.
- **[low]** `Stale data` / partial-failure state for live surfaces (Monitor, price-correlation) not covered — only blanket "backend offline". *Fix:* one row for stale/degraded data.
- **[low]** `loading` for the command palette itself not stated. *Fix:* trivial line.

## 5. Visual reference coverage — adequate
`mockups/sidebar-groups.html` exists and is linked inline in IA; spines-win-on-conflict stated.
### Findings
- **[medium]** EXPERIENCE references `mockups/command-palette.html` — **file does not exist**. Only `sidebar-groups.html` was rendered. (§IA → composition reference). *Fix:* render command-palette mock or drop the reference.
- **[low]** No mock for collapsed-rail active state or group-open state beyond the single static mock. *Fix:* optional — mock is illustrative, spine is contract.

## 6. Bloat & overspecification — strong
Both spines are appropriately terse; tables used over prose; DESIGN carries editorial voice only where it should. No personas/FRs restated. No action.

## 7. Inheritance discipline — adequate
### Findings
- **[medium]** `sources:` lists `components/sidebar.tsx (audit)` — a file path, not a resolvable spec/PRD; verify intent (it's an audit, fine as provenance but not a "source" in the spec sense). (EXPERIENCE frontmatter). *Fix:* keep as provenance or move to a note.
- **[low]** Glossary consistent; token refs resolve except `{colors.card}` (noted above). Component names: minor mismatch (nav-group). No other broken cross-refs.

## 8. Shape fit — strong
DESIGN.md canonical order respected (Brand→Colors→Typography→Layout→Elevation→Shapes→Components→Do's/Don'ts). EXPERIENCE.md has all required defaults (Foundation, IA, Voice/Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) + a justified "Open Items" invention. No dropped defaults.

## Mechanical notes
- Frontmatter complete on both; DESIGN `status`/`updated` present, EXPERIENCE same.
- `{colors.card}` is the only unresolvable token ref.
- Component-name mismatch: `nav-group` (DESIGN) vs "Nav group header" (EXPERIENCE).
- Missing file: `mockups/command-palette.html` referenced but not rendered.
- 8-digit alpha hex in `nav-item-active-bg-dark` — valid, note convention.
