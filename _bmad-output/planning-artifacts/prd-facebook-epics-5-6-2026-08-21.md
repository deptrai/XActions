---
title: "PRD: Facebook Epics 5, 5b & 6 — Messenger Port, Marketplace, Headless/Anti-Detection"
created: 2026-08-21
updated: 2026-08-21
status: approved
epics: [5, 5b, 6]
author: "John (BMad Product Manager) & Winston (BMad System Architect)"
prd_ref:
  - prd-XActions-2026-06-08
  - prd-XActions-2026-06-10-epic4
---

# PRD: Facebook Epics 5, 5b & 6 — Messenger Port, Marketplace, Headless/Anti-Detection

*Mở rộng năng lực Facebook automation từ growth cơ bản sang Messenger share, Marketplace scraping, headless/browser controls, và anti-detection behavioral fingerprinting.*

---

## 0. Mục Đích & Bối Cảnh

PRD này là phần tiếp theo của `prd-XActions-2026-06-08` (Epics 1–3: scrape/automate/surfaces) và `prd-XActions-2026-06-10-epic4` (Epic 4: growth automation). Nó định nghĩa:

- **Epic 5 — Facebook Messenger Port:** GraphQL HTTP layer, Messenger share campaign, auth proxy, input queue, campaign UI.
- **Epic 5b — Marketplace & Infrastructure Enhancements:** Marketplace scraper, share-link-uid v2, `headless` parameter, Chrome executable auto-resolution.
- **Epic 6 — Anti-Detection & Bot Countermeasures:** Fingerprint randomization, behavioral simulation, session hygiene, velocity limits, account age awareness.

FR đánh số tiếp từ FR-23 (→ FR-23..FR-54). NFR tiếp từ NFR-10 của Epic 4 (→ NFR-1..NFR-10).

---

## 1. Vision

XActions Facebook module không chỉ là công cụ scrape và automate post/like/comment, mà còn là một **Facebook growth & lead engine đầy đủ**: share qua Messenger, khai thác Marketplace, và mô phỏng hành vi người dùng thật để giảm tỷ lệ checkpoint. Mọi tính năng mới đều đi qua cùng một dispatcher, dry-run mặc định, và `runGuardedBatch`.

---

## 2. Target User & Jobs-To-Be-Done (JTBD)

### 2.1 Personas

1. **Growth Marketer / Lead Gen** — muốn share link/nội dung qua Messenger hàng loạt, scrape Marketplace để theo dõi đối thủ.
2. **Automation Operator** — cần chạy headless trên server, tự động resolve Chrome path, quản lý campaign qua CLI/MCP/API.
3. **Account Farmer / Warming Specialist** — cần làm ấm account, giả lập hành vi con người, tuân thủ velocity limits theo độ tuổi account.
4. **MCP/AI Agent** — gọi `x_facebook_*` tools với cùng schema, nhận về 3-Layer JSON Envelope.

### 2.2 Key User Journeys

- **UJ-5.1:** An muốn gửi bài post đến 50 người qua Messenger. An tạo campaign, paste URL, nhập UID list, dry-run preview, chạy thật với delay bảo thủ.
- **UJ-5b.1:** Mai theo dõi giá laptop trên Facebook Marketplace. Mai chạy `x_facebook_marketplace_search` với query, nhận về danh sách có giá parse đa tiền tệ.
- **UJ-5b.2:** Tuấn deploy trên server headless. Tuấn chạy `xactions automate --platform facebook --headless true`, hệ thống tự resolve Chrome path.
- **UJ-6.1:** Hưng nuôi account mới (< 7 ngày). Hưng bật `accountAge` mode, hệ thống tự động giảm 50% velocity limits và thêm warming sequence.

---

## 3. Glossary

- **Messenger share campaign** — Một batch gửi link bài post đến nhiều UID qua Messenger, quản lý bởi `Operation` record.
- **Share-link-uid v2** — Gửi link trực tiếp qua URL `facebook.com/messages/t/{uid}` thay vì share dialog.
- **Headless mode** — Browser chạy không cửa sổ; mặc định `true` trên server.
- **Fingerprint** — Tập hợp UA, viewport, WebRTC, navigator props, canvas noise, plugins — consistent trong một session.
- **Behavioral simulation** — Mouse Bezier, human click với hover, typing với typo, natural scrolling, session warming.
- **Velocity limits** — Giới hạn hành động theo giờ/ngày; giảm theo account age.

---

## 4. Features

### 4.1 Epic 5 — Facebook Messenger Port

#### FR-23: GraphQL HTTP Layer
`src/scrapers/facebook/graphql.js` cung cấp layer gọi internal GraphQL với `doc_id`, `fb_dtsg`, `lsd`; check Messenger CTA + page list.

#### FR-24: Messenger Share v1
`shareLinkByUid` (v1) mở Messenger share dialog, paste URL, gửi đến recipient.

#### FR-25: Auth Proxy
`--proxy-server=` launch arg + `page.authenticate()`; hỗ trợ proxy có auth.

#### FR-26: Input Queue Surfaces
CLI/MCP/API accept share campaign params (`message`, `link`, `recipientUids[]`).

#### FR-27: Session/Campaign UI
Dashboard/UI quản lý share campaigns: tạo, pause, retry, xem progress.

### 4.2 Epic 5b — Marketplace & Infrastructure Enhancements

#### FR-28: Marketplace Scraper
`scrapeMarketplace(page, query, options)` trả normalized listing với `id, title, price, location, image, listingUrl, platform, source`.

#### FR-29: Multi-Currency Price Parse
Hỗ trợ `$`, `CA$`, `ETB`, `₹`, v.v.

#### FR-30: Title Extraction
Tách title từ concatenated text bằng camelCase heuristics.

#### FR-31: Location Extraction
Extract location từ trailing capitalized word heuristics.

#### FR-32: Share-Link-UID v2 (Direct Messenger URL)
Navigate `messages/t/{uid}`, paste URL via clipboard, Enter.

#### FR-33: Recipient List Support
Accept `recipientUid` hoặc `recipientUids[]`.

#### FR-34: Per-Recipient Results
Trả `{ uid, ok, sharesSent, method }` cho từng recipient.

#### FR-35: Headless Parameter
Tất cả Facebook endpoints accept `headless` boolean.

#### FR-36: Headless `true`
Invisible browser, `networkidle2`, 30s timeout.

#### FR-37: Headless `false`
Visible browser, `domcontentloaded`, 60s timeout, longer delays.

#### FR-38: Headless Response Confirmation
Response include `headless: true/false`.

#### FR-39: Chrome executablePath Auto-Resolution
`createBrowser()` tự resolve: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome path.

### 4.3 Epic 6 — Anti-Detection & Bot Countermeasures

#### FR-40: User-Agent Pool
≥ 20 real Chrome UAs, random per session, consistent within session.

#### FR-41: Viewport Randomization
Viewport match UA platform.

#### FR-42: WebRTC Leak Prevention
Disable/override RTCPeerConnection.

#### FR-43: Navigator Properties Override
`navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`.

#### FR-44: Bezier Mouse Movement
Bezier curve + micro-jitter + overshoot+correction.

#### FR-45: Human Click with Hover
Hover pause 100–400ms trước click.

#### FR-46: Typing with Typos
Typo rate 1–2%, variable speed.

#### FR-47: Natural Scrolling
Variable speed, momentum, overshoot.

#### FR-48: Session Warming
Homepage → scroll → mouse → actions.

#### FR-49: Timezone Override
Khớp proxy location.

#### FR-50: Geolocation Override
Khớp proxy location.

#### FR-51: Persistent Browser Profiles
`userDataDir` support.

#### FR-52: Fingerprint Consistency
Không change mid-session.

#### FR-53: Velocity Limits
Likes ≤ 30/hr, comments ≤ 10/hr, friend requests ≤ 20/day.

#### FR-54: Account Age Awareness
< 7 days = 50% limits, 1–4 weeks = 80%, > 1 month = 100%.

---

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Bezier mouse movement < 2s. |
| NFR-2 | Fingerprint config centralized, dễ update. |
| NFR-3 | Behavioral functions có injectable `delayFn` seam để test. |
| NFR-4 | Không log cookie values trong error/API response. |
| NFR-5 | Facebook delay floor cao hơn Twitter (ADR-012). |
| NFR-6 | Mọi mutate action có dry-run default (ADR-007). |
| NFR-7 | `doc_id` GraphQL hardcoded có fallback graceful, không throw. |
| NFR-8 | Messenger mass-share dùng delay bảo thủ hơn default like/comment. |
| NFR-9 | Scheduler throughput cap ≤ 5 posts/giờ/user. |
| NFR-10 | Friend request delay 60–180s, không override được. |

---

## 6. Architecture Requirements

- **AR1:** Stealth plugin tái dùng cho Facebook.
- **AR2:** Facebook delay rộng hơn Twitter cho mutating actions.
- **AR3:** Batch size ≤ 20/session cho friend requests.
- **AR4:** Proxy rotation infrastructure đã có (`proxyfb`, `tmproxy`, `shoplike`).
- **AR5:** `createBrowser()` support proxy via `--proxy-server=`.
- **AR6:** `page.authenticate()` gọi trước `page.goto` đầu tiên.
- **AR7:** Checkpoint detection: body text chứa `confirm that you` và `human`.
- **AR8:** Facebook scraper clone structure từ `threads/index.js`.
- **AR9:** GraphQL layer tại `graphql.js`, không trộn vào adapter DOM.
- **AR10:** Fingerprint module tại `fingerprint.js`, behavioral tại `human.js`, limits tại `limits.js`.

---

## 7. MVP Scope

### 7.1 In Scope

- Epic 5: FR-23..FR-27 (Messenger port + campaign surfaces).
- Epic 5b: FR-28..FR-39 (Marketplace + headless + Chrome path).
- Epic 6: FR-40..FR-54 (Anti-detection + behavioral + velocity).
- NFR-1..NFR-10.

### 7.2 Out of Scope

- UI dashboard riêng cho campaign (defer Epic 19).
- AI-generated Messenger content.
- Marketplace advanced filters (price range, category drill-down) — Phase 2.
- Full browser fingerprint spoofing canvas/WebGL — Phase 2.

---

## 8. Open Questions

1. **FR-62 GraphQL replay:** Thuộc Epic 7/13, liên quan đến `doc_id` capture/replay — cần quyết định implement hoặc defer.
2. **Fingerprint canvas/WebGL:** Có cần trong Epic 6 MVP hay Phase 2?
3. **Marketplace PII:** Có strip thông tin liên hệ người bán không?

---

*PRD được phê duyệt bởi BMad Product Council, 2026-08-21.*
