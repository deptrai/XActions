---
created: 2026-08-13
trigger: user requested to call a Facebook Marketplace MCP tool and asked to audit all Facebook features missing from the MCP tool surface
mode: batch
---

# Sprint Change Proposal — Expose Missing Facebook MCP Tools

## 1. Issue Summary

Người dùng yêu cầu gọi tool MCP để tìm kiếm sản phẩm trên Facebook Marketplace (`macbook pro 14inch 32gb ram, 1tb`, khu vực Hồ Chí Minh). Khi kiểm tra `xactions` MCP server, tool `x_facebook_marketplace` **không tồn tại** trong `src/mcp/server.js`. Đồng thời, audit nhanh cho thấy một số tính năng Facebook khác đã có implementation trong codebase nhưng **chưa được expose thành MCP tool**:

- `x_facebook_group_members` — `FR-20` / Epic 4 story `4-6-scrape-group-members` đã done, hàm `scrapeGroupMembers` đã có trong `src/scrapers/facebook/index.js`.
- `x_facebook_marketplace` — Epic 5b story `5b-1-marketplace-scraper` đã done, hàm `scrapeMarketplace` đã có trong `src/scrapers/facebook/index.js`.
- `x_facebook_search` — đã có thể thông qua `x_search_tweets` với `platform: "facebook"`, nhưng không có tên tool rõ ràng cho Facebook.
- `x_facebook_list_accounts` — không có tool nào để liệt kê các `FacebookAccount` đã lưu trong DB, dù các tool khác đã hỗ trợ `authCookie.accountId`.

Đây là gap giữa **implementation** và **MCP surface**, không phải gap chức năng cốt lõi.

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic / Story | Tác động | Ghi chú |
|--------------|----------|---------|
| Epic 4 `4-6-scrape-group-members` | Trung bình | Code done, chỉ thiếu MCP tool. Không ảnh hưởng epic completion nhưng AI agent không thể gọi tính năng này qua MCP. |
| Epic 5b `5b-1-marketplace-scraper` | Trung bình | Code done, PRD cũ Epic 4 đánh Marketplace là out-of-scope nhưng sprint-status.yaml đã ghi nhận epic-5b done. Cần cập nhật PRD hoặc chấp nhận epic-5b là scope mới. |
| Epic 3 `3-2-mcp-facebook` | Trung bình | Story đánh dấu done nhưng MCP surface chưa đầy đủ. Cần reopen hoặc tạo follow-up story. |
| Epic 6 (Anti-Detection) | Thấp | Không ảnh hưởng trực tiếp. |

### 2.2 Artifact Conflict

| Artifact | Xung đột? | Chi tiết |
|----------|-----------|----------|
| `src/mcp/server.js` | Có | Cần thêm tool definitions và handler dispatch. |
| `tests/mcp/` | Có | Cần thêm schema/dispatch tests cho tool mới. |
| `src/scrapers/facebook/index.js` | Không | Code đã sẵn sàng, chỉ import và gọi. |
| `_bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md` | Có | §6.2 ghi Marketplace out-of-scope, nhưng `sprint-status.yaml` và code lại có epic-5b. Cần reconcile. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Có | `3-2-mcp-facebook: done` và `5b-1-marketplace-scraper: done` ghi nhận sai trạng thái nếu MCP chưa expose. |
| `architecture.md` | Không | Khuyến nghị thêm MCP contract tests khi thay đổi public surface. |

### 2.3 PRD / MVP Impact

- **FR-20 (Scrape group members)** vẫn là in-scope. Việc thêm MCP tool là hoàn thiện surface, không thay đổi MVP.
- **Marketplace** cần quyết định scope: nếu giữ epic-5b đã done thì expose MCP tool là bắt buộc; nếu revert epic-5b thì cần xoá `scrapeMarketplace` khỏi codebase hoặc đánh dấu `experimental`.
- **List accounts** là tính năng mới hỗ trợ `accountId` workflow, không nằm trong PRD hiện tại, nhưng nâng cao UX của MCP.

## 3. Recommended Approach

### 3.1 Chọn chiến lược

**Hybrid: Direct Adjustment + nhỏ PRD reconciliation.**

Lý do:
- Code `scrapeGroupMembers` và `scrapeMarketplace` đã có sẵn, chỉ cần expose qua MCP — effort thấp.
- Không cần rollback vì implementation đúng và tests đã pass.
- Cần cập nhật `sprint-status.yaml` và PRD để phản ánh scope thực (epic-5b Marketplace đã là in-scope de-facto).
- `x_facebook_list_accounts` nên làm sau hoặc tách thành story riêng vì liên quan đến auth/PII surface.

### 3.2 Kế hoạch thực hiện

| Bước | Hành động | Người phụ trách | Output |
|------|-----------|-----------------|--------|
| 1 | Thêm `x_facebook_group_members` vào `src/mcp/server.js` (schema + handler). | Developer | Code diff |
| 2 | Thêm `x_facebook_marketplace` vào `src/mcp/server.js` (schema + handler). | Developer | Code diff |
| 3 | Thêm MCP contract tests trong `tests/mcp/` cho 2 tool mới. | Developer | Test files |
| 4 | Chạy `npx vitest run tests/mcp/` và `npx vitest run`. | Developer | Pass report |
| 5 | Smoke test bằng `mcp_call_tool` với `accountId`. | Developer | Tool result |
| 6 | Cập nhật `sprint-status.yaml`: đánh dấu `3-2-mcp-facebook` cần review hoặc tạo follow-up story. | PO/Developer | Updated yaml |
| 7 | Cập nhật PRD Epic 4 (hoặc tạo PRD Epic 5b): ghi nhận Marketplace là in-scope. | PO | Updated PRD |

### 3.3 Ước tính effort & rủi ro

- **Effort:** Thấp–Trung bình (2–4 giờ cho 2 tool + tests + smoke).
- **Risk:** Thấp. Code scraper đã có; chỉ là orchestration MCP. Rủi ro chính là selector Facebook Marketplace có thể thay đổi, nhưng đã có retry bounded.
- **Timeline impact:** Không đáng kể.

## 4. Detailed Change Proposals

### 4.1 Add `x_facebook_group_members`

```
Tool: x_facebook_group_members
Input: { groupUrl: string, limit?: number, authCookie: { c_user, xs } | { accountId } }
Dry-run: false only (read operation, can still run without mutating)
Real run: login → navigate groupUrl → scrapeGroupMembers(page, groupUrl, { limit })
```

Implementation:
- Thêm vào `TOOLS` array trong `src/mcp/server.js`.
- Thêm nhánh trong `executeFacebookEpic4Tool`.
- Gọi `scrapeGroupMembers` từ `src/scrapers/facebook/index.js`.
- Reuse `resolveMcpFacebookAuth` để hỗ trợ `accountId`.

### 4.2 Add `x_facebook_marketplace`

```
Tool: x_facebook_marketplace
Input: { query: string, location?: string, limit?: number, minPrice?: number, maxPrice?: number, category?: string, authCookie: ..., dryRun?: boolean }
Dry-run: true (default) → preview search URL và filters
Real run: login → scrapeMarketplace(page, query, { limit, location, minPrice, maxPrice, category })
```

Implementation tương tự `x_facebook_warmup_scroll`, sử dụng `runWithFacebookBrowser`.

### 4.3 Optional `x_facebook_list_accounts`

```
Tool: x_facebook_list_accounts
Input: { userId?: string } (nếu không có userId, lấy từ account đầu tiên)
Output: [{ id, label, userId, createdAt }] (không trả c_user/xs)
```

Nên tách thành story riêng do liên quan đến quyền và PII.

### 4.4 PRD / Sprint Status Reconciliation

- Cập nhật `prd-XActions-2026-06-10-epic4/prd.md`: §6.2 ghi Marketplace là `defer` → đổi thành `covered by Epic 5b`.
- Cập nhật `sprint-status.yaml`: tách `5b-1-marketplace-scraper` thành `in-progress` hoặc thêm `5b-3-marketplace-mcp-tool`.

## 5. PRD MVP Impact & Action Plan

### MVP hiện tại

Facebook Platform Extension vẫn là MVP. Việc expose thêm 2 MCP tool không mở rộng MVP vì implementation đã tồn tại. Tuy nhiên, nếu `x_facebook_marketplace` được chấp nhận, MVP cần ghi nhận Marketplace là in-scope.

### Action plan

1. Implement `x_facebook_group_members` (in-scope, no PRD change).
2. Implement `x_facebook_marketplace` (scope reconciliation needed).
3. Add MCP contract tests.
4. Run `npx vitest run tests/mcp/`.
5. Smoke test `mcp_call_tool` với `accountId`.
6. Update `sprint-status.yaml`.
7. Update PRD / tạo Epic 5b PRD.

## 6. Implementation Handoff

| Vai trò | Trách nhiệm |
|---------|-------------|
| **Developer** | Thêm tool definitions, handlers, tests, smoke test, commit/push. |
| **PO** | Quyết định scope Marketplace và approve PRD reconciliation. |
| **Tester / QA** | Xác nhận `npx vitest run tests/mcp/` pass và `mcp_call_tool` trả về listing hợp lệ. |

## 7. Success Criteria

- [ ] `x_facebook_group_members` trả về danh sách thành viên (hoặc `note` nếu nhóm hạn chế).
- [ ] `x_facebook_marketplace` trả về danh sách listing với `title`, `price`, `location`, `image`, `listingUrl`.
- [ ] `npx vitest run tests/mcp/` pass.
- [ ] Không leak cookie values trong response (NFR3).
- [ ] `sprint-status.yaml` và PRD được cập nhật phản ánh scope thực.

## 8. Checklist Summary (từ bmad-correct-course)

| Section | Status |
|---------|--------|
| 1. Understand the Trigger | Done |
| 2. Epic Impact Assessment | Done |
| 3. Artifact Conflict Analysis | Done |
| 4. Path Forward Evaluation | Done — Hybrid Direct Adjustment + PRD reconciliation |
| 5. Sprint Change Proposal Components | Done |
| 6. Final Review | ⏳ Chờ user approve |

## 9. Next Step

Chờ **PO/Architect approve** proposal. Sau khi approve, Developer sẽ implement `x_facebook_group_members` và `x_facebook_marketplace`, sau đó smoke test với `accountId`.
