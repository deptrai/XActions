---
title: "Sprint Change Proposal — Facebook Post-Completion Improvements"
created: 2026-08-14
updated: 2026-08-14
status: approved
related:
  - epic-3-retrospective.md
  - epic-7-retrospective.md
  - prd-XActions-2026-08-14-epic7/prd.md
---

# Sprint Change Proposal — Facebook Post-Completion Improvements

## 1. Issue Summary

### 1.1 Trigger

Sau khi Epic 3 và Epic 7 hoàn thành, full regression test suite chạy **3668 tests / 3614 passed / 0 failed / 54 skipped**. Sau đó real-user testing với 17 Facebook MCP tools + REST API được thực hiện bằng live account. Kết quả tool test 15/15 API actions pass, 20/20 MCP direct calls pass, nhưng phát hiện **12 improvements** về performance, validation, error handling, observability, và code quality.

### 1.2 Problem Statement

Các epic Facebook (3, 4, 5, 5b, 6, 7) đã hoàn thành về chức năng, nhưng real-user run và stress test suite phát hiện nhiều **deferred technical debt** và **behavioral gaps** chưa được giải quyết:

- Dry-run path vẫn chạy quá trình delay/browser thật → chậm và phí account risk
- Shared resources (PrismaClient) chưa được singleton hóa
- DOM selectors/comments/group content cần xác thực thêm với live data
- Error handling chưa graceful khi `localTools` chưa khởi tạo
- Một số API param validation inconsistencies

Các vấn đề này **không phá vỡ MVP**, nhưng cần được capture thành stories để sprint tiếp theo.

### 1.3 Evidence

| Source | Finding |
|---|---|
| Full vitest suite | 0 failures sau fix normalizePost + loginWithCookie timeout |
| Real API test (15 actions) | profile ✅, search 4 types ✅, posts ✅, comments (graceful note) ✅, group posts/search 0 results ✅, group comments (graceful note) ✅, marketplace ✅, group members ✅, dry-run ✅, validation 400 ✅ |
| MCP direct test (20 calls) | 17 tools pass; `x_facebook_cancel_friend_requests` dry-run mất **63.4s**; `executeTool` throw null khi unknown tool + `localTools` uninitialized |
| Epic 3 retrospective | Deferred: `new PrismaClient()` per route module vẫn chưa sửa |
| Epic 7 retrospective | Marketplace trả `[]` (đã fix), MCP dispatch conflict đã fix |

---

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | Status | Impact |
|---|---|---|
| Epic 1 (Anti-Detection) | done | Low — một số delay seams có thể cần cải tiến để test nhanh hơn |
| Epic 3 (Multi-Surface + Persistence) | done | Medium — PrismaClient singleton deferred từ retrospective, auth middleware JWT key mismatch |
| Epic 4 (Growth Automation) | done | Medium — `cancel_friend_requests` dry-run chậm, `send_friend_requests` selector cần verify |
| Epic 5 (Scheduling/Queue) | done | None |
| Epic 5b (Messenger Share) | done | None |
| Epic 6 (Human Behavior) | done | Low — `loginWithCookie` randomDelay chưa injectable; test timeout có thể tái diễn |
| Epic 7 (Advanced Scraping) | done | High — comments/group content cần live verification; `executeTool` null guard; marketplace dry-run path cần kiểm tra |

### 2.2 Story Impact

Không cần sửa stories đã hoàn thành. Các findings này nên thành **stories mới** trong một epic mới hoặc gắn vào epic maintenance.

### 2.3 Artifact Conflicts

- **PRD Epic 7**: Không conflict. Các improvements nằm ngoài scope PRD, là hardening và debt paydown.
- **Architecture.md**: Cần cập nhật nếu giải quyết PrismaClient singleton (cross-cutting refactor).
- **AGENTS.md / Testing Conventions**: Có thể cập nhật về injectable delay seams.

### 2.4 Technical Impact

- Database connection pool fragmentation nếu `PrismaClient` per route không được xử lý.
- CI timeout risk nếu `loginWithCookie` test không có delay seam.
- User experience chậm cho dry-run của `cancel_friend_requests`.
- Crash risk khi `executeTool` được import trực tiếp mà không qua server init.

---

## 3. Path Forward Evaluation

### 3.1 Option 1: Direct Adjustment — Add Stories

- **Viable**: ✅ Yes
- **Effort**: Medium
- **Risk**: Low
- **Approach**: Tạo Epic 8 "Facebook Quality & Hardening" với các stories được prioritize. Không cần rollback.

### 3.2 Option 2: Rollback

- **Viable**: ❌ No
- **Effort**: High
- **Risk**: High
- Không có lý do rollback; features đang hoạt động, chỉ cần hardening.

### 3.3 Option 3: PRD MVP Review

- **Viable**: ⚠️ Partial
- **Effort**: Low
- **Risk**: Low
- MVP không bị ảnh hưởng. Một số items có thể defer ra khỏi MVP nếu cần.

### 3.4 Recommended Approach

**Option 1 / Hybrid**: Create **Epic 8: Facebook Quality & Hardening** (hoặc đưa vào maintenance epic tiếp theo) với 7 stories được ưu tiên. Không cần sửa PRD hiện tại.

**Rationale**:
- Low risk, incremental
- Giải quyết deferred debt đã ghi trong retrospectives
- Cải thiện testability và observability
- Không làm thay đổi contract API/MCP hiện có

---

## 4. Recommended Change Proposals

### 4.1 Story 8.1 — Fix `x_facebook_cancel_friend_requests` dry-run delay

**OLD behavior:** Dry-run vẫn chạy qua `runGuardedBatch` với delay 2-5s, mất 63s.

**NEW behavior:** Dry-run short-circuit trước khi vào batch loop, trả preview ngay lập tức.

**Rationale:** Dry-run không được chạm account risk hay delay thật.

**AC:**
- Given `x_facebook_cancel_friend_requests` with `dryRun: true`
- When tool executes
- Then result returns in <1s
- And no browser is launched

### 4.2 Story 8.2 — PrismaClient singleton refactor

**OLD behavior:** Mỗi route module tạo `new PrismaClient()`.

**NEW behavior:** Một `PrismaClient` instance shared toàn project.

**Rationale:** Giảm connection pool fragmentation, đã deferred từ Epic 3.

**AC:**
- Given any API request
- When route needs DB
- Then it imports singleton `prisma` from `api/lib/prisma.js`
- And connection count does not scale with route count

### 4.3 Story 8.3 — Verify live Facebook comments selectors

**OLD behavior:** `post_comments` và `group_comments` trả note "Facebook comments are not accessible" trên mọi post.

**NEW behavior:** Có thể scrape comments từ post công khai với comments được bật.

**Rationale:** FR-58 / UJ-7.2 yêu cầu thu thập comments thực sự.

**AC:**
- Given a public post with comments enabled
- When `x_facebook_post_comments` runs with `includeReplies: true`
- Then it returns array of comments with author, text, timestamp, likes, replies

### 4.4 Story 8.4 — Verify live group posts and group search

**OLD behavior:** `group_posts` và `group_search` trả 0 results trên `digitalmarketing` group.

**NEW behavior:** Có thể scrape posts từ group mà account đã join hoặc public group.

**Rationale:** FR-59 / UJ-7.3 cần group content.

**AC:**
- Given a public or joined group
- When `x_facebook_group_posts` or `x_facebook_group_search` runs
- Then it returns non-empty post array or a clear note explaining access restriction

### 4.5 Story 8.5 — Injectable `delayFn` for `loginWithCookie`

**OLD behavior:** `loginWithCookie` dùng `randomDelay` module-level `setTimeout`; test mất 3-6s.

**NEW behavior:** `loginWithCookie` chấp nhận `delayFn` seam trong `options`.

**Rationale:** NFR-3 testable delays; tránh timeout flaky trong parallel suite.

**AC:**
- Given `loginWithCookie(page, cookies, { delayFn: async () => {} })`
- When function runs
- Then internal random delays use provided `delayFn`

### 4.6 Story 8.6 — Graceful `executeTool` unknown tool handling

**OLD behavior:** `executeTool` throws `Cannot read properties of null` khi `localTools` null hoặc `Error("Unknown tool")` khi tool không tồn tại.

**NEW behavior:** Trả về `{ isError: true, content: [...] }` cho MCP client.

**Rationale:** MCP error contract yêu cầu result object, không throw.

**AC:**
- Given unknown tool name
- When `executeTool` runs
- Then returns MCP error result, not throw

### 4.7 Story 8.7 — Standardize JWT token key (`id` vs `userId`)

**OLD behavior:** Auth middleware reads `decoded.userId`; ad-hoc tokens dùng `id` bị 500.

**NEW behavior:** Middleware chấp nhận cả `decoded.userId` và `decoded.id`.

**Rationale:** Tránh mismatch giữa test fixtures và user-generated tokens.

**AC:**
- Given token with payload `{ id: "..." }`
- When request hits auth middleware
- Then user is resolved correctly

---

## 5. Priority and Sequencing

| Priority | Story | Effort | Risk | Why |
|---|---|---|---|---|
| **P1** | 8.2 PrismaClient singleton | Medium | Low | Deferred debt, affects scalability |
| **P1** | 8.3 Comments live verification | Medium | High | Core Epic 7 requirement |
| **P1** | 8.4 Group content verification | Medium | High | Core Epic 7 requirement |
| **P2** | 8.1 Cancel friend requests dry-run | Low | Low | Easy win, bad UX |
| **P2** | 8.5 loginWithCookie delayFn | Low | Low | Test stability |
| **P2** | 8.6 executeTool graceful errors | Low | Low | Robustness |
| **P3** | 8.7 JWT key standardization | Low | Low | Developer experience |

### Recommended Sprint Sequence

1. **Sprint N**: 8.2 + 8.1 + 8.5 (technical debt + quick wins)
2. **Sprint N+1**: 8.3 + 8.4 (live DOM verification, may need iteration)
3. **Sprint N+2**: 8.6 + 8.7 (polish and standards)

---

## 6. PRD and Scope Impact

### 6.1 MVP Status

**MVP của Epic 7 vẫn achievable.** Các improvements này là hardening/technical-debt, không phải blocker.

### 6.2 Scope Changes

Không thay đổi scope PRD hiện tại. Có thể thêm Epic 8 vào roadmap hoặc gộp vào maintenance epic.

---

## 7. Handoff Plan

| Role | Responsibility |
|---|---|
| **Developer (Amelia)** | Implement stories 8.1–8.7, red-green-refactor |
| **Test Architect (Murat)** | ATDD scaffolds, real-cookie verification for 8.3/8.4 |
| **Architect (Winston)** | Review 8.2 singleton design, ADR update nếu cần |
| **Product (John)** | Approve Epic 8 backlog ordering |
| **Business Analyst (Mary)** | Cập nhật epic/story map, acceptance criteria |

---

## 8. Checklist Completion

| Section | Status |
|---|---|
| 1. Understand Trigger and Context | ✅ Done |
| 2. Epic Impact Assessment | ✅ Done |
| 3. Artifact Conflict and Impact Analysis | ✅ Done |
| 4. Path Forward Evaluation | ✅ Done — Option 1/Hybrid |
| 5. Sprint Change Proposal Components | ✅ Done |
| 6. Final Review and Handoff | ⏳ Pending user approval |

---

## 9. Approval

**Status:** Pending approval from Luisphan.

**Next step after approval:** Tạo Epic 8 stories trong sprint-status.yaml hoặc bmmad-equivalent backlog, sau đó handoff cho `bmad-create-story` hoặc `bmad-sprint-planning`.
