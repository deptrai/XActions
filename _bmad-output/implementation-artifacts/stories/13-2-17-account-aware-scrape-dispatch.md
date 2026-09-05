---
title: 'Story 13.2.17: Account-Aware Scrape Dispatch & UI Guidance'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: '33f3d4e9'
context:
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-05.md
  - dashboard/platform.html
  - api/routes/platform.js
  - src/scrapers/social/twitter/crawler.js
  - src/scrapers/social/facebook/crawler.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trên giao diện universal platform dashboard (`dashboard/platform.html`), tab `scrape` được mặc định là hoàn toàn công khai (`const isPublic = tab === "scrape";`, `const needsAccount = tab !== "scrape";`). Tuy nhiên trên thực tế, một số hành động scrape (như Twitter Search `search`, Facebook Search `search`, Facebook Followers `followers`) bắt buộc phải có phiên xác thực (`authCookie` / `auth_token`). Khi người dùng chưa chọn tài khoản:
1. Giao diện không cảnh báo yêu cầu tài khoản và không vô hiệu hóa nút chạy.
2. Người dùng bấm chạy sẽ nhận lỗi kỹ thuật (ví dụ `Twitter search requires an authenticated session`) hoặc mảng rỗng `[]` (Facebook search note bị ẩn).
3. Thiếu lối tắt trực tiếp để nạp tài khoản (`+ Add Account`) ngay tại card hành động khi chưa có tài khoản.
4. `api/routes/platform.js` chưa chuẩn hóa đối xứng alias `x` và `twitter` khi tra cứu danh sách và cookie tài khoản.

**Approach:**
1. **Cấu hình `requiresAccount: true`**:
   - Thêm cờ `requiresAccount: true` vào các action đòi hỏi phiên đăng nhập trong `PLATFORM_CONFIG` (Twitter search, Facebook search, Facebook followers).
2. **Cập nhật hiển thị và điều kiện thực thi trên `dashboard/platform.html`**:
   - `buildActionCard`: `const needsAccount = tab !== "scrape" || Boolean(item.requiresAccount);`
   - Khi `needsAccount && !state.accountId`:
     - Hiển thị khối cảnh báo rõ ràng kèm link trực tiếp mở form nạp account: `⚠️ This action requires an authenticated account. Select one from the account bar or click [+ Add Account].`
     - Vô hiệu hóa nút Preview/Run Live.
   - Quick actions list: hiển thị biểu tượng `🔑` để nhận biết trước action cần tài khoản.
   - `run()`: chặn thực thi nếu action yêu cầu tài khoản mà chưa chọn (`!isPublic && !state.accountId`).
3. **Cải thiện hiển thị kết quả (Empty & Note States)**:
   - Khi API trả về mảng rỗng hoặc có trường `note` (ví dụ `resObj.note` từ Facebook search), hiển thị hộp ghi chú thông tin nổi bật thay vì chỉ báo `✅ Operation completed successfully`.
   - Nếu xảy ra lỗi liên quan đến phiên xác thực (`AUTH_EXPIRED`, thiếu cookie), hiển thị nút CTA `[+ Add Account]` ngay trong khung kết quả.
4. **Chuẩn hóa Alias `x` <-> `twitter` trong `api/routes/platform.js`**:
   - Hỗ trợ cả hai tiền tố `x:` và `twitter:` khi tra cứu và lưu trữ tài khoản để tương thích hoàn toàn giữa URL `/platforms/x` và backend `/platform/twitter`.

## Boundaries & Constraints

**Always:**
- Giữ nguyên các action công khai thực sự (profile, trending, hashtag trên Mastodon, Bluesky, Threads, Facebook profile) hoạt động bình thường không cần tài khoản.
- Không phá vỡ luồng `POST /api/platform/:platform/scrape` hiện có.
- Tuân thủ Pure ESM và không thêm dependency ngoài.

**Never:**
- Không bắt buộc tài khoản đối với các nền tảng mở như Bluesky hay Mastodon.
- Không sửa đổi logic core trong `TwitterCrawler` hay `FacebookCrawler`.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Twitter Search no account | User opens `/platforms/x#scrape` → Search, no account | Card shows warning "Requires an account" + disabled Run button + "+ Add Account" link | User cannot send invalid request |
| Twitter Search with account | User selects account with `auth_token` | Preview button enabled; sends `accountIds` in scrape body; returns real tweets | Session expired → clear error with re-auth CTA |
| Facebook Search no account | User opens `/platforms/facebook#scrape` → Search | Card shows warning "Requires an account" + disabled Run button | Blocked on UI |
| Facebook Scrape Profile | User enters public URL `https://facebook.com/zuck` | Profile scraped as guest without warning | Public page rendered |
| Mastodon Trending | User clicks Trending | Runs without account; returns 20 posts | Instance error handled gracefully |

</frozen-after-approval>

## Tasks & Acceptance

### Task 1: `dashboard/platform.html` Action Config & Card Rendering
- [x] Thêm `requiresAccount: true` cho `x.scrape.search`, `facebook.scrape.search`, `facebook.scrape.followers`.
- [x] Cập nhật `buildActionCard` tính `needsAccount = tab !== "scrape" || Boolean(item.requiresAccount)`.
- [x] Hiển thị warning box kèm nút gọi `toggleImport()` khi thiếu account.
- [x] Cập nhật `run()` kiểm tra `item.requiresAccount`.
- [x] Cập nhật `renderQuickActions` hiển thị biểu tượng `🔑` cho action cần account.

### Task 2: `dashboard/platform.html` Result Presentation
- [x] Hiển thị `resObj.note` và empty state rõ ràng trong `renderResult()`.
- [x] Hiển thị gợi ý nạp account khi gặp lỗi thiếu phiên xác thực.

### Task 3: `api/routes/platform.js` Platform Alias Normalization
- [x] Chuẩn hóa tra cứu tài khoản cho cả hai prefix `x:` và `twitter:`.

### Task 4: Verification
- [x] Kiểm thử E2E bằng Chrome MCP trên `/platforms/x` và `/platforms/facebook`.
- [x] Chạy Vitest test suite để đảm bảo không hồi quy.
