# Sprint Change Proposal: MCP Domain Dispatchers & Tool Surface Optimization

**Date:** 2026-10-01  
**Project:** XActions (XACT)  
**Author:** Winston (System Architect)  
**Status:** Approved  
**Scope Classification:** Moderate (Backlog & Architecture Update)  

---

## 1. Issue Summary

### 1.1 Problem Statement
Tệp `src/mcp/server.js` hiện đang đăng ký tĩnh **224 MCP tools** riêng lẻ trong mảng `TOOLS`. Khi kết nối XActions MCP vào các AI client hiện đại như Claude Code CLI, Cursor, hoặc Claude Desktop, cấu trúc này gây ra 3 vấn đề nghiêm trọng:
1. **Token Bloat (Tốn ngữ cảnh khổng lồ):** Khai báo schema của 224 tools tiêu tốn từ **45.000 đến 55.000 tokens** cho mỗi turn hội thoại. Điều này chiếm tới 25–50% context window của model trước cả khi người dùng gửi prompt.
2. **Tool Dropping (Vượt ngưỡng trần của Claude Code CLI):** Claude Code CLI và Anthropic API có ngưỡng trần an toàn (~116–128 tools active đồng thời). Khi vượt quá, client sẽ tự động drop công cụ hoặc báo lỗi `unknown tool` / `tool not available`.
3. **Selection Degradation (Suy giảm độ chính xác của LLM):** 27 tool `x_get_*`, 21 tool `x_facebook_*`, 15 tool crypto... làm LLM dễ bị nhầm lẫn tham số hoặc chọn sai công cụ.

### 1.2 Discovery Context & Evidence
- Trong buổi làm việc ngày 2026-10-01, khi kiểm tra `claude mcp list` và khả năng load MCP của Claude Code CLI, việc bổ sung thêm các tool crypto (Epic 50) đã nâng tổng số tools lên 224, khiến việc nạp toàn bộ vào CLI trở nên bất khả thi nếu không có cơ chế gom cụm.
- Khảo sát thực tế trong `src/mcp/server.js`:
  - `x_get_*`: 27 tools (chủ yếu là các read endpoint của Twitter).
  - `x_facebook_*`: 21 tools.
  - `x_pumpfun_*` & `x_dexscreener_*`: 15 tools.
  - `x_follow_*`, `x_unfollow_*`: 7 tools.
  - `x_stream_*`: 8 tools.

---

## 2. Impact Analysis

### 2.1 Epic Impact
- **Các Epic đã hoàn thành (Epic 3, 14, 20, 50):** Không bị hồi tố (no rollback). Toàn bộ logic nghiệp vụ bên dưới của 224 tools vẫn hoạt động ổn định.
- **Đề xuất Epic mới:** Tạo **Epic 52: MCP Tool Surface Consolidation & Dual-Mode Runtime**.
  - *Story 52.1:* Thiết kế và triển khai 10 Domain Dispatchers (`x_post`, `x_user`, `x_read`, `x_dm`, `x_facebook`, `x_crypto`, `x_scrape`, `x_persona`, `x_analytics`, `x_system`).
  - *Story 52.2:* Triển khai cơ chế Dual-Mode (`MCP_TOOL_MODE=compact|full`) bảo toàn 100% tương thích ngược cho các client cũ cần gọi legacy tool names.
  - *Story 52.3:* Cập nhật test suite (`tests/mcp/domain-dispatchers.test.js` và cập nhật `server.test.js`).

### 2.2 PRD Impact
- **FR-73 (MCP Daemon & CLI Integration):** Cập nhật mô tả từ "80+ MCP tools" thành:
  *"Hỗ trợ kiến trúc Dual-Mode: Mặc định cung cấp 10 Core Domain Dispatchers tối ưu hóa context cho AI Agents (tiết kiệm 95% token schema), đồng thời duy trì chế độ Full Catalog (220+ legacy tools) khi cấu hình `MCP_TOOL_MODE=full`."*
- **NFR-16 (Tương Thích Ngược):** Đảm bảo không làm gãy bất kỳ caller hiện tại nào thông qua Dual-Mode flag.

### 2.3 Architecture Impact
- **Architecture Pattern:** Bổ sung **Domain Facade Router** vào tầng MCP.
  - `TOOLS` được khởi tạo dựa trên `process.env.MCP_TOOL_MODE` hoặc cờ CLI `--mode`.
  - Mặc định (`compact`): Export mảng 10 Domain Tools.
  - Khi `full`: Export toàn bộ 224 legacy tools.
  - `executeTool` phân phối lời gọi từ Domain Dispatcher vào các handler cũ hiện có thông qua `DOMAIN_DISPATCH_MAP`. Không viết lại logic nghiệp vụ cào hay automation.

### 2.4 Technical & Test Impact
- **Tương thích test:** File `tests/mcp/server.test.js` hiện kiểm tra các tool name cụ thể (`x_get_profile`, `x_post_tweet`). Cần đảm bảo test suite chạy dưới chế độ test có thể kiểm tra cả 2 chế độ mà không bị gãy CI.
- **Hiệu năng:** Giảm token overhead từ ~50.000 tokens xuống ~2.500 tokens (giảm 95%). Thời gian phân giải tool của LLM giảm từ hàng giây xuống mili-giây.

---

## 3. Recommended Approach

### 3.1 Lựa chọn Giải pháp: Hybrid Option 1 + Option 3 (Domain Dispatchers + Dual-Mode Flag)
- **Triển khai 10 Domain Dispatchers làm chuẩn mặc định (`compact` mode):**
  1. `x_post`: Twitter write actions (tweet, thread, reply, retweet, quote, like, schedule...).
  2. `x_user`: Twitter social graph & relationships (profile, follow, unfollow, mute, block...).
  3. `x_read`: Twitter search & retrieval (search, detail, timeline, bookmarks, lists...).
  4. `x_dm`: Direct message operations.
  5. `x_facebook`: Gom toàn bộ 21 tool Facebook thành 1 tool duy nhất.
  6. `x_crypto`: Gom 15 tool Dexscreener & Pump.fun thành 1 tool duy nhất với tham số `platform`.
  7. `x_scrape`: 29 platforms crawlers hiện tại (giữ nguyên).
  8. `x_persona`: Autonomous agent & growth engine.
  9. `x_analytics`: Metrics, graph analysis, viral analysis.
  10. `x_system`: Status, health, governor, quota, streaming controls.

- **Bảo toàn tương thích ngược thông qua Dual-Mode Flag:**
  ```bash
  # Mặc định cho Claude Code CLI / Claude Desktop (10 tools - siêu nhẹ)
  node src/mcp/server.js

  # Hoặc kích hoạt chế độ legacy (224 tools)
  MCP_TOOL_MODE=full node src/mcp/server.js
  ```

---

## 4. Detailed Change Proposals

### Proposal 4.1: Cập nhật PRD (`_bmad-output/planning-artifacts/prd.md`)

**Section:** Functional Requirements - FR-73  
**OLD:**
```markdown
* **FR-73 (MCP Daemon & CLI Integration + Streaming Dataset Exporter):** Cung cấp 80+ MCP tools trả về 3-Layer JSON Envelope có cơ chế Auto-Artifact khi payload >100 records. Hỗ trợ xuất dữ liệu ra định dạng JSONL/CSV stream với backpressure.
```

**NEW:**
```markdown
* **FR-73 (MCP Daemon & Dual-Mode Domain Dispatchers):** Cung cấp giao thức MCP tối ưu hóa ngữ cảnh với kiến trúc Dual-Mode:
  - **Compact Mode (Mặc định):** 10 Domain Dispatchers (`x_post`, `x_user`, `x_read`, `x_dm`, `x_facebook`, `x_crypto`, `x_scrape`, `x_persona`, `x_analytics`, `x_system`) giúp giảm 95% token overhead và loại bỏ triệt để tình trạng tool-dropping trên Claude Code CLI / Claude Desktop.
  - **Full Catalog Mode (`MCP_TOOL_MODE=full`):** Mở rộng 220+ dedicated tools riêng lẻ phục vụ kiểm thử và tương thích ngược với các workflow legacy.
  - Toàn bộ công cụ tuân thủ chuẩn 3-Layer JSON Envelope (`ToolEnvelope`) và cơ chế Auto-Artifact cho payload lớn.
```

---

### Proposal 4.2: Tạo Epic 52 trong Backlog (`_bmad-output/planning-artifacts/epics.md`)

```markdown
### Epic 52: MCP Tool Surface Consolidation & Context Optimization
*Tái cấu trúc bề mặt công cụ MCP của XActions từ 224 tools tĩnh thành 10 Domain Dispatchers, tối ưu hóa triệt để context window và đảm bảo tương thích 100% với Claude Code CLI.*

#### Story 52.1: Domain Dispatcher Schemas & Routing Facade
- Định nghĩa mảng `DOMAIN_TOOLS` gồm 10 tools với schema chuẩn mực.
- Xây dựng `DOMAIN_DISPATCH_MAP` ánh xạ `(domain_tool, action) -> legacy_handler`.
- Đảm bảo trả về `ToolEnvelope` và bắt lỗi `XACT_4002` khi thiếu requiredArgs của action.

#### Story 52.2: Dual-Mode Runtime Engine & CLI Flags
- Hỗ trợ biến môi trường `MCP_TOOL_MODE=compact|full` và tham số khởi động `--mode=compact|full`.
- Mặc định là `compact` (chỉ export 10 tools). Khi bật `full`, export toàn bộ mảng legacy tools.
- Export helper `getAllTools()` và `getDomainTools()` phục vụ kiểm thử.

#### Story 52.3: Verification Test Suite & Backward Compatibility Assurance
- Viết test suite `tests/mcp/domain-dispatchers.test.js` kiểm tra khả năng dispatch của cả 10 tools.
- Cập nhật `tests/mcp/server.test.js` để chạy tương thích ở cả 2 mode mà không bị fail assertion.
```

---

## 5. Implementation Handoff & Success Criteria

- **Scope Classification:** Moderate (Cần cập nhật Backlog, PRD và triển khai code tại `src/mcp/server.js`).
- **Phân công Thực thi:**
  - **Winston (Architect):** Đã hoàn tất bản đặc tả kiến trúc và proposal.
  - **Amelia (Developer Agent):** Triển khai Epic 52 thông qua skill `bmad-build-auto`.
- **Tiêu chí Hoàn thành (Success Criteria):**
  1. `src/mcp/server.js` khởi động mặc định chỉ expose đúng 10 tools.
  2. Kích thước schema truyền cho LLM giảm từ ~50k tokens xuống <3k tokens.
  3. Khi set `MCP_TOOL_MODE=full`, toàn bộ 224 tools cũ vẫn sẵn sàng.
  4. 100% test suites trong `tests/mcp/` đều pass.
