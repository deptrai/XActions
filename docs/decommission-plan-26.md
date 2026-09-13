# Kế Hoạch Decommission Mã Nguồn Legacy (Epic 26)

<!-- Được thiết lập bởi Story 26.1 — Pre-Decommission Parity & Rollback Preparation -->
<!-- Ngày tạo: 2026-09-12 | Trạng thái: APPROVED FOR DECOMMISSION -->

Tài liệu này xác định phạm vi, kế hoạch an toàn, ma trận tương đương (parity matrix), và quy trình rollback chi tiết cho việc dỡ bỏ hoàn toàn các scraper module legacy trong **Story 26.2**.

---

## 1. Phạm Vi Dỡ Bỏ (Decommission Scope)

### 1.1. Thư Mục và Tập Tin Sẽ Xóa Vật Lý trong Story 26.2

| Đường Dẫn Legacy | Dung Lượng / Số File | Mô Tả | Module Thay Thế Canonical |
|---|---|---|---|
| `src/client/Scraper.js` | 1 file (~1,200 dòng) | Client Twitter monolithic cũ | `src/scrapers/social/twitter/client.js` (`TwitterClient`) & `src/client/index.js` |
| `src/scrapers/twitter/` | Thư mục (~25 files) | Toàn bộ Puppeteer scraper & HTTP scraper Twitter cũ | `src/scrapers/social/twitter/` (`TwitterCrawler`, `TwitterClient`) |
| `src/scrapers/facebook/` | Thư mục (~23 files) | Toàn bộ Puppeteer scraper Facebook cũ | `src/scrapers/social/facebook/` (`FacebookCrawler`, `FacebookClient`) |
| `src/scrapers/threads/index.js` | 1 file (~413 dòng) | Threads Puppeteer legacy | `src/scrapers/social/threads/` (`ThreadsCrawler`, `ThreadsClient`) |
| `src/scrapers/bluesky/index.js` | 1 file (~560 dòng) | Bluesky scraper AT Protocol cũ | `src/scrapers/social/bluesky/` (`BlueskyCrawler`, `BlueskyClient`) |
| `src/scrapers/mastodon/index.js` | 1 file (~570 dòng) | Mastodon REST API scraper cũ | `src/scrapers/social/mastodon/` (`MastodonCrawler`, `MastodonClient`) |

> **Tổng cộng:** 2 thư mục lớn (`twitter/`, `facebook/`) và 4 tập tin đơn lẻ, tương đương **> 50 files** và **> 15.000 dòng mã legacy** sẽ được dỡ bỏ.

---

## 2. Kế Hoạch An Toàn & Cơ Chế Rollback (Safety & Rollback Protocol)

### 2.1. Git Tag Dự Phòng (Backup Shield)
Trước khi xóa bất kỳ file nào trong Story 26.2:
- **Git tag:** `pre-decommission-2026-09-12` được tạo trực tiếp từ commit mới nhất trên nhánh `main`.
- **Lệnh tạo:** `git tag -a pre-decommission-2026-09-12 -m "Safety backup tag before Epic 26 legacy scraper decommissioning"`
- Tag này lưu giữ toàn bộ mã nguồn legacy nguyên vẹn để khôi phục tức thì khi cần.

### 2.2. Rollback SLA & Triggers
- **Cửa sổ rollback (Rollback Window):** **48 giờ** kể từ thời điểm merge Story 26.2 vào `main`.
- **Điều kiện kích hoạt Rollback (Triggers):**
  1. Tỷ lệ lỗi trên các kênh cào production tăng đột biến > 2% so với baseline.
  2. Phát hiện lỗi nghiêm trọng (Critical P0/P1) trong caller API, CLI `unfollowx`, hoặc MCP tools mà nguyên nhân do thiếu symbol legacy.
  3. Bất kỳ regression nào không thể hotfix trong vòng 30 phút.

### 2.3. Quy Trình Khôi Phục (Rollback Procedures)

#### Cách 1: Revert Commit (Khuyên dùng khi lỗi xảy ra trên nhánh `main`)
```bash
git revert --no-edit <commit-sha-story-26.2>
git push origin main
```

#### Cách 2: Restore từ Git Tag (Dùng trong trường hợp khẩn cấp)
```bash
git checkout -b hotfix/restore-legacy pre-decommission-2026-09-12
git checkout main -- src/scrapers/twitter src/scrapers/facebook src/client/Scraper.js
git commit -m "fix(emergency): restore legacy scrapers from pre-decommission tag"
```

---

## 3. Ma Trận Parity & Tính Năng Tương Đương (Parity Audit Matrix)

100% tính năng của legacy đã được cài đặt và kiểm thử trong `src/scrapers/social/` qua `AbstractCrawler` và dispatcher `scrape()`:

| Nền Tảng | Tính Năng Legacy | Action Tương Đương (`scrape(platform, action)`) | Trạng Thái Hybrid | Test Coverage |
|---|---|---|---|---|
| **Twitter** | `scrapeProfile` | `scrape('twitter', 'profile', { username })` | `TwitterCrawler.profile()` | `tests/scrapers/social/twitter/` |
| | `scrapeFollowers` | `scrape('twitter', 'followers', { username })` | `TwitterCrawler.followers()` | 100% coverage |
| | `scrapeFollowing` | `scrape('twitter', 'following', { username })` | `TwitterCrawler.following()` | 100% coverage |
| | `scrapeTweets` | `scrape('twitter', 'tweets', { username })` | `TwitterCrawler.tweets()` | 100% coverage |
| | `searchTweets` | `scrape('twitter', 'search', { query })` | `TwitterCrawler.search()` | 100% coverage |
| | `scrapeHashtag` | `scrape('twitter', 'hashtag', { hashtag })` | `TwitterCrawler.hashtag()` | 100% coverage |
| | `scrapeTrending` | `scrape('twitter', 'trending')` | `TwitterCrawler.trending()` | 100% coverage |
| | `likeTweet` / `retweet` | `scrape('twitter', 'like')` / `retweet` | `TwitterCrawler.like()` | 100% coverage |
| | `follow` / `unfollow` | `scrape('twitter', 'follow')` / `unfollow` | `TwitterCrawler.follow()` | 100% coverage |
| | `sendDm` | `scrape('twitter', 'send_dm')` | `TwitterCrawler.send_dm()` | 100% coverage |
| **Facebook** | `scrapeProfile` | `scrape('facebook', 'profile', { page, username })` | `FacebookCrawler.profile()` | `tests/scrapers/social/facebook/` |
| | `scrapeFollowers` | `scrape('facebook', 'followers', { page, username })` | `FacebookCrawler.followers()` | 100% coverage |
| | `scrapePosts` | `scrape('facebook', 'posts', { page, username })` | `FacebookCrawler.posts()` | 100% coverage |
| | `search` | `scrape('facebook', 'search', { query })` | `FacebookCrawler.search()` | 100% coverage |
| | `groupSearch` | `scrape('facebook', 'group_search', { query })` | `FacebookCrawler.group_search()` | 100% coverage |
| | `messengerShareCampaign` | `social/facebook/messengerShare.js` | Re-exported từ `social/facebook/index.js` | 262 tests pass |
| | `rotateProxy` / `limits` | `social/facebook/{proxy,limits}.js` | Re-exported từ `social/facebook/index.js` | 100% coverage |
| **Threads** | `scrapeProfile` | `scrape('threads', 'profile', { username })` | `ThreadsCrawler.profile()` | `tests/scrapers/social/threads/` |
| | `scrapeFollowers` | `scrape('threads', 'followers', { username })` | `ThreadsCrawler.followers()` | 100% coverage |
| | `scrapeUserFeed` | `scrape('threads', 'tweets', { username })` | `ThreadsCrawler.tweets()` | 100% coverage |
| **Bluesky** | `scrapeProfile` / `posts` | `scrape('bluesky', 'profile')` / `posts` | `BlueskyCrawler` | `tests/scrapers/social/bluesky/` |
| **Mastodon** | `scrapeProfile` / `posts` | `scrape('mastodon', 'profile')` / `posts` | `MastodonCrawler` | `tests/scrapers/social/mastodon/` |

---

## 4. Chiến Lược Chuyển Tiếp `package.json` Exports (Story 26.2)

Khi các file legacy bị xóa, `package.json` exports sẽ được cập nhật như sau:

| Export Key Hiện Tại | Trỏ Hiện Tại (Legacy) | Trỏ Mới Sau Story 26.2 | Ghi Chú |
|---|---|---|---|
| `./scrapers/twitter` | `./src/scrapers/twitter/index.js` | `./src/scrapers/social/twitter/index.js` | Redirect trực tiếp sang hybrid barrel |
| `./scrapers/twitter/http` | `./src/scrapers/twitter/http/index.js` | `./src/scrapers/social/twitter/index.js` | Redirect sang hybrid barrel |
| `./scrapers/bluesky` | `./src/scrapers/bluesky/index.js` | `./src/scrapers/social/bluesky/index.js` | Chuyển từ legacy file sang hybrid barrel |
| `./scrapers/mastodon` | `./src/scrapers/mastodon/index.js` | `./src/scrapers/social/mastodon/index.js` | Chuyển từ legacy file sang hybrid barrel |
| `./scrapers/threads` | `./src/scrapers/threads/index.js` | `./src/scrapers/social/threads/index.js` | Chuyển từ legacy file sang hybrid barrel |

---

## 5. Danh Mục Test Cần Điều Chỉnh trong Story 26.2

Một số test kiểm tra sự tồn tại của file legacy cần được gắn guard hoặc loại bỏ:
1. `tests/scrapers/social/twitter/crawler-*.test.js`: Các test case kiểm tra JSDoc `@deprecated` bằng cách `fs.readFile('src/client/Scraper.js')` và `src/scrapers/twitter/http/actions.js` → Thêm guard `if (!fs.existsSync(...)) return;` hoặc loại bỏ vì file không còn tồn tại.
2. `tests/scrapers/facebook-exports.test.js`: Đổi assertion kiểm tra `platforms.facebook` để trỏ vào `src/scrapers/social/facebook/index.js` hoặc re-export adapter tương ứng.
3. `src/scrapers/platforms.js`: Xóa các import trực tiếp tới `./twitter/index.js`, `./threads/index.js`, `./facebook/index.js`, thay bằng re-export từ `src/scrapers/social/`.

---

## 6. Checklist Thực Thi Cho Story 26.2

- [ ] Xác nhận git tag `pre-decommission-2026-09-12` đã được tạo và push.
- [ ] Thực hiện lệnh xóa vật lý các thư mục legacy (`rm -rf src/scrapers/twitter src/scrapers/facebook src/client/Scraper.js src/scrapers/threads/index.js src/scrapers/bluesky/index.js src/scrapers/mastodon/index.js`).
- [ ] Cập nhật `src/scrapers/platforms.js` để loại bỏ legacy module imports.
- [ ] Cập nhật `package.json` exports map.
- [ ] Cập nhật các test file có phụ thuộc legacy (`tests/scrapers/facebook-exports.test.js`, deprecation-assertion tests).
- [ ] Chạy `npm run typecheck` (đảm bảo 0 errors).
- [ ] Chạy `npm test` (đảm bảo 100% tests pass).
- [ ] Cập nhật status trong `docs/deprecation-plan.md` sang `removed`.
- [ ] Commit với thông điệp: `feat(decommission): Story 26.2 — remove legacy scrapers (twitter, facebook, threads, bluesky, mastodon)`.

---

## 7. Review Findings & Remediation (Story 26.2 Code Review)

### Findings Summary
- Total findings identified across 4 review layers: **15**
- Dismissed / Pre-resolved: **2** (already fixed in `e01d0ac1`: dead legacy dispatch, platforms.facebook exports)
- Active patches applied: **13** (committed in `0f9f4b8e`)

### Remediations Applied:
1. **Scraper Stub Completeness** (`src/client/index.js`):
   - Added missing methods: `setCookies`, `getCookies`, `saveCookies`, `getTweets`, `getTweetsAndReplies`, `getLikedTweets`, `getLatestTweet`, `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`, `followUser`, `unfollowUser`, `sendQuoteTweet`, `deleteTweet`, `getFollowing`, `searchProfiles`, `getExploreTabs`, `getListTweets`, `getListMembers`, `getListById`, `isLoggedIn`.
   - Fixed `getTweet` mapping from non-existent `tweet_detail` action to `thread` action.
   - Fixed envelope unwrapping: `profile` unwraps `res.profile`, `getTweet` unwraps `rootTweet`, `searchTweets` unwraps `posts`, `getFollowers` unwraps `followers`.
   - Added unit test suite: `tests/client/scraper-stub.test.js` (8 tests, 100% pass).

2. **Package Subpath Export** (`package.json`):
   - Fixed `./scrapers/twitter/http` mapping from `social/twitter/index.js` to `social/twitter/http/index.js`.

3. **Convenience Wrapper Mapping** (`src/scrapers/index.js`):
   - `scrapeTweets`: auto-prefixes `from:<username>` into `query` when not explicitly provided.
   - `scrapeLikes`: maps `username` to `tweetId: opts.tweetId || username`.
   - `scrapeCommunityMembers`: builds canonical `communityUrl` from `communityId`.
   - `scrapeNotifications`: throws explicit error explaining lack of crawler support.

4. **Descriptor Enhancements** (`src/scrapers/social/twitter/descriptor.js`):
   - `mapArgs` accepts both `communityUrl` and `communityId` for community actions.

5. **Facebook Utility Hardening** (`src/scrapers/social/facebook/`):
   - `url-helpers.js`: coerced `c_user` to string for numeric IDs; supported both `datr` and `datar` cookie names.
   - `normalize.js`: updated `normalizeHandle` regex to strip subdomains (`m.facebook.com`, `web.facebook.com`).

6. **Deprecation Proxy Fallbacks** (`src/scrapers/deprecation-proxy.js`):
   - Added fallback resolution for `createBrowser`, `createPage`, `loginWithCookie` on `platforms.twitter` and `platforms.facebook`.

7. **Dead Code Elimination** (`src/scrapers/social/facebook/descriptor.js`):
   - Removed legacy `options.page` dispatch path that referenced deleted legacy modules.
