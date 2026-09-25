---
title: Pump.fun Frontend UX Design Specification
status: draft
author: Sally (UX Designer)
created: 2026-09-25
epic: 20
stories-covered: [20.5, 20.6, 20.7]
target-release: Story 20.8 (pumpfun-dashboard-integration)
---

# Pump.fun Dashboard — UX Design Specification

## 1. Bối cảnh & Mục tiêu

### 1.1 Bối cảnh
Backend pump.fun (Stories 20.5–20.7) đã hoàn chỉnh với **8 actions** có thể dispatch qua `scrape('pumpfun', <action>, options)` và route generic `POST /api/platform/pumpfun/scrape`. Tuy nhiên người dùng **không có cách nào chạm tới các tính năng này** — không trang dashboard, không nav entry, không card trên platform grid.

### 1.2 Mục tiêu UX
> "Một người dùng mở dashboard, nhìn thấy pump.fun như một platform đẳng cấp ngang X/Reddit, và trong ≤3 click chạy được một scrape trên mint address hoặc theo dõi livestream chat realtime."

### 1.3 Non-goals
- **Không** tái triển khai trading UI (buy/sell/bonding curve) — XActions là scraping/automation toolkit, không phải sàn giao dịch.
- **Không** tạo route backend mới nếu `POST /api/platform/pumpfun/scrape` đã đủ dùng.
- **Không** xây Solana wallet connect — auth xử lý qua Browser-as-Signer bridge (cookies/JWT từ session đăng nhập sẵn), không phải wallet adapter.

---

## 2. Persona & User Stories

**Persona chính:** "Meme-coin intel analyst" — người dùng theo dõi pump.fun launches, muốn capture chat sentiment + social signals trước khi token graduate.

| ID | User Story | Priority |
|----|-----------|----------|
| US-1 | Tôi muốn nhập mint address và thấy toàn bộ social context (replies, market cap, creator, live status) trong một màn hình | P0 |
| US-2 | Tôi muốn browse feed các coin đang live / graduating / new mà không cần biết mint trước | P0 |
| US-3 | Tôi muốn theo dõi chat livestream realtime trong 30–120s để cảm nhận sentiment, rồi export kết quả | P0 |
| US-4 | Tôi muốn resolve một username pump.fun → ví Solana để enrich CRM/lead lists | P1 |
| US-5 | Khi đã có session đăng nhập, tôi muốn xem profile của tôi + following list + KOL list | P1 |
| US-6 | Tôi muốn post một reply vào mint comment thread từ dashboard (có cảnh báo rate-limit rõ ràng) | P1 |
| US-7 | Tôi muốn xem clips/HLS metadata của một livestream để review lại | P2 |

---

## 3. Information Architecture

### 3.1 Navigation
Thêm **1 nav item** vào group `Intelligence` trong `apps/web/lib/nav.ts`, ngay sau `Facebook`:

```ts
{ label: 'Pump.fun', href: '/pumpfun', keywords: ['meme', 'solana', 'livestream', 'crypto', 'mint'] },
```

Lý do đặt trong Intelligence thay vì Audience/Automation: toàn bộ actions pump.fun hiện tại là **read-scrape + monitor** (chỉ `post_mint_reply` là write). Nhóm Intelligence chứa các tool "quan sát & phân tích" — khớp mental model.

### 3.2 Route map

| Route | Mục đích | Data |
|---|---|---|
| `/pumpfun` | Hub — tab container 4 chế độ | — |
| `/pumpfun?tab=mint` | Mint intelligence (US-1) | `fetch_mint_social` |
| `/pumpfun?tab=feed` | Platform feed browser (US-2) | `fetch_platform_feed` |
| `/pumpfun?tab=live` | Livestream chat monitor (US-3) | `stream_mint_chat` |
| `/pumpfun?tab=account` | Authenticated account tools (US-5, US-6) | `fetch_my_profile`, `fetch_user_following`, `post_mint_reply`, `fetch_livestream_clips` |

URL param `?tab=` giữ deep-linkable; default `tab=mint` (use-case phổ biến nhất).

### 3.3 Platform grid
Thêm vào `PLATFORM_META` (`api/routes/platforms.js`):

```js
{ id: 'pumpfun', name: 'Pump.fun', icon: '🎰', features: ['Scraping', 'Livestreams', 'Chat Stream', 'Auth'] },
```

Và `apps/web/app/platform/page.tsx` seed list cùng entry. Status: `supported` (registry đã có descriptor).

---

## 4. Screen Specifications

### 4.0 Shared shell

```
┌─────────────────────────────────────────────────────────┐
│ [🎰 icon box] Pump.fun Intelligence           [Refresh] │
│ Meme-coin social signals, livestreams & chat monitor.   │
├─────────────────────────────────────────────────────────┤
│ Auth status banner (xem §4.5)                           │
├─────────────────────────────────────────────────────────┤
│ [ Mint ] [ Feed ] [ Live Chat ] [ Account ]             │  ← tabs
├─────────────────────────────────────────────────────────┤
│                  Tab content                            │
└─────────────────────────────────────────────────────────┘
```

Tab component reuse pattern của `platform/page.tsx` (segmented `bg-slate-100 dark:bg-slate-800` pills), KHÔNG dùng thư viện tabs mới.

### 4.1 Tab "Mint" — Mint Social Intelligence (US-1)

**Input row:**
```
┌─────────────────────────────────────────────────────┐
│ Mint address: [____________________________] [Fetch]│
│ placeholder: "So1111… or any pump.fun mint"         │
└─────────────────────────────────────────────────────┘
```

**Kết quả render 3 vùng:**

1. **Coin header card** — name, symbol, image thumbnail, creator address (mono, truncated 8+…+4, click-to-copy), `marketCapUsd` + `marketCapSol`, `athMarketCap`, `isLive` badge (pulse animation khi live), `replyCount`, `createdTimestamp`.
2. **Social links row** — twitter/telegram/website icon chips (từ `coinMeta.socialLinks`), external-link mở tab mới.
3. **Replies table** — top 20: cột `[user avatar initials | username | wallet(truncated) | text | timestamp]`. `wallet` click → copy full address. Empty state: "No replies yet — coin may be too new."

**Interaction chi tiết:**
- `Fetch` disabled khi input rỗng hoặc < 32 chars (mint Solana base58 ~32–44 chars — chỉ sanity-check length, không validate charset).
- Loading state: skeleton rows (3 hàng), nút biến spinner.
- Error mapping:
  - `XACT_4004` → inline warning "Mint not found on pump.fun" (amber banner).
  - `XACT_4029`/429 → "Rate limited — pump.fun allows ~40 req/min/IP. Retry in Xs" (đếm ngược).
  - Khác → generic red banner + error message.

### 4.2 Tab "Feed" — Platform Feed Browser (US-2)

```
┌────────────────────────────────────────────────────┐
│ Feed type: [Latest | Live Now | Graduating |       │
│             Market Cap | New]    Limit: [20] [Go]  │
├────────────────────────────────────────────────────┤
│ Grid of coin cards (3 cols desktop, 1 mobile):     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ 🖼 name   │ │ 🖼 name   │ │ 🖼 name   │            │
│ │ $SYMBOL  │ │ $SYMBOL  │ │ $SYMBOL  │            │
│ │ 🔴 LIVE  │ │ $45.2K   │ │ $12.1K   │            │
│ │ 👥 142   │ │ 💬 89    │ │ 💬 4     │            │
│ │ [View]   │ │ [View]   │ │ [View]   │            │
│ └──────────┘ └──────────┘ └──────────┘             │
└────────────────────────────────────────────────────┘
```

- `feedType` map: `latest`→`new`, `live`→`currently_live`, `graduating`, `marketcap`(top), `new`.
- "View" trên coin card → chuyển tab Mint + pre-fill mint address + auto-fetch (pass state qua URL param `?tab=mint&mint=<addr>`).
- Live badge `🔴 LIVE` + viewer count khi `isLive===true`.
- Pagination: nút "Load more" append (`offset += limit`).

### 4.3 Tab "Live Chat" — Realtime Monitor (US-3)

Đây là **feature khác biệt nhất** so với các platform page hiện có — cần spec kỹ:

```
┌─────────────────────────────────────────────────────┐
│ Mint: [____________] Duration: [30s▾] [Start] [Stop]│
├─────────────────────────────────────────────────────┤
│ ● Streaming… 47 messages · room mint=<short>        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 12:01:23  whale123: LFG 🚀🚀                    │ │
│ │ 12:01:24  anon44:   dev sold??                  │ │
│ │ 12:01:25  moonboi:  chart looks bullish af      │ │
│ │ …auto-scroll, max 200 buffered                   │ │
│ └─────────────────────────────────────────────────┘ │
│ [Export JSON] [Export CSV]     Buffer: 47 msgs      │
└─────────────────────────────────────────────────────┘
```

**Quan trọng — kiến trúc transport:**
`stream_mint_chat` hiện tại chạy bounded-duration (1–300s) trong crawler rồi trả `result.messages[]` — KHÔNG phải SSE stream tới browser. Để UX "live", có 2 lựa chọn:

- **Phương án A (khuyến nghị, zero backend change):** Poll-based progressive display. UI gọi `POST /api/platform/pumpfun/scrape { action: 'stream_mint_chat', mintAddress, durationMs: 30000 }`. Backend giữ socket 30s, trả full batch. UX hiển thị "Collecting messages for 30s…" với progress bar; sau khi resolve render bảng tin. Đơn giản, đúng contract hiện tại. **Trade-off:** không thấy tin nhắn từng giây — chỉ sau khi batch hoàn tất.
- **Phương án B (future):** SSE qua `redisPublisher` — crawler đã publish `stream:social:pumpfun:chat`. Cần route `/api/pumpfun/chat-stream` map redis pubsub → SSE (như `/api/a2a/stream`). **Đánh dấu P2**, ghi note trong spec nhưng không implement ở story này.

**Spec chọn A** với copy trung thực: "Chat collection runs for the selected duration, then displays the full capture." Thanh progress đếm ngược; khi xong hiển thị tổng `messageCount` + bảng tin có timestamps. `Stop` = AbortController cancel request (backend crawler có signal forwarding sẵn từ Story 20.6).

- Duration presets: 15s / 30s / 60s / 120s.
- Cap thông báo: "XActions caps at 5 concurrent chat streams" → nếu nhận `XACT_4291` hiển thị "Stream limit reached — wait for an active stream to finish."
- Export: `Export JSON`/`CSV` serialize `result.messages` (reuse `exportToJSON`/`exportToCSV` client-side helper nếu có, else inline Blob download).

### 4.4 Tab "Account" — Authenticated Tools (US-5/6/7)

**Auth status banner (hiển thị trên mọi tab):**

```
Khi chưa có session:
┌─────────────────────────────────────────────────────┐
│ ⚠️ No pump.fun session. Authenticated features      │
│ (profile, following, replies) need a session.       │
│ [How to connect] → mở docs modal                    │
└─────────────────────────────────────────────────────┘
Khi có session:
┌─────────────────────────────────────────────────────┐
│ ✅ Connected as me (5HY65…tfUK) · expires 12:40 UTC │
└─────────────────────────────────────────────────────┘
```

Detection: `POST /api/platform/pumpfun/scrape { action: 'fetch_my_profile' }` — nếu `XACT_4010` → chưa auth; nếu 200 → render profile chip.

**Sub-sections trong tab Account:**

1. **My Profile card** — avatar placeholder, username, wallet, `is_pump_user` badge, follower/following counts. Nút Fetch riêng.
2. **Following list** — input `userId` (default = my userId từ profile) → table username+wallet+avatar. `resolve_user_wallet` cũng nằm đây dạng "username → wallet" quick tool.
3. **Post reply** — form: mint, text, optional replyToId, optional mediaUrl. **Bắt buộc hiển thị warning card:** "Writes to pump.fun under your account. Rate limit: 5 comments/min." Confirm modal trước khi POST (modal chứa preview text + mint). Success → toast + link `pump.fun/coin/{mint}`.
4. **Livestream clips** — input mintOrWallet → list clips (title, duration, playback URL, thumbnail). Mỗi clip card có nút "Open" external link — không embed video player trong story này.

**Auth UX edge cases:**
- `XACT_4010` bất kỳ call nào → toàn tab Account disable inputs + banner đỏ "Session expired — refresh via Browser Bridge (see docs)".
- Nút "How to connect" mở modal giải thích ngắn: "XActions reuses your logged-in pump.fun browser session via CDP cookie extraction. Run `xactions pumpfun auth` hoặc dùng Browser Bridge." — link sang `/docs/pumpfun-auth` (sẽ tạo docs page trong story kèm theo).

### 4.5 Error & Empty States (global)

| Tình huống | UX |
|---|---|
| Chưa nhập mint | Nút Fetch disabled + hint dưới input |
| Mint invalid format | Inline đỏ "Mint must be 32–44 chars" |
| `XACT_4004` | Amber "Not found" |
| `XACT_4010` | Đỏ "Auth required/expired" + link Account tab |
| `XACT_4029` / 429 | Amber "Rate limited" + retry-after countdown |
| `XACT_4291` | Amber "5-stream cap" |
| `XACT_5000/5001` | Đỏ "pump.fun API/network error" + raw message collapse |
| Empty feed/replies/chat | Icon + "Nothing here yet" copy |

---

## 5. Visual & Component System

Tuân thủ `ux/DESIGN.md` tokens hiện có + chuẩn Tailwind slate/emerald của các page khác (`facebook/page.tsx`, `platform/page.tsx`). Quy ước riêng:

- **Platform icon:** 🎰 (slot machine — pump.fun brand). Icon box color: `bg-green-100 dark:bg-green-950/60 text-green-600` (pump.fun brand green `#83F3C0`-adjacent; dùng emerald/green Tailwind vì DESIGN.md chưa có accent-pumpfun → **thêm** `accent-pumpfun: "#83F3C0"` vào tokens).
- **Live badge:** `bg-red-100 text-red-600` + `animate-pulse` dot.
- **Mono fields** (mint, wallet): `font-mono text-xs` + copy button.
- **Currency:** `marketCapUsd` format `$XX.XK/M`; `marketCapSol` format `◎XX.X` (◎ symbol — không cần @solana/web3.js).
- Components tái dùng: cards + pills từ platform page; SSE/status chip pattern từ `a2a/page.tsx` nếu Phương án B được thực hiện sau.
- Lucide icons: `Coins` (mint tab), `Rss`/`Radio` (feed/live), `MessageSquare` (chat), `UserCircle` (account), `Copy`, `ExternalLink`, `Download`.

---

## 6. Data Contract (frontend ↔ backend)

Tất cả calls đi qua `api()` helper → `POST /api/platform/pumpfun/scrape` body `{ action, ...args }`.

| UI element | action | args | result shape (từ crawler) |
|---|---|---|---|
| Mint fetch | `fetch_mint_social` | `{ mintAddress }` | `{ coinMeta, replies[], summary }` |
| Feed | `fetch_platform_feed` | `{ feedType, limit, offset }` | `{ items: FeedItem[] }` (isLive, viewers, roomId, marketCapUsd, name, symbol, imageUrl, mint) |
| Chat | `stream_mint_chat` | `{ mintAddress, durationMs }` | `{ messages[], messageCount, mint }` |
| My profile | `fetch_my_profile` | `{}` | `{ username, address, userId, is_pump_user, ... }` |
| Following | `fetch_user_following` | `{ userId }` | `[{ username, address, ... }]` |
| Clips | `fetch_livestream_clips` | `{ mintOrWallet }` | `[{ id, title, playbackUrl, duration, ... }]` |
| Post reply | `post_mint_reply` | `{ mintAddress, text, replyToId?, mediaUrl? }` | `{ id, ... }` |
| User resolve | `resolve_user_wallet` | `{ username }` | `{ username, wallet, userId }` |

**Lưu ý:** `post_mint_reply` gọi qua route `/automate` (state-changing) thay vì `/scrape`? — Generic `/scrape` cũng dispatch được (descriptor không phân biệt), nhưng theo convention trong `platform.js`, `automate` route dùng cho state-changing. **Quyết định UX:** dùng `/api/platform/pumpfun/automate` cho `post_mint_reply` để giữ semantic sạch sẽ (giống `facebook.js` dispatch hybrid).

---

## 7. Acceptance Criteria (cho Dev story 20.8)

- [ ] AC1: Nav item "Pump.fun" xuất hiện trong Intelligence group, ⌘K search "pump"/"meme"/"solana" tìm được.
- [ ] AC2: `/pumpfun` render 4 tabs, URL `?tab=` deep-link hoạt động, `?tab=mint&mint=<addr>` auto-fetch.
- [ ] AC3: Platform grid `/platform` + API `/api/platforms` hiển thị pump.fun `supported`.
- [ ] AC4: Tab Mint fetch mint thật → hiển thị coinMeta + replies; 404/429/auth errors map đúng banner.
- [ ] AC5: Tab Feed chọn 5 feedTypes → grid render; "View" card → prefill Mint tab.
- [ ] AC6: Tab Live Chat chạy bounded collection với progress countdown; Stop abort request; export JSON/CSV hoạt động; `XACT_4291` hiển thị đúng.
- [ ] AC7: Tab Account detect auth state qua `fetch_my_profile`; unauth → banner + disable auth features.
- [ ] AC8: Post reply yêu cầu confirm modal + warning rate-limit; gọi `/automate` route.
- [ ] AC9: Không thêm dependency mới (không @solana/web3.js, không wallet adapter — đúng ADR).
- [ ] AC10: Mobile responsive: coin grid 1 cột, tabs scrollable ngang.

## 8. Out-of-scope / Future

- SSE realtime chat display (Phương án B — cần `/api/pumpfun/chat-stream` route map redis pubsub).
- Embedded HLS clip player.
- Bonding-curve chart / trade actions.
- Multi-account session picker (session-manager có nhiều `pumpfun:<accountId>` keys — UI chọn account).
- Docs page `/docs/pumpfun-auth` nội dung chi tiết (soạn trong story triển khai).

## 9. File-level Implementation Map

| File | Thay đổi |
|---|---|
| `apps/web/lib/nav.ts` | +1 NavItem trong `intelligence` group |
| `apps/web/app/pumpfun/page.tsx` | MỚI — ~450 LOC, 4 tabs |
| `apps/web/app/platform/page.tsx` | +1 entry trong `PLATFORMS` seed |
| `api/routes/platforms.js` | +1 entry trong `PLATFORM_META` |
| `_bmad-output/planning-artifacts/ux/DESIGN.md` | +`accent-pumpfun` token |
| `docs/` hoặc `dashboard/docs/` | `pumpfun-auth` docs stub (auth connect guide) |
