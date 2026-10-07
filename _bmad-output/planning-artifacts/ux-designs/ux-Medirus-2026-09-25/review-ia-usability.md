# IA & Usability Review — XActions UX Spine

## Overall verdict
The 6-group task-based IA is a clear, correct fix for the 38-item overload and matches how an internal team actually thinks about the work. Findability improves via groups + ⌘K. Residual risks: a few ambiguous placements (Explorer vs OSINT, agent under System, playground under Content), accordion one-open may annoy when a task spans groups, and deep-link/breadcrumb behavior is unspecified.

## Findings
- **[high]** Group-name learnability is untested: "Intelligence" vs "Audience" vs "Content & AI" overlap in a new user's mind (Analytics is in Intelligence but Follower CRM in Audience — a user hunting "stats about followers" could look in either). (EXPERIENCE §IA). *Fix:* add one-line group descriptors in EXPERIENCE; consider renaming "Intelligence"→"Analytics & Intel" or moving CRM-adjacent analytics nearer Audience; or accept ⌘K as the escape hatch and note it.
- **[medium]** Accordion (one-open) forces collapse of the working group when a flow crosses groups (e.g., Automation → Scheduler then Content → Tweet Schedule). (§Sidebar behavior). *Fix:* allow multi-open (independent toggles) OR keep accordion but never auto-collapse the group the user manually opened; spec which.
- **[medium]** `/agent` "Agent Persona" sits under System — but persona building is a *content/automation* task, not ops. Likely mis-grouped. *Fix:* move to Automation or Content & AI; System should hold only monitor/status/security/mcp/jev/extension/settings/api-docs.
- **[medium]** No breadcrumb or page-context on the canvas — with deep grouping, a child page (e.g. /osint) gives no "Intelligence ▸ OSINT" cue in the content area. *Fix:* add a small breadcrumb or group-context label under page-title.
- **[low]** Universal Explorer described as multi-platform scraper (X/FB/Chợ Tốt/BĐS) but there's also a standalone `/facebook` page in routes — reconcile: is /facebook a child of Explorer or separate? *Fix:* fold /facebook into Explorer or list it under Audience/Intelligence explicitly.
- **[low]** ⌘K is the findability safety net — good — but spec doesn't say it's discoverable (hint in top bar). *Fix:* add "⌘K" hint chip in top-bar search field.
- **[low]** No journey covers deep-linking to a child route (shared URL) — does its group auto-expand + scroll into view? *Fix:* one line in IA behavior.

## Mechanical notes
- IA table is clean and maps all 37 routes; the 3 open items (settings page, scraper grouping, palette scope) are the right residual decisions.
- Biggest correction: re-home `/agent` and reconcile `/facebook`; add breadcrumb + palette discoverability hint.
