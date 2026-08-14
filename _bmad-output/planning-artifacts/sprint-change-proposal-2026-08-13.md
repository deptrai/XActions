---
created: 2026-08-13
trigger: sync upstream `nirholas/XActions` into fork `deptrai/XActions`
mode: batch
---

# Sprint Change Proposal — Sync Upstream `nirholas/XActions`

## 1. Issue Summary

Fork `deptrai/XActions` đã tách khỏi upstream `nirholas/XActions` khá lâu. Sau `git fetch upstream`:

- Local `develop`: **256 commits ahead** upstream `main`.
- Upstream `main`: **74 commits ahead** local `develop`.

Người dùng muốn kéo các tính năng / fix mới từ upstream về fork hiện tại. Đây là thay đổi đáng kể vì:
- Tổng divergence ~330 commits, merge base cũ.
- Upstream có thay đổi cross-cutting: dependencies, CLI, scraper adapters, API, docs/site, license.
- Local có Epic 6 (Facebook anti-detection) và Messenger/Automation mở rộng, có thể xung đột với upstream.

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | Tác động | Ghi chú |
|------|----------|---------|
| Epic 6 — Facebook Anti-Detection | Trung bình | Code Facebook local không có trên upstream, nhưng các file share (`package.json`, `README`, `src/cli/index.js`, `api/server.js`) có thể xung đột. Cần verify sau merge. |
| Epic 5 — Facebook Messenger Port | Trung bình | `messengerShare.js`, `messengerQueue.js` có thể bị ảnh hưởng nếu upstream thay đổi cấu trúc API route hoặc dispatcher. |
| Epic 1-4 (Twitter/X core) | Cao | Upstream sửa `client` public reads, `Bluesky/Mastodon adapters`, `cli/mcp` empty-result reporting, `api/tests` paid endpoints. Cần merge để không bị regress. |
| Epic mới tiềm năng: **Upstream Sync** | Cao | Cần một epic/tracking để quản lý việc merge, review, test. |

### 2.2 Artifact Conflict

| Artifact | Xung đột? | Chi tiết |
|----------|-----------|----------|
| `README.md` | Cao | Upstream refresh toàn bộ README, version, feature matrix. Local thêm Facebook features nhưng README chưa cập nhật. |
| `package.json` / `package-lock.json` | Cao | Upstream update dependencies, license, exports, bin. Local thêm deps cho Facebook. |
| `src/cli/index.js` | Trung bình | Upstream nhóm 53 commands, thêm shell completions. Local có Facebook CLI chưa rõ. |
| `src/scrapers/` | Trung bình | Upstream fix Bluesky/Mastodon, thêm Scraper Toolbox, Command Center. Local thêm `facebook/` folder riêng, ít xung đột file. |
| `api/` | Trung bình | Upstream fix `teams.js` crash, paid endpoints, scheduler (`node-cron 4`). Local thêm `facebook.js`, `facebookAccounts.js`. |
| `docs/` / `site/` | Trung bình-Cao | Upstream redesign docs site, thêm playground, report/query-translator. Local chưa có. |
| `prisma/schema.prisma` | Thấp | Không thấy upstream thay đổi đáng kể trong 74 commit gần nhất. |
| `_bmad-output/` | Thấp | BMad artifacts chỉ có ở local, upstream không có. Cần giữ nguyên. |

### 2.3 PRD / MVP Impact

PRD `Facebook Platform Extension` vẫn đúng. Tuy nhiên, sau khi sync upstream, phạm vi sản phẩm có thể mở rộng hơn Facebook:
- Có thể cập nhật PRD để ghi nhận các tính năng mới từ upstream mà team muốn adopt.
- Nếu upstream đã giải quyết một số vấn đề (Bluesky/Mastodon adapters, client public reads), MVP Facebook sẽ đứng trên nền tảng ổn định hơn.

## 3. Recommended Approach

### 3.1 Chọn chiến lược

**Hybrid: Merge toàn bộ upstream/main vào một feature branch, sau đó review & resolve conflicts theo nhóm.**

Lý do:
- 74 commits upstream không quá lớn, chủ yếu là docs, deps, fixes.
- 256 commits local chủ yếu là Facebook Epic, không trùng nhiều với upstream (trừ cross-cutting files).
- Cherry-pick 74 commits một cái một cái sẽ tốn thời gian và dễ miss dependency.
- Rebase 256 commits lên upstream rất rủi ro vì conflict nhiều lần.

### 3.2 Kế hoạch thực hiện

| Bước | Hành động | Người phụ trách | Output |
|------|-----------|-----------------|--------|
| 1 | Tạo nhánh `sync/upstream-2026-08-13` từ `develop` hiện tại. | Developer | Branch |
| 2 | `git merge upstream/main` vào branch. Resolve conflicts ưu tiên giữ local changes cho Facebook, sau đó merge upstream cho cross-cutting files. | Developer | Merge commit |
| 3 | Chạy `npm install` và `npm audit` để xử lý deps mới. | Developer | lockfile cập nhật |
| 4 | Chạy `npx vitest run` toàn bộ. | Developer | Test report |
| 5 | Chạy smoke test Facebook real-cookie để đảm bảo Epic 6 không regress. | Developer | Pass/Fail |
| 6 | Review từng nhóm thay đổi upstream (deps, CLI, scrapers, docs) và quyết định giữ/bỏ. | PO/Architect | Review checklist |
| 7 | Merge branch vào `develop` sau khi PO approve. | Developer | PR/Merge |
| 8 | Cập nhật `sprint-status.yaml` và tạo Epic/story tracking cho các tính năng mới adopt. | Developer/PO | Updated artifacts |

### 3.3 Ước tính effort & rủi ro

- **Effort:** Cao (1–2 ngày làm việc tùy conflict).
- **Risk:** Trung bình–Cao. Rủi ro chính là xung đột `package.json`/`package-lock` và CLI nếu upstream refactor lớn. Rủi ro thứ hai là regression test Facebook do thay đổi stealth/dependency.
- **Timeline impact:** Có thể trì hoãn 1–2 ngày các epic tiếp theo cho đến khi merge ổn định.

## 4. Detailed Change Proposals

### 4.1 Merge & Conflict Resolution

- Tạo branch `sync/upstream-2026-08-13`.
- Merge `upstream/main`.
- Conflict resolution strategy:
  - `package.json`/`package-lock`: giữ cả local deps (Facebook) và upstream deps (nodemailer 9, node-cron 4, audit fixes).
  - `src/cli/index.js`: giữ upstream CLI grouping + thêm Facebook commands nếu local có.
  - `README.md`: merge upstream refresh + thêm dòng giới thiệu Facebook.
  - `src/scrapers/`: giữ `facebook/` folder, apply upstream fixes cho `Bluesky`, `Mastodon`, `Threads`.
  - `api/`: apply upstream crash fixes, giữ `facebook.js` và `facebookAccounts.js`.

### 4.2 Adopt Upstream Features

Dựa trên `git log --right-only HEAD...upstream/main`, các tính năng/fix đáng chú ý:

1. **Dependency & Security**
   - `node-cron 4`, `nodemailer 9` — cần để tránh lỗi scheduler và vulnerable floors.
   - `npm audit` fixes — bắt buộc.

2. **Scraper fixes**
   - `fix(client): restore public reads over HTTP`
   - `fix(scrapers): repair the Bluesky and Mastodon adapters`
   - `fix(cli,mcp): stop reporting empty results as success`

3. **CLI/MCP improvements**
   - `feat(cli): group 53 commands by task, add quickstart and shell completions`
   - `feat(report): account analytics and a plain-English query translator, on CLI and MCP`
   - `feat(playground): hosted try-it page for the report and query-translator APIs`

4. **Browser automation UX**
   - `feat: add Scraper Toolbox` (interactive on-page control panel)
   - `Add XActions Command Center` (108 browser tools across 11 categories)

5. **Docs & Site**
   - Documentation site redesign, Cloudflare/GCP deployment, tutorials.
   - Có thể defer nếu không cần thiết cho Facebook MVP.

6. **License**
   - Upstream đã chuyển sang Apache-2.0. Cần review license surface nếu fork vẫn dùng BSL/MIT.

### 4.3 Defer / Drop

- Site redesign và Cloudflare Workers deployment có thể defer nếu team không dùng ngay.
- Command Center / Scraper Toolbox là browser scripts; có thể adopt sau khi core Facebook ổn định.

## 5. PRD MVP Impact & Action Plan

### MVP hiện tại
Facebook Platform Extension vẫn là MVP. Sync upstream không thay đổi MVP, nhưng cung cấp nền tảng ổn định hơn.

### Action plan
1. Tạo branch sync.
2. Merge upstream.
3. Resolve conflicts theo checklist.
4. Chạy full test suite.
5. Smoke test Facebook real-cookie.
6. Review và adopt tính năng.
7. Cập nhật documentation và sprint status.

## 6. Implementation Handoff

| Vai trò | Trách nhiệm |
|---------|-------------|
| **Developer** | Tạo branch, merge, resolve conflicts, chạy test, smoke test Facebook, commit. |
| **PO / Architect** | Quyết định adopt/drop các tính năng upstream, approve proposal. |
| **Tester / QA** | Xác nhận `npx vitest run` pass và real-cookie smoke test pass. |

## 7. Success Criteria

- [ ] `git merge upstream/main` thành công, branch build được.
- [ ] `npx vitest run` pass (≥ current pass rate).
- [ ] Real-cookie Facebook smoke test pass (login + warmup + scrape).
- [ ] `npm audit` không còn critical/high vulnerabilities mới.
- [ ] Các tính năng upstream đã adopt được ghi nhận trong `sprint-status.yaml` hoặc `deferred-work.md`.

## 8. Checklist Summary (từ bmad-correct-course)

| Section | Status |
|---------|--------|
| 1. Understand the Trigger | ✅ Done |
| 2. Epic Impact Assessment | ✅ Done |
| 3. Artifact Conflict Analysis | ✅ Done |
| 4. Path Forward Evaluation | ✅ Done — chọn Hybrid Merge |
| 5. Sprint Change Proposal Components | ✅ Done |
| 6. Final Review | ⏳ Chờ user approve |

## 9. Next Step

Chờ **PO/Architect approve** proposal này. Sau đó Developer sẽ thực hiện merge `upstream/main` vào `sync/upstream-2026-08-13` và bắt đầu resolve conflicts.
