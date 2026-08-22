# BMAD Code Review — Handoff: các nhóm còn lại (C, D, E, F)

> Prompt này dành cho agent tiếp theo chạy tiếp quy trình **bmad-code-review** trên
> commit range refactor `7cd8028~1..HEAD` của repo XActions.
> Nhóm A (CLI) và Nhóm B (Facebook scraper split) đã review xong và patch xong.

## Bối cảnh bắt buộc phải biết trước khi làm

1. **Range review:** `7cd8028168d666ff638120886793ea2dafebdd59~1..HEAD`
   — 38 commits refactor/typing (JSDoc-to-TS Phase 3+4, tách monolith).
   Tổng: 601 files, +24.481 / −13.543.
2. **Đã xong:**
   - **Nhóm A — CLI** (`src/cli/**`, `bin/**`): 73 files. Kết quả triage:
     8 patch · 6 defer · 12 dismissed. Đã fix toàn bộ 8 patch
     (commit `40f17eb`: token key mismatch `auth_token`→`authToken` + hint chết
     "xactions config --token"; try/finally đóng Chromium trong ai.js/read.js/
     portability.js; logout xóa thêm csrfToken + cookies.json; gom
     automate/status/checkpoints/schema vào GROUPS; viết lại 38 file .d.ts;
     dọn unused imports ~16 module; khôi phục comment ADR-012 + followsBack).
   - **Nhóm B — Facebook scraper split** (`src/scrapers/facebook/**`,
     `api/services/facebookAutomation.js`): 24 files. Triage: 4 patch · 4 defer ·
     3 dismissed. Đã fix 4 patch (commit `5a38448`: regression coercion numeric-id
     trong normalize.js — hydration JSON thả legacy_fbid dạng number, code mới ép
     typeof==='string' làm drop âm thầm comment/search/post/listing; guard
     nodeType===1 cho xpath fallback messengerShare.js).
   - Cả hai fix nằm trên branch `worktree-review-groupA-cli-fixes`, đã push,
     draft PR: https://github.com/deptrai/XActions/pull/2
3. **Các mục DEFER đã ghi nhận (chưa fix, pre-existing):**
   - NaN-validation cho CLI flags (`--delay/--days/--limit/--interval/...`)
   - SIGINT handler async thiếu try/catch (`analytics.js`, `agent.js`, `history.js`)
   - `schedule.js resolveCliUserId` đọc key `sessionCookie` nhưng login chỉ lưu `authToken`;
     collision prefix cookie trong upsert user
   - `info.js` hardcode v3.0.0 (package.json là 3.5.0)
   - `bin/unfollowx` là stub CJS hỏng trong package `"type": "module"` (pre-existing)
   - WebRTC stub chỉ override khi defined (`fingerprint.js`) — behavior change nhỏ
   - Thiếu guard `page == null` ở 3 write-batch function facebook automation
     (`joinFacebookGroups`, `postToFacebookGroups`, `sendFriendRequests`)

## Quy trình phải tuân theo

Chạy skill `.claude/skills/bmad-code-review` (step-file architecture):
step-01 gather context → step-02 launch song song **Blind Hunter**
(`bmad-review-adversarial-general`) + **Edge Case Hunter**
(`bmad-review-edge-case-hunter`) → step-03 triage (đọc code thật trước khi
chấm severity; route vào patch/defer/dismiss; drop dismissed) → step-04 present.

**Mode:** no-spec (không có story file).

**Lưu ý vận hành rút ra từ 2 nhóm đầu:**
- Diff mỗi nhóm vẫn lớn (8–9k dòng) — lưu ra file rồi cho subagent Read theo chunk
  (offset/limit), đừng paste vào prompt.
- Blind Hunter từng chết bởi API 503 giữa chừng: nếu subagent fail/empty, ghi
  `failed_layers` và bù bằng phân tích parity trực tiếp (so sánh export inventory +
  function body old-vs-new bằng script Python tokenize bỏ comment/whitespace —
  cách này bắt được cả regression mà reviewer thường bỏ sót).
- Dùng `code-review-graph` MCP (`detect_changes_tool`, `get_impact_radius_tool`)
  để định blast radius, dùng serena/vibervn file_retrieval để định vị nhanh.
- Verify mọi claim của subagent trước khi patch: nhiều finding là false positive
  hoặc pre-existing (Nhóm B: 3/11 findings bị dismiss vì đúng lý do này).
- Patch xong phải chạy: `npx tsc --noEmit` + `npx vitest run` liên quan +
  smoke test entry point. Test flake có xảy ra (facebook services fail 3 test
  1 lần, chạy lại sạch) — chạy lại trước khi kết luận lỗi.
- Commit theo format repo, push lên branch PR hiện tại
  `worktree-review-groupA-cli-fixes` (PR #2 đang mở, draft) hoặc branch mới nếu
  user muốn tách.

## Các nhóm còn lại (theo thứ tự ưu tiên)

### Nhóm C — API server/services/middleware
```
git diff 7cd8028~1..HEAD -- api/server.js api/serverless api/services api/middleware api/lib api/utils api/config api/realtime > <tmp>/groupC.diff
```
~23 files services (+operations/puppeteer 8 files) + middleware/openapi/socketHandler.
Điểm cần soi: typing commit `0040884`/`d47c086`/`46eed6d` (thêm express/jsonwebtoken/
socket.io shims), jobQueue, payments (Stripe/x402 — tiền!), auth middleware.

### Nhóm D — API routes + sidecar types
```
git diff 7cd8028~1..HEAD -- api/routes src/types > <tmp>/groupD.diff
```
47 routes + 47 routes/ai + 22 src/types. Commit mới nhất `9fbb179` type routes/ai.
Soi: JSDoc sidecar types có mô tả đúng API thật không (Nhóm A bắt được cả loạt
.d.ts sai hoàn toàn), response shape, validation route.

### Nhóm E — Core library + scrapers twitter/client
```
git diff 7cd8028~1..HEAD -- src/scrapers/twitter src/scrapers/adapters src/client src/core src/types > <tmp>/groupE.diff
```
17 files twitter/http + 9 adapters + 9 client/auth + client/api. Commits
`86d25dc`→`6fcec4b`. Soi giống Nhóm B: GraphQL query registry, endpoint typing,
coercion id/timestamp khi tách module.

### Nhóm F — src còn lại
```
git diff 7cd8028~1..HEAD -- src/automation src/agents src/analytics src/a2a src/workflows src/streaming src/mcp src/utils src/proxy src/portability > <tmp>/groupF.diff
```
20 automation + 10 agents + 10 analytics + 12 a2a + 7 workflows + 6 streaming +
6 mcp. Soi: personaEngine/algorithmBuilder (commit `7bb80ae`, `d4c627c`),
MCP server tools (commit `6d66c27`), browser-script pattern giữ nguyên khi move.

## Tiêu chí severity (đọc code thật, không tin diff hunk)
- `high` — intolerable: regression hành vi, leak tài nguyên, mất guard, sai key/config
- `medium` — tolerable: dead-end UX, inconsistency convention, thiếu test
- `low` — cosmetic

Sau khi xong từng nhóm: trình bày summary (số liệu patch/defer/dismiss), apply
patch sau khi user chọn "Apply every patch", verify, commit + push, cập nhật
phần "Đã xong" trong chính file handoff này cho nhóm kế tiếp.
