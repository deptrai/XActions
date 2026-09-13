---
title: "Sprint Change Proposal — Obscura Browser Backend (Public Scraping) + Watch/Promote"
date: 2026-09-13
author: Winston (System Architect)
scope: minor
status: proposed
---

# Sprint Change Proposal — Obscura Browser Backend

## 1. Issue Summary

**Trigger:** Spike `scripts/obscura-spike.mjs` chứng minh [Obscura](https://github.com/h4ckf0r0day/obscura) (browser engine Rust, CDP-compatible) tích hợp được vào XActions qua `puppeteer-core.connect`, nhưng có giới hạn kỹ thuật rõ ràng.

**Problem:** Obscura là engine **non-Chromium** tự render. Nó hydrate tốt form đăng nhập X (`/i/flow/login` render ngang Chrome: 4 inputs + `data-testid`), nhưng **không mount `data-testid` trên các trang SPA sau-auth** (`/explore`, `/home` trả body ~270KB nhưng testid rỗng — React hydration fail). Ngoài ra `waitUntil:'networkidle2'` **treo hoàn toàn** trên Obscura 0.2.2.

**Decision (kiến trúc):**
- **Obscura** = backend chỉ cho **scraping công khai** (profile/tweet/search guest-visible, không cần React hydration sau auth). Lợi: ~30MB RAM vs 200MB+, startup instant, anti-detect built-in.
- **Chrome** = giữ cho **automation sau-login** (post/like/DM — cần React mount đầy đủ).
- **Watch → Verify → Promote:** theo dõi issue Obscura; khi release fix hydration/networkidle2, chạy lại spike — chỉ promote khi `/home` mount `data-testid` xanh. **Không auto-update production.**

**Evidence:** login flow ngang Chrome; `/home` không hydrate; `networkidle2` timeout 15–30s, `networkidle0` OK ~76ms.

## 2. Impact Analysis

### Epic Impact
- **Story 12.2/12.3** (CDP Remote Attach, `launchBrowserWithCdp`, `cdp-launcher.js`): Medium — Obscura là CDP target; `resolveBrowserExecutablePath` mở rộng resolve `obscura` binary.
- **Epic 27** (FingerprintManager/stealth): Medium — backend option đã thêm vào `stealthBrowser.js`; verify `evaluateOnNewDocument` patch không xung đột stealth built-in của Obscura.
- **Epic 15/16/17/35** (Threads/TikTok/Shopee/Chotot/Reddit/Medium public scrapers): Medium — phạm vi Obscura phù hợp nhất, opt-in.
- **Automation sau-login (dmManager/postComposer/engagementManager):** **Giữ Chrome** — guard chặn backend obscura.
- **Story mới:** "Obscura Public-Scraping Backend & Watch" (AC bên dưới).

### Artifact Conflicts
- **PRD:** thêm FR-XX pluggable backend + NFR-XX (networkidle0-only). Không xung đột NFR11 (85% RAM reduction — Obscura củng cố).
- **Architecture spine (`xactions-hybrid-scraping-spine`, `epic35`, `facebook-gateway`):** khái niệm `transport`/`adapter` đã có (`'http'|'puppeteer'|'rss'`). Obscura là **backend dưới transport `puppeteer`**, không phải transport mới — khớp spine.
- **`facebook-gateway`:** rule "chỉ SessionFactory launch browser" → Obscura connect đi qua `SessionFactory.createBrowser`.
- **CI/CD:** spike `BACKEND=both`, skip khi không có `obscura serve`.

### Technical Impact
- `puppeteer-core` có sẵn transitively (24.43.1) — nên promote lên dependency trực tiếp.
- `networkidle2` unsupported → codebase dùng `networkidle0` (đã sửa spike).
- `userDataDir` (Chrome persistent) → Obscura `--storage-dir` (cookie persistence khác cơ chế) — cần map/document.

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Additive, opt-in, backward-compatible; Chrome path giữ nguyên default. Effort Low, Risk Low.

## 4. Detailed Change Proposals

**P1 — PRD:** FR-XX pluggable browser backend; NFR-XX networkidle0-only trên Obscura 0.2.x.

**P2 — `src/scraping/stealthBrowser.js`:** backend option (đã áp); **guard** throw khi post-auth module request `obscura`; map `userDataDir`→storage-dir.

**P3 — Story "Obscura Public-Scraping Backend & Watch":**
- AC1: guest scrapers chạy `XACTIONS_BROWSER_BACKEND=obscura` với `obscura serve --stealth`.
- AC2: post-auth automation assert guard throw khi `backend==='obscura'`.
- AC3: `obscura-spike.mjs BACKEND=both` trong CI (skip khi không có server).
- AC4: `docs/obscura-watch.md` liệt kê issue theo dõi (#531, #886, #643, #683, #817, #866) + promote gate.

**P4 — `docs/obscura-backend.md`:** cài đặt, `obscura serve`, env vars, ma trận target phù hợp/không phù hợp.

**P5 — Watch/promotion gate:** release mới → chạy spike → `/home` `data-testid` mount xanh → mở "obscura-for-auth" opt-in (không default).

## 5. Implementation Handoff

**Scope: Minor** — Developer agent implementation trực tiếp.

**Success criteria:** `obscura-spike.mjs` PASS backend obscura trên example/nowsecure/sannysoft/x-guest; guard throw trên post-auth path; watch doc lưu promote gate.
