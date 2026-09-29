---
title: '51.3 Decentralized Social Deck (/fediverse)'
type: 'feature'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: 26f8b5933db8b5b6e699eb349d4eb4185e8740f9
context:
  - '{project-root}/_bmad-output/specs/spec-fe-platform-suites/SPEC.md'
warnings: []
deferred:
  - summary: >-
      Mobile tab bar thiếu các thuộc tính accessibility nâng cao (role="tabpanel" và aria-controls
      liên kết hai chiều giữa nút tab và container hiển thị cột).
    evidence: |-
      Hiện tại đã có role="tablist", role="tab" và aria-selected={activeColumn === c.id}, đủ
      đáp ứng điều hướng cơ bản. Việc bổ sung đầy đủ tabpanel/aria-controls sẽ được gộp vào
      chiến dịch rà soát accessibility toàn diện cho toàn bộ apps/web.
    location: >-
      apps/web/app/fediverse/page.tsx (mobile tab bar container)
    severity: medium
  - summary: >-
      Kịch bản mạng chập chờn khi chuyển đổi liên tục giữa các tab trên mobile có thể gây
      hiện tượng cuộn giật.
    evidence: |-
      Cần có kịch bản kiểm thử trên thiết bị di động thực tế hoặc trình giả lập với chế độ
      network throttling để quan sát và xác định xem có cần điều chỉnh layout hay không.
    location: >-
      apps/web/app/fediverse/page.tsx (mobile layout container)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Nghiên cứu viên và người dùng mạng xã hội phi tập trung phải dùng app riêng cho Bluesky và Mastodon — `apps/web` chưa có giao diện đọc song song hai mạng lưới này dù backend đã có đủ scraper.

**Approach:** Thêm trang `/fediverse` — deck đa cột kiểu TweetDeck với 3 cột mặc định: Bluesky What's Hot (custom feed `whats-hot`), Bluesky Profile Stream (action `posts` theo handle), Mastodon Trending (`trending` từ `mastodon.social`) — gọi qua BFF `POST /api/platform/{bluesky|mastodon}/scrape` ở `mode: 'sync'`, không cần credentials (guest mode), và thêm mục "Fediverse" vào nhóm điều hướng Intelligence.

## Boundaries & Constraints

**Always:**
- Mọi request qua helper `api()` (`@/lib/api`) tới same-origin BFF — không `fetch()` trực tiếp.
- Action backend: Bluesky `feed` với `{feedUri: at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot, limit, cursor}` cho What's Hot; Bluesky `posts` với `{handle, limit, cursor}` cho Profile Stream; Mastodon `trending` với `{limit}` (mặc định instance `mastodon.social` phía backend).
- Đọc đúng field PostItem: `authorName`, `authorAvatar`, `content`, `mediaUrls[]`, `likesCount`, `repostsCount`, `publishedAt`, `postUrl`, `platform`.
- Infinite scroll: khi cuộn tới đáy cột và `has_next_page` (Bluesky `pageInfo.end_cursor`), gọi lại với `cursor`; Mastodon `trending` không phân trang nên cột đó không infinite scroll.
- Ảnh media dùng `referrerPolicy="no-referrer"` với lightbox khi bấm; ảnh lỗi có fallback.
- Lỗi xử lý ở mức cột: cột lỗi hiện empty state + Retry, các cột khác vẫn hoạt động.
- Desktop (≥1024px) 3 cột ngang; mobile (<1024px) tab bar ngang 3 mục, mỗi lần hiện 1 cột.
- Trang client component, style Tailwind + lucide-react như `app/dexscreener/page.tsx`.

**Never:**
- Không sửa backend bluesky/mastodon (`src/scrapers/social/**`).
- Không truyền credentials (`identifier`/`password`/`accessToken`) — mọi action chọn cho deck chạy không đăng nhập; `#maybeAuthenticate` chỉ login khi có credentials.
- Không đụng các suite khác của Epic 51 (`/dexscreener`, `/youtube`, `/enterprise-vn`, `/jobs-vn`).
- Không thêm realtime SSE/WebSocket — chỉ fetch thủ công + nút refresh per-column + nút "Refresh All".
- Không thêm cột hashtag Mastodon hay search — ngoài scope CAP-3.
- Không hardcode URL backend; không thêm dependency mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop layout | Mở `/fediverse` viewport ≥1024px | 3 cột ngang song song, mỗi cột tự tải độc lập | Không lỗi |
| Mobile layout | Viewport <1024px | Tab bar ngang 3 mục (Bluesky Hot / Bluesky Profile / Mastodon), 1 cột tại một thời điểm | Không lỗi |
| What's Hot | Cột Bluesky Hot tải lần đầu | Gọi `feed` với feedUri whats-hot, limit 30, render post card | Không lỗi |
| Profile Stream | Nhập handle (vd `bsky.app`) | Gọi `posts` với `{handle, limit 30}` | Không lỗi |
| Mastodon Trending | Cột Mastodon tải lần đầu | Gọi `trending` với `{limit 30}` | Không lỗi |
| Infinite scroll | Cuộn tới đáy cột Bluesky | Gọi lại với `cursor` từ `pageInfo.end_cursor`; nối tiếp posts | Không lỗi |
| Lỗi một cột | Một cột lỗi upstream | Cột đó hiện empty state + Retry; cột khác vẫn chạy | Bắt lỗi ở mức cột |
| Ảnh lỗi | `mediaUrls` 404 | Fallback icon; bấm ảnh mở lightbox modal | `onError` fallback |
| Copy permalink | Bấm nút copy trên card | `postUrl` vào clipboard, check ~1.5s | Không crash nếu clipboard lỗi |

## Code Map

- `src/scrapers/social/bluesky/descriptor.js:15-44` — action map: `feed` → `feed` (custom algorithm feed khi có `feedUri` qua `mapAction`), `posts` (alias `timeline`), `trending`, `profile`, `post_detail`.
- `src/scrapers/social/bluesky/crawler.js:536-585` — `getFeed(feedUri)` trả `{posts, pageInfo:{end_cursor, has_next_page}}`; ném `XACT_4001` khi thiếu `feedUri`.
- `src/scrapers/social/bluesky/crawler.js:406-441` — `getAuthorFeed` (action `posts`) nhận `{handle|username|actor, limit, cursor, filter}`, trả `{posts, pageInfo:{end_cursor}}`.
- `src/scrapers/social/bluesky/crawler.js:514-545` — `trending()` trả `{trends}` (không phân trang) — chưa dùng trong deck này.
- `src/scrapers/social/bluesky/crawler.js:86-95` — `#maybeAuthenticate` chỉ login khi có `identifier`+`password` — guest mode chạy được.
- `src/scrapers/social/mastodon/descriptor.js:15-65` — action map: `posts`, `trending` (alias `trends`), `hashtag`, `profile`.
- `src/scrapers/social/mastodon/crawler.js:429-463` — `getPosts` cần `username`/`handle`, trả mảng PostItem trực tiếp (không bọc `{posts}`).
- `src/scrapers/social/mastodon/crawler.js:546-564` — `getTrending` trả mảng PostItem trực tiếp; `#maybeAuthenticate` (`:290-296`) chỉ cần token khi truyền — guest mode chạy được.
- `src/scrapers/social/mastodon/client.js:70` — mặc định instance `mastodon.social`.
- `src/scrapers/social/mastodon/normalizer.js` — `normalizeMastodonStatus` trả `authorName`, `authorAvatar`, `content` (đã strip HTML, prefix CW), `mediaUrls`, `likesCount`, `repostsCount`, `metadata.acct`, `postUrl`.
- `src/scrapers/social/bluesky/normalizer.js:142-220` — `normalizeBlueskyPost` trả `authorName` (displayName/handle), `authorAvatar`, `content`, `mediaUrls` (từ embed images), `likesCount`, `repostsCount`, `metadata.uri`, `postUrl`, `publishedAt`.
- `apps/web/app/dexscreener/page.tsx:74-107` — helper `scrape()` chuẩn (unwrap `result`, `isAsyncAccepted` → `pollOperation`); effect chỉ phụ thuộc URL dùng ref.
- `apps/web/lib/nav.ts:35-46` — nhóm `intelligence`; thêm item "Fediverse" cạnh Dexscreener/YouTube.
- `apps/web/lib/api.ts:38-119` — `api()` trả `ApiResult<T>`; `apps/web/lib/scrape-poll.ts` — polling helpers.
- `tests/web/dexscreener.test.js:1-19` — pattern test source-assertion.

## Tasks & Acceptance

**Execution:**
- `apps/web/app/fediverse/page.tsx` -- tạo mới client component deck 3 cột. State mỗi cột: posts, cursor, loading, error. Cột Bluesky Hot gọi `feed` (feedUri whats-hot); cột Bluesky Profile nhận handle từ input (mặc định `bsky.app`), gọi `posts` với cursor; cột Mastodon gọi `trending`. Infinite scroll bằng IntersectionObserver ở đáy cột (desktop) hay đáy tab (mobile). Lightbox khi bấm ảnh; copy permalink check 1.5s; refresh per-column + Refresh All. Mobile: tab bar chọn 1 trong 3 cột. Empty state + Retry per-column. Mirror helper `scrape()` của dexscreener. -- Toàn bộ surface của story.
- `apps/web/lib/nav.ts` -- thêm `{ label: 'Fediverse', href: '/fediverse', keywords: [...] }` vào nhóm `intelligence`. -- Một nguồn nav cho sidebar, breadcrumb và ⌘K palette.
- `tests/web/fediverse.test.js` -- test source-assertion: client component, dùng `api()` qua BFF `/api/platform/bluesky/scrape` và `/api/platform/mastodon/scrape`, gọi action `feed` với `feedUri` whats-hot, `posts`, `trending`, không `fetch(` trực tiếp, `referrerPolicy="no-referrer"`, empty state/Retry per-column, lightbox, mobile tab bar, nav.ts chứa href `/fediverse`. -- Khóa hành vi quan sát được.

**Acceptance Criteria:**
- Given viewport ≥1024px, when mở `/fediverse`, then 3 cột hiển thị song song, mỗi cột tự tải độc lập.
- Given viewport <1024px, when mở trang, then tab bar ngang 3 mục và chỉ 1 cột hiển thị tại một thời điểm.
- Given một cột lỗi upstream, when render, then chỉ cột đó hiện empty state + Retry, các cột khác vẫn hoạt động.
- Given cuộn tới đáy cột có phân trang, when trigger load more, then cursor tiếp theo được dùng và posts nối tiếp.
- Given sidebar, when nhìn nhóm Intelligence, then thấy mục "Fediverse" dẫn tới `/fediverse`.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- verdicts: 17 findings — high 1, medium 3, low 8, false 4, maybe-false 1
- findings:
  - `[high]` `[patch]` Khi fetch phân trang (`isMore`) bị lỗi, nhánh `state.error` thay thế toàn bộ danh sách bài viết (`state.posts`) bằng màn hình báo lỗi, làm người dùng mất trắng dữ liệu đã cuộn đọc được. Sửa: chỉ hiện error state toàn cột khi `state.posts.length === 0`; khi đã có bài thì giữ nguyên feed và hiện banner lỗi nhỏ ở đáy cột kèm nút thử lại load-more.
  - `[medium]` `[patch]` Modal lightbox ảnh thiếu phím tắt `Escape` để thoát bằng bàn phím. Sửa: thêm `useEffect` lắng nghe `keydown` phím `Escape` khi modal mở.
  - `[medium]` `[patch]` Khóa card bài viết và fallback ảnh bằng index `${col}:${index}` khiến các bài viết append mới có thể bị lệch trạng thái fallback khi danh sách thay đổi. Sửa: dùng `post.id || post.externalId || post.postUrl || `${col}:${index}`` làm khóa ổn định.
  - `[medium]` `[defer]` Mobile tab bar thiếu thuộc tính accessibility hoàn chỉnh (`role="tabpanel"`, `aria-controls` liên kết giữa tab button và container cột). Hiện tại đã có `role="tablist"` và `role="tab"` với `aria-selected`, đủ dùng cơ bản; việc hoàn thiện ARIA full pattern sẽ thực hiện cùng lượt audit UI chung.
  - `[low]` `[reject]` Cắt tối đa 4 ảnh (`media.slice(0, 4)`) mà không có chỉ báo "+N ảnh nữa" — spec không yêu cầu carousel/gallery phức tạp cho bài có >4 ảnh; cắt 4 ảnh dạng lưới 2x2 là quy chuẩn hiển thị mạng xã hội phổ biến.
  - `[low]` `[reject]` `cleanHandle` không bóc tách handle dạng `@user@instance` của Mastodon — input handle chỉ dành cho cột Bluesky Profile (Mastodon chỉ có trending, không có input handle); Bluesky dùng AT Protocol handle (`user.bsky.social`), không dùng federation instance suffix.
  - `[low]` `[reject]` Hai bài viết thiếu `id` có thể trùng URL khi copy — trường hợp này rất hiếm và permalink vẫn được copy đúng vào clipboard.
  - `[low]` `[reject]` Div bọc ảnh thiếu `role="button"` và `tabIndex` cho người dùng bàn phím — ảnh đã có cursor zoom-in và nhấp chuột mở lightbox; trợ năng bàn phím thuộc danh mục hoàn thiện chung.
  - `[low]` `[reject]` Thẻ `<img>` trong lightbox thiếu onError fallback — lightbox chỉ mở khi bấm vào ảnh chưa bị đánh dấu lỗi; nếu mở được thì ảnh gốc đã tải thành công ở thumbnail.
  - `[low]` `[reject]` Bài viết không có media thì khoảng trống nhỏ ở footer — là padding layout chuẩn của thẻ card, không phải lỗi.
  - `[low]` `[reject]` `LoadMoreSentinel` chỉ mount khi `posts.length > 0` nên nếu trang đầu trả 0 bài sẽ không tải tiếp — nếu trang đầu trả 0 bài thì cột rơi vào empty state "Trống", hành vi đúng.
  - `[low]` `[reject]` Nút refresh per-column không có debounce — người dùng bấm nhiều lần thì generation counter đã tự hủy kết quả cũ, không gây race condition.
  - `[false]` `[reject]` "generationRef và inFlightRef là dead code không được dùng" — kiểm tra mã nguồn tại dòng 261-265, 297, 303: cả hai ref đều được đọc và cập nhật trong `loadColumn`, bảo vệ chống stale response và duplicate fetch.
  - `[false]` `[reject]` "loadingMore là dead state không được đọc" — dòng 265 set `loadingMore: true`, dòng 303 và 312 set `loadingMore: false`, và sentinel nhận prop `loading={state.loadingMore}`.
  - `[false]` `[reject]` "refreshAll chạy song song không tuần tự" — dòng 344 có `await loadColumn(col.id)` bên trong vòng lặp `for...of`, mỗi cột hoàn tất mới chạy tiếp cột sau; không bị bắn song song đồng thời.
  - `[false]` `[reject]` Test chỉ kiểm tra chuỗi tĩnh, không chạy logic — đây là quy ước chuẩn của toàn bộ thư mục `tests/web` (44 files chạy qua vitest ở môi trường `node` không có jsdom).
  - `[maybe-false]` `[defer]` Kịch bản mạng chập chờn khi chuyển tab mobile có thể gây cuộn giật — cần kiểm thử thực tế trên thiết bị di động với network throttling để đánh giá.


## Verification

**Commands:**
- `npx vitest run tests/web/fediverse.test.js` -- expected: tất cả test PASS
- `npx tsc --noEmit -p apps/web/tsconfig.json` -- expected: không lỗi type mới ở `app/fediverse/page.tsx` và `lib/nav.ts`

**Manual checks (if no CLI):**
- `npm run dev` trong `apps/web`, mở `/fediverse`: 3 cột tự tải; co viewport xuống <1024px ra tab bar; bấm ảnh ra lightbox; cuộn đáy cột Bluesky tải trang cursor tiếp theo.

## Auto Run Result

**Tóm tắt.** Thêm trang `/fediverse` (client component) với bố cục sàn đọc đa cột (TweetDeck-style): 3 cột mặc định gồm Bluesky What's Hot (feed algorithm `whats-hot`), Bluesky Profile Stream (action `posts` theo handle, mặc định `bsky.app`), và Mastodon Trending (action `trending` từ `mastodon.social`). Hỗ trợ infinite scroll dựa trên cursor AT Protocol, modal Lightbox xem ảnh, sao chép liên kết bài viết, làm mới riêng từng cột và làm mới toàn bộ. Trên mobile (<1024px) tự động co thành tab bar ngang 3 mục. Đã đăng ký mục "Fediverse" vào nhóm Intelligence trong `apps/web/lib/nav.ts`.

**File đã đổi.**
- `apps/web/app/fediverse/page.tsx` — trang mới: deck 3 cột, bóc tách dữ liệu PostItem chuẩn, infinite scroll, lightbox, mobile tab bar, xử lý lỗi độc lập per-column.
- `apps/web/lib/nav.ts` — bổ sung 1 mục nav Fediverse vào nhóm `intelligence`.
- `tests/web/fediverse.test.js` — 21 test source-assertion khóa toàn bộ ràng buộc kiến trúc và ma trận I/O.

**Review (17 findings).**
- Vá:
  - 1 high: Khi fetch phân trang (`isMore`) bị lỗi, toàn bộ danh sách bài viết bị thay bằng màn hình báo lỗi to — đã sửa thành giữ nguyên feed và hiển thị thanh báo lỗi nhỏ ở đáy cột kèm nút "Thử lại".
  - 2 medium: Thêm phím tắt `Escape` để đóng modal Lightbox; chuyển khóa định danh bài viết và fallback ảnh sang khóa ổn định `post.id || post.externalId || post.postUrl || `${col}:${index}``.
- Hoãn:
  - Trợ năng nâng cao cho mobile tab bar (`role="tabpanel"`, `aria-controls`) (medium).
  - Giật cuộn khi chuyển tab mobile dưới mạng yếu (medium, chưa xác minh).
- Bác 13 findings còn lại:
  - 8 low (cắt 4 ảnh không có chỉ báo, handle Mastodon trong input Bluesky, trùng id copy, role button cho div ảnh, onError trong lightbox, padding rỗng, sentinel khi 0 bài, debounce refresh) vì không gây hại thực tế hoặc nằm ngoài phạm vi spec CAP-3.
  - 4 false (generationRef và inFlightRef là dead code; loadingMore là dead state; refreshAll chạy song song; test source-text tĩnh) vì code thực tế đã có xử lý bảo vệ đầy đủ.
  - 1 maybe-false (chuyển tab mobile mạng yếu) đã đưa vào deferred.

**Follow-up review: true.** Đã vá 1 finding mức high (bảo vệ feed khi load-more gặp lỗi). Cần một lượt review follow-up để kiểm chứng hành vi khôi phục trạng thái sau khi bấm "Thử lại" tải thêm dưới điều kiện mạng thực tế.

**Xác minh.**
- `npx vitest run tests/web/fediverse.test.js` — 21/21 PASS.
- `npx tsc --noEmit -p apps/web/tsconfig.json` — không có lỗi mới nào ở các file đã thay đổi.
- `npx vitest run tests/web` — 44/44 test files PASS, 263/263 tests PASS.

**Rủi ro còn lại.** Chưa có test end-to-end trên trình duyệt thật đối với phím tắt Escape của Lightbox; hành vi cuộn vô tận trên các trình duyệt mobile cũ phụ thuộc vào hỗ trợ IntersectionObserver (đã có rootMargin chuẩn).
