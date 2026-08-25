# Sprint Change Proposal — 2026-08-26

**Issue Triggered By:** User question — *"Các story còn lại có thật sự cần thiết hay bị duplicate với tính năng cũ không?"*  
**Scope:** Toàn bộ các story còn lại trong Epics 13–22, so sánh với codebase hiện tại.  
**Recommended Path:** Direct Adjustment + MVP Scope Refinement (không rollback).  
**Scope Classification:** Moderate — cần backlog reorganization và sửa `epics.md` trước khi dev tiếp tục.

---

## 1. Issue Summary

Dự án đang ở **Epic 13 — High-Throughput Hybrid Scraping Engine**. Story 13.1 (`Tiered Signer Architecture`) đã hoàn thành. Story 13.2 và 13.3 vừa được tạo file `ready-for-dev`. Người dùng nghi ngờ các story còn lại có thể bị **duplicate với tính năng cũ** đã có trong repo.

**Phát hiện chính:**

- Nhiều platform sắp refactor (Twitter, Facebook, Threads) **đã có implementation cũ** trong repo, một số khá hoàn chỉnh.
- Epic 19 (Admin Dashboard/CLI/API/MCP) **overlap nặng** với các route, CLI command, và MCP server đã tồn tại.
- Epic 14.2 (MCP Daemon HTTP/SSE) **overlap với `src/mcp/server.js` HTTP transport** đã có, nhưng thiếu 3-Layer JSON Envelope và action discovery.
- `epics.md` ghi nhầm **Story 18.3 bị blocked vì Epic 12.2**, nhưng `sprint-status.yaml` xác nhận 12.2 đã `done`.
- Nếu không có kế hoạch **decommission rõ ràng**, dự án sẽ có 3+ implementation Twitter/Facebook/Threads song song, làm tăng rủi ro bảo trì và bloat.

---

## 2. Evidence / Data Sources

| Nguồn | Mô tả |
|-------|-------|
| `_bmad-output/planning-artifacts/epics.md` | Epic 10–22, requirements, dependency map. [Source] |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Trạng thái story. [Source] |
| `src/scrapers/twitter/index.js` | Twitter Puppeteer-based scraper (legacy). [Source] |
| `src/scrapers/twitter/http/index.js` | HTTP-only Twitter scraper với 30+ methods. [Source] |
| `src/client/Scraper.js` | HTTP-only Twitter `Scraper` class với profile/tweets/DMs/search/trends/lists/media. [Source] |
| `src/scrapers/facebook/index.js` | Facebook Puppeteer scraper với search, group posts, comments, marketplace, messenger. [Source] |
| `src/scrapers/threads/index.js` | Threads Puppeteer scraper với profile/posts/search. [Source] |
| `src/mcp/server.js` | MCP server với HTTP transport port 3001 và 80+ tools. [Source] |
| `api/routes/checkpoints.js` | `GET/POST /api/checkpoints` resume/pause/retry endpoints. [Source] |
| `api/routes/proxies.js` | `/api/proxies/status/add/next/sticky/quarantine` + account endpoints. [Source] |
| `api/routes/streams.js` | `/api/streams` CRUD, stats, history. [Source] |
| `api/routes/governor.js` | `GET /governor/status`. [Source] |
| `src/cli/commands/checkpoints.js` | `xactions checkpoints list/show/resume/pause/retry`. [Source] |
| `src/cli/commands/stream.js` | `xactions stream start/stop/list/history/pause/resume/status/stop-all`. [Source] |

---

## 3. Impact Analysis

### 3.1 Epic 13 (Twitter & Facebook Refactor)

| Story | Trạng thái | Độ cần thiết | Overlap với cũ | Ghi chú |
|-------|-----------|--------------|-----------------|---------|
| **13.1** | done | Cần | Không | Foundation cho toàn bộ hybrid engine. |
| **13.2** | ready-for-dev | Cần nhưng **phải scope chặt** | **Cao** — `src/client/Scraper.js` và `src/scrapers/twitter/http/index.js` đã có profile/tweets/followers/search/DMs/media. | Đây sẽ là implementation Twitter thứ 3. Cần kế hoạch decommission. |
| **13.3** | ready-for-dev | Cần nhưng **phải scope chặt** | **Cao** — `src/scrapers/facebook/` đã có group posts, comments, search, marketplace, messenger. | 13.3 chỉ nên làm group/page posts; messenger/marketplace để sau. |

**Impact:** Nếu 13.2/13.3 không có điều kiện deprecation, dự án sẽ nuôi 3 Twitter clients và 2 Facebook scrapers. Tăng chi phí bảo trì, test, và nguy cơ drift giữa các implementation.

### 3.2 Epic 14 (Deep Conversation, MCP Daemon, Redis Stream)

| Story | Độ cần thiết | Overlap với cũ | Ghi chú |
|-------|--------------|-----------------|---------|
| **14.1** Comment tree | Cần | Thấp | `src/scrapers/facebook/comments.js` và `src/scrapers/twitter/http/thread.js` có thread/comment logic riêng lẻ, không thống nhất. 14.1 là feature mới (topological sort). |
| **14.2** MCP Daemon HTTP/SSE | Cần nhưng **phải tích hợp** | **Trung bình–Cao** | `src/mcp/server.js` đã chạy HTTP transport trên port 3001, có health, x402, tools. Thiếu 3-Layer JSON Envelope, action discovery (`x_actions_list`), auto-artifact. |
| **14.3** Redis Stream | Cần | Thấp | `src/streaming/index.js` dùng Socket.IO cho real-time tweet streams; 14.3 là Redis Stream `stream:social:raw_posts` cho Nowing. Khác hẳn. |

**Impact:** 14.2 không nên tạo một daemon process mới. Nên mở rộng `src/mcp/server.js` đã có.

### 3.3 Epic 15–18 (Platform-specific Crawlers)

| Epic/Story | Độ cần thiết | Overlap với cũ | Ghi chú |
|-----------|--------------|-----------------|---------|
| **15.1** Threads | Cần | **Cao** | `src/scrapers/threads/index.js` Puppeteer-based đã có profile/posts/search. 15.1 sẽ thay bằng HTTP GraphQL. |
| **15.2** TikTok | Cần | Không | Chưa có TikTok scraper. |
| **16.1–16.2** Shopee, TikTok Shop | Cần | Không | Chưa có. |
| **17.1–17.2** Chợ Tốt, Batdongsan | Cần | Không trong XActions | Có thể Nowing repo có legacy, nhưng XActions repo chưa có. |
| **18.1–18.2** TopCV, VietnamWorks | Cần | Không | Chưa có. |
| **18.3** LinkedIn CDP | Cần | Không | `epics.md` ghi blocked vì 12.2, nhưng 12.2 đã done. Cần update. |

### 3.4 Epic 19 (Admin Dashboard/CLI/API/MCP)

| Story | Độ cần thiết | Overlap với cũ | Ghi chú |
|-------|--------------|-----------------|---------|
| **19.1** Dashboard Jobs & Checkpoints | Cần nhưng **đã có nền tảng** | Cao | API checkpoints đã có; dashboard cần page mới. |
| **19.2** Dashboard Proxies & Accounts | Cần nhưng **đã có nền tảng** | Cao | `api/routes/proxies.js` + `GET /governor/status` đã có; cần dashboard view. |
| **19.3** Dashboard Stream Metrics | Cần nhưng **đã có nền tảng** | Cao | `api/routes/streams.js` `/stats` đã có; cần dashboard view. |
| **19.4** Admin CLI — Governor/Proxies/Accounts | **Thấp/Trùng lặp** | Rất cao | `xactions stream list/status` và API proxy/governor đã có. Nhưng chưa có command `xactions admin ...`. Có thể gộp. |
| **19.5** Admin CLI — Checkpoints | **Thấp/Trùng lặp** | Rất cao | `xactions checkpoints ...` đã tồn tại. Story này có thể bị duplicate. |
| **19.6** Admin CLI — Stream Metrics | **Thấp/Trùng lặp** | Rất cao | `xactions stream ...` đã tồn tại. Có thể duplicate. |
| **19.7** Admin REST API | Cần nhưng **đã có nền tảng** | Cao | Các `/api/proxies`, `/api/checkpoints`, `/governor/status`, `/api/streams` đã có. Cần đổi namespace `/admin/*` hoặc gộp. |
| **19.8** Admin MCP Tools | Cần | Trung bình | MCP server đã có tools, nhưng thiếu admin tools (`x_admin_*`). |

**Impact:** Epic 19 có nguy cơ viết lại nhiều thứ đã có. Cần audit kỹ trước khi dev.

### 3.5 Epic 20 (Nowing Cutover & Legacy Decommissioning)

| Story | Độ cần thiết | Ghi chú |
|-------|--------------|---------|
| **20.1** Shadow-run adapter | Cần | Nhưng target là Nowing repo (`/Users/luisphan/Documents/GitHub/nowing`), không phải XActions. Cần theo dõi ở sprint Nowing. |
| **20.2** Legacy decommissioning | Cần | Nên mở rộng scope để xoá cả legacy XActions (`src/client/`, `src/scrapers/twitter/http/`, `src/scrapers/facebook/`, `src/scrapers/threads/`) sau khi hybrid crawler đạt parity. |

### 3.6 Epic 21–22 (B2B, Automotive, F&B, Healthcare, Legal)

- **Tất cả đều cần**, không có overlap trong XActions.
- Cần ưu tiên theo nhu cầu Nowing / người dùng.

---

## 4. Recommended Approach

**Chọn: Direct Adjustment (Option 1)**

Lý do:

- Không cần rollback 13.1 vì nó là foundation đúng hướng.
- Không cần giảm MVP nhiều vì các epic mới (16–22) là domain hoàn toàn mới.
- Cần **sửa scope và dependency** của 13.2, 13.3, 15.1, 14.2, 18.3, 19.x, 20.2 để tránh duplicate và đảm bảo decommission có kế hoạch.

---

## 5. Detailed Change Proposals

### Proposal P1: Sửa `epics.md` dependency map (Story 18.3)

**File:** `_bmad-output/planning-artifacts/epics.md`  
**OLD:**

```markdown
| Epic 18.3 (LinkedIn) | Epic 12.2 | CDP Remote Attach cho LinkedIn | **Blocked** — 12.2 còn backlog. |
```

**NEW:**

```markdown
| Epic 18.3 (LinkedIn) | Epic 12.2 | CDP Remote Attach cho LinkedIn | **Unblocked** — 12.2 done; có thể lên lịch sau khi proxy pool & signer stable. |
```

**Rationale:** `sprint-status.yaml` xác nhận `12-2-cdp-remote-attach-mode-chrome-devtools-protocol: done`.

---

### Proposal P2: Thêm deprecation AC vào Story 13.2, 13.3, 15.1

**File:** `_bmad-output/planning-artifacts/epics.md` (các AC của 13.2, 13.3, 15.1)  
**Thêm AC mới vào mỗi story:**

```markdown
**AC mới — Deprecation Marker:**
- **Given** `TwitterCrawler` / `FacebookCrawler` / `ThreadsCrawler` hybrid hoàn thành
- **When** so sánh với legacy implementation
- **Then** gắn `@deprecated` vào các file legacy tương ứng
- **And** thêm vào `docs/deprecation-plan.md` lộ trình xoá trong Epic 20.2
- **And** không sửa logic nội bộ của legacy code trong story này
```

**Legacy mapping để ghi nhận:**

| New Hybrid | Legacy Code to Deprecate |
|------------|--------------------------|
| `src/scrapers/social/twitter/` | `src/client/Scraper.js`, `src/scrapers/twitter/http/`, `src/scrapers/twitter/index.js` |
| `src/scrapers/social/facebook/` | `src/scrapers/facebook/` |
| `src/scrapers/social/threads/` | `src/scrapers/threads/index.js` |

---

### Proposal P3: Thu hẹp scope Story 13.2 & 13.3

**Story 13.2 (Twitter Hybrid):** Chỉ làm `search(query)` và `getTimeline(username)` theo `epics.md`. Không làm lại DMs, media upload, follower management, engagement. Các tính năng này đã có trong `src/client/Scraper.js` và `src/scrapers/twitter/http/`.

**Story 13.3 (Facebook Hybrid):** Chỉ làm `getGroupPosts(groupId)` và `getPagePosts(pageId)`. Không làm `search`, `comments`, `marketplace`, `messenger` trong story này.

---

### Proposal P4: Chỉnh Story 14.2 — tích hợp với `src/mcp/server.js` có sẵn

**File:** `_bmad-output/planning-artifacts/epics.md` — AC của 14.2  
**Sửa phần daemon:**

**OLD:**

```markdown
* **When** thêm script `mcp:daemon` trỏ đến `src/mcp/server.js`
* **Then** `npm run mcp:daemon` khởi động server lắng nghe trên `http://localhost:3001/mcp`...
```

**NEW:**

```markdown
* **Given** `src/mcp/server.js` đã có HTTP transport trên port 3001
* **When** bổ sung 3-Layer JSON Envelope, `x_actions_list`, và auto-artifact cho responses >100 records
* **Then** MCP server trả về `{ success, platform, meta, data, summary, error? }`
* **And** `x_actions_list` gọi `AbstractCrawler.listActions()`
* **And** `/health` endpoint vẫn hoạt động, không tạo daemon process riêng
```

**Rationale:** `src/mcp/server.js` đã chạy HTTP/SSE. Việc tạo `mcp:daemon` riêng sẽ duplicate.

---

### Proposal P5: Gộp / điều chỉnh Epic 19

**File:** `_bmad-output/planning-artifacts/epics.md`  
**Đề xuất:**

- **Giữ lại** 19.1, 19.2, 19.3 (Dashboard views) — cần UI pages.
- **Gộp** 19.4, 19.5, 19.6 thành **một story** `19-4-admin-cli-unified` với các command:
  - `xactions admin status`
  - `xactions admin proxies list/quarantine/release`
  - `xactions admin accounts list/wake/rotate`
  - `xactions admin checkpoints list/resume/pause/retry`
  - `xactions admin stream metrics/alerts/test`
- **Giữ** 19.7 nhưng scope là "tạo namespace `/admin/*` wrap các route `/api/proxies`, `/api/checkpoints`, `/governor/status`, `/api/streams`" — không viết lại business logic.
- **Giữ** 19.8 (admin MCP tools) — cần thêm tools mới.

**Rationale:** `src/cli/commands/checkpoints.js` và `src/cli/commands/stream.js` đã có phần lớn command. Tạo `xactions admin` chỉ là alias/nhóm lại.

---

### Proposal P6: Mở rộng Story 20.2 decommission scope

**File:** `_bmad-output/planning-artifacts/epics.md`  
**Sửa phần xoá thư mục:**

**OLD:**

```markdown
* **When** xóa các thư mục `shopee/`, `chotot/`, `batdongsan/`, `topcv/`, `vietnamworks/`, `linkedin/`, v.v.
* **Then** CI tests pass, Nowing Docker image < 500MB
```

**NEW:**

```markdown
* **When** xóa các thư mục legacy trong Nowing repo (`shopee/`, `chotot/`, `batdongsan/`, `topcv/`, `vietnamworks/`, `linkedin/`, v.v.)
* **And** xóa các file legacy trong XActions repo (`src/client/Scraper.js`, `src/scrapers/twitter/http/`, `src/scrapers/twitter/index.js`, `src/scrapers/facebook/`, `src/scrapers/threads/index.js`)
* **Then** CI tests pass, Nowing Docker image < 500MB, XActions bundle size giảm đáng kể
```

**Rationale:** Các implementation cũ trong XActions cũng cần được decommission sau khi hybrid crawlers thay thế.

---

### Proposal P7: Tạo `docs/deprecation-plan.md`

**File mới:** `docs/deprecation-plan.md`  
**Nội dung:**

- Danh sách legacy code theo platform.
- Điều kiện decommission: shadow-run parity ≥ 99% trong 7 ngày.
- Thứ tự xoá: `src/scrapers/twitter/http/` → `src/client/Scraper.js` → `src/scrapers/twitter/index.js` → `src/scrapers/facebook/` → `src/scrapers/threads/index.js`.
- Mapping tính năng từ legacy sang hybrid.

---

## 6. Dependency & Sequencing Recommendations

**Thứ tự ưu tiên đề xuất:**

1. **13.2, 13.3** — hoàn thiện hybrid Twitter/Facebook (scope chặt).
2. **14.1, 14.3** — comment tree + Redis stream (ít overlap).
3. **14.2** — mở rộng MCP server hiện tại (tránh duplicate daemon).
4. **15.1, 15.2** — Threads/TikTok (TikTok cần 13.1 done ✓).
5. **16–18** — e-commerce, real estate, recruitment.
6. **19.x** — admin dashboard/CLI/API/MCP (sau khi 14.3 có dữ liệu).
7. **20.1** — Nowing shadow-run.
8. **20.2** — decommission.
9. **21–22** — mở rộng domain.

**Lưu ý:** Epic 19 nên bắt đầu **sau 14.3** vì dashboard stream metrics cần Redis Stream. Một số story 19.x (checkpoints/proxies) có thể bắt đầu sớm hơn vì nền tảng đã có.

---

## 7. Risk Assessment

| Rủi ro | Mức độ | Mitigation |
|--------|--------|------------|
| 3+ Twitter clients tồn tại song song | Cao | Gắn deprecation, không thêm feature mới vào legacy, xoá ở 20.2. |
| Admin stories viết lại code đã có | Trung bình | Audit `api/routes/` và `src/cli/commands/` trước khi dev; gộp story. |
| MCP daemon duplicate | Trung bình | Tích hợp 14.2 vào `src/mcp/server.js` hiện tại. |
| `epics.md` dependency lỗi thời | Thấp | Sửa ngay theo Proposal P1. |
| Scope creep 13.3 làm luôn Facebook comments/search | Cao | Giữ scope group/page posts; defer còn lại. |

---

## 8. Implementation Handoff

**Scope Classification:** Moderate

**Handoff Recipients:**

- **Product Owner / Architect:** Duyệt các proposal P1–P7, quyết định scope cuối cho 13.2/13.3/15.1/19.x.
- **Developer:** Chỉnh `epics.md`, `sprint-status.yaml` (nếu cần), tạo `docs/deprecation-plan.md`, sau đó tiếp tục dev 13.2/13.3 với scope đã thu hẹp.
- **Nowing Integration Lead:** Theo dõi 20.1/20.2 ở repo Nowing.

**Deliverables cần hoàn thành sau khi proposal được duyệt:**

1. `epics.md` đã cập nhật AC và dependency.
2. `docs/deprecation-plan.md` mới.
3. Các story file 13.2, 13.3, 15.1 đã bổ sung AC deprecation.
4. Story 19.x đã được gộp/tinh gọn.

---

## 9. Story-by-Story Necessity Verdict

| Story | Cần thiết? | Duplicate? | Khuyến nghị |
|-------|-----------|------------|------------|
| 13.2 | Có | Không trực tiếp, nhưng overlap capability | **Scope chặt**, thêm deprecation AC |
| 13.3 | Có | Không trực tiếp, nhưng overlap capability | **Scope chặt**, thêm deprecation AC |
| 14.1 | Có | Không | Giữ nguyên |
| 14.2 | Có | Partial — tích hợp MCP hiện tại | Sửa AC, không tạo daemon mới |
| 14.3 | Có | Không | Giữ nguyên |
| 15.1 | Có | Partial — thay thế Threads Puppeteer | Thêm deprecation AC |
| 15.2 | Có | Không | Giữ nguyên |
| 16.1–16.2 | Có | Không | Giữ nguyên |
| 17.1–17.2 | Có | Không | Giữ nguyên |
| 18.1–18.3 | Có | Không | Update dependency, 18.3 unblocked |
| 19.1–19.8 | Có nhưng **cần gộp** | Cao — API/CLI đã có | Gộp 19.4–19.6, điều chỉnh 19.7 |
| 20.1 | Có (Nowing repo) | Không | Theo dõi ở Nowing |
| 20.2 | Có | Không | Mở rộng scope xoá cả legacy XActions |
| 21.1–21.2 | Có | Không | Giữ nguyên |
| 22.1–22.3 | Có | Không | Giữ nguyên |

---

*Proposal generated by `bmad-correct-course` workflow — 2026-08-26.*
