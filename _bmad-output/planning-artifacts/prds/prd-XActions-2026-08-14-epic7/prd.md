---
title: "Epic 7 — Facebook Advanced Scraping & Multi-Account Parallel Execution"
created: 2026-08-14
updated: 2026-08-14
status: draft
epic: 7
prd_ref:
  - prd-XActions-2026-06-08
  - prd-XActions-2026-06-10-epic4
---

# PRD: Epic 7 — Facebook Advanced Scraping & Multi-Account Parallel Execution

*Mở rộng năng lực scrape Facebook của XActions để phục vụ lead generation và market research, với multi-type search, comments, group content, và multi-account parallel execution.*

## 0. Mục Đích Tài Liệu

PRD này là phần tiếp theo của `prd-XActions-2026-06-08` (Epics 1–3: scrape, automate, CLI/MCP/REST/Persistence) và `prd-XActions-2026-06-10-epic4` (Epic 4: growth automation). Epic 7 bổ sung các tính năng **đọc nâng cao** cho Facebook: search đa loại, comments, group posts/comments, kết hợp với **quản lý account pool** và **chạy song song** để tăng throughput. FR tiếp tục từ FR-54 (→ FR-55..FR-63). NFR tiếp tục từ NFR-9 (→ NFR-10..NFR-15).

Tài liệu này **không** đề cập UI; UI được defer sang phase sau. Dữ liệu scrape **không được lưu** trong XActions; XActions chỉ trả JSON để hệ thống downstream tự lưu.

## 1. Vision

XActions đã có khả năng scrape Facebook cơ bản (profile, posts, followers, search posts, group members, marketplace). Epic 7 đưa XActions lên mức **lead-generation ready**:

- Tìm kiếm đồng thời posts, people, pages, groups.
- Thu thập comments của post để hiểu engagement và sentiment.
- Thu thập posts và comments trong group để theo dõi cộng đồng.
- Tận dụng pool tài khoản Facebook đã nuôi để chạy song song, rút ngắn thời gian thu thập.
- Lọc account "live" trước khi dùng để giảm checkpoint giữa chừng.

Giá trị cốt lõi: người dùng growth/marketing có thể thu thập dữ liệu Facebook quy mô lớn qua cùng một MCP/API, không cần tự quản lý nhiều browser hoặc tài khoản thủ công.

## 2. Target User

### 2.1 Jobs To Be Done

- **Là người làm lead generation**, tôi muốn search nhiều keyword cùng lúc trên Facebook (posts/people/pages/groups) để tìm khách hàng tiềm năng và đối thủ.
- **Là người làm market research**, tôi muốn scrape comments của post để hiểu phản ứng thị trường.
- **Là người vận hành nhiều tài khoản**, tôi muốn dùng account pool để chạy song song nhiều task scrape, giảm tổng thời gian.
- **Là AI agent**, tôi muốn gọi MCP tool để scrape post comments, group posts, và search đa loại mà không cần cấu hình tài khoản thủ công cho mỗi request.

### 2.2 Non-Users

- Người cần Facebook Ads/Business automation — ngoài phạm vi.
- Người cần gửi tin nhắn hàng loạt (bulk DM) — ngoài phạm vi.
- Người cần lưu trữ/scoring dữ liệu trong XActions — ngoài phạm vi; chỉ trả JSON.

### 2.3 Key User Journeys

- **UJ-7.1: An search đa loại.** An chạy `x_facebook_search` với `query: "macbook pro 14"`, `type: "all"`, `limit: 20`. Hệ thống trả về posts, people, pages, groups riêng biệt. Realizes FR-57.
- **UJ-7.2: Bình scrape comments của post viral.** Bình chạy `x_facebook_post_comments` với `postUrl`, `limit: 100`, `includeReplies: true`. Hệ thống click "All comments", scroll, trả về mỗi comment kèm author, text, timestamp, likes, replies. Realizes FR-58.
- **UJ-7.3: Cường scrape group posts.** Cường chạy `x_facebook_group_posts` với `groupUrl`, `limit: 50`. Hệ thống dùng mobile UA, trả về posts trong group. Realizes FR-59.
- **UJ-7.4: Dung chạy song song nhiều task.** Dung gửi 4 task comments của 4 post khác nhau với `accountIds: ["acc1", "acc2", "acc3", "acc4"]`. Hệ thống lọc account live, gán mỗi task một account, chạy song song với `maxConcurrency: 4`, trả về kết quả gộp. Realizes FR-55, FR-56.

## 3. Glossary

- **Account pool** — Tập hợp các `FacebookAccount` của một user, có thể được lọc theo trạng thái live.
- **Live account** — Account có `fb_dtsg`/`c_user` hợp lệ, không nằm ở checkpoint, có thể dùng để scrape.
- **Health check** — Kiểm tra nhanh (HTTP, không mở browser) xem account có live không.
- **Parallel task** — Một đơn vị công việc scrape được gán cho một account cụ thể.
- **Hydration JSON** — JSON Facebook nhúng trong HTML dùng để hydrate React/Comet UI.
- **GraphQL replay** — Gửi lại request `POST /api/graphql/` với `doc_id` và tokens đã capture từ browser.
- **FacebookScrapeService** — Service điều phối việc scrape qua account pool, là lớp chung cho cả API và MCP.
- **DOM fallback** — Trích xuất dữ liệu từ DOM khi hydration/GraphQL không khả dụng.

## 4. Features

### 4.1 Account Health & Pool

**Description:** Trước khi chạy bất kỳ task scrape nào, hệ thống kiểm tra và lọc account để chỉ dùng account live. Sau đó phân bổ task cho các account này với giới hạn concurrency. Realizes UJ-7.4.

#### FR-55: Account health check

Người dùng có thể kiểm tra nhanh tài khoản Facebook có live không. Realizes UJ-7.4.

**Consequences (testable):**
- Gọi HTTP GET `https://www.facebook.com/` với cookie.
- Parse `fb_dtsg` từ HTML; xác thực `c_user` và `xs` từ cookie jar (không từ HTML).
- Kiểm tra checkpoint: body chứa `/checkpoint/`, `confirm that you're human`, hoặc `security check`.
- Trả về `{ status: 'active' | 'checkpoint' | 'dead', reason?: string, lastCheckAt: ISO8601 }`.
- Không mở browser; thời gian < 2 giây.
- Health cache TTL 5 phút; kết quả lưu vào `FacebookAccountHealth` (Prisma). `[ASSUMPTION: lưu trong Prisma cho bền vững; Redis cache chỉ dùng nếu triển khai production có Redis sẵn.]`

#### FR-56: Account pool & parallel runner

Hệ thống phân bổ nhiều task scrape cho nhiều account live với concurrency limit. Realizes UJ-7.4.

**Consequences (testable):**
- Nhận `tasks: Array<{ action, args }>` và `options: { accountIds[], maxConcurrency, delayBetweenLaunches }`.
- Lọc account theo health check (TTL 5 phút hoặc tươi hơn).
- Mỗi `FacebookAccount` có thể có `proxy` cố định; `AccountPool` gán task vào account có proxy đã gắn.
- Gán task cho account theo round-robin / least-recently-used trong số account active.
- Mỗi task mở browser riêng với `userDataDir: buildUserDataDir(c_user)`.
- `delayBetweenLaunches` mặc định 3-8 giây giữa các lần mở browser để tránh burst.
- Giới hạn `maxConcurrency` mặc định 4, tối đa 8.
- Retry task sang account khác nếu account bị checkpoint giữa chừng.
- Trả về `results[]` kèm `accountUsage` report.

### 4.2 Multi-Type Search

**Description:** Mở rộng `searchTweets` hiện tại để hỗ trợ search posts, people, pages, groups. Realizes UJ-7.1.

#### FR-57: Search Facebook multi-type

Người dùng có thể search Facebook theo 4 loại: posts, people, pages, groups, hoặc all. Realizes UJ-7.1.

**Consequences (testable):**
- Input: `query`, `type` (`posts`, `people`, `pages`, `groups`, `all`), `location`, `limit`, `authCookie`, `parallel` (boolean, default `false`).
- `type: 'all'` mặc định chạy **sequential** trên 1 account, trả về object `posts`, `people`, `pages`, `groups` từng mảng.
- `type: 'all'` với `parallel: true` phân 4 task cho 4 account live, gộp kết quả cùng object shape.
- Ví dụ response `type: 'all'`:
  ```js
  {
    posts: [{ id, text, author, timestamp, url, platform: 'facebook' }],
    people: [{ id, name, username, profileUrl, image, platform: 'facebook' }],
    pages: [{ id, name, category, likes, pageUrl, image, platform: 'facebook' }],
    groups: [{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }]
  }
  ```
- Posts: trả về `{ id, text, author, timestamp, url, platform: 'facebook' }`.
- People: trả về `{ id, name, username, profileUrl, image, platform: 'facebook' }`.
- Pages: trả về `{ id, name, category, likes, pageUrl, image, platform: 'facebook' }`.
- Groups: trả về `{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }`.

### 4.3 Comments Scraping

**Description:** Scrape comments của một post, bao gồm replies lồng nhau. Realizes UJ-7.2.

#### FR-58: Scrape post comments

Người dùng có thể lấy comments của một post Facebook. Realizes UJ-7.2.

**Consequences (testable):**
- Input: `postUrl`, `limit`, `includeReplies` (boolean), `authCookie`.
- Mở post, click chuyển sort từ "Most relevant" sang "All comments" nếu có.
- Scroll và mở "View more comments" / "X replies".
- Mỗi comment trả về `{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }`.
- `replies[]` chỉ có khi `includeReplies: true`.

### 4.4 Group Content Scraping

**Description:** Scrape posts và comments trong Facebook group. Realizes UJ-7.3.

#### FR-59: Scrape group posts

Người dùng có thể lấy posts từ một group Facebook. Realizes UJ-7.3.

**Consequences (testable):**
- Input: `groupUrl`, `limit`, `authCookie`.
- Dùng mobile UA + viewport 390x844.
- Trả về mảng posts với shape tương tự `scrapeTweets`.
- Trả về `note` nếu group private/restricted và account không phải member.

#### FR-60: Scrape group comments

Người dùng có thể lấy comments của một post trong group. Realizes UJ-7.3.

**Consequences (testable):**
- Input: `postUrl` (post thuộc group), `limit`, `includeReplies`, `authCookie`.
- Gọi `scrapeFacebookComments({ page, postUrl, limit, includeReplies, authCookie })` — cùng hàm với FR-58, không duplicate logic.
- Trước khi gọi, verify URL là post trong group (chứa `facebook.com/groups/`); nếu không, trả lỗi rõ ràng.
- Trả về `note` nếu group private và account không phải member.

### 4.5 Hydration & GraphQL Fallback

**Description:** Giảm phụ thuộc vào DOM bằng cách trích xuất hydration JSON và/hoặc replay GraphQL. Realizes FR-57, FR-58, FR-59.

#### FR-61: Hydration JSON extraction

Hệ thống parse JSON trong `<script type="application/json" data-content-len>` sau khi page load. Realizes FR-57, FR-58, FR-59.

**Consequences (testable):**
- Tìm tất cả script tag có `data-content-len`.
- Walk JSON đệ quy, lọc theo `__typename`.
- Hỗ trợ ít nhất: `Story`, `Comment`, `User`, `Page`, `Group`, `MarketplaceListing`.
- Trả về dữ liệu tương đương DOM extraction.
- DOM fallback khi hydration không đủ.

#### FR-62: GraphQL replay

Hệ thống capture `doc_id` từ `api/graphql` request trong Puppeteer và replay bằng `axios`. Realizes FR-57, FR-58.

**Consequences (testable):**
- Bật `page.on('response')` để capture request/response `api/graphql`.
- Lưu mapping `doc_id` → query name (search, comments, group feed).
- Replay bằng `POST /api/graphql/` với `fb_dtsg`, `lsd`, `__dyn`, `__csr`.
- Fallback sang hydration/DOM nếu `doc_id` rotate hoặc request thất bại.

### 4.6 API + MCP Surface Unification

**Description:** MCP gọi qua service chung, không gọi scraper trực tiếp. Realizes UJ-7.1..UJ-7.4.

#### FR-63: Unified Facebook scrape service

API và MCP cùng gọi `facebookScrapeService`. Realizes UJ-7.1..UJ-7.4.

**Consequences (testable):**
- Tạo `api/services/facebookScrape.js` với `run(action, args)` và `runBatch(tasks, options)`.
- `api/routes/facebook.js` `POST /scrape` gọi `facebookScrapeService.run`.
- `src/mcp/server.js` các tool Facebook mới gọi `facebookScrapeService`.
- Không duplicate login/scrape logic giữa API và MCP.

## 5. Non-Goals (Explicit)

- Không xây UI cho Epic 7 — defer sang phase sau.
- Không lưu trữ dữ liệu scrape trong XActions — chỉ trả JSON.
- Không tự động hóa ghi (like/comment/post) trong Epic 7 — chỉ đọc.
- Không xây Facebook Ads / Business automation.
- Không scrape PII nhạy cảm (số điện thoại, email) — strip nếu lộ.

## 6. MVP Scope

### 6.1 In Scope

- Account health check (FR-55).
- Account pool & parallel runner (FR-56) với concurrency mặc định 4.
- Multi-type search: posts, people, pages, groups (FR-57).
- Post comments scraping (FR-58).
- Group posts scraping (FR-59).
- Group comments scraping (FR-60).
- Hydration JSON extraction fallback (FR-61).
- API + MCP surface unification (FR-63).

### 6.2 Out of Scope for Epic 7

- **GraphQL replay (FR-62) — defer sang Phase 3 / epic sau.**
- UI dashboard.
- Lưu trữ / analytics trên dữ liệu scrape.
- Reaction/liker list scraping (có thể là Epic 7b).

## 7. Cross-Cutting NFRs

- **NFR-10:** Không lưu trữ — XActions chỉ trả JSON, không ghi database với kết quả scrape.
- **NFR-11:** Health check nhanh — < 2 giây, không mở browser.
- **NFR-12:** Concurrency cap — mặc định 4, tối đa 8 browsers đồng thời.
- **NFR-13:** Privacy — cookie/token values không bao giờ log hay echo.
- **NFR-14:** Resilience — luôn có DOM fallback khi hydration/GraphQL fail.
- **NFR-15:** Read velocity — mỗi vòng lặp scroll/crawl có delay 1-3 giây; giới hạn 50 lần scroll mỗi task; không tối ưu hóa tốc độ ở mức làm tăng account risk.

## 8. Success Metrics

**Primary**
- **SM-1:** `x_facebook_search` với `type: 'all'` trả về kết quả cho cả 4 loại trong 1 response gộp.
- **SM-2:** `x_facebook_post_comments` lấy được 100 comments trong < 90 giây trên post có comments.
- **SM-3:** `runBatch` với 4 tasks trên 4 account hoàn thành nhanh hơn 3 lần so với chạy tuần tự.

**Secondary**
- **SM-4:** Health check chính xác ≥ 95% so với kết quả login thực.

**Counter-metrics (do not optimize)**
- **SM-C1:** Không tối đa hóa concurrency để "nhanh bằng mọi giá" — account risk tăng. Giữ cap 4-8.
- **SM-C2:** Không thu thập thêm field nếu làm tăng độ brittle của selector — ưu tiên hydration/role/aria-label.

## 9. Open Questions

### Resolved (defaults applied)

1. ✅ `FacebookAccountHealth` — dùng Prisma model, cache TTL 5 phút. `[DECIDED]`
2. ✅ `x_facebook_search type: 'all'` — mặc định sequential trên 1 account; `parallel: true` để fan-out. `[DECIDED]`
3. ✅ `FacebookAccount.proxy` — có field `proxy`, `AccountPool` enforce proxy affinity. `[DECIDED]`

### Remaining

1. Có nên thêm `p-limit` vào `package.json` hay tự implement concurrency pool?
2. Có cần TLS/JA3 impersonation (ví dụ `curl_cffi`) cho GraphQL replay không, hay axios + headers thật đã đủ?

## 10. Assumptions Index

- **§2.1** — Người dùng có pool tài khoản Facebook đã nuôi, không phải tài khoản mới tạo. `[ASSUMPTION]`
- **§4.1 (FR-55)** — `FacebookAccountHealth` lưu trong Prisma; Redis cache chỉ dùng nếu production có Redis sẵn. `[ASSUMPTION]`
- **§4.1 (FR-56)** — Mỗi account có thể gắn proxy cố định; `AccountPool` sẽ honor proxy affinity. `[ASSUMPTION]`
- **§4.1** — Anti-detection từ Epic 6 (fingerprint, proxy, warmup) đã hoạt động và được tái dùng. `[ASSUMPTION]`
- **§4.5** — Hydration JSON và GraphQL `doc_id` có thể thay đổi; DOM fallback là bắt buộc. `[ASSUMPTION]`
- **§4.6** — `facebookScrapeService` sẽ là single source of truth cho cả API và MCP, tương tự cách `api/services/facebookAutomation.js` được dùng cho automate. `[ASSUMPTION]`
