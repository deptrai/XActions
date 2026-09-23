# Obscura Release Watch & Promote Gate

> Track upstream Obscura issues that block `obscura-for-auth`. **Promote only after spike-verify — never auto-update.**

## Blocking issues (watch list)

| Issue | Status | Blocks |
|---|---|---|
| [#531](https://github.com/h4ckf0r0day/obscura/issues/531) — SPA hydration: module-eval timeout + V8 watchdog | open | post-auth `data-testid` mount |
| [#886](https://github.com/h4ckf0r0day/obscura/issues/886) — form submit emits no nav/network events | open | network-idle accuracy |
| [#643](https://github.com/h4ckf0r0day/obscura/issues/643) — fetch interception blocks subresources | open | `networkidle2` hang |
| [#683](https://github.com/h4ckf0r0day/obscura/issues/683) — navigate hangs on heavy JS | open | settle loop |
| [#817](https://github.com/h4ckf0r0day/obscura/issues/817) — micro-frontend shell never bootstraps | open | complex SPA |
| [#866](https://github.com/h4ckf0r0day/obscura/issues/866) — Google Maps SPA self-navigates + hangs | open | heavy SPA |
| #833/#838 — lifecycle events not emitted | ✅ closed | (fixed in 0.2.x) |

## Promote gate — `obscura-for-auth` opt-in

When a release lands that claims to fix hydration / networkidle:

1. Bump the Obscura binary; run `obscura serve --stealth`.
2. `BACKEND=both node scripts/obscura-spike.mjs` → all targets green.
3. **Auth-hydration check:** `x.com/home` (with a logged-in session) mounts `data-testid` — the current spike's `xcom-guest` is auth-walled, so add an authenticated probe before promoting.
4. If green → open a **change request** to enable `obscura-for-auth` as *opt-in* (never default). Human approve required.
5. Keep Chrome default regardless.

## Current verdict (2026-09-23, Obscura v0.2.3 audit)

- **Release status:** Obscura v0.2.3 was published on 2026-09-20 (bringing V8 150.4, Deno 0.412, and CDP bearer token authentication).
- **Blocking issues status:** All 6 key blocking issues remain **OPEN** upstream:
  - [#531](https://github.com/h4ckf0r0day/obscura/issues/531) (SPA hydration module-eval timeout): **OPEN** (still blocks post-auth `data-testid` mounting).
  - [#643](https://github.com/h4ckf0r0day/obscura/issues/643) (fetch interception subresource blocking): **OPEN** (still causes `networkidle2` hang).
  - [#886](https://github.com/h4ckf0r0day/obscura/issues/886), [#683](https://github.com/h4ckf0r0day/obscura/issues/683), [#817](https://github.com/h4ckf0r0day/obscura/issues/817), [#866](https://github.com/h4ckf0r0day/obscura/issues/866): all **OPEN**.
- **Action verdict:** Public scraping remains viable via `networkidle0`. Post-auth `obscura-for-auth` remains **BLOCKED**. Do NOT promote Obscura to handle authenticated sessions or replace Chrome as default. Keep Chrome / Chromium as the primary engine for authenticated workflows.
