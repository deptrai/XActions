# Sprint Change Proposal — Facebook Guest/Public Scrape Lane

- **Ngày:** 2026-10-06
- **Tác giả:** Correct Course workflow (BMAD), user: Luisphan
- **Phạm vi:** Minor → Moderate
- **Trạng thái:** Đã duyệt 4/4 proposals (incremental)

---

## 1. Issue Summary

**Trigger:** Người dùng yêu cầu "cào Facebook post không cần cookie" và muốn thêm module scraper mới dựa trên Facebook Embed Plugin (`plugins/post.php`).

**Vấn đề phát hiện qua live probe (2026-10-06):** Mọi đường HTTP thuần cookieless đã **chết** trên facebook.com:

| Phương pháp | Endpoint | Kết quả probe |
|---|---|---|
| Embed post | `plugins/post.php` | HTTP 400 |
| Embed page | `plugins/page.php` | HTTP 200 nhưng chỉ JS-bootloader shell, 0 post data inline |
| oEmbed | `plugins/post/oembed.json` | Error page (cần app token) |
| Social-bot UA | post permalink | HTTP 200 (328KB) React hydration shell — 0 `og:`/`"message"`/`"text"` |
| Browser UA thường | post permalink | HTTP 400 |
| `mbasic.facebook.com` | Page | HTTP 200 → login wall |

**Kết luận:** Cào Facebook không cookie **không thể** bằng `axios`+`cheerio`. Đường duy nhất còn lại là **browser DOM render** — và XActions đã build sẵn qua `fb-guest` trong Epic 13.

**Khám phá quan trọng:** capability đã tồn tại end-to-end:
- `api/services/facebookScrape.js:63` — "Public actions can omit authCookie entirely and run as guest"
- `crawler.js` — 13 action `requiresAuth:false` + DOM fallback (L1338/1502/2315/2580/2790)
- `client.js` — `guestTokenRing` (capacity 50), guest `lsd`/`jazoest`
- `base-crawler.js:646-658` — gating: auth-required action thiếu account → throw `PlatformError`

→ **Không cần module mới.** Thay đổi thực sự = *surfacing* lane guest (explicit flag + gating + anonymous-tier routing + contract tests).

## 2. Impact Analysis

- **Epic bị ảnh hưởng:** Epic 13 (Facebook hybrid, đã ship fb-guest) — chỉ bổ sung contract test; Epic 50 (Public Scrape Gateway) — thêm anonymous Facebook mapping.
- **Story mới:** 1 story "Facebook Guest/Public Scrape Lane — Explicit Surfacing" (thuộc Epic 50 hoặc epic hardening gần nhất).
- **PRD:** bổ sung FR nhỏ ghi nhận guest lane là public-scrape capability chính thức; **không** thay FR hiện có.
- **Architecture:** tôn trọng AD-20 (dual-pool isolation — guest lane ∈ anonymous/public pool, không đụng account pool) và FR-102 (Obscura cho public/guest scraping — guest lane là ứng viên backend `obscura`).
- **Không vô hiệu hoá epic nào; không cần rollback; không thêm dependency.**

## 3. Recommended Approach

**Direct Adjustment** — modify/add story trong plan hiện có (KHÔNG MVP review, KHÔNG rollback).

- Effort: **nhỏ** (~1 story). Phần nặng (DOM fallback, guest token ring) đã build.
- Risk: thấp. Rủi ro chính = silent-regression → giải quyết bằng contract test (Proposal 4).
- Timeline: không ảnh hưởng các epic đang chạy; có thể xếp làm story nhỏ trong Epic 50 hoặc sprint hardening.

## 4. Detailed Change Proposals

### P1 — Story mới (Epic 50)
Thêm story "Facebook Guest/Public Scrape Lane — Explicit Surfacing": cờ `auth:'guest'`, gate action `requiresAuth:false`, contract test, anonymous tier. (Đã approve.)

### P2 — Route contract `api/routes/facebook.js`
- Body mới: `auth?: 'auto' | 'guest'` (default `auto`).
- `auth='guest'` → bỏ qua `authCookie`/`accountIds`; chỉ cho phép guest-eligible action; auth-required → `400 { code:'FB_REQUIRES_AUTH' }`; `auth` lạ → `400`.
- `facebookScrape.js`: `auth==='guest'` → `resolved={}` (bỏ `resolveFacebookAuth`).

### P3 — Epic 50 anonymous mapping
- Anonymous caller (không Bearer) vào `POST /api/platform/facebook/scrape` + action guest-eligible → inject `auth:'guest'`; vào anonymous IP bucket (10/min mặc định).
- Anonymous caller vào action auth-required → `401/400 { code:'FB_REQUIRES_AUTH', suggestedAction }` — KHÔNG auto-pick stored account.
- Cần xác nhận trong gateway route hiện có (hook inject `auth` trước dispatch).

### P4 — Contract tests `tests/scrapers/social/facebook/guest-lane.contract.test.js`
- [A] Descriptor: mọi action `requiresAuth:false` đúng cờ; `requiresAuth:true` + thiếu account → `PlatformError`.
- [B] Service: `run('posts',{auth:'guest'})` không gọi `resolveFacebookAuth`, session không `accountId`, đi qua `scrapePagePostsViaBrowser`; `run('like',{auth:'guest'})` → reject.
- [C] Route (supertest): `auth:'guest'` → 200 guest; `auth:'bogus'` → 400; `auth:'guest'` + action auth-required → 400 `FB_REQUIRES_AUTH`; browserBridge absent → envelope lỗi rõ.
- Verify thực: `curl` với public page + `auth:"guest"` trên clean IP → `PostItem[]`.

## 5. Implementation Handoff

- **Scope:** Minor → Moderate.
- **Route to:** Developer agent (`bmad-build`) — implement P2–P4, cập nhật story P1 vào `epics.md`.
- **Deliverables:** diff `api/routes/facebook.js` + `api/services/facebookScrape.js` (+ gateway hook nếu cần), story mới trong `epics.md`, file test mới, kết quả curl verify.
- **Success criteria:** `auth:'guest'` trả public data không cần cookie; action auth-required bị reject rõ; 3 nhóm contract test pass; không regression test hiện có.

## Bằng chứng probe

Script probe tại `/tmp/test_fb_embed.sh`, `/tmp/test_fb_embed2.sh`, `/tmp/test_fb_og.sh`, `/tmp/inspect_fb_page.sh`, `/tmp/deep_fb_og.sh`, `/tmp/inspect_fb_og.sh`. Kết luận: mọi HTTP cookieless đã chết — chỉ browser DOM còn hoạt động.
