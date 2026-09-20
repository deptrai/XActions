---
title: "Implementation Readiness — Post-Retro Appended Stories"
date: 2026-09-19
gate: PASS
intent: readiness
scope: "Stories 41.3, 35.5, 13.11 (ready-for-dev) appended via Correct Course 2026-09-19"
---

# Implementation Readiness — Post-Retro Stories (41.3 / 35.5 / 13.11)

## Verdict: **PASS** (after 3 findings patched in-story)

Initial gate was **CONCERNS** — 3 findings found and **patched directly into the story files** on 2026-09-19.

## Findings (all resolved)

### 🔴 Finding 1 — RESOLVED (was blocker): Story 41.3 hid a breaking signature change
- **Where:** `src/mcp/entity-resolver.js:226` `resolveIdentities` + `:161` `scorePair` are **sync**; caller `src/mcp/osint-find-profiles.js:653` calls sync.
- **Issue:** pHash requires network fetch → must be async. Story originally only said "ensure awaited".
- **Fix applied:** AC-3 now explicitly documents the signature change; Dev Notes recommend the **preferred design** — keep `scorePair`/`resolveIdentities` sync, add `async prefetchAvatarHashes(profiles)` returning `Map<url,hash>` so only the entry point goes async; grep callers before commit.

### 🟡 Finding 2 — RESOLVED: Story 35.5 env credential contract was non-standard
- **Where:** story used `IG_TEST_*` env vars; client reads `session`/credentials object + `INSTAGRAM_*`/`INSTAGRAPI_*`/`PROXY_URL` env.
- **Fix applied:** Dev Notes now map env→credentials (`{sessionid,ds_user_id,csrftoken}` or `{username,password}`); verify script translates `IG_TEST_*` → client credentials; precedent `scripts/test-fb-*.mjs`.

### 🟡 Finding 3 — RESOLVED: Story 13.11 sort/condition param keys unmapped
- **Where:** `buildMarketplaceSearchUrl` params (`minPrice=`, `lat=`, `radius=`, `cursor=`) had no sort/condition keys.
- **Fix applied:** Dev Notes list expected param names (`sortBy=price_ascend|price_descend|creation_time_descend`, `itemCondition=new|used`) to verify via dryRun preview and add to the params array.

## Artifact Traceability (confirmed)

| Story | Epic heading | PRD FR | Architecture AD | sprint-status |
|---|---|---|---|---|
| 41.3 | epics.md:2340 | FR-109 | AD-46 | `41-3-...: ready-for-dev` |
| 35.5 | epics.md:2158 | FR-110 | — (verification) | `35-5-...: ready-for-dev` |
| 13.11 | epics.md:761 | FR-111 | — | `13-11-...: ready-for-dev` |

## Gated (not in scope of this gate)
13.12, 27.5, 33.3, 33.4 — `backlog-blocked`, pending activation conditions.

## Recommendation
Proceed — all 3 stories are now implementable without inventing unrecorded decisions.
