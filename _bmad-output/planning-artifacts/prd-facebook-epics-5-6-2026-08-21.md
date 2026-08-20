---
title: "PRD: Facebook Messenger Port, Marketplace, Headless Mode & Anti-Detection (Epics 5, 5b, 6)"
created: 2026-08-21
updated: 2026-08-21
status: canonical
author: "John (BMad Product Manager) & Winston (BMad System Architect)"
epics: [5, 5b, 6]
replaces:
  - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-08/prd.md
  - phần Facebook platform trong epics-full.md (FR23–FR54)
canonical: true
---

# PRD: Facebook Messenger Port, Marketplace, Headless Mode & Anti-Detection

## 0. Document Purpose

Tài liệu này là PRD canonical cho các tính năng Facebook platform còn lại (Epics 5, 5b, 6) của XActions. Nó mô tả Messenger share, Marketplace scraping, headless mode, Chrome path resolution, và anti-detection / bot countermeasures. Được tổng hợp từ `epics-full.md` (FR23–FR54), các ADR liên quan, và kết quả regression test. Dùng cho PM, kiến trúc, và downstream epic/story workflow.

## 1. Vision

XActions cần mở rộng khả năng Facebook automation từ "scrape + post cơ bản" sang "growth distribution + marketplace intelligence + chống phát hiện bot đủ mạnh để chạy production". Người dùng là growth marketer và automation engineer — họ cần share nội dung qua Messenger, thu thập dữ liệu Marketplace, và chạy đa tài khoản với hành vi giả lập con người mà không bị Facebook khóa.

## 2. Target User

### 2.1 Jobs To Be Done

- **Growth Marketer:** Share nội dung đến nhiều UID qua Messenger, quản lý campaign, thu thập dữ liệu Marketplace để research giá/sản phẩm.
- **Automation Engineer:** Chạy Facebook automation ổn định trên headless server, tự động chọn Chrome path, quản lý proxy/fingerprint/velocity để giảm tỷ lệ die tài khoản.
- **MCP User / AI Agent:** Gọi `x_facebook_*` tools để thực hiện các hành động trên mà không cần biết DOM chi tiết.

### 2.2 Key User Journeys

- **UJ-1. Mai chia sẻ deal đến 50 người mua qua Messenger.**
  - Mai dùng CLI `xactions facebook share --url <deal> --uids <list>` hoặc gọi MCP `x_facebook_share_link_by_uid`.
  - Hệ thống mở Messenger thread từng UID, paste link, nhấn Enter, trả kết quả per-recipient.
  - Delay bảo thủ được áp dụng, dry-run cho phép preview trước khi thực thi.

- **UJ-2. Khoa research Marketplace Hà Nội.**
  - Khoa gọi `x_facebook_scrape_marketplace --query "xe đạp" --location "Hà Nội"`.
  - Hệ thống trả danh sách `{ id, title, price, location, image, listingUrl, platform, source }` với phân tích multi-currency.

- **UJ-3. Trí triển khai automation trên server không GUI.**
  - Trí chạy với `headless: true` (mặc định) hoặc `headless: false` khi debug.
  - `createBrowser()` tự tìm Chrome executable: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome.

- **UJ-4. Linh chạy 10 tài khoản song song mà không bị khóa.**
  - Mỗi session có fingerprint riêng (UA + viewport + navigator props), WebRTC bị vô hiệu hóa, mouse/click/type/scroll giả lập con người, velocity limit theo account age.

## 3. Glossary

- **Share-Link-UID v1/v2** — Cơ chế share post qua Messenger. v1 dùng share dialog; v2 dùng direct URL `messages/t/{uid}`.
- **Marketplace Scraper** — Module lấy dữ liệu listing từ `facebook.com/marketplace`.
- **Headless Mode** — Chạy browser không UI. Default `true` cho production, `false` cho debug.
- **Fingerprint** — Tập hợp UA, viewport, hardwareConcurrency, deviceMemory, platform, plugins được cố định trong một session.
- **Session Warming** — Chuỗi hành động (homepage → scroll → mouse) trước khi thực hiện action chính.
- **Velocity Limit** — Giới hạn tần suất action (likes, comments, friend requests, messages) theo giờ/ngày.
- **Account Age** — Thời gian từ khi tài khoản Facebook được tạo, dùng để điều chỉnh velocity limits.
- **Anti-Detection** — Tổng hợp fingerprint, behavioral simulation, WebRTC prevention, timezone/geo override, persistent profiles.

## 4. Features

### 4.1 Messenger Port & Share (Epic 5)

**Description:** Cung cấp GraphQL HTTP layer và khả năng share post qua Messenger, quản lý campaign, hỗ trợ proxy auth. Thực hiện UJ-1.

**Functional Requirements:**

#### FR23: GraphQL HTTP Layer
[AI agent / developer] có thể [gọi Facebook GraphQL endpoints] [qua HTTP] để kiểm tra Messenger CTA + page list mà không cần DOM scraping.

- `src/scrapers/facebook/graphql.js` check `fb_dtsg`/`lsd`/`jazoest`/`doc_id`.
- `doc_id` là named constant với fallback graceful (NFR7).
- `fetchImpl` có thể inject để test.
- Không thêm HTTP dependency mới (dùng axios/fetch sẵn có).

#### FR24: Messenger Share v1 (Share Dialog)
[Growth marketer] có thể [share post via Messenger share dialog] [với delay bảo thủ và dry-run default].

- Input: post URL + recipient.
- Output: kết quả share.
- Delay bảo thủ (NFR8) và dry-run default.

#### FR25: Auth Proxy
[Automation engineer] có thể [chạy Facebook automation qua proxy] [bằng cách truyền `--proxy-server=` launch arg và gọi `page.authenticate()`].

- `createBrowser({ proxy })` thêm `--proxy-server=`.
- `page.authenticate()` được gọi trước `page.goto` đầu tiên (AR6).

#### FR26: Input Queue Surfaces (CLI/MCP/API)
[AI agent / user] có thể [submit share campaign params] [qua CLI/MCP/API] và hệ thống queue + execute qua `runGuardedBatch`.

#### FR27: Session/Campaign UI
[User] có thể [quản lý share campaigns] [qua dashboard với Socket.IO real-time updates] để theo dõi tiến độ và kết quả.

### 4.2 Marketplace & Infrastructure Enhancements (Epic 5b)

**Description:** Thu thập dữ liệu Facebook Marketplace, cải tiến share-link-uid v2, thêm headless mode và Chrome path auto-resolution. Thực hiện UJ-2, UJ-3.

**Functional Requirements:**

#### FR28: Marketplace Scraper
[Marketer] có thể [scrape Marketplace listings] [với query và options] và nhận `{ id, title, price, location, image, listingUrl, platform, source }`.

- Hỗ trợ pagination qua scroll với stall detection.
- `marketplace` được đăng ký trong action map + API route.

#### FR29: Multi-Currency Price Parsing
[Scraper] phải parse giá với các ký hiệu tiền tệ: `$`, `CA$`, `ETB`, `₹`.

#### FR30: Title Extraction from Concatenated Text
[Scraper] phải extract title từ concatenated text bằng camelCase splitting heuristic.

#### FR31: Location Extraction
[Scraper] phải extract location từ trailing capitalized word heuristics.

#### FR32: Share-Link-UID v2 (Direct Messenger URL)
[Growth marketer] có thể [share post bằng direct URL `messages/t/{uid}`] [mà không cần recipient trong friend list].

- Navigates `messages/t/{uid}` → paste URL qua clipboard → Enter.
- Nhận `recipientUid` hoặc `recipientUids[]`.
- Trả per-recipient results: `{ uid, ok, sharesSent, method }`.
- `shareLinkByUidCampaign` hỗ trợ multiple recipients.

#### FR33–FR34: Recipient Input & Per-Recipient Results
Bao gồm FR32 ở trên.

#### FR35–FR38: Headless Mode Parameter
[Automation engineer] có thể [chọn headless true/false] [cho mọi Facebook endpoint].

- `headless: true` (default): invisible, `networkidle2`, 30s timeout, shorter delays.
- `headless: false`: visible, `domcontentloaded`, 60s timeout, longer delays.
- Response bao gồm `headless: true/false` confirming mode.

#### FR39: Chrome executablePath Auto-Resolution
[Automation engineer] có thể [chạy `createBrowser()` không cung cấp executablePath] [và hệ thống tự resolve theo thứ tự: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome path].

### 4.3 Anti-Detection & Bot Countermeasures (Epic 6)

**Description:** Hệ thống chống phát hiện bot bao gồm fingerprint, behavioral simulation, session hygiene, velocity controls. Thực hiện UJ-4.

**Functional Requirements:**

#### FR40: User-Agent Pool
[Scraper] phải có UA pool ≥20 real Chrome UAs, random per session, consistent trong session.

#### FR41: Viewport Randomization
[Scraper] phải randomize viewport khớp UA platform.

#### FR42: WebRTC Leak Prevention
[Scraper] phải disable/override `RTCPeerConnection` và thêm `--disable-webrtc` launch arg.

#### FR43: Navigator Properties Override
[Scraper] phải override `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`.

#### FR44: Bezier Mouse Movement
[Scraper] phải di chuyển chuột theo Bezier curve với micro-jitter và overshoot+correction.

#### FR45: Human Click with Hover
[Scraper] phải click với hover pause 100–400ms.

#### FR46: Typing with Typos
[Scraper] phải typing với typo rate 1–2%, variable speed.

#### FR47: Natural Scrolling
[Scraper] phải scroll với variable speed, momentum, overshoot.

#### FR48: Session Warming
[Scraper] phải warm-up session: homepage → scroll → mouse → actions.

#### FR49–FR50: Timezone & Geolocation Override
[Scraper] phải override timezone và geolocation khớp proxy location.

#### FR51: Persistent Browser Profiles
[Scraper] phải hỗ trợ `userDataDir` để lưu cookie/localStorage theo profile `profiles/fb-{c_user}/`.

#### FR52: Consistent Fingerprint Per Session
[Scraper] phải giữ fingerprint consistent trong một session, không thay đổi mid-session.

#### FR53: Action Velocity Limiting
[Scraper] phải giới hạn velocity: likes ≤30/hr, comments ≤10/hr, friend requests ≤20/day, messages ≤20/hr.

#### FR54: Account Age Awareness
[Scraper] phải điều chỉnh limits theo account age: <7 days = 50%, 1–4 weeks = 80%, >3 months = 100%.

## 5. Non-Goals (Explicit)

- Không hỗ trợ bypass CAPTCHA / checkpoint của Facebook.
- Không cào private message content (chỉ share/campaign metadata).
- Không tự động mua/bán trên Marketplace (chỉ scrape).
- GraphQL replay (FR-62) không nằm trong scope — xem `FUTURE-WORK.md`.

## 6. MVP Scope

### 6.1 In Scope

- Epic 5: Messenger share v1, auth proxy, campaign queue & UI.
- Epic 5b: Marketplace scraper, share-link-uid v2, headless parameter, Chrome path auto-resolution.
- Epic 6: Fingerprint, UA/viewport, WebRTC, navigator override, mouse/click/type/scroll, session warming, velocity limits, account age awareness. **Story 6.2–6.5, 6.9–6.14** là core anti-detection.

### 6.2 Out of Scope for MVP

- **Persistent browser profiles (FR51 / Story 6.17):** deferred vì cần quản lý profile lifecycle và storage. Có thể implement sau khi core anti-detection ổn định.
- **Timezone/Geolocation override (FR49–FR50 / Story 6.16):** deferred vì cần integrate với proxy geo-IP database. Có thể dùng IP location thay thế tạm thời.
- **GraphQL replay (FR-62):** deferred to Phase 3; xem `FUTURE-WORK.md`.

## 7. Non-Functional Requirements

| ID | Requirement | Traceability |
|---|---|---|
| NFR1 | Bezier mouse movement hoàn thành <2s. | Story 6.9 |
| NFR2 | Fingerprint config centralized trong một module, dễ update. | Epic 6 |
| NFR3 | Behavioral functions có injectable delay seam để test nhanh. | Epic 6 |
| NFR4 | Không log cookie values trong error/API response. | Toàn bộ Epic 5–6 |
| NFR5 | Facebook automation delay floor cao hơn Twitter (ADR-012). | Epic 6 |
| NFR6 | Mọi mutate action có dry-run default. | Epic 4–6 |
| NFR7 | `doc_id` GraphQL hardcoded có fallback graceful, không throw. | Story 5.1 |
| NFR8 | Messenger mass-share dùng delay bảo thủ hơn default. | Story 5.2, 5b.2 |
| NFR9 | Scheduler throughput cap ≤5 posts/giờ/user. | Epic 4 |
| NFR10 | Friend request delay hardcode 60–180s, không override. | Epic 4 |

## 8. Additional Requirements from Architecture

- **AR1:** Stealth plugin (puppeteer-extra-plugin-stealth) tái dùng cho Facebook.
- **AR2:** Facebook cần delay rộng hơn Twitter cho mutating actions.
- **AR3:** Batch size ≤20/session cho friend requests.
- **AR4:** Proxy rotation infrastructure đã có (proxyfb, tmproxy, shoplike).
- **AR5:** `createBrowser()` support proxy via `--proxy-server=` launch arg.
- **AR6:** `page.authenticate()` gọi trước `page.goto` đầu tiên.
- **AR7:** Checkpoint detection: `bodyText.includes('confirm that you') && bodyText.includes('human')`.
- **AR8:** Facebook scraper clone structure từ `threads/index.js`.
- **AR9:** GraphQL layer tách riêng tại `graphql.js`.
- **AR10:** `fingerprint.js`, `human.js`, `limits.js` tách riêng.

## 9. Open Questions

1. Có cần gộp `headless` parameter vào `AbstractCrawler` (Epic 10) hay giữ riêng cho Facebook?
2. Marketplace scraper có cần hỗ trợ location filter theo khoảng cách (miles/km) không?
3. `userDataDir` profile path format có cần mã hóa `c_user` để tránh leak account identity?

## 10. Assumptions Index

- **A1:** `puppeteer-extra-plugin-stealth` được sử dụng làm base anti-detection (AR1).
- **A2:** Proxy geo-IP database chưa có nên FR49–FR50 deferred.
- **A3:** CAPTCHA / checkpoint không nằm trong scope v1.
