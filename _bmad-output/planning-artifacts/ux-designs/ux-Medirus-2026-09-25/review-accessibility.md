# Accessibility Review — XActions UX Spine

## Overall verdict
Accessibility Floor is present and hits the main beats (nav landmark, aria-expanded groups, aria-current, keyboard operability, reduced-motion). Gaps: focus-visible spec is assertive but unconstrained; collapsed-rail icon-only tooltips need an accessible-name rule; live status regions and ⌘K result announcements are underspecified; a few contrast claims are asserted but not token-verified for dark mode.

## Findings
- **[high]** Collapsed rail shows icon-only + `title` tooltip — `title` is unreliable for screen readers and never shows for keyboard/touch users. (EXPERIENCE §Sidebar). *Fix:* require `aria-label` on each rail icon + visible tooltip on focus, not just hover.
- **[high]** Command palette result list needs `role="listbox"` + `aria-activedescendant`, and result count must be announced (`role="status"`/`aria-live="polite"`). Not stated. (EXPERIENCE §Component Patterns/Accessibility). *Fix:* add the roles + live announcement to the palette row.
- **[medium]** Live status updates (Monitor, backend-status pill, toasts like "Job queued") must use `aria-live`/`role="status"` so screen readers announce them — currently only implied. *Fix:* state it in Accessibility Floor.
- **[medium]** Accordion "one group open" — moving focus is fine, but ensure expanding/collapsing doesn't move focus unexpectedly; chevron `aria-hidden` ✓ but group header needs `aria-controls`→panel id. *Fix:* add `aria-controls` to spec.
- **[medium]** Contrast: `nav-item-active-text` blue-700 on blue-50 asserted ≥4.5:1 — verify `nav-item-active-text-dark` blue-300 on `blue-900/20` overlay (alpha over slate-900) also meets AA; alpha backgrounds can fail. *Fix:* verify token pair or bump to blue-200.
- **[low]** `Esc` and `[` shortcuts and `g x` mnemonics: ensure they don't conflict with screen-reader/browse-mode keys; document a "keyboard shortcuts" help surface. *Fix:* note a `/` or `?` shortcuts legend.
- **[low]** Focus-visible ring color not tokenized — rely on blue `primary`; confirm visible on both themes. *Fix:* add `focus-ring` token.

## Mechanical notes
- Accessibility Floor exists and is above-average; needs the live-region + rail-label + palette-listbox rules to be testable.
- Verify the two active-state token pairs (light + dark) numerically before finalize.
