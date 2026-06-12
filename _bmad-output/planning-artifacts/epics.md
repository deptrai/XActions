---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-08/prd.md
  - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md
  - _bmad-output/planning-artifacts/architecture.md
---

# XActions - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for XActions, decomposing the requirements from the Facebook Platform Extension PRD and Architecture Addendum A into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Người dùng có thể scrape một Facebook profile/page công khai bằng handle hoặc URL; trả về normalized profile shape và lỗi rõ ràng khi profile không tồn tại hoặc bị chặn.

FR2: Người dùng có thể scrape posts gần đây của một profile/page với `limit`; mỗi post trả về `id`, `text`, `timestamp`, `likes`, `comments`, `url`, `media`, `platform: 'facebook'`; scroll có delay và bounded retry.

FR3: Người dùng có thể scrape followers của một profile/page khi Facebook cho phép; nếu không lộ follower list thì trả object có `note` thay vì lỗi cứng.

FR4: Người dùng có thể search posts/nội dung Facebook theo query; trả về mảng kết quả normalized và tôn trọng `limit`.

FR5: Facebook được đăng ký vào `platforms` registry để `scrape('facebook', action, options)` và alias `'fb'` dispatch đúng module; `facebook`/`fb` nằm trong nhánh `needsPuppeteer`.

FR6: Người dùng có thể tự động like một hoặc nhiều Facebook post; `dryRun` mặc định `true`; khi chạy thật có delay, bounded batch và Operation record.

FR7: Người dùng có thể tự động comment nội dung cho trước lên post; `dryRun` mặc định `true`; preview hiển thị post mục tiêu và nội dung comment; chạy thật có delay/batch/stop condition.

FR8: Người dùng có thể tạo Facebook post text (kèm media nếu có); `dryRun` mặc định `true`; chạy thật trả về URL/ID post trong Operation result.

FR9: Mọi hàm automate chia sẻ guardrail: dry-run mặc định, delay, bounded batch, bounded retry, stop condition, cảnh báo account risk trước batch ghi đầu tiên.

FR10: Người dùng xác thực bằng cặp Facebook session cookie `c_user` + `xs`; thiếu/sai cookie trả lỗi rõ ràng; cookie không xuất hiện trong log/response.

FR11: MCP tool/option nhận `platform: "facebook"` hoặc `"fb"` cho các action đã hỗ trợ; schema bổ sung additive và có contract test.

FR12: CLI hỗ trợ `--platform facebook` cho scrape/automate; scrape trả output qua exporter hiện có; automate có cờ dry-run mặc định bật.

FR13: REST API + Dashboard hỗ trợ Facebook; route validate/authorize theo `userId`, business logic ở `api/services`, thao tác nặng/ghi sau rate limit hoặc job queue.

FR14: Job automation Facebook được lưu vào PostgreSQL qua Prisma; Operation record có progress, Socket.IO update cho job dài; snapshot chỉ thêm khi story/future phase có retention rõ.

FR15: Người dùng lên lịch post Facebook tại datetime cụ thể; `dryRun` mặc định `true`; khi thật tạo Prisma `Schedule` record; scheduler worker thực thi trong ±2 phút.

FR16: Người dùng auto-share một post URL lên timeline; `dryRun` mặc định `true`; khi thật trả về URL post share trong Operation result.

FR17: Hệ thống scroll tự nhiên (view boost) trên trang/post; không click action; `durationSeconds` cap 300s; `dryRun` validate URL không mở browser.

FR18: Người dùng tham gia nhóm Facebook tự động (URL/keyword); `dryRun` mặc định; thực thi qua `runGuardedBatch` delay 30-90s; cảnh báo account risk bắt buộc.

FR19: Người dùng đăng bài hàng loạt vào nhiều nhóm; `batchLimit=10`; `dryRun` mặc định; qua `runGuardedBatch`; nhóm thất bại không abort batch; cảnh báo account risk.

FR20: Người dùng scrape thành viên nhóm; trả về mảng `{ name, username?, profileUrl, platform }`; nhóm không cho xem → object có `note`; không thu thập SĐT/email.

FR21: Người dùng gửi kết bạn tự động (uid_list/suggestions/location); `dryRun` mặc định; `runGuardedBatch` delay 60-180s, batch ≤ 20; cảnh báo không tắt được; không scrape SĐT.

FR22: Người dùng bulk cancel lời mời kết bạn pending; `dryRun` mặc định; `runGuardedBatch` delay 2-5s; trả về `{ cancelled, failed, remaining }`.

FR23: Newsfeed farming / account warming (scroll + react xác suất thấp); `reactProbability` default 0.05 cap 0.2; `durationSeconds` cap 600s; `dryRun` không mở browser; cảnh báo bắt buộc.

FR24: Scrape internal Facebook tokens (fb_dtsg, lsd, jazoest, hsi, __spin_r, __spin_t) từ HTML facebook.com qua HTTP; anchored regex; trả `null` khi logged-out; không log cookie (NFR3).

FR25: Lấy danh sách Facebook Pages qua Graph API (ad account → EAAG token → facebook_pages); trả mảng `{ pageId, name, accessToken }`; empty array khi không có; không log accessToken.

FR26: Kiểm tra Messenger Business CTA eligibility cho một page qua GraphQL doc_id; trả `{ eligible: boolean }`; fallback `false` khi response shape bất thường; doc_id là named constant có cảnh báo rotation.

FR27: Share một Facebook post tới một Page qua Messenger (DOM automation: share button → "via Messenger" → chọn target); selector fallback chain; `dryRun` mặc định `true`; route qua `runGuardedBatch`.

FR28: Compose & gửi message trong Messenger dialog; hỗ trợ random segment (`**` delimiter), type line-by-line Shift+Enter, strip emoji surrogates `\p{Cs}`, detect "Couldn't send" → mark blocked.

FR29: Batch messenger share campaign chạy đa tài khoản qua `runGuardedBatch`; delay bảo thủ hơn like/comment (ADR-012); FIFO target queue; dry-run mặc định; cảnh báo ToS bắt buộc mọi surface.

FR30: Login Facebook bằng uid/password (bait-cookie → fill form → handle "Continue" prompt); bổ sung cho `loginWithCookie` khi không có cookie sẵn.

FR31: 2FA TOTP injection khi login trigger challenge; nhận 32-char seed, sinh code qua `otplib`; pin version chính xác (crypto dependency).

FR32: Proxy rotation qua 3 provider (proxyfb.com, tmproxy.com, shoplike.vn); mỗi provider `rotate(key)` / `current(key)` trả proxy string; wire vào `browserOptions.proxy`.

FR33: File-queue inputs (target pages / contents / links) đọc từ file hoặc API body; FIFO thread-safe; random content segment; expose qua CLI/MCP/API action `messenger` — additive, dry-run mặc định.
FR34: Dashboard có thể import/lưu Facebook session cookie, chọn account đã lưu, import content/links/recipients, và chạy single/batch campaign qua UI giống flow WinForms của C# port; cookie không bị log hay persist raw ngoài phạm vi session/profile rõ ràng.
FR35: Dashboard hiển thị progress/history cho Messenger jobs và cho phép operator xem preview trước khi chạy thật.

### NonFunctional Requirements

NFR1: Rate-limit safety — mọi vòng lặp action (scrape scroll + automate) có delay 1-3s, bounded retry, stop condition; automate dùng batch nhỏ hơn scrape do account risk cao hơn.

NFR2: Anti-detection — dùng puppeteer-extra-plugin-stealth như Threads/Twitter; delay rộng hơn cho Facebook.

NFR3: Security — session cookie `c_user`/`xs` là dữ liệu nhạy cảm; không log, không echo trong response; mọi record scope theo `userId`.

NFR4: Selector resilience — ưu tiên anchor theo `role`/`aria-label`/text, bọc selector trong helper và tài liệu `docs/agents/selectors-facebook.md`; không hard-code rải rác.

NFR5: Consistency — output khớp normalized shape của các nền tảng khác; entrypoint chỉ orchestrate/validate/format, không nhân bản logic scraper.

NFR6: Testability — unit test cho parser/normalizer, smoke test gated bởi session/env availability, contract test khi public surface (MCP/API/CLI) đổi.

NFR7: Delay sàn cho write action Epic 4 — Group actions delay 30-90s; friend requests delay 60-180s. Không giảm dưới ngưỡng sàn dù người dùng cấu hình.

NFR8: `runGuardedBatch` bắt buộc — Mọi vòng lặp ghi hàng loạt FR-18..FR-22 phải dùng hoặc extend `runGuardedBatch`. Không tự viết vòng lặp mutate mới.

NFR9: Cảnh báo account risk không thể tắt — FR-18, FR-19, FR-21, FR-22, FR-23 bắt buộc hiển thị cảnh báo trước thực thi thật. Người dùng không suppress được.

NFR10: Giới hạn throughput scheduling — Scheduler worker ≤ 5 scheduled posts/giờ/user. Vượt: enqueue với jitter.

NFR11: Không thu thập PII nhạy cảm — Mọi scraper Epic 4 không thu thập SĐT, email, địa chỉ kể cả khi DOM hiển thị. Filter ở tầng normalizer.

### Additional Requirements

- Architecture Addendum A xác nhận Facebook là nền tảng thứ năm, bổ sung chứ không viết lại kiến trúc brownfield hiện có.
- ADR-006: Facebook scrape đi qua adapter pattern hiện có, clone gần nhất từ `src/scrapers/threads/index.js`.
- ADR-007: Facebook automate tách khỏi scrape, nằm ở `api/services/facebookAutomation.js` và `src/automation/facebook/*.js`, mặc định dry-run.
- Wiring requirement: thêm `import facebook from './facebook/index.js'`, thêm `facebook`/`fb` vào `platforms`, thêm `facebook`/`fb` vào `needsPuppeteer`.
- Login contract lệch Twitter: `loginWithCookie(page, { c_user, xs })` nhận object, không phải string.
- Selector knowledge phải tập trung ở `docs/agents/selectors-facebook.md`.
- Implementation phases từ Architecture A.7: Phase 1 Scrape core; Phase 2 Registry + tests; Phase 3 Expose surfaces; Phase 4 Automate; Phase 5 Persisted workflows.
- Phase 1 blockers: tài liệu cách lấy cookie `c_user`/`xs`; xác minh field follower scrape thực tế.
- Phase 4 blocker: chốt batch size an toàn cho automate bằng account thử nghiệm.

### UX Design Requirements

Không có UX Design document riêng. Dashboard work ở MVP là tích hợp surface hiện có, không tạo UX flow mới độc lập. Nếu dashboard story phát sinh UI mới, story đó phải tuân thủ shared CSS/helpers và API-side authorization theo architecture.

### FR Coverage Map

FR1: Epic 1 - Scrape Facebook profile
FR2: Epic 1 - Scrape Facebook posts
FR3: Epic 1 - Scrape Facebook followers (with public-data fallback)
FR4: Epic 1 - Search Facebook posts
FR5: Epic 1 - Register Facebook in `platforms` dispatcher
FR6: Epic 2 - Auto-like Facebook posts (dry-run default)
FR7: Epic 2 - Auto-comment on Facebook posts (dry-run default)
FR8: Epic 2 - Create Facebook post (dry-run default)
FR9: Epic 2 - Shared automate guardrails (delay, batch, stop)
FR10: Epic 1 - Login with Facebook session cookie (`c_user` + `xs`)
FR11: Epic 3 - MCP tool/option for Facebook
FR12: Epic 3 - CLI `--platform facebook`
FR13: Epic 3 - REST API + Dashboard for Facebook
FR14: Epic 3 - Operation persistence via Prisma
FR15: Epic 4 - Lên lịch post Facebook (scheduler worker)
FR16: Epic 4 - Auto-share post lên timeline
FR17: Epic 4 - View boost qua scroll simulation
FR18: Epic 4 - Tham gia nhóm Facebook tự động
FR19: Epic 4 - Đăng bài hàng loạt vào nhiều groups
FR20: Epic 4 - Scrape thành viên nhóm
FR21: Epic 4 - Gửi kết bạn tự động
FR22: Epic 4 - Hủy lời mời kết bạn pending
FR23: Epic 4 - Newsfeed farming / account warming
FR24: Epic 5 - Token scraping (fb_dtsg/lsd/jazoest/hsi/spin)
FR25: Epic 5 - Page list via Graph API
FR26: Epic 5 - Messenger CTA check (GraphQL doc_id)
FR27: Epic 5 - Share post → Page qua Messenger
FR28: Epic 5 - Messenger message compose & send
FR29: Epic 5 - Batch messenger share campaign (runGuardedBatch)
FR30: Epic 5 - uid/pass login mode (bait cookie)
FR31: Epic 5 - 2FA TOTP injection
FR32: Epic 5 - Proxy rotation (3 providers)
FR33: Epic 5 - File-queue inputs + surface exposure

## Epic List

### Epic 1: Facebook Data Reading
Người dùng có thể đọc dữ liệu Facebook (profile, posts, followers, search) qua Node library bằng cùng interface với các nền tảng khác. Bao gồm login bằng session cookie, Facebook adapter module, đăng ký vào dispatcher và bộ scrape function chuẩn hóa output.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR10

### Epic 2: Facebook Automation
Người dùng có thể tự động hóa hành động ghi (like, comment, post) trên Facebook với cơ chế an toàn: dry-run mặc định, delay 1-3s, bounded batch và stop condition. Logic nằm ở Facebook automation service, tách hoàn toàn khỏi adapter scrape (theo ADR-007).
**FRs covered:** FR6, FR7, FR8, FR9

### Epic 3: Facebook Multi-Surface & Persistence
Người dùng truy cập mọi tính năng Facebook (scrape + automate) qua CLI, MCP, REST API/Dashboard, với Operation persistence qua Prisma và Socket.IO updates cho job dài. Surface exposure dùng lại pattern hiện có thay vì tạo chiến lược riêng cho Facebook.
**FRs covered:** FR11, FR12, FR13, FR14

### Epic 4: Facebook Growth Automation
Người dùng có các tính năng tăng trưởng tài khoản Facebook nâng cao: lên lịch post, share post, view boost (Cluster 3 — rủi ro thấp), tham gia/đăng bài nhóm hàng loạt và scrape member (Cluster 1 — rủi ro trung bình), gửi/hủy kết bạn tự động và account warming (Cluster 2 — rủi ro trung-cao). Mọi tính năng ghi kế thừa `runGuardedBatch` từ Epic 2, `dryRun` mặc định, cảnh báo account risk không tắt được.
**FRs covered:** FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23

## Epic 1: Facebook Data Reading

Người dùng có thể đọc dữ liệu Facebook (profile, posts, followers, search) qua Node library bằng cùng interface với các nền tảng khác. Bao gồm login bằng session cookie, Facebook adapter module, đăng ký vào dispatcher và bộ scrape function chuẩn hóa output.

### Story 1.1: Facebook adapter scaffold + login + dispatcher registration

As a developer using XActions,
I want a Facebook adapter module registered in the platform dispatcher with login support,
So that I have a working foundation to build scrape functions on.

**Acceptance Criteria:**

**Given** the XActions codebase with `src/scrapers/` multi-platform structure
**When** `src/scrapers/facebook/index.js` is created with `createBrowser`, `createPage`, `loginWithCookie` exports
**Then** the module follows the same pattern as `src/scrapers/threads/index.js` (Puppeteer + Stealth)
**And** `loginWithCookie(page, { c_user, xs })` accepts an object with both cookies
**And** missing/invalid cookies return a clear error message without retrying blindly
**And** cookies never appear in logs or error messages (security redaction)

**Given** the `src/scrapers/index.js` dispatcher
**When** Facebook is registered in the `platforms` object with aliases `facebook` and `fb`
**Then** `getPlatform('facebook')` and `getPlatform('fb')` return the Facebook module
**And** `'facebook'` and `'fb'` are in the `needsPuppeteer` branch of the `scrape()` function
**And** calling `scrape('facebook', 'nonexistent', {})` throws an appropriate error listing available actions

**Given** the new module
**When** inspecting the file structure
**Then** `docs/agents/selectors-facebook.md` is created (initially empty/skeleton)
**And** unit tests exist for login error handling and dispatcher wiring

### Story 1.2: Scrape Facebook profile

As a growth marketer using XActions,
I want to scrape a public Facebook profile/page,
So that I can analyze Facebook accounts with the same normalized format as Twitter.

**Acceptance Criteria:**

**Given** a valid Facebook session cookie and a public profile handle or URL
**When** `scrape('facebook', 'profile', { page, username: '<handle>' })` is called
**Then** the system returns an object with: `name`, `username`, `bio`, `avatar`, `followers`, `url`, `platform: 'facebook'`
**And** the shape matches the profile shape of other platform adapters (Threads/Twitter)

**Given** a non-existent or blocked profile
**When** scrape profile is called
**Then** the system returns a clear error (not a hang, not an empty unlabeled object)

**Given** the profile scraping logic
**When** extracting data from the DOM
**Then** selectors are documented in `docs/agents/selectors-facebook.md`
**And** selectors prefer `role`/`aria-label`/text anchors over class names
**And** unit tests validate the normalizer/parser logic

### Story 1.3: Scrape Facebook posts

As a growth marketer using XActions,
I want to scrape recent posts from a Facebook profile/page with a configurable limit,
So that I can collect Facebook content for cross-platform analysis.

**Acceptance Criteria:**

**Given** a valid session and a public profile/page
**When** `scrape('facebook', 'posts', { page, username, limit: 50 })` is called
**Then** each post in the result has: `id`, `text`, `timestamp`, `likes`, `comments`, `url`, `media: { images, hasVideo }`, `platform: 'facebook'`

**Given** the posts scraping loop
**When** scrolling to load more posts
**Then** there is a 1-3s delay between scrolls (rate-limit safety)
**And** there is a bounded retry limit when no new posts appear (maxRetries)
**And** the loop stops when `limit` is reached or content is exhausted

**Given** a page with fewer posts than `limit`
**When** the scraper reaches end of content
**Then** it returns whatever posts were collected without error

### Story 1.4: Scrape Facebook followers (public-data fallback)

As a growth marketer using XActions,
I want to scrape followers of a Facebook profile/page when publicly available,
So that I can understand audience composition without hitting a hard error when data is restricted.

**Acceptance Criteria:**

**Given** a profile where Facebook exposes the follower list publicly
**When** `scrape('facebook', 'followers', { page, username })` is called
**Then** the system returns an array of follower profiles (`name`, `username`, `url`)

**Given** a profile where Facebook does NOT expose the follower list publicly
**When** scrape followers is called
**Then** the system returns an object with `note` field explaining the limitation and `platform: 'facebook'`
**And** the system does NOT throw an error or return an empty unlabeled result

**Given** the follower scraping logic
**When** verifying available fields
**Then** `docs/agents/selectors-facebook.md` documents which fields are actually extractable (resolves Phase 1 blocker Q3)

### Story 1.5: Search Facebook posts

As a growth marketer using XActions,
I want to search Facebook posts by query,
So that I can discover content and conversations relevant to my niche.

**Acceptance Criteria:**

**Given** a valid session and a search query
**When** `scrape('facebook', 'search', { page, query, limit: 30 })` is called
**Then** the system returns an array of results with: `id`, `text`, `author`, `timestamp`, `url`, `platform: 'facebook'`

**Given** the search loop
**When** scrolling for more results
**Then** it respects `limit` and has bounded retry when no new results appear
**And** delay 1-3s between scrolls

**Given** a query with no results
**When** the search returns empty
**Then** the system returns an empty array, not an error

## Epic 2: Facebook Automation

Người dùng có thể tự động hóa hành động ghi (like, comment, post) trên Facebook với cơ chế an toàn: dry-run mặc định, delay 1-3s, bounded batch và stop condition. Logic nằm ở Facebook automation service, tách hoàn toàn khỏi adapter scrape (theo ADR-007).

### Story 2.1: Automation service scaffold + shared guardrails

As a multi-account operator using XActions,
I want a Facebook automation service with built-in safety guardrails,
So that every write action is protected by dry-run, delay, and batch limits by default.

**Acceptance Criteria:**

**Given** the XActions codebase
**When** `api/services/facebookAutomation.js` is created (and `src/automation/facebook/` for loop scripts)
**Then** the service is separate from the scrape adapter (per ADR-007)
**And** it reuses the Facebook login from Epic 1 (`loginWithCookie` with `c_user`/`xs`)

**Given** any write function in the service
**When** the function signature is defined
**Then** it accepts a `dryRun` parameter defaulting to `true`
**And** a shared guardrail helper enforces: 1-3s delay between actions, bounded batch size, bounded retry, explicit stop condition

**Given** a batch size exceeding the configured threshold
**When** a write operation is requested
**Then** the system rejects or splits the batch — no unbounded write loop is possible
**And** an account-risk warning is surfaced before the first real write batch

**Given** the guardrail helper
**When** unit testing
**Then** tests confirm no write executes when `dryRun` has not been explicitly disabled

### Story 2.2: Auto-like Facebook posts (dry-run default)

As a multi-account operator using XActions,
I want to auto-like one or more Facebook posts with a dry-run preview,
So that I can see exactly what will be affected before executing for real.

**Acceptance Criteria:**

**Given** the automation service with shared guardrails
**When** the like function is called with default `dryRun=true`
**Then** the system returns the list of posts that would be liked WITHOUT sending any action to Facebook

**Given** `dryRun=false` is explicitly set
**When** the like action executes
**Then** likes are performed with 1-3s delay between actions and bounded batch size
**And** an Operation record is created (type, status, progress, result) scoped by `userId`

**Given** a like action that fails (blocked, checkpoint)
**When** the failure occurs
**Then** a clear error is returned and recorded in the Operation status

### Story 2.3: Auto-comment on Facebook posts (dry-run default)

As a multi-account operator using XActions,
I want to auto-comment user-provided content on posts with a dry-run preview,
So that I can review target posts and comment text before posting.

**Acceptance Criteria:**

**Given** the automation service
**When** the comment function is called with default `dryRun=true`
**Then** the preview shows the target post(s) and the comment content that would be posted

**Given** `dryRun=false`
**When** comments execute
**Then** there is delay between comments, bounded batch, and a clear stop condition
**And** comment content is user-provided — the system does NOT auto-generate content
**And** an Operation record tracks the run scoped by `userId`

### Story 2.4: Create Facebook post (dry-run default)

As a multi-account operator using XActions,
I want to create a Facebook text post (with optional media) with a dry-run preview,
So that I can confirm content before it goes live.

**Acceptance Criteria:**

**Given** the automation service
**When** the post-create function is called with default `dryRun=true`
**Then** the preview shows the post content that would be published

**Given** `dryRun=false`
**When** the post executes successfully
**Then** the created post URL/ID is returned in the Operation result

**Given** a post failure (blocked, checkpoint)
**When** the failure occurs
**Then** a clear message is returned and written to the Operation status

## Epic 3: Facebook Multi-Surface & Persistence

Người dùng truy cập mọi tính năng Facebook (scrape + automate) qua CLI, MCP, REST API/Dashboard, với Operation persistence qua Prisma và Socket.IO updates cho job dài. Surface exposure dùng lại pattern hiện có thay vì tạo chiến lược riêng cho Facebook.

### Story 3.1: CLI `--platform facebook`

As a CLI user of XActions,
I want to run scrape and automate commands against Facebook via `--platform facebook`,
So that I can use Facebook from the terminal like any other platform.

**Acceptance Criteria:**

**Given** the XActions CLI and a registered Facebook adapter
**When** `xactions scrape --platform facebook --profile <handle>` is run
**Then** normalized output is returned through the existing exporters (JSON/CSV/...)
**And** the command does NOT duplicate scraper logic (delegates to the adapter)

**Given** an automate command via CLI
**When** the user runs a Facebook write command
**Then** there is a dry-run flag that defaults to enabled
**And** disabling dry-run requires an explicit flag

**Given** an invalid platform value
**When** the command runs
**Then** the CLI surfaces the dispatcher's `Unknown platform` error cleanly

### Story 3.2: MCP tool/option for Facebook

As an AI agent using the XActions MCP server,
I want to call Facebook scrape and automate actions with the same schema as other platforms,
So that I don't need platform-specific handling.

**Acceptance Criteria:**

**Given** the MCP server
**When** a tool is called with `platform: "facebook"` or `"fb"`
**Then** supported scrape and automate actions dispatch correctly

**Given** the MCP tool schema
**When** Facebook support is added
**Then** the schema additions are additive — existing tool contracts are not broken
**And** a contract test verifies schema stability for the Facebook tool

**Given** an automate action via MCP
**When** invoked
**Then** dry-run default behavior is preserved (consistent with CLI and service)

### Story 3.3: REST API + Dashboard for Facebook

As a dashboard user of XActions,
I want to access Facebook scrape and automate via REST API and see it in the dashboard,
So that I can operate Facebook from the web UI.

**Acceptance Criteria:**

**Given** the Express API
**When** Facebook routes are added
**Then** routes validate input and authorize by `userId` at the boundary
**And** business logic lives in `api/services` (routes only orchestrate/validate/format)
**And** heavy/write operations sit behind rate limiting or the job queue

**Given** the dashboard
**When** a Facebook page/section is added
**Then** it calls the API using the unified response shape
**And** security relies on API-side authorization, not client-only guards
**And** it reuses shared CSS/helpers per architecture

### Story 3.4: Operation persistence + Socket.IO updates

As a dashboard user of XActions,
I want Facebook automation jobs tracked in the database with real-time progress,
So that I can monitor long-running jobs and review their history.

**Acceptance Criteria:**

**Given** a Facebook automation job
**When** the job runs
**Then** an Operation record is created/updated with progress, scoped by `userId`
**And** Socket.IO emits progress updates for long-running jobs visible on the dashboard

**Given** the persistence design
**When** implementing storage
**Then** the existing `Operation` model is reused — no Facebook-specific Prisma table is created at MVP (per assumption)
**And** any new snapshot table is added only if a story/future phase requires explicit retention

**Given** records belonging to a user
**When** read or written
**Then** access is always scoped by `userId` — no cross-user read/write

## Epic 4: Facebook Growth Automation

Người dùng có các tính năng tăng trưởng tài khoản Facebook nâng cao, nhóm theo 3 cluster rủi ro tăng dần (cũng là thứ tự triển khai đề xuất). Mọi tính năng ghi kế thừa `runGuardedBatch` từ Epic 2, `dryRun` mặc định `true`, cảnh báo account risk không thể tắt. Nguồn: PRD `prd-XActions-2026-06-10-epic4`.

### Story 4.1: Schedule Facebook post (dry-run default)

As a growth marketer using XActions,
I want to schedule a Facebook post to publish at a specific datetime,
So that I can maintain consistent content without being online at peak hours.

**Acceptance Criteria:**

**Given** the Facebook automation service and a valid session
**When** `scheduleFacebookPost(page, { content, mediaUrls?, scheduledAt }, options)` is called with default `dryRun=true`
**Then** the system returns a preview of the content and scheduled time WITHOUT creating a `Schedule` record

**Given** `dryRun=false` is explicitly set
**When** the schedule is created
**Then** a Prisma `Schedule` record is created scoped by `userId` and a `scheduleId` is returned
**And** the scheduler worker executes the post within ±2 minutes of `scheduledAt`
**And** scheduler throughput is capped at ≤5 scheduled posts/hour/user (NFR10)

**Given** a scheduled post that fails (expired session, checkpoint)
**When** the execution time arrives
**Then** `Schedule.status = 'failed'` is set with a clear reason and no blind retry occurs

### Story 4.2: Auto-share Facebook post (dry-run default)

As a growth marketer using XActions,
I want to auto-share one or more post URLs to my timeline,
So that I can amplify content reach with batch control.

**Acceptance Criteria:**

**Given** the automation service routing through `runGuardedBatch`
**When** `shareFacebookPosts(page, postUrls, options)` is called with default `dryRun=true`
**Then** the system returns the list of URLs that would be shared WITHOUT any DOM interaction

**Given** `dryRun=false`
**When** the share executes
**Then** there is a 1-3s delay between shares with bounded batch (default max 10)
**And** each result entry has `{ target, ok, alreadyShared?, error? }`
**And** an account-risk warning is surfaced before the first real share

**Given** an invalid or deleted `postUrl`
**When** validation runs
**Then** a clear error is returned before opening the browser

### Story 4.3: View boost via scroll simulation

As a growth marketer using XActions,
I want to simulate natural scrolling on a page/post,
So that I can increase organic engagement signals without explicit actions.

**Acceptance Criteria:**

**Given** the automation service
**When** `warmupScrollFeed(page, targetUrl, { durationSeconds })` is called
**Then** the system scrolls with randomized speed and pauses, performing NO click/like/comment actions

**Given** a `durationSeconds` value exceeding 300
**When** the function runs
**Then** the value is clamped to 300s (not rejected)

**Given** `dryRun=true`
**When** the function is invoked
**Then** the URL is validated and parameters computed but the browser is NOT opened
**And** no Operation record is created in dry-run (only on real execution)

### Story 4.4: Join Facebook groups (dry-run default)

As a multi-group operator using XActions,
I want to join Facebook groups automatically by URL or keyword search,
So that I can expand my group reach with safety controls.

**Acceptance Criteria:**

**Given** URL mode with `{ groupUrls: string[] }` or search mode with `{ keyword, limit }`
**When** `joinFacebookGroups(page, ..., options)` is called with default `dryRun=true`
**Then** the system lists the groups that would be joined WITHOUT sending any join request

**Given** `dryRun=false`
**When** the join executes
**Then** requests go through `runGuardedBatch` with 30-90s delay between groups (NFR7)
**And** an account-risk warning is mandatorily surfaced before the first batch (NFR9)

**Given** a group requiring admin approval
**When** the join request is sent
**Then** the Operation result records `pending` status — this is NOT treated as an error

### Story 4.5: Batch post to multiple groups (dry-run default)

As a multi-group operator using XActions,
I want to post one content to multiple Facebook groups in a batch,
So that I can distribute content efficiently with spam-safe delays.

**Acceptance Criteria:**

**Given** `{ groupUrls: string[], content, mediaUrls?, batchLimit=10 }`
**When** `postToFacebookGroups(page, ..., options)` is called with default `dryRun=true`
**Then** the preview lists the target groups and content WITHOUT opening the browser

**Given** `groupUrls.length` exceeds `batchLimit`
**When** the function runs without `force=true`
**Then** it requires an explicit `force=true` parameter to proceed

**Given** `dryRun=false`
**When** the batch executes through `runGuardedBatch`
**Then** there is a 30-90s delay between groups and a single aggregated Operation with per-group progress
**And** a failed group (not a member, posting restricted) does NOT abort the batch
**And** an account-risk warning is surfaced before the batch (NFR9)

### Story 4.6: Scrape Facebook group members

As a growth marketer using XActions,
I want to scrape the member list of a Facebook group,
So that I can understand group composition for targeting.

**Acceptance Criteria:**

**Given** a group URL and a valid session
**When** `scrapeGroupMembers(page, groupUrl, { limit })` is called
**Then** the system returns an array of `{ name, username?, profileUrl, platform: 'facebook' }`

**Given** a group that does NOT expose its member list (or the account is not a member)
**When** scrape members is called
**Then** the system returns an object with a `note` field explaining the limitation — it does NOT throw

**Given** the member scraping logic
**When** extracting member data
**Then** phone numbers and emails are NEVER collected even if visible in the DOM (NFR11)
**And** scroll has 1-3s delay with bounded retry

### Story 4.7: Send friend requests automatically (dry-run default)

As a growth hacker using XActions,
I want to send friend requests by UID list, suggestions, or location filter,
So that I can build a targeted network with conservative rate limits.

**Acceptance Criteria:**

**Given** `{ mode: 'uid_list'|'suggestions'|'location', targets?, location?, limit }`
**When** `sendFriendRequests(page, options)` is called with default `dryRun=true`
**Then** the system lists the profiles that would receive requests WITHOUT sending any

**Given** `dryRun=false`
**When** requests execute through `runGuardedBatch`
**Then** there is a 60-180s delay between requests and `batchLimit` ≤ 20/session (NFR7)
**And** a non-suppressible warning is shown: friend-request spam is the top cause of checkpoint (NFR9)

**Given** a profile already a friend, with a pending request, or not found
**When** the request is processed
**Then** it is skipped and logged in the Operation — the batch does NOT fail

**Given** any mode of operation
**When** profile data is read
**Then** phone numbers are NEVER scraped; `location` filter uses only publicly self-declared location (NFR11)

### Story 4.8: Cancel pending friend requests (dry-run default)

As a growth hacker using XActions,
I want to bulk-cancel pending friend requests,
So that I can free up my friend-request quota without manual clicking.

**Acceptance Criteria:**

**Given** `{ limit, olderThanDays? }`
**When** `cancelPendingFriendRequests(page, options)` is called with default `dryRun=true`
**Then** the system returns the list of requests that would be cancelled `[{ name, profileUrl, dateSent }]`

**Given** `dryRun=false`
**When** the cancellation executes through `runGuardedBatch`
**Then** there is a 2-5s delay between cancels and the result returns `{ cancelled, failed, remaining }`

**Given** an `olderThanDays` filter
**When** selecting requests to cancel
**Then** only pending requests older than N days are cancelled

### Story 4.9: Newsfeed farming / account warming (dry-run default)

As a new-account operator using XActions,
I want to warm up an account with natural newsfeed scrolling and light reactions,
So that I can build a normal behavioral fingerprint before running heavier automation.

**Acceptance Criteria:**

**Given** `{ durationSeconds, reactProbability=0.05 }`
**When** `warmupAccount(page, options)` is called with default `dryRun=true`
**Then** the system describes the behavior sequence WITHOUT opening the browser or performing actions

**Given** `dryRun=false`
**When** the warmup runs
**Then** it scrolls with randomized pauses (≥5s pause at least once per 3 screens of scroll)
**And** reactions occur only if `allowReactions=true` (default false) and `reactProbability` is capped at 0.2
**And** NO follow/friend/comment actions occur in warmup mode

**Given** a `durationSeconds` value exceeding 600
**When** the function runs
**Then** the value is clamped to 600s/session
**And** a mandatory warning notes warming does not guarantee avoiding checkpoint (NFR9)

## Epic 5: Facebook Messenger Port (from SST_TOOL_FB C#)

Port các tính năng từ SST_TOOL_FB (C# WinForms) vào XActions theo nguyên tắc REUSE-FIRST: chỉ viết mới phần C# có mà XActions chưa có; tái dùng guardrail, login, dispatcher, surfaces đã build ở Epic 1-3. Nguồn: `auto-crawl-tiktok-post-fb/automation-facebook/SST_TOOL_FB`. Plan chi tiết: `facebook-messenger-port-plan.md`.

**FRs covered:** FR24, FR25, FR26, FR27, FR28, FR29, FR30, FR31, FR32, FR33, FR34, FR35

### Story 5.1: Facebook GraphQL/HTTP layer

As a developer building Facebook Messenger automation in XActions,
I want a GraphQL/HTTP helper layer (token scraper + page list + Messenger CTA check),
So that the Messenger share campaign (Story 5.2) has tokens, pages, and eligibility data.

**Acceptance Criteria:**

**Given** a valid Facebook session cookie string
**When** `getFacebookTokens(cookie)` is called
**Then** it returns `{ fb_dtsg, lsd, jazoest, hsi, spin_r, spin_t }` parsed from facebook.com HTML via anchored regex (null if logged-out, never throws)

**Given** the cookie
**When** `getPagesFromCookie(cookie)` is called
**Then** it returns an array of `{ pageId, name, accessToken }` via Graph API (empty array if none)

**Given** a page ID + actor ID + tokens
**When** `checkMessengerCTA(pageId, actorId, tokens)` is called
**Then** it returns `{ eligible: boolean }` based on GraphQL doc_id response (false on unexpected shape)

**Given** any function
**When** called
**Then** cookie/accessToken values are never logged (NFR3); injectable `fetchImpl` seam keeps tests browser-free

### Story 5.2: Messenger share automation (CORE)

As a multi-account operator using XActions,
I want to share a Facebook post to target Pages via Messenger with a dry-run preview,
So that I can run share campaigns at scale with safety guardrails.

**Acceptance Criteria:**

**Given** an authenticated page + post URL + target page ID
**When** `shareToMessenger(page, postUrl, targetPageId)` is called with dryRun=false
**Then** it finds share button + "via Messenger" via fallback selector chain, selects target, composes + sends, returns success/failure

**Given** dryRun=true (default)
**When** `messengerShareCampaign(accounts, options)` is called
**Then** no DOM write occurs; returns preview of targets that WOULD be messaged

**Given** message content
**When** composing
**Then** it supports `**`-delimited random segments, types line-by-line with Shift+Enter, strips emoji surrogates, detects "Couldn't send" → marks blocked

**Given** the batch
**When** running
**Then** it routes through `runGuardedBatch` (dry-run default, delay seam, bounded batch, account-risk warning) — NO custom loop

### Story 5.3: Auth modes & proxy rotation

As a multi-account operator using XActions,
I want uid/password login + 2FA TOTP + proxy rotation from 3 providers,
So that I can run campaigns across many accounts with different IPs.

**Acceptance Criteria:**

**Given** uid + password (no cookie available)
**When** `loginWithPassword(page, { uid, pass, baitCookie? })` is called
**Then** it injects bait cookie, fills login form, handles "Continue" prompt, returns authenticated page

**Given** a 32-char 2FA seed
**When** login triggers 2FA challenge
**Then** TOTP code is generated via `otplib` and injected

**Given** a proxy provider key (proxyfb / tmproxy / shoplike)
**When** `rotateProxy(provider, key)` is called
**Then** it calls the provider's rotate API and returns a fresh proxy string, ready to wire into `browserOptions.proxy`

### Story 5.4: Input queue & surface exposure

As a CLI/MCP/API user of XActions,
I want to run Messenger share campaigns from any surface with file-based target queues,
So that I can operate campaigns from terminal, AI agent, or web dashboard.

**Acceptance Criteria:**

**Given** a file with target page IDs (one per line) + a content file + a links file
**When** the campaign runs
**Then** targets are consumed FIFO (thread-safe), content picked randomly from `**`-segments, links picked randomly

**Given** the CLI surface
**When** `xactions automate --action messenger-share --targets file.txt --content content.txt --links links.txt`
**Then** it runs the campaign with dry-run default, outputs JSON result

**Given** MCP + REST API
**When** called with action `messenger` + targets/content/links in body
**Then** same behavior as CLI, additive (no existing surface contract broken)

### Story 5.5: Facebook Session & Campaign Manager UI

As a multi-account operator using XActions,
I want to manage Facebook sessions, accounts, and Messenger share campaigns from the existing dashboard,
So that I can run campaigns using the WinForms flow (import → select → preview → run) without leaving the dashboard or adding a new UI surface.

**Acceptance Criteria:**

**Given** the user opens `dashboard/facebook.html` and enters a label (max 50 chars), `c_user` (must match `/^\d{10,20}$/`), and `xs` (non-empty) cookie values
**When** they click save/import
**Then** the session is sent to `POST /api/facebook/accounts` for server-side encrypted storage
**And** the UI stores only the returned opaque account ID — never the raw cookie values
**And** cookie values are never echoed in logs or rendered in the UI after save
**And** a duplicate label is rejected with an inline error before the API call is made

**Given** the user enters an invalid `c_user` (not matching `/^\d{10,20}$/`) or an empty `xs`
**When** they click save/import
**Then** an inline validation error is shown and the save is blocked

**Given** one or more saved Facebook accounts exist
**When** the user opens the Facebook dashboard page
**Then** `GET /api/facebook/accounts` is called and a list of saved accounts (label + opaque ID) is shown
**And** accounts can be selected via checkbox (single or multiple) as the active session(s)
**And** the selection can be changed without leaving the page

**Given** a saved account entry exists
**When** the user clicks the remove button on that entry
**Then** the account is deleted from server-side storage
**And** the remove button is disabled for accounts with an active run in progress

**Given** one or more accounts are selected and content inputs are filled
**When** the user views the preview panel
**Then** the dashboard shows parsed recipients, the full segment pool, and a sample composed message for the first recipient
**And** all post link(s) are listed before execution

**Given** one post link and one or more selected accounts
**When** the user clicks run (single-run mode, auto-detected: link count = 1)
**Then** the system calls `POST /api/facebook/automate` with the active session and inputs
**And** the result is shown in the existing result/progress area on the same page

**Given** multiple post links (>1) or multiple selected accounts
**When** the user clicks run (batch mode, auto-detected: link count > 1 or multiple accounts)
**Then** `POST /api/facebook/automate` is called with a `postUrls[]` array
**And** recipients are distributed round-robin across selected accounts
**And** the batch is routed via `runGuardedBatch` with account rotation and delay guardrails
**And** the queue is consumed FIFO

**Given** a run is in progress
**When** the backend emits `facebook:operation` Socket.IO events
**Then** the dashboard shows live progress and final completion/failure state
**And** the run button is disabled and labelled "Run in progress…" until the job completes

**Given** the page is refreshed while or after a job has run
**When** the page loads
**Then** the UI reads the last `operationId` from localStorage and calls `GET /api/facebook/operations/:id`
**And** the progress panel is restored to the last known job state

**Given** no valid account session exists for the selected account
**When** the user attempts to run
**Then** the run button is disabled with an "Account session missing" tooltip

**Given** the API returns a `sessionExpired` error during a run
**When** the error is received
**Then** the UI shows an inline auth error and halts the run without retrying

**Given** dry-run is enabled (default on)
**When** the user clicks run
**Then** the result area shows the dry-run preview (targets, content, links) without sending any Messenger message
**And** the result area has a yellow/warning border and displays "🛡️ Dry-run preview — no messages sent"

**Given** the user toggles dry-run off
**When** dry-run is disabled
**Then** the run button changes to a red "⚠️ Send for real — click again to confirm" label
**And** a second click fires the real send
**And** if dry-run is re-enabled before the second click the button reverts to its normal state

**Given** any run completes (dry-run or real)
**When** results are returned
**Then** server logs must not contain `c_user` or `xs` values
**And** the account-list API response contains label and opaque ID only — no cookie data

**Dev Notes:**
- Extend `dashboard/facebook.html` — add up to 3 new `.card` blocks; no new nav links; no new `.html` file; no new top-level route
- Reuse existing form / button / result-panel patterns from other dashboard pages
- Cookie storage: `POST /api/facebook/accounts` saves encrypted cookie server-side; `GET /api/facebook/accounts` returns label + opaque ID only (NFR3)
- Socket.IO: load `socket.io-client`, authenticate with JWT, join user room, listen on `facebook:operation` events for progress updates
- Messenger-share campaign form: implement as a **separate `.card`** — do NOT add it as a 4th option in the existing like/comment/post select
- `POST /api/facebook/automate` accepts `postUrls: string[]`; backend iterates per URL and emits per-URL progress via `facebook:operation` Socket.IO events

**Review Findings (pre-code, opus adversarial, 2026-06-12):**

- [x] F-01 ✓ server-side encrypted storage, POST/GET /api/facebook/accounts
- [x] F-02 ✓ preview AC updated to segment pool + sample message
- [x] F-03 ✓ mode auto-detected by link count
- [x] F-04 ✓ multi-account ACs added (checkbox selector, round-robin, runGuardedBatch)
- [x] F-05 ✓ cookie error split into client-side guard + server-side sessionExpired AC
- [x] F-06 ✓ Socket.IO dev note added
- [x] F-07 ✓ GET /api/facebook/operations/:id added, refresh-restore AC added
- [x] F-08 ✓ label field spec added (50 chars, no duplicates)
- [x] F-09 ✓ postUrls[] backend extension specified
- [x] F-10 ✓ dev note: separate card, not 4th select option
- [x] F-11 ✓ account delete AC added
- [x] F-12 ✓ concurrency guard AC added (run button disabled while in progress)
- [x] F-13 ✓ dry-run visual specified (yellow border + banner text)
- [x] F-14 ✓ two-step inline confirmation AC added
- [x] F-15 ✓ cookie validation regex added
- [x] F-16 ✓ Dev Notes constraints tightened (card count + no new files)
- [x] F-17 dismissed (WinForms reference — noise)
- [x] F-18 ✓ NFR3 promoted to formal AC (logs + API response constraints)
