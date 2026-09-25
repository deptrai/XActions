---
title: 'Story 20.8 — PumpFun Dashboard Frontend (4-Tab Intelligence Page)'
type: 'feature'
created: '2026-09-25'
status: 'draft'
baseline_revision: 'd8ded361'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/planning-artifacts/ux-designs/ux-pumpfun-frontend-2026-09-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pumpfun-frontend-2026-09-25/wireframes/pumpfun-page.ascii.md
  - docs/architecture/adr-pumpfun-auth-and-dependencies.md
warnings: []
deferred:
  - 'SSE realtime chat qua redis pubsub → `/api/pumpfun/chat-stream` (Phương án B — future)'
  - 'Embedded HLS clip player'
  - 'Bonding-curve chart / trade actions'
  - 'Multi-account session picker UI'
---

<intent-contract>

## Intent

**Problem:** Backend pump.fun (Stories 20.5–20.7) đã hoàn chỉnh 8 actions dispatchable qua `scrape('pumpfun', …)` và route generic `POST /api/platform/pumpfun/scrape` — nhưng không có bất kỳ UI nào. Người dùng dashboard không thể chạm tới mint intelligence, feed browser, live chat monitor hay account tools mà không dùng CLI/MCP thủ công.

**Approach:** Xây một trang `/pumpfun` trong `apps/web` với 4 tabs (Mint / Feed / Live Chat / Account) gọi thẳng `POST /api/platform/pumpfun/scrape` (+ `/automate` cho write action), đăng ký pump.fun vào nav Intelligence group, platform grid card, và `PLATFORM_META`. Không tạo backend route mới.

## Boundaries & Constraints

**Always:**
- Tất cả calls đi qua `api()` helper (`apps/web/lib/api.ts`) → `POST /api/platform/pumpfun/scrape` hoặc `/automate`; KHÔNG fetch trực tiếp pump.fun từ browser.
- Tuân thủ DESIGN tokens hiện có (`_bmad-output/planning-artifacts/ux/DESIGN.md`) + thêm `accent-pumpfun: "#83F3C0"`.
- `post_mint_reply` (state-changing) gọi `/api/platform/pumpfun/automate`; mọi action còn lại qua `/scrape`.
- Tab state giữ trong URL `?tab=` (deep-linkable), `?mint=` auto-prefill + auto-fetch Mint tab.
- Auth detection qua `fetch_my_profile`: `XACT_4010` → banner ⚠ + lock auth-gated features; 200 → banner ✅ + profile chip.
- Error mapping chuẩn XACT_* → banner màu đúng spec UX §4.5.
- `stream_mint_chat` UI = Phương án A: bounded collection + progress countdown + render batch sau resolve; Stop = `AbortController.abort()`.

**Never:**
- Không thêm dependency mới: cấm `@solana/web3.js`, cấm wallet adapter (đúng ADR).
- Không tạo backend route `/api/pumpfun/*` mới — generic `/platform/:platform/scrape` đã đủ.
- Không embed trading UI (buy/sell/bonding-curve trade).
- Không hiển thị nhầm batch chat là "live stream" — copy phải ghi rõ "Collecting for Xs…".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| NAV_ITEM | nav.ts edit | "Pump.fun" trong Intelligence group, ⌘K searchable | — |
| GRID_CARD | `/api/platforms` GET | pumpfun `status: 'supported'` + card 🎰 trên `/platform` | — |
| MINT_FETCH | `{action:'fetch_mint_social', mintAddress}` | coinMeta card + replies table 20 rows | 4004→amber, 429→amber+countdown, 5000→đỏ |
| MINT_INVALID | mint <32 chars | Fetch disabled + inline hint | — |
| FEED_LOAD | `{action:'fetch_platform_feed', feedType, limit, offset}` | coin card grid + Load more append | upstream → đỏ banner |
| FEED_TO_MINT | click "View→" card | nav `/pumpfun?tab=mint&mint=<addr>` auto-fetch | — |
| CHAT_RUN | `{action:'stream_mint_chat', mintAddress, durationMs}` | progress countdown → messages table | 4291→amber cap, abort→cleanup |
| CHAT_EXPORT | click Export JSON/CSV | Blob download `result.messages` | — |
| AUTH_DETECT | `fetch_my_profile` on mount/Account tab | ✅ profile chip hoặc ⚠ no-session banner | 4010→banner+lock auth tools |
| FOLLOWING | `{action:'fetch_user_following', userId}` | table username+wallet | 4010→lock |
| RESOLVE_USER | `{action:'resolve_user_wallet', username}` | wallet ⧉copy | 404→"not found" |
| CLIPS | `{action:'fetch_livestream_clips', mintOrWallet}` | clip cards + Open↗ | 4010→lock |
| POST_REPLY | `{action:'post_mint_reply', mintAddress, text}` via `/automate` | confirm modal → toast + pump.fun link | 4010→lock, confirm required |
| DEEP_LINK | `/pumpfun?tab=mint&mint=X` | Mint tab + prefill + auto-fetch | — |

</intent-contract>

## Code Map

- `apps/web/app/pumpfun/page.tsx` — **MỚI** (~450 LOC, `'use client'`):
  - Shell: 🎰 icon box `bg-green-100`, title "Pump.fun Intelligence", auth banner, 4 pill tabs.
  - `TabMint`: mint input + Fetch → coinMeta card + social links chips + replies table.
  - `TabFeed`: feedType select + limit + Go → coin grid + Load more.
  - `TabLiveChat`: mint + duration presets + Start/Stop → progress countdown → messages table + Export.
  - `TabAccount`: My Profile card, Username→Wallet, Following list, Post Reply form (+confirm modal), Livestream Clips.
  - Shared: `useAuthSession()` hook (fetch_my_profile once), `ErrBanner` component (XACT_* mapping), `CopyField` (truncated ⧉copy).
- `apps/web/lib/nav.ts` — +NavItem `{ label:'Pump.fun', href:'/pumpfun', keywords:['meme','solana','livestream','crypto','mint'] }` trong `intelligence` sau `Facebook`.
- `apps/web/app/platform/page.tsx` — +PLATFORMS seed `{ id:'pumpfun', name:'Pump.fun', status:'supported', features:['Scraping','Livestreams','Chat Stream','Auth'], icon:'🎰' }`.
- `api/routes/platforms.js` — +PLATFORM_META entry tương ứng.
- `_bmad-output/planning-artifacts/ux/DESIGN.md` — +`accent-pumpfun: "#83F3C0"` vào colors.
- `dashboard/docs/pumpfun-auth.html` — **MỚI**: hướng dẫn Browser Bridge session connect.

## Tasks & Acceptance

**Execution:**
1. `api/routes/platforms.js` + `apps/web/app/platform/page.tsx` + `apps/web/lib/nav.ts` — đăng ký pumpfun (meta/grid/nav).
2. `apps/web/app/pumpfun/page.tsx` — shell + 4 tabs + auth hook + error banner.
3. `dashboard/docs/pumpfun-auth.html` — docs stub.
4. `DESIGN.md` — token accent-pumpfun.
5. Verify: `GET /api/platforms` shows pumpfun supported; `POST /api/platform/pumpfun/scrape {action:'fetch_platform_feed',feedType:'currently_live'}` 200.

**Acceptance Criteria:** (mirror epics.md 20.8)
- AC1: nav Pump.fun + ⌘K searchable (`pump`,`meme`,`solana`,`livestream`,`crypto`,`mint`).
- AC2: `/pumpfun` 4 tabs + `?tab=` deep-link + `?mint=` auto-fetch.
- AC3: platform grid + API trả `supported`.
- AC4: Mint fetch → coinMeta + replies; errors map đúng.
- AC5: Feed 5 feedTypes → grid; View→ prefill Mint.
- AC6: Live Chat bounded collect + countdown + Stop abort + Export + XACT_4291 banner.
- AC7: Account detect auth; unauth → banner + lock auth features (public tabs vẫn dùng).
- AC8: Post reply → confirm modal + `/automate` + toast + link.
- AC9: Không dependency mới.
- AC10: Mobile responsive.

## Verification

**Commands:**
- `cd apps/web && npx next build` (hoặc `npx tsc --noEmit`) — expected: no type errors.
- `curl -s http://localhost:3000/api/platforms | jq '.platforms[] | select(.id=="pumpfun")'` — expected: `status: "supported"` (qua BFF proxy → backend).
- `curl -s -X POST http://localhost:PORT/api/platform/pumpfun/scrape -H 'content-type: application/json' -d '{"action":"fetch_platform_feed","feedType":"currently_live","limit":3}'` — expected: `{ok:true, result:{items:[…]}}`.
- Manual: mở `/pumpfun`, 4 tabs hoạt động, `?tab=mint&mint=<real>` auto-fetch.
