---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-08/prd.md
  - _bmad-output/planning-artifacts/research/technical-facebook-bot-detection-countermeasures-research-2026-08-12.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14.md
---

# XActions - Facebook Anti-Detection & Bot Countermeasures

## Overview

Epic breakdown for Facebook anti-detection countermeasures — fingerprint randomization, behavioral simulation, and session hygiene to minimize checkpoint triggers and account restrictions.

## Requirements Inventory

### Functional Requirements

**FR1:** Hệ thống phải có User-Agent pool với 20+ real Chrome UAs, khởi tạo ngẫu nhiên mỗi session nhưng consistent trong suốt session.

**FR2:** Hệ thống phải randomize viewport (width, height, devicePixelRatio) match với platform của UA đã chọn.

**FR3:** Hệ thống phải prevent WebRTC leak (disable WebRTC hoặc override STUN servers) để IP thật không bị lộ qua proxy.

**FR4:** Hệ thống phải override `navigator.webdriver`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `navigator.platform` để khớp với fingerprint giả.

**FR5:** Hệ thống phải có Bezier curve mouse movement simulation với micro-jitter và overshoot+correction behavior.

**FR6:** Hệ thống phải có human click simulation với hover pause (100-400ms) trước khi click.

**FR7:** Hệ thống phải có typing simulation với typo rate (1-2%), variable speed, và natural pauses.

**FR8:** Hệ thống phải có natural scrolling với variable speed (acceleration/deceleration), momentum, và occasional overshoot+correction.

**FR9:** Hệ thống phải có session warming sequence: visit homepage → scroll → move mouse randomly → sau đó mới thực hiện actions.

**FR10:** Hệ thống phải hỗ trợ timezone override khớp với proxy location.

**FR11:** Hệ thống phải hỗ trợ geolocation override khớp với proxy location.

**FR12:** Hệ thống phải support persistent browser profiles (userDataDir) để retain history, cookies, localStorage.

**FR13:** Hệ thống phải có fingerprint consistency: một fingerprint duy nhất per session, không randomize mid-session.

**FR14:** Hệ thống phải expose `headless` parameter cho tất cả Facebook automation endpoints.

**FR15:** Khi `headless: false`, hệ thống phải dùng `domcontentloaded` wait strategy và longer delays để user có thể theo dõi.

**FR16:** Khi `headless: true`, hệ thống phải dùng `networkidle2` wait strategy và shorter delays.

**FR17:** Hệ thống phải tự động resolve Chrome executablePath: explicit option → env var → system Chrome path.

**FR18:** Hệ thống phải có action velocity limits: likes/hour ≤ 30, comments/hour ≤ 10, friend requests/day ≤ 20.

**FR19:** Hệ thống phải có account age awareness: new accounts (<7 days) bị giới hạn 50% activity.

**FR20:** Hệ thống phải hiển thị `headless: true/fong` trong response để confirm mode đã dùng.

### NonFunctional Requirements

**NFR1:** Hiệu suất — Bezel mouse movement phải hoàn thành trong <2s cho khoảng cách màn hình điển hình.

**NFR2:** Khả năng bảo trì — Fingerprint config phải centralized trong một module, dễ update UA pool và viewport list.

**NFR3:** Khả năng test — Behavioral functions phải có injectable delay seam để test không cần chờ thật.

**NFR4:** NFR3 Privacy — Không log hay echo cookie values trong error messages hoặc API responses.

**NFR5:** NFR1 Rate Limiting — Facebook automation phải có delay floor cao hơn Twitter (ADR-012).

**NFR6:** ADR-007 — Mọi mutate action phải có dry-run default.

### Additional Requirements (from Architecture)

- **AR1:** Stealth plugin (puppeteer-extra-plugin-stealth) đã có cho Threads/Twitter — tái dùng cho Facebook.
- **AR2:** Facebook cần delay rộng hơn Twitter cho mọi mutating action.
- **AR3:** Batch size ≤ 20/session cho Facebook friend requests.
- **AR4:** Proxy rotation infrastructure đã có (proxyfb, tmproxy, shoplike providers).
- **AR5:** `createBrowser()` phải support proxy via `--proxy-server=` launch arg.
- **AR6:** `page.authenticate()` phải được gọi trước `page.goto` đầu tiên cho authenticated proxies.
- **AR7:** Checkpoint detection: check `bodyText.includes('confirm that you') && bodyText.includes('human')` sau login.

### Additional Requirements from Post-Completion Testing (2026-08-14)

Nguồn: `sprint-change-proposal-2026-08-14.md` — phát hiện từ full regression test + real-user MCP/API testing.

- **PCR1:** `x_facebook_cancel_friend_requests` dry-run không được chạy delay thật 63s → short-circuit trước batch loop.
- **PCR2:** `new PrismaClient()` per route module gây connection-pool fragmentation → singleton refactor cross-cutting.
- **PCR3:** `post_comments`/`group_comments` cần verify live selectors vì hiện trả note "not accessible" trên mọi post.
- **PCR4:** `group_posts`/`group_search` cần verify với public/joined group vì hiện trả 0 results.
- **PCR5:** `loginWithCookie` cần injectable `delayFn` seam để test nhanh và tránh timeout flaky.
- **PCR6:** `executeTool` cần trả MCP error result (không throw) khi `localTools` null hoặc tool unknown.
- **PCR7:** Auth middleware cần chấp nhận cả `decoded.userId` và `decoded.id` để tránh token mismatch.

### UX Design Requirements

N/A — No UX design spec for this technical infrastructure feature.

### FR Coverage Map

| FR | Epic 1 (Anti-Detection) |
|---|---|
| FR1 (UA Pool) | ✅ |
| FR2 (Viewport) | ✅ |
| FR3 (WebRTC) | ✅ |
| FR4 (Navigator) | ✅ |
| FR5 (Bezier Mouse) | ✅ |
| FR6 (Human Click) | ✅ |
| FR7 (Typing) | ✅ |
| FR8 (Scrolling) | ✅ |
| FR9 (Session Warming) | ✅ |
| FR10 (Timezone) | ✅ |
| FR11 (Geolocation) | ✅ |
| FR12 (Persistent Profiles) | ✅ |
| FR13 (Consistency) | ✅ |
| FR14 (Headless Param) | ✅ |
| FR15 (Headless-aware) | ✅ |
| FR16 (Headless strategy) | ✅ |
| FR17 (Chrome Path) | ✅ |
| FR18 (Velocity Limits) | ✅ |
| FR19 (Account Age) | ✅ |
| FR20 (Headless Response) | ✅ |

## Epic List

### Epic 1: Facebook Anti-Detection & Bot Countermeasures

**Epic Goal:** Build comprehensive anti-detection infrastructure cho Facebook automation — bao gồm fingerprint randomization, behavioral simulation, session hygiene, headless mode, và velocity controls — để minimize checkpoint triggers và account restrictions. Toàn bộ stories trong epic này chạm cùng file core (`createBrowser`, `createPage`, `loginWithCookie`, `shareLinkByUid`) và được develop theo thứ tự logic tăng dần.

**Stories (theo thứ tự development):**

1. **Story 1.1:** Chrome executablePath Auto-Resolution — `createBrowser()` tự động resolve system Chrome path (explicit option → env var → system path).
2. **Story 1.2:** Consistent Session Fingerprint — generate một fingerprint object per session, reuse throughout, không change mid-session.
3. **Story 1.3:** User-Agent Pool & Viewport Randomization — 20+ real Chrome UAs + viewport randomization trong `createPage()`, devicePixelFactor khớp platform.
4. **Story 1.4:** Navigator Properties Override — override `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`, `plugins`.
5. **Story 1.5:** WebRTC Leak Prevention — disable/override RTCPeerConnection, `--disable-webrtc` launch arg.
6. **Story 1.6:** Headless Mode Parameter — `headless` param cho tất cả endpoints, response trả về mode.
7. **Story 1.7:** Headless-Aware Timeouts — `loginWithCookie()` dùng `domcontentloaded`+60s (visible) hoặc `networkidle2`+30s (hidden).
8. **Story 1.8:** Behavioral Delays in Share-Link-UID — delays phù hợp headless mode (8-12s visible / 5-8s hidden).
9. **Story 1.9:** Bezier Mouse Movement — cubic Bezier curve với micro-jitter, 15% overshoot + correction, <2s.
10. **Story 1.10:** Human Click with Hover — hover pause 100-400ms, variable hold 30-120ms, dùng element handle.
11. **Story 1.11:** Typing with Typos — variable speed 80-120ms/ký tự, typo rate 1-2%, natural pauses.
12. **Story 1.12:** Natural Scrolling — sin curve speed, 20% overshoot + correction, delay giữa chunks.
13. **Story 1.13:** Action Velocity Limiting — likes ≤30/hr, comments ≤10/hr, friend requests ≤20/day, messages ≤20/hr, delay floor 5-15s.
14. **Story 1.14:** Account Age Awareness — new accounts (<7 days) giới hạn 50%, accounts 1-4 weeks giới hạn 80%.
15. **Story 1.15:** Session Warming Sequence — visit homepage → scroll → mouse movements → mới perform actions.
16. **Story 1.16:** Timezone & Geolocation Override — `emulateTimezone` + `setGeolocation` khớp proxy, grant permissions.
17. **Story 1.17:** Persistent Browser Profiles — `userDataDir` retain cookies/localStorage, tự động tạo profile directory.

---

## Epic 1: Facebook Anti-Detection & Bot Countermeasures

**Epic Goal:** Build comprehensive anti-detection infrastructure cho Facebook automation — fingerprint randomization, behavioral simulation, session hygiene, headless mode, và velocity controls — để minimize checkpoint triggers và account restrictions. Toàn bộ stories trong epic này chạm cùng file core (`createBrowser`, `createPage`, `loginWithCookie`, `shareLinkByUid`) và được develop theo thứ tự logic tăng dần.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19, FR20

**NFRs relevant:** NFR1 (Bezel <2s), NFR2 (centralized config), NFR3 (testable delays), NFR4 (no cookie logging), NFR5 (delay floor), NFR6 (dry-run default)

**Additional Requirements relevant:** AR1 (stealth plugin), AR2 (longer delays), AR3 (batch ≤20), AR5 (proxy support), AR6 (auth before goto), AR7 (checkpoint detection)

### Story 1.1: Chrome executablePath Auto-Resolution

As a developer,
I want `createBrowser()` tự động resolve system Chrome path,
So that mỗi automation session launch Chrome mà không cần puppeteer bundled.

**Acceptance Criteria:**

**Given** Chrome được cài đặt tại `/Applications/Google Chrome.app/`
**When** `createBrowser()` được gọi mà không có `executablePath`
**Then** hệ thống kiểm tra theo thứ tự: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system path mặc định
**And** Chrome launches thành công với system installation
**And** không có "Could not find Chrome" error

### Story 1.2: Consistent Session Fingerprint

As a developer,
I want mỗi session generate ONE fingerprint và reuse throughout,
So that Facebook không detect fingerprint changes mid-session.

**Acceptance Criteria:**

**Given** một automation session mới bắt đầu
**When** `createBrowser()` + `createPage()` được gọi
**Then** một fingerprint object được generate (UA + viewport + hardware config)
**And** fingerprint được lưu trong session context
**And** tất cả navigation trong session dùng cùng fingerprint
**And** fingerprint KHÔNG change giữa session (consistent across tabs)

### Story 1.3: User-Agent Pool & Viewport Randomization

As a developer,
I want User-Agent pool với 20+ real Chrome UAs và viewport randomization,
So that mỗi session có unique nhưng realistic browser fingerprint.

**Acceptance Criteria:**

**Given** một session mới đã chọn fingerprint
**When** `createPage()` được gọi
**Then** UA được set qua `page.setUserAgent()` từ pool
**And** viewport được set qua `page.setViewport()` từ predefined list (1920x1080, 1366x768, 1536x864, 1440x900, 2560x1440)
**And** deviceScaleFactor khớp với UA platform (1 cho desktop, 2 cho Retina)
**And** UA và viewport được log trong dry-run response (không log cookie)

### Story 1.4: Navigator Properties Override

As a developer,
I want override navigator automation indicators,
So that Facebook không detect `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`, `plugins` inconsistencies.

**Acceptance Criteria:**

**Given** browser đã launch với stealth plugin
**When** `createPage()` chạy
**Then** `navigator.webdriver` trả về `undefined`
**And** `navigator.hardwareConcurrency` random trong [4, 6, 8]
**And** `navigator.deviceMemory` random từ [2, 4, 8]
**And** `navigator.platform` khớp với UA platform (Win32 cho Windows)
**And** `navigator.plugins.length` > 0

### Story 1.5: WebRTC Leak Prevention

As a developer,
I want WebRTC bị disable hoặc override,
So that IP thật không bị lộ qua STUN servers khi dùng proxy.

**Acceptance Criteria:**

**Given** browser với proxy đã configure
**When** một Facebook page được load
**Then** `RTCPeerConnection` API bị override hoặc disabled
**And** `--disable-webrtc` launch arg được thêm vào browser
**And** không có STUN requests ra ngoài proxy

### Story 1.6: Headless Mode Parameter

As a developer,
I want tất cả Facebook endpoints accept `headless` parameter,
So that users có thể debug với browser visible hoặc run production với headless.

**Acceptance Criteria:**

**Given** `createBrowser({ headless: false })`
**When** browser được launch
**Then** browser window hiển thị và user có thể thấy automation
**And** response trả về `headless: false`

**Given** `createBrowser({ headless: true })` (default)
**When** browser được launch
**Then** browser chạy invisible
**And** response trả về `headless: true`

### Story 1.7: Headless-Aware Timeouts

As a developer,
I want `loginWithCookie()` dùng appropriate timeout strategy,
So that visible browser có đủ thời gian load Facebook fully.

**Acceptance Criteria:**

**Given** `headless: false`
**When** `loginWithCookie()` được gọi
**Then** `waitUntil: 'domcontentloaded'` được dùng
**And** timeout = 60000ms

**Given** `headless: true`
**When** `loginWithCookie()` được gọi
**Then** `waitUntil: 'networkidle2'` được dùng
**And** timeout = 30000ms

### Story 1.8: Behavioral Delays in Share-Link-UID

As a user running share-link-uid automation,
I want delays phù hợp với headless mode,
So that tôi có thể theo dõi khi browser visible.

**Acceptance Criteria:**

**Given** `headless: false`
**When** `shareLinkByUid()` chạy
**Then** delay 8-12s sau navigation
**And** delay 3-5s sau khi paste URL
**And** delay 3-5s sau khi send
**And** console logs: `[uid] Conversation opened: ...` và `[uid] Sending message...`

**Given** `headless: true`
**When** `shareLinkByUid()` chạy
**Then** delay 5-8s sau navigation
**And** delay 1.5-2.5s sau khi paste URL
**And** delay 2-3s sau khi send

### Story 1.9: Bezier Mouse Movement

As a developer,
I want mouse movement theo Bezier curve với micro-jitter,
So that Facebook không detect straight-line bot movement.

**Acceptance Criteria:**

**Given** cần click ở vị trí (x, y)
**When** `humanMoveMouse(page, x, y)` được gọi
**Then** mouse di chuyển theo cubic Bezier curve (20-35 steps)
**And** mỗi step có micro-jitter ±2px (human tremor)
**And** 15% chance có overshoot + correction
**And** movement hoàn thành trong <2s (NFR1)

### Story 1.10: Human Click with Hover

As a developer,
I want click simulation với hover pause và variable hold duration,
So that Facebook không detect instant/mechanical clicks.

**Acceptance Criteria:**

**Given** đã move đến target vị trí
**When** `humanClick(page, x, y)` được gọi
**Then** hover pause 100-400ms trước khi click
**And** mouse down → hold 30-120ms → mouse up
**And** không có coordinate-based clicks (dùng element handle)

### Story 1.11: Typing with Typos

As a developer,
I want typing simulation với variable speed và occasional typos,
So that Facebook không detect mechanical typing patterns.

**Acceptance Criteria:**

**Given** cần type text vào input
**When** `humanType(page, text)` được gọi
**Then** mỗi ký tự có variable delay 80-120ms
**And** typo rate 1-2% cho alphabet characters
**And** typo được gõ sai → pause → backspace → type lại
**And** pause 100-300ms giữa các words
**And** pause 200-500ms sau punctuation

### Story 1.12: Natural Scrolling

As a developer,
I want scrolling với variable speed và momentum,
So that Facebook không detect fixed-distance instant scrolls.

**Acceptance Criteria:**

**Given** cần scroll distance pixels
**When** `humanScroll(page, distance)` được gọi
**Then** scroll được chia thành 5-10 chunks với variable speed
**And** speed follows sin curve (slow → fast → slow)
**And** 20% chance có overshoot + correction
**And** delay 100-400ms giữa các chunks

### Story 1.13: Action Velocity Limiting

As a developer,
I want built-in rate limiting cho Facebook actions,
So that automation không exceed human-possible speeds.

**Acceptance Criteria:**

**Given** automation session đang chạy
**When** actions được thực hiện liên tục
**Then** likes giới hạn ≤ 30/hour
**And** comments giới hạn ≤ 10/hour
**And** friend requests giới hạn ≤ 20/day
**And** messages giới hạn ≤ 20/hour
**And** delay floor 5-15s giữa actions (NFR5, AR2)

### Story 1.14: Account Age Awareness

As a developer,
I want account age được tính để giới hạn activity,
So that new accounts không bị flag ngay lập tức.

**Acceptance Criteria:**

**Given** account có creationDate
**When** automation khởi động
**Then** accounts < 7 days bị giới hạn 50% action limits
**And** accounts 1-4 weeks bị giới hạn 80% limits
**And** accounts > 3 months cho phép full limits

### Story 1.15: Session Warming Sequence

As a developer,
I want tự động warm-up session trước khi thực hiện actions,
So that Facebook không detect cold-session-immediate-action pattern.

**Acceptance Criteria:**

**Given** logged in successfully
**When** session warming được trigger
**Then** visit homepage → wait 3-8s
**And** scroll 300-800px → wait 2-6s
**And** scroll 200-500px → wait 1-4s
**And** random mouse movements 3 lần → wait 0.5-2s mỗi lần
**And** sau đó mới safe để perform actions

### Story 1.16: Timezone & Geolocation Override

As a developer,
I want override timezone và geolocation khớp proxy location,
So that Facebook không detect IP-timezone-geo mismatch.

**Acceptance Criteria:**

**Given** proxy ở US-East
**When** session được khởi tạo
**Then** `page.emulateTimezone('America/New_York')` được gọi
**And** `page.setGeolocation({ lat, lng })` match proxy location
**And** `Intl.DateTimeFormat().resolvedOptions().timeZone` returns correct timezone
**And** permissions được grant cho geolocation API

### Story 1.17: Persistent Browser Profiles

As a developer,
I want support persistent browser profiles qua userDataDir,
So that browser retains history, cookies, localStorage across sessions.

**Acceptance Criteria:**

**Given** profile directory được specify
**When** `createBrowser({ userDataDir: './profiles/account-1' })` được gọi
**Then** browser retains cookies và localStorage sau khi close
**And** next session restore previous state
**And** profile directory tự động create nếu chưa tồn tại
