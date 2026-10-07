# Reviewer Gate Report — Validate Intent (2026-08-27)

**Đối tượng review:** Sửa đổi "Action-Level Granular Authentication & Proxy Strategy" áp dụng ngày 2026-08-27 vào `ARCHITECTURE-SPINE.md` (AD-3 rule 3b, AD-11 rule 3, AD-8, AD-14) + `epics.md` (9 stories) + `sprint-change-proposal-2026-08-27.md`.

**Gate verdict:** ⚠️ **PASS-WITH-FINDINGS (4/4 reviewer đồng thuận)** — Hướng kiến trúc action-level granularity được xác nhận đúng và đáng làm. Nhưng **plan triển khai (dev tasks T1–T6) chưa đủ**: có 3 blocker ở tầng code mà proposal khẳng định "không cần sửa" và 2 lỗ hổng AD cần thêm 1 câu văn mỗi chỗ.

**Lens đã chạy:** lint_spine.py (12 findings, tất cả pre-existing/false-positive) + 4 subagent reviewer song song.

---

## Findings (đã dedupe, theo severity)

### 🔴 CRITICAL

| # | Finding | Nguồn | Fix tối thiểu |
|---|---|---|---|
| **F1** | **Token Ring không tách bạch guest vs account tokens** — AD-1 rule 1 gộp `lsd`/`fb_dtsg`/`msToken` vào một ring; AD-3 3b nói no-auth action lấy "guest token từ Pre-Signed Token Ring". Không có quy tắc affinity → account-bound `fb_dtsg` có thể bị phát cho request xoay IP → checkpoint/ban tức thì | rubric + adversarial | Thêm 1 câu vào AD-3 3b: *"Token Ring phân vùng theo auth mode: guest token (lsd/jazoest anonymous) tách khỏi account-bound token (fb_dtsg/c_user); account-bound token chỉ phát qua sticky proxy của đúng accountId"* |
| **F2** | **Opt-in accountId bỏ qua governor check** — AD-11 rule 3 nói `actionRequiresAuth === false` → "bỏ qua governor account check", nhưng AD-3 3b nói "caller truyền accountId vẫn được tôn trọng (opt-in auth)". Hibernating/velocity-exhausted account vẫn chạy được qua opt-in → ban | rubric + adversarial + cross-artifact | Thêm 1 câu: *"Opt-in accountId trên action `requiresAuth: false` vẫn chịu `governor.canAccountRequest` + account velocity limit; vi phạm → `XACT_4291` như auth action"* |
| **F3** | **[CODE] `FacebookClient.requestGraphQl` dòng 436: `options.accountId \|\| 'default'`** — accountId=null bị thành chuỗi `'default'` → `resolveProxy('default')` gán sticky session → **rotating không bao giờ xảy ra** cho no-auth action. **Phản bác claim "không cần sửa client" trong proposal** | reality-check (đã verify trên code) | Dev task mới **T7**: bỏ fallback `'default'`, truyền `null` xuyên suốt |
| **F4** | **[CODE] `buildGraphQlBody` dòng 389 hard-require `c_user`/`userId`** — throw `XACT_4010` khi thiếu token auth. Guest GraphQL cần `__user: '0'`/`av: '0'` — **mọi no-auth action sẽ crash ở tầng token** dù T1–T6 xong | reality-check (đã verify trên code) | Mở rộng **T7**: guest body mode khi `actionRequiresAuth === false` |

### 🟠 HIGH

| # | Finding | Nguồn | Fix tối thiểu |
|---|---|---|---|
| **F5** | **[CODE] `base-client.js:486` guard + client-level `requiresAuth = true`** — standalone setup không accountPool: no-auth action vẫn throw `XACT_4010` vì flag ở cấp client không nhận signal action-level | adversarial + reality-check | Dev task mới **T8**: truyền auth-mode xuống client qua `options.requiresAuth` (hoặc session) và nới guard |
| **F6** | **AD-20 × AD-3 3b: ma trận phân bổ chưa định nghĩa** — rotating bulk action (marketplace) có hút Realtime Pool không? Có thể starve on-demand queries — đúng điều AD-20 tồn tại để ngăn | rubric + adversarial | 1 câu vào AD-3 3b: *"no-auth rotating request mặc định thuộc Bulk Pool; vào Realtime Pool chỉ khi gọi qua MCP on-demand"* |
| **F7** | **CrawlCheckpoint (AD-12/AD-16) thiếu `authMode`/`accountId`** — resume sau restart có thể replay auth cursor bằng guest mode (hoặc ngược lại) → pagination cursor bị reject `XACT_4001` | rubric + adversarial | Thêm `authMode` + `accountId` vào checkpoint state (AD-12 rule 1 + note schema Story 10.2) |
| **F8** | **`epics.md` Story 14.2 (dòng ~675): action discovery AC còn shape cũ thiếu `requiresAuth`** — story này không nằm trong danh sách 9 story được sửa | cross-artifact | Sửa 1 dòng AC |
| **F9** | **`epics.md` Story 11.5 step 2 (dòng ~271): còn ngôn ngữ platform-level** — "Auth-required platforms (Facebook...) sử dụng sticky IP" mâu thuẫn với step 1 vừa sửa | cross-artifact | Sửa wording step 2 theo action-level |
| **F10** | **AD-9 rule 1 branch theo platform, không theo auth state** — Facebook `marketplace` gặp WAF → đi nhánh "Auth-required platforms" (hibernate account) hay "No-auth" (xoay IP)? Hai team đọc hai kiểu | cross-artifact | Đổi "No-auth platforms" → "no-auth requests (theo action-level, AD-3 3b)" |

### 🟡 MEDIUM

| # | Finding | Nguồn | Fix |
|---|---|---|---|
| **F11** | AD-5 rule 4 vẫn liệt kê Facebook trong "Auth-required platforms" blanket | cross-artifact | Thêm "(mặc định platform; action-level override xem AD-3 3b)" |
| **F12** | `registerAction` truyền descriptor **chưa resolve** vào `globalActionRegistry` — action dựa fallback sẽ có `requiresAuth: undefined` ở registry; cần xác minh MCP `x_actions_list` đọc nguồn nào | reality-check | Ghi rõ trong T3: resolve trước khi register hoặc resolve tại list-time |

### ⚪ Pre-existing (không do thay đổi hôm nay)
- Lint: 6× AD non-monotonic (AD-14..19 đứng sau AD-20 — thừa kế từ r3), 6× false-positive placeholder tokens.

---

## Kết luận cho plan

| Khía cạnh | Đánh giá |
|---|---|
| **Hướng kiến trúc** | ✅ Đúng — 4/4 reviewer nhất trí. Phân rã `requiresAuth` xuống action là quyết định đúng, fallback `??` giữ backward compat chuẩn xác |
| **Sửa tài liệu đã làm** | ⚠️ 85% đúng — còn 4 chỗ stale (F8, F9, F10, F11) + 2 câu AD cần bổ sung (F1, F2) + 1 câu (F6) |
| **Dev tasks T1–T6** | ❌ **Chưa đủ** — cần thêm **T7** (FacebookClient: guest mode + bỏ `'default'` accountId — F3, F4) và **T8** (base-client guard / auth-mode signal — F5). Effort tăng từ ~1 dev-day lên **~1.5–2 dev-days** |
| **Effort/risk tổng** | Vẫn Low-Medium risk; chưa có finding nào bác bỏ toàn bộ hướng đi |

**Đề xuất:** chạy **Update intent** (bmad-architecture) để áp F1, F2, F6, F10, F11 vào spine + F8, F9 vào epics.md + cập nhật proposal (thêm T7, T8, sửa claim "không cần sửa client") — ước tính ~30 phút.

---

## Chi tiết review đầy đủ

| Reviewer | File |
|---|---|
| Rubric walker | `reviews/review-rubric-walker-2026-08-27.md` |
| Adversarial | `reviews/review-adversarial-2026-08-27.md` |
| Reality-check | `reviews/review-reality-check-2026-08-27.md` |
| Cross-artifact | `reviews/review-cross-artifact-2026-08-27.md` |
