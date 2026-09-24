---
title: 'Story 48.8 — Content & Media Screens (/thread, /thread-composer, /tweet-schedule, /video, /ai, /ai-api, /playground)'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/dashboard/thread.html'
  - '{project-root}/dashboard/thread-composer.html'
  - '{project-root}/dashboard/tweet-schedule.html'
  - '{project-root}/dashboard/video.html'
  - '{project-root}/dashboard/ai.html'
  - '{project-root}/dashboard/ai-api.html'
  - '{project-root}/dashboard/playground.html'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** Content creators need thread composer, video downloader, AI playground, and tweet scheduling in the new app.

**Approach:** 7 new pages:
- `/thread` — thread viewer/analytics (read thread data, engagement)
- `/thread-composer` — thread composer with drag-to-reorder, preview, char count
- `/tweet-schedule` — tweet scheduling form + scheduled list
- `/video` — video downloader (paste URL, select quality, download via BFF streaming)
- `/ai` — AI dashboard (model status, usage stats, recent generations)
- `/ai-api` — AI API explorer (endpoint list, request/response tester)
- `/playground` — AI playground (prompt input, model select, generation output)

`/video` uses BFF binary streaming for file download. `/playground` uses `/api/ai/generate`.

## Boundaries & Constraints

**Always:**
- `'use client'` components.
- `api()` helper — zero raw fetch.
- `/video` download uses `fetch` with `blob()` for binary streaming (exception: binary download, not JSON API).
- Dark mode aware.
- Sidebar nav items added.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No external editor lib (use textarea + preview).
- No payment flow changes (x402 modal stays as-is).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thread view | `api('GET','/api/threads')` | Thread list + engagement | Empty → "No threads" |
| Thread composer | `api('POST','/api/threads')` | Compose + preview + submit | Validation → char count warn |
| Tweet schedule | `api('GET','/api/scheduler/tweets')` | Scheduled list + form | Empty → "Schedule tweet" CTA |
| Video download | `fetch('/api/video/download')` blob | File download starts | Error → error message |
| AI dashboard | `api('GET','/api/ai/status')` | Model cards + stats | Offline → seeded data |
| AI API | `api('GET','/api/ai/endpoints')` | Endpoint list + tester | Error → error message |
| Playground | `api('POST','/api/ai/generate')` | Generated text output | Error → error message |

</intent-contract>

## Code Map

- `apps/web/app/thread/page.tsx` — NEW: thread viewer
- `apps/web/app/thread-composer/page.tsx` — NEW: thread composer
- `apps/web/app/tweet-schedule/page.tsx` — NEW: tweet scheduler
- `apps/web/app/video/page.tsx` — NEW: video downloader
- `apps/web/app/ai/page.tsx` — NEW: AI dashboard
- `apps/web/app/ai-api/page.tsx` — NEW: AI API explorer
- `apps/web/app/playground/page.tsx` — NEW: AI playground
- `apps/web/components/sidebar.tsx` — EDIT: add 7 nav items
- `tests/web/{thread,thread-composer,tweet-schedule,video,ai,ai-api,playground}.test.js` — NEW

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/app/thread/page.tsx`
- [ ] `apps/web/app/thread-composer/page.tsx`
- [ ] `apps/web/app/tweet-schedule/page.tsx`
- [ ] `apps/web/app/video/page.tsx` — blob download via BFF
- [ ] `apps/web/app/ai/page.tsx`
- [ ] `apps/web/app/ai-api/page.tsx`
- [ ] `apps/web/app/playground/page.tsx`
- [ ] `apps/web/components/sidebar.tsx` — add 7 nav items
- [ ] `tests/web/*.test.js`
- [ ] `npm run web:build` passes
- [ ] `vitest run tests/web/` all pass

**Acceptance Criteria:**
- Given `/thread`, when loaded, then thread list + engagement render
- Given `/thread-composer`, when loaded, then composer + preview render
- Given `/tweet-schedule`, when loaded, then schedule form + list render
- Given `/video`, when URL pasted + download clicked, then file download starts
- Given `/ai`, when loaded, then model status + stats render
- Given `/ai-api`, when loaded, then endpoint list + tester render
- Given `/playground`, when loaded, then prompt input + output render

## Spec Change Log

## Review Triage Log

## Auto Run Result

## Auto Run Result

**Status:** done
**Summary:** Implemented 7 content/media screens — `/thread` (thread list + status filter), `/thread-composer` (multi-tweet editor + preview + char count), `/tweet-schedule` (datetime picker + scheduled list), `/video` (URL input + quality select + blob download), `/ai` (model status cards + recent generations), `/ai-api` (endpoint explorer + live tester), `/playground` (prompt + model + temperature + generation history).

**Files changed:**
- `apps/web/app/{thread,thread-composer,tweet-schedule,video,ai,ai-api,playground}/page.tsx` *(new)*
- `tests/web/{thread,thread-composer,tweet-schedule,video,ai,ai-api,playground}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 35 routes, zero errors
- `npx vitest run tests/web/` — 25/25 new tests pass
