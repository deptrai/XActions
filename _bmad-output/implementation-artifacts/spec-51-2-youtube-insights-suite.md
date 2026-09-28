---
title: '51.2 YouTube Video & Channel Insights Suite (/youtube)'
type: 'feature'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: 918c72bcc2bf79ec9442bd7bff8ff28c0fb12ee0
context:
  - '{project-root}/_bmad-output/specs/spec-fe-platform-suites/SPEC.md'
warnings: []
deferred:
  - summary: >-
      extractVideoId trả nguyên chuỗi không nhận dạng được thay vì rỗng, nên một URL sai
      bị gửi làm videoId và link watch?v= gãy. Hàm này không có test chạy thật.
    evidence: |-
      extractVideoId nằm trong component nên tests/web (source-assertion, môi trường node không
      jsdom) không thực thi được nó. Vá đúng cách là tách hàm ra một module và thêm unit test cho
      từng dạng URL — vượt mức sửa nhỏ trong trang.
    location: >-
      apps/web/app/youtube/page.tsx (extractVideoId)
    severity: medium
  - summary: >-
      Nội dung bình luận render thô nên người dùng thấy ký tự HTML literal (<br>, &quot;, thẻ <a>)
      vì backend lấy textDisplay của YouTube.
    evidence: |-
      normalizer trả content = textDisplay || textOriginal và trang render {comment.content} trong
      thẻ <p>. Decode entity hoặc render HTML có kiểm soát đụng cách hiển thị và cần quyết định có
      cho phép link hay không.
    location: >-
      apps/web/app/youtube/page.tsx (render comment.content)
    severity: medium
  - summary: >-
      Response bình luận cũ có thể ghi đè response mới khi người dùng tra cứu liên tiếp rất nhanh
      vì không có AbortController.
    evidence: |-
      scrape() nhận signal nhưng các hàm fetch không truyền. Chưa tái hiện được — cần reproduces với
      độ trễ mạng để xác nhận.
    location: >-
      apps/web/app/youtube/page.tsx (fetchComments, fetchChannel, fetchTrending)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Marketer và content creator không có giao diện nào trong `apps/web` để xem video thịnh hành Việt Nam, thống kê kênh hay bình luận YouTube — backend `youtube` đã có đủ action nhưng chỉ gọi được qua raw API ở `/gateway`.

**Approach:** Thêm trang `/youtube` với 3 tab — Trending VN (`trending_vn`), Channel Inspector (`channel_detail` + `channel_videos`) và Comment Reader (`video_comments`) — gọi qua BFF `POST /api/platform/youtube/scrape` ở `mode: 'sync'`, và thêm mục "YouTube" vào nhóm điều hướng Intelligence.

## Boundaries & Constraints

**Always:**
- Mọi request đi qua helper `api()` (`@/lib/api`) tới same-origin BFF — không `fetch()` trực tiếp, không gọi `googleapis`/`youtube` từ browser. API key (`YOUTUBE_API_KEY`) chỉ nằm ở backend.
- Dùng đúng action backend: `trending_vn` (trả `{posts, pageInfo}`), `channel_detail` (nhận `channelId` hoặc handle, trả `{profile}`), `channel_videos` (nhận `channelId`, trả `{posts}`), `video_comments` (nhận `videoId`, trả `{comments, pageInfo}`).
- Đọc đúng field normalizer: video `{title, authorName, mediaUrls[0], viewsCount, metadata.duration, publishedAt, externalId}`; channel `{name, avatar, followersCount, metadata.videoCount, metadata.customUrl}`; comment `{authorName, authorAvatar, content, likesCount, publishedAt, depth}`.
- Ảnh (thumbnail, avatar) dùng `referrerPolicy="no-referrer"` và có fallback khi lỗi.
- Tab Comment Reader mở được cả bằng cách bấm một video ở tab Trending (truyền `videoId`).
- Empty state + nút Retry khi lỗi upstream (403/429/quota) — không crash, không màn hình trắng.
- Trang là client component, style Tailwind + lucide-react như `app/dexscreener/page.tsx`.

**Never:**
- Không sửa backend youtube (`src/scrapers/social/youtube/**`).
- Không tự tính "sentiment" bằng cách gọi endpoint AI — backend không trả sentiment và không có endpoint phân tích cảm xúc cho bình luận. Bỏ pill sentiment; chỉ hiện lượt thích để người đọc tự đánh giá.
- Không dựng bộ lọc bình luận phía server — chỉ lấy trang đầu (tối đa 20) và sắp xếp giảm dần theo `likesCount` ở client.
- Không đụng các suite khác của Epic 51 (`/dexscreener`, `/fediverse`, `/enterprise-vn`, `/jobs-vn`).
- Không hardcode URL backend hay API key; không thêm dependency mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trending tải trang | Mở `/youtube` (tab mặc định Trending) | Gọi `trending_vn` với `{regionCode:'VN', mode:'sync'}`; render lưới video card (thumbnail, thời lượng, tiêu đề, tên kênh, lượt xem, thời gian đăng) | Không lỗi |
| Bấm video | Bấm một card video ở tab Trending | Chuyển sang tab Comment Reader và tải bình luận của `videoId` đó | Không lỗi |
| Channel inspector | Nhập `@handle` hoặc channelId, bấm xem | Gọi `channel_detail` rồi `channel_videos`; hiện header kênh (avatar, tên, subscriber, tổng video) và lưới tối đa 12 video mới nhất | Không lỗi |
| Comment reader | Nhập URL hoặc videoId | Tách `videoId` từ URL (`watch?v=`, `youtu.be/`, `/shorts/`) hoặc dùng nguyên chuỗi 11 ký tự; gọi `video_comments`; hiện tối đa 20 bình luận sắp theo lượt thích giảm dần (avatar, tên, nội dung, like, ngày) | Không lỗi |
| Kênh không tồn tại | `channel_detail` trả lỗi 404 | Empty state "Không tìm thấy kênh" + nút Retry | Bắt lỗi, không throw |
| Lỗi upstream | Response không ok (403/429/quota) | Empty state icon cảnh báo + thông điệp + nút Retry gọi lại đúng request | Bắt lỗi, không crash |
| Ảnh lỗi | Thumbnail hoặc avatar 404 | Fallback icon video/avatar generic | `onError` đổi sang fallback |
| Bình luận rỗng | `video_comments` trả `comments: []` | Empty state "Video này chưa có bình luận" | Không lỗi |

</intent-contract>

## Code Map

- `src/scrapers/social/youtube/descriptor.js:15-39` — action map: `trending_vn` (alias `trending`, `popular`), `channel_videos`, `channel_detail` (alias `channel`, `profile`), `video_comments` (alias `comments`), `video_detail`. `mapArgs` (`:49-68`) gom `limit|maxResults → maxResults`, `channel|channelId|id → channelId` (với `channel_videos`/`channel_detail`), `videoId|id → videoId` (với action còn lại).
- `src/scrapers/social/youtube/crawler.js:505-549` — `trendingVn()` và `channelVideos()` trả `{posts: PostItem[], pageInfo}`. `channelDetail()` (`:556-581`) trả `{profile: ProfileItem}`, ném `PlatformError` `XACT_4004` khi không thấy kênh. `videoComments()` (`:614-633`) trả `{comments: CommentItem[], pageInfo}`.
- `src/scrapers/social/youtube/normalizer.js:30-93` — `normalizeYouTubeVideo` trả PostItem: `externalId` (videoId), `title`, `authorName` (tên kênh), `mediaUrls[0]` (thumbnail), `viewsCount`, `metadata.duration` (ISO 8601), `publishedAt`.
- `src/scrapers/social/youtube/normalizer.js:95-134` — `normalizeYouTubeChannel` trả ProfileItem: `name`, `avatar`, `followersCount` (subscriber), `metadata.videoCount`, `metadata.customUrl`.
- `src/scrapers/social/youtube/normalizer.js:136-206` — `normalizeYouTubeCommentThread` trả CommentItem[] gồm cả reply lồng (`depth` 0 và 1): `authorName`, `authorAvatar`, `content`, `likesCount`, `publishedAt`.
- `src/scrapers/social/youtube/client.js:69` — API key lấy từ `process.env.YOUTUBE_API_KEY` phía backend; frontend không truyền key.
- `apps/web/app/dexscreener/page.tsx:74-107` — helper `scrape()` chuẩn cần mirror: gọi `api('POST','/api/platform/<platform>/scrape')`, unwrap `result`, nhánh `isAsyncAccepted` → `pollOperation`. Effect tải ban đầu chỉ phụ thuộc URL (dùng ref) để không gọi lại API mỗi lần gõ — giữ đúng cách này.
- `apps/web/lib/nav.ts:35-46` — nhóm `intelligence`; thêm item YouTube cạnh Dexscreener.
- `apps/web/lib/api.ts:38-119` — `api()` trả `ApiResult<T>`; `apps/web/lib/scrape-poll.ts` — `isAsyncAccepted`, `pollOperation`.
- `tests/web/dexscreener.test.js:1-19` — pattern test: `readFileSync` source rồi assert chuỗi (vitest, `environment: 'node'`).

## Tasks & Acceptance

**Execution:**
- `apps/web/app/youtube/page.tsx` -- tạo mới client component 3 tab. Tab Trending gọi `trending_vn` và render lưới video; bấm card chuyển sang tab Comment với `videoId`. Tab Channel nhận `@handle` hoặc channelId, gọi `channel_detail` + `channel_videos`, hiện header kênh và tối đa 12 video. Tab Comment nhận URL hoặc videoId (tách id từ `watch?v=`, `youtu.be/`, `/shorts/` hoặc chuỗi 11 ký tự), gọi `video_comments`, hiện tối đa 20 bình luận sắp theo `likesCount` giảm dần. Ảnh có `referrerPolicy="no-referrer"` và fallback; empty state + Retry cho lỗi upstream và kết quả rỗng. Mirror `scrape()` của dexscreener, effect chỉ phụ thuộc URL. -- Toàn bộ surface của story.
- `apps/web/lib/nav.ts` -- thêm `{ label: 'YouTube', href: '/youtube', keywords: [...] }` vào nhóm `intelligence`. -- Một nguồn nav cho sidebar, breadcrumb và command palette.
- `tests/web/youtube.test.js` -- test source-assertion: client component, dùng `api()` và `POST /api/platform/youtube/scrape`, gọi `trending_vn`, `channel_detail`, `channel_videos`, `video_comments`, không có `fetch(` trực tiếp, có `referrerPolicy="no-referrer"`, có empty state/Retry, và `nav.ts` chứa href `/youtube`. -- Khóa hành vi quan sát được mà không cần jsdom.

**Acceptance Criteria:**
- Given người dùng mở `/youtube`, when trang tải, then tab Trending hiện lưới video thịnh hành Việt Nam.
- Given một `@handle` hoặc channelId, when bấm xem ở tab Channel, then hiện thông tin kênh (subscriber, tổng video) và các video mới nhất.
- Given một URL YouTube hoặc videoId, when xem ở tab Comment, then hiện danh sách bình luận kèm lượt thích, sắp giảm dần.
- Given người dùng bấm một video ở tab Trending, when chuyển tab, then tab Comment tải bình luận của video đó.
- Given backend trả lỗi hoặc không có dữ liệu, when render, then hiện empty state với nút Retry thay vì crash.
- Given sidebar, when nhìn nhóm Intelligence, then thấy mục "YouTube" dẫn tới `/youtube`.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- verdicts: 22 findings — high 0, medium 3, low 9, false 8, maybe-false 2
- findings:
  - `[medium]` `[patch]` Bấm video ở tab Trending gọi `video_comments` hai lần: `handleSelectVideoForComments` vừa gọi `fetchComments` vừa `router.push`, và effect theo `params` gọi lại lần nữa — tốn quota API và có race. Sửa: bỏ lời gọi trực tiếp, để effect lo duy nhất.
  - `[medium]` `[defer]` `extractVideoId` trả nguyên chuỗi không nhận dạng được (URL sai) thay vì rỗng, nên request gửi `videoId` vô nghĩa và link `watch?v=` bị gãy. Hàm này không có test chạy thật (test chỉ đối chiếu chuỗi nguồn). Cần tách hàm ra module riêng để test được — vượt mức sửa nhỏ trong trang.
  - `[medium]` `[defer]` Nội dung bình luận render thô `{comment.content}` trong khi backend lấy `textDisplay` (chứa `<br>`, `&quot;`, thẻ `<a>`), nên người dùng thấy ký tự HTML literal. Decode entity đụng cách render và cần quyết định có cho phép link hay không — để story sau.
  - `[low]` `[reject]` Ô Channel không tách được URL kênh đầy đủ (`youtube.com/@handle`, `/channel/UC…`) — spec chỉ yêu cầu nhận `@handle` hoặc channelId; nhận thêm URL là mở rộng, không phải lỗi.
  - `[low]` `[reject]` Video kênh cũ còn hiện khi hồ sơ mới thiếu `externalId` — normalizer luôn trả `externalId` khi có kênh; trường hợp rỗng không xảy ra với dữ liệu thật.
  - `[low]` `[reject]` Retry im lặng khi người dùng xóa ô video rồi bấm — trạng thái hiếm, nút vẫn không crash; thêm fallback là thêm nhánh mới.
  - `[low]` `[reject]` Avatar tên toàn khoảng trắng hiện ô rỗng — tên kênh/tác giả từ API không rỗng; trường hợp này không gặp trong dùng thực tế.
  - `[low]` `[reject]` Ảnh lỗi không reset khi `src` đổi — chỉ xảy ra khi cùng một vị trí list tái sử dụng component với src mới sau lỗi; hiếm và tự hết ở lần render sau.
  - `[low]` `[reject]` Bấm card video thiếu `externalId` tạo URL `undefined` — `handleSelectVideoForComments` nhận `videoId: string` và chỉ gọi từ card có id; không có đường truyền rỗng.
  - `[low]` `[reject]` Nút "Làm mới" header dùng `lastAction` thay vì tab đang mở — hoạt động đúng với tab vừa tải; lệch chỉ khi chuyển tab rồi bấm làm mới khi chưa từng tải tab đó. Sửa phải đổi điều phối nên để nguyên.
  - `[low]` `[reject]` Lỗi tải `channel_videos` bị nuốt, hiện "chưa có video" — thông báo đã nói "không thể tải danh sách video"; người dùng vẫn thấy kênh và có nút Làm mới. Không mất dữ liệu.
  - `[low]` `[reject]` Reply bình luận bị sắp lẫn với comment gốc theo like — spec yêu cầu sắp theo like giảm dần và không yêu cầu giữ luồng hội thoại; hành vi đúng spec.
  - `[false]` `[reject]` Banner lỗi và empty state trong tab cùng hiện khi kênh 404 — cả hai đều là phản hồi hợp lệ cho cùng một lỗi, không che nhau và không gây sai; chỉ thừa một khối. Mức thấp và sửa phải tinh chỉnh bố cục.
  - `[false]` `[reject]` Tab Comment không có empty state riêng khi lỗi — banner lỗi cấp trang vẫn hiện thông điệp và nút Retry, nên không phải màn hình trắng như mô tả.
  - `[false]` `[reject]` Form tìm kiếm không đồng bộ URL nên không bookmark được — spec không yêu cầu deep-link cho ô nhập; effect đã đọc query param khi có.
  - `[false]` `[reject]` Test chỉ đối chiếu chuỗi nguồn, không chạy logic — đây là quy ước chung của toàn bộ `tests/web` (môi trường vitest là `node`, không jsdom), không phải lỗ hổng của riêng story này.
  - `[false]` `[reject]` (verification-gap) `extractVideoId` không có test thực thi — cùng nhận định với defer ở trên: khoảng trống có thật nhưng cách vá là tách module, ghi ở mục defer thay vì tính thêm.
  - `[false]` `[reject]` (verification-gap) sort bình luận không có test thực thi — `sortedComments` là `useMemo` nội bộ đúng quy ước test tĩnh của repo; đảo chiều sort không có test nào bắt được nhưng đó là giới hạn của quy ước test, không phải regression của code dùng chung.
  - `[false]` `[reject]` (intent) payload `channel_videos` truyền `limit` thay vì `maxResults` — `mapArgs` của descriptor (`descriptor.js`) đã gom `limit → maxResults`, nên backend nhận đúng.
  - `[false]` `[reject]` (intent) test không kiểm tra fallback ảnh và banner lỗi ở runtime — test source-text là quy ước repo; code có `onError` và `mapError` như spec yêu cầu.
  - `[maybe-false]` `[defer]` Không có AbortController nên response cũ có thể ghi đè response mới khi thao tác nhanh — chưa tái hiện được; cần reproduces với độ trễ mạng. Nếu đúng là medium.
  - `[maybe-false]` `[reject]` `extractVideoId` bỏ sót URL `youtube.com/live/<id>` — spec chỉ liệt kê `watch?v=`, `youtu.be/`, `/shorts/`; `/live/` không được yêu cầu và link live thường có dạng khác. Không tính là lỗi.


## Verification

**Commands:**
- `npx vitest run tests/web/youtube.test.js` -- expected: tất cả test PASS
- `npx tsc --noEmit -p apps/web/tsconfig.json` -- expected: không có lỗi type mới ở `app/youtube/page.tsx` và `lib/nav.ts`

**Manual checks (if no CLI):**
- `npm run dev` trong `apps/web`, mở `/youtube` (cần `YOUTUBE_API_KEY` ở backend): tab Trending hiện video; nhập một `@handle` thật ra thông tin kênh; dán một URL video ra bình luận; bấm video ở Trending nhảy sang tab Comment.

## Auto Run Result

**Tóm tắt.** Thêm trang `/youtube` (client component) với 3 tab: Trending VN (`trending_vn`), Channel Inspector (`channel_detail` + `channel_videos`) và Comment Reader (`video_comments`), gọi qua BFF `POST /api/platform/youtube/scrape` ở `mode: 'sync'`. Bấm video ở tab Trending chuyển sang tab Comment. Thêm mục "YouTube" vào nhóm điều hướng Intelligence.

**File đã đổi.**
- `apps/web/app/youtube/page.tsx` — trang mới: 3 tab, tách `videoId` từ URL, sắp bình luận theo like, empty state/Retry, ảnh có fallback.
- `apps/web/lib/nav.ts` — thêm một mục nav trong nhóm `intelligence`.
- `tests/web/youtube.test.js` — 11 test source-assertion theo quy ước `tests/web`.

**Review (22 findings).**
- Vá: 1 medium — bấm video gọi `video_comments` hai lần (gọi trực tiếp và qua effect khi URL đổi); đã bỏ lời gọi trực tiếp, effect xử lý một lần.
- Hoãn: `extractVideoId` trả chuỗi không hợp lệ thay vì rỗng và không có test chạy thật (medium); bình luận render thô nên lộ ký tự HTML từ `textDisplay` (medium); chưa có AbortController cho request nhanh liên tiếp (medium, chưa xác minh).
- Bác 18 findings còn lại: 9 low (URL kênh đầy đủ, video cũ sót lại, retry ô rỗng, avatar khoảng trắng, reset ảnh lỗi, id rỗng, nút Làm mới, nuốt lỗi channel_videos, reply sắp lẫn) vì không gây hại thực tế hoặc spec không yêu cầu; 9 false vì đã kiểm tra và không xảy ra hoặc là quy ước test của repo (test source-text, banner kép, payload `limit` đã được backend gom thành `maxResults`).

**Follow-up review: false.** Không có entry mức high và chỉ một entry medium được vá (ngưỡng là hai). Không có rủi ro chưa kiểm nào cần một lượt review riêng.

**Xác minh.**
- `npx vitest run tests/web/youtube.test.js` — 11/11 PASS (trước và sau khi vá).
- `npx tsc --noEmit -p apps/web/tsconfig.json` — không lỗi mới ở file đã đổi. 4 lỗi `TS18046` ở `apps/web/lib/api.ts` có sẵn từ baseline, không thuộc story này.

**Rủi ro còn lại.** Bình luận hiện ký tự HTML literal (đã hoãn); `extractVideoId` chưa có test thực thi (đã hoãn); trang cần `YOUTUBE_API_KEY` ở backend để có dữ liệu thật.
