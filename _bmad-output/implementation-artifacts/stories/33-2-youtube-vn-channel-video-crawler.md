---
title: 'Story 33.2: YouTube VN Channel & Video Crawler'
type: 'feature'
created: '2026-09-05'
updated: '2026-09-08'
status: 'done'
epic: 33
story_number: 33.2
phase: 'Phase A — Vietnam Core'
priority: 'high'
baseline_commit: 'e0beb4e5'
context:
  - _bmad-output/planning-artifacts/epics.md#epic-33
  - _bmad-output/planning-artifacts/prd.md#fr-97
  - _bmad-output/planning-artifacts/prd.md#nfr-19
  - src/scrapers/index.js
  - src/core/base-crawler.js
  - src/core/base-client.js
  - src/core/platform-validator.js
  - src/core/account-pool.js
  - src/core/types.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần dữ liệu video, kênh và bình luận người dùng từ YouTube Việt Nam (nền tảng chia sẻ video lớn nhất với hơn 63 triệu người xem tại VN) nhằm phục vụ phát hiện influencer, phân tích xu hướng dư luận (sentiment analysis), và theo dõi nội dung số phục vụ cho chiến dịch B2B Lead Hub và tiếp thị thương hiệu.

**Approach:**
1. Tạo `YouTubeVNCrawler` tại `src/scrapers/social/youtube/crawler.js` kế thừa `AbstractCrawler`.
2. Implement `YouTubeClient` tại `src/scrapers/social/youtube/client.js` kế thừa `AbstractApiClient` gọi YouTube Data API v3 (`https://www.googleapis.com/youtube/v3`) sử dụng API Key (`process.env.YOUTUBE_API_KEY` hoặc truyền qua options) và cơ chế HTML fallback khi API quota bị cạn kiệt (10,000 units/ngày của free tier).
3. Hỗ trợ các actions cốt lõi:
   - `search`: tìm kiếm video theo từ khóa, lọc theo `regionCode: 'VN'` và ngôn ngữ `relevanceLanguage: 'vi'`.
   - `trending_vn` (alias `trending`): lấy danh sách video thịnh hành nhất tại Việt Nam (`chart=mostPopular&regionCode=VN`).
   - `channel_videos`: cào danh sách video thuộc kênh YouTube cụ thể (`search` theo `channelId`).
   - `channel_detail` (alias `channel`, `profile`): cào thông tin chi tiết của kênh (`/channels?part=snippet,statistics,brandingSettings`).
   - `video_detail` (alias `video`, `detail`): cào thông tin chi tiết một video (`/videos?part=snippet,contentDetails,statistics`).
   - `video_comments` (alias `comments`): cào bình luận và các câu trả lời lồng nhau (nested replies) của video (`/commentThreads?part=snippet,replies`).
4. Chuẩn hóa dữ liệu sang:
   - `PostItem` với `platform: 'youtube'`, `category: 'video'` (hoặc `'social'`), định danh `youtube:${videoId}`.
   - `CommentItem` với `platform: 'youtube'`, định danh `youtube:${videoId}:${commentId}`, hỗ trợ `parentCommentId` và phân cấp đa tầng.
   - `ProfileItem` cho kênh với định danh `youtube:${channelId}`.
5. Tích hợp `YouTubePlatformResponseValidator` kiểm tra lỗi quota (`quotaExceeded`), lỗi khóa API (`keyInvalid`, `badRequest`), lỗi video bị ẩn/tắt bình luận (`commentsDisabled`).
6. Tự động lưu trữ qua `PrismaStore` và phát `ThinEvent` tới Redis Stream `stream:social:raw_posts`.
7. Đăng ký alias trong unified dispatcher `src/scrapers/index.js`: `youtube`, `yt`, `youtube_vn`.

## Boundaries & Constraints

**Always:**
- Mặc định sử dụng API Key từ biến môi trường `YOUTUBE_API_KEY` hoặc `options.apiKey` / `options.key`.
- Tất cả truy vấn tìm kiếm hoặc thịnh hành cho thị trường Việt Nam phải luôn áp dụng `regionCode: 'VN'` và `relevanceLanguage: 'vi'`.
- Khi API quota hết (`quotaExceeded` / HTTP 403), crawler tự động chuyển sang chế độ HTML Fallback hoặc trả về error envelope chuẩn để không làm gián đoạn pipeline.
- Định danh `id` của PostItem và CommentItem phải tuân thủ quy chuẩn namespaced: `youtube:${videoId}` và `youtube:${videoId}:${commentId}`.
- Mọi item bóc tách phải được kiểm tra qua `this.validateItem(item)`.

**Ask First:**
- Nếu cần cào Live Stream Chat trong thời gian thực (yêu cầu duy trì polling kết nối liên tục).
- Nếu cần tải file binary video/audio trực tiếp từ YouTube (cần kiểm tra bản quyền và dung lượng băng thông).

**Never:**
- Không hardcode API Key trong source code hoặc commit credentials vào git.
- Không vượt qua giới hạn rate limit bằng cách spam request song song không kiểm soát; phải tôn trọng adaptive governor.
- Không bypass chính sách Google bằng cách tạo hàng loạt bot account ảo bất hợp pháp.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Tìm kiếm video VN | `scrape('youtube', 'search', { query: 'doanh nghiệp vừa và nhỏ', regionCode: 'VN' })` | `{ posts: PostItem[], pageInfo: { total, nextPageToken } }` | Quota hết → chuyển fallback hoặc `XACT_4029` |
| Video thịnh hành VN | `scrape('youtube', 'trending_vn', { maxResults: 20 })` | `{ posts: PostItem[], pageInfo: { total, nextPageToken } }` | Lỗi API → trả về mã lỗi chuẩn `XACT_5001` |
| Chi tiết kênh | `scrape('youtube', 'channel_detail', { channelId: 'UC...' })` | `{ profile: ProfileItem }` | Kênh không tồn tại → `XACT_4004` (`not_found`) |
| Video của kênh | `scrape('youtube', 'channel_videos', { channelId: 'UC...', maxResults: 15 })` | `{ posts: PostItem[], pageInfo: { nextPageToken } }` | Tham số thiếu → `XACT_4001` (`invalid_params`) |
| Bình luận video | `scrape('youtube', 'video_comments', { videoId: 'dQw4w9WgXcQ' })` | `{ comments: CommentItem[], pageInfo: { nextPageToken } }` | Video tắt bình luận → trả về `[]` với flag `commentsDisabled: true` |
| Chi tiết 1 video | `scrape('youtube', 'video_detail', { videoId: 'dQw4w9WgXcQ' })` | `{ post: PostItem }` | Video riêng tư / bị xóa → `XACT_4004` (`not_found`) |
| Hết quota API | Google API trả về HTTP 403 `quotaExceeded` | Validator `isRateLimit` trả về `true` | Crawler kích hoạt backoff hoặc bật HTML Fallback |
| API Key không hợp lệ | Google API trả về HTTP 400 `keyInvalid` | Validator `isAuthExpired` trả về `true` | Crawler báo lỗi `XACT_4003` (`auth_expired`) |

</frozen-after-approval>

## User Story

As a **Vietnam Content Intelligence Analyst**,  
I want **a `YouTubeVNCrawler` in `src/scrapers/social/youtube/crawler.js` that extends `AbstractCrawler` and calls YouTube Data API v3 with Vietnam region filtering**,  
So that **Nowing AI can monitor trending Vietnam YouTube channels, video performance metrics, and audience comments for influencer discovery, sentiment tracking, and B2B digital market insights**.

---

## Acceptance Criteria (BDD)

### AC 1: Architecture & Base Class Conformance
- **Given** module `src/scrapers/social/youtube/`
- **When** khởi tạo `YouTubeVNCrawler` và `YouTubeClient`
- **Then** `YouTubeVNCrawler` kế thừa `AbstractCrawler`, thiết lập `name: 'youtube'`, `platform: 'youtube'`, `category: 'video'`, `requiresAuth: false` (hỗ trợ API key công khai).
- **And** `YouTubeClient` kế thừa `AbstractApiClient`, thiết lập `platform: 'youtube'`, `baseUrl: 'https://www.googleapis.com/youtube/v3'`.
- **And** crawler cài đặt đầy đủ vòng đời `init()` và `cleanup()`.

### AC 2: Vietnam Video Search (`search`)
- **Given** YouTube Data API v3 endpoint `/search`
- **When** gọi `scrape('youtube', 'search', { query: 'AI Vietnam', regionCode: 'VN', maxResults: 10 })`
- **Then** crawler gửi request với các tham số: `part=snippet`, `type=video`, `q=AI Vietnam`, `regionCode=VN`, `relevanceLanguage=vi`, `key=<API_KEY>`
- **And** normalizer chuyển đổi danh sách items thành `PostItem[]`:
  - `id`: `youtube:${item.id.videoId}`
  - `platform`: `'youtube'`
  - `externalId`: `item.id.videoId`
  - `category`: `'video'`
  - `title`: `snippet.title`
  - `content`: `snippet.description`
  - `authorId`: `snippet.channelId`
  - `authorName`: `snippet.channelTitle`
  - `authorUrl`: `https://www.youtube.com/channel/${snippet.channelId}`
  - `postUrl`: `https://www.youtube.com/watch?v=${item.id.videoId}`
  - `mediaUrls`: mảng chứa URL ảnh thumbnail chất lượng cao nhất (`high` hoặc `medium` hoặc `default`)
  - `publishedAt`: `new Date(snippet.publishedAt)`
  - `metadata.regionCode`: `'VN'`
  - `metadata.channelTitle`: `snippet.channelTitle`
  - `metadata.sourcePlatform`: `'youtube'`
- **And** trả về kết cấu: `{ posts: PostItem[], pageInfo: { total, nextPageToken, prevPageToken } }`.

### AC 3: Vietnam Trending Videos (`trending_vn` / `trending`)
- **Given** YouTube Data API v3 endpoint `/videos` với `chart=mostPopular`
- **When** gọi `scrape('youtube', 'trending_vn', { maxResults: 20 })` hoặc `scrape('youtube', 'trending')`
- **Then** crawler gửi request với `part=snippet,contentDetails,statistics`, `chart=mostPopular`, `regionCode=VN`
- **And** normalizer bóc tách đầy đủ các chỉ số tương tác số:
  - `viewsCount`: số lượt xem `parseInt(statistics.viewCount, 10)`
  - `likesCount`: số lượt thích `parseInt(statistics.likeCount, 10)`
  - `repliesCount`: số bình luận `parseInt(statistics.commentCount, 10)`
  - `metadata.duration`: thời lượng video từ `contentDetails.duration` (định dạng ISO 8601, ví dụ `PT15M33S`)
  - `metadata.tags`: mảng thẻ từ khóa `snippet.tags`
- **And** trả về danh sách `posts: PostItem[]` kèm `pageInfo`.

### AC 4: Channel Videos Extraction (`channel_videos`)
- **Given** YouTube Data API v3 endpoint `/search` hoặc uploads playlist
- **When** gọi `scrape('youtube', 'channel_videos', { channelId: 'UC12345', maxResults: 15 })`
- **Then** crawler trích xuất danh sách video mới nhất được xuất bản bởi kênh
- **And** chuẩn hóa thành `PostItem[]` và trả về kèm `pageInfo`.

### AC 5: Channel Profile Details (`channel_detail` / `channel` / `profile`)
- **Given** YouTube Data API v3 endpoint `/channels`
- **When** gọi `scrape('youtube', 'channel_detail', { channelId })` hoặc `scrape('youtube', 'channel', { username })`
- **Then** crawler gửi request với `part=snippet,statistics,brandingSettings`
- **And** chuẩn hóa sang `ProfileItem`:
  - `id`: `youtube:${channel.id}`
  - `platform`: `'youtube'`
  - `externalId`: `channel.id`
  - `name`: `snippet.title`
  - `bio`: `snippet.description`
  - `avatar`: `snippet.thumbnails.high.url`
  - `profileUrl`: URL kênh YouTube (`https://www.youtube.com/channel/${channel.id}`)
  - `followersCount`: số người đăng ký `parseInt(statistics.subscriberCount, 10)`
  - `metadata.videoCount`: tổng số video `parseInt(statistics.videoCount, 10)`
  - `metadata.viewCount`: tổng lượt xem toàn kênh `parseInt(statistics.viewCount, 10)`
  - `metadata.country`: quốc gia của kênh (`snippet.country`)
  - `metadata.customUrl`: alias của kênh (ví dụ `@VTV24`)
- **And** trả về kết quả `{ profile: ProfileItem }`.

### AC 6: Video Comments & Threading (`video_comments` / `comments`)
- **Given** YouTube Data API v3 endpoint `/commentThreads`
- **When** gọi `scrape('youtube', 'video_comments', { videoId: 'abc123xyz', maxResults: 20 })`
- **Then** crawler trích xuất các bình luận gốc (top-level comments) và các bình luận trả lời (replies)
- **And** chuẩn hóa sang mảng `CommentItem[]`:
  - `id`: `youtube:${videoId}:${comment.id}`
  - `platform`: `'youtube'`
  - `externalId`: `comment.id`
  - `postId`: `youtube:${videoId}`
  - `authorId`: `snippet.authorChannelId?.value || ''`
  - `authorName`: `snippet.authorDisplayName`
  - `authorAvatar`: `snippet.authorProfileImageUrl`
  - `content`: `snippet.textDisplay` || `snippet.textOriginal`
  - `likesCount`: `snippet.likeCount`
  - `publishedAt`: `new Date(snippet.publishedAt)`
  - `parentCommentId`: `undefined` cho bình luận gốc, hoặc `youtube:${videoId}:${parent.id}` cho bình luận trả lời
  - `depth`: `0` cho bình luận gốc, `1` cho reply
- **And** nếu video bị tắt tính năng bình luận (`commentsDisabled`), crawler trả về `{ comments: [], pageInfo: { commentsDisabled: true } }` thay vì crash.

### AC 7: Platform Response Validator & Quota Exhaustion Detection
- **Given** class `YouTubePlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`
- **When** nhận payload phản hồi từ Google/YouTube API
- **Then** `isValidPayload(res)` trả về `true` khi có thuộc tính `items` (hoặc `kind === 'youtube#...'`) và không có khối lỗi `error`
- **And** `isRateLimit(res)` trả về `true` khi HTTP 429 hoặc HTTP 403 chứa lý do `quotaExceeded` hoặc `rateLimitExceeded`
- **And** `isAuthExpired(res)` trả về `true` khi HTTP 400/401 chứa lỗi `keyInvalid` hoặc `badRequest` do API key
- **And** `isBotChallenge(res)` trả về `true` khi HTTP 403 dạng WAF/Cloudflare HTML hoặc trang xác minh robot của Google
- **And** `isLoginWall(res)` trả về `true` khi video yêu cầu xác nhận độ tuổi hoặc nội dung riêng tư (`private`).

### AC 8: Persistence & Thin-Event Dispatch
- **Given** crawler có cấu hình `store` (PrismaStore) và `publisher` (RedisStreamPublisher)
- **When** bóc tách các `PostItem`, `CommentItem` hoặc `ProfileItem` thành công
- **Then** từng item được kiểm tra qua `this.validateItem(item)`
- **And** lưu vào database qua `store.savePost()` / `store.saveProfile()` / `store.saveComment()`
- **And** phát `ThinEvent` sang Redis Stream `stream:social:raw_posts` với payload:
  `{ id: item.id, platform: 'youtube', externalId: item.externalId, category: 'video', authorId: item.authorId, crawledAt: isoDate, storageRef: item.id }`.

### AC 9: Unified Dispatcher Integration & Comprehensive Tests
- **Given** file dispatcher trung tâm `src/scrapers/index.js`
- **When** người dùng gọi `scrape('youtube', action, options)` hoặc `scrape('yt', action, options)` hoặc `scrape('youtube_vn', action, options)`
- **Then** lệnh được định tuyến chính xác tới `YouTubeVNCrawler`
- **And** bộ test suite tại `tests/scrapers/social/youtube/` bao phủ:
  - `client.test.js`: kiểm tra API key injection, query params, URL builders, error responses.
  - `validator.test.js`: kiểm tra phát hiện `quotaExceeded`, `keyInvalid`, challenge HTML, invalid payloads.
  - `normalizer.test.js`: kiểm tra chuyển đổi chuẩn xác `PostItem`, `CommentItem`, `ProfileItem`, date parsing.
  - `crawler.test.js`: kiểm tra lifecycle, mock API calls, store persistence, event publishing.
  - `dispatch.test.js`: kiểm tra routing aliases trong unified dispatcher.
- **And** 100% tests chạy thành công với Vitest.

---

## Technical Notes & YouTube Data API v3 Contracts

### 1. Base URL & Common Params
- **Base URL:** `https://www.googleapis.com/youtube/v3`
- **Auth:** Query parameter `key=<YOUTUBE_API_KEY>` hoặc header `Authorization: Bearer <token>`
- **Quota cost matrix:**
  - `search.list`: **100 units**
  - `videos.list`: **1 unit**
  - `channels.list`: **1 unit**
  - `commentThreads.list`: **1 unit**

### 2. Endpoints Details

#### a) Video Search:
- `GET /search?part=snippet&q={query}&type=video&regionCode=VN&relevanceLanguage=vi&maxResults={maxResults}&key={key}`
- **Response Format:**
```json
{
  "kind": "youtube#searchListResponse",
  "nextPageToken": "CAUQAA",
  "pageInfo": {
    "totalResults": 1000000,
    "resultsPerPage": 10
  },
  "items": [
    {
      "kind": "youtube#searchResult",
      "id": { "kind": "youtube#video", "videoId": "vid_12345" },
      "snippet": {
        "publishedAt": "2026-09-01T08:00:00Z",
        "channelId": "UC_channel_123",
        "title": "Xu hướng chuyển đổi số doanh nghiệp Việt Nam 2026",
        "description": "Toàn cảnh ứng dụng trí tuệ nhân tạo và tự động hóa...",
        "thumbnails": {
          "high": { "url": "https://i.ytimg.com/vi/vid_12345/hqdefault.jpg" }
        },
        "channelTitle": "VTV Công Nghệ"
      }
    }
  ]
}
```

#### b) Trending Videos (VN Most Popular):
- `GET /videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=VN&maxResults={maxResults}&key={key}`
- **Response Format:**
```json
{
  "kind": "youtube#videoListResponse",
  "items": [
    {
      "id": "vid_trending_99",
      "snippet": {
        "publishedAt": "2026-09-07T12:00:00Z",
        "channelId": "UC_music_vn",
        "title": "Top Bài Hát Thịnh Hành Việt Nam 2026",
        "description": "Danh sách ca khúc được nghe nhiều nhất...",
        "thumbnails": {
          "high": { "url": "https://i.ytimg.com/vi/vid_trending_99/hqdefault.jpg" }
        },
        "channelTitle": "Nhạc Trẻ Hits",
        "tags": ["nhac tre", "vpop", "trending vn"]
      },
      "contentDetails": {
        "duration": "PT4M15S"
      },
      "statistics": {
        "viewCount": "1250000",
        "likeCount": "89000",
        "commentCount": "3400"
      }
    }
  ]
}
```

#### c) Video Comments:
- `GET /commentThreads?part=snippet,replies&videoId={videoId}&maxResults={maxResults}&key={key}`
- **Response Format:**
```json
{
  "kind": "youtube#commentThreadListResponse",
  "items": [
    {
      "id": "cmt_thread_1",
      "snippet": {
        "videoId": "vid_12345",
        "totalReplyCount": 2,
        "topLevelComment": {
          "id": "cmt_top_1",
          "snippet": {
            "authorDisplayName": "Nguyen Van A",
            "authorProfileImageUrl": "https://yt3.ggpht.com/avatar1.jpg",
            "authorChannelId": { "value": "UC_user_1" },
            "textDisplay": "Video rất hữu ích cho doanh nghiệp SME!",
            "likeCount": 15,
            "publishedAt": "2026-09-02T10:30:00Z"
          }
        }
      },
      "replies": {
        "comments": [
          {
            "id": "cmt_reply_1_1",
            "snippet": {
              "authorDisplayName": "VTV Công Nghệ",
              "textDisplay": "Cảm ơn bạn đã quan tâm theo dõi!",
              "likeCount": 3,
              "publishedAt": "2026-09-02T11:00:00Z"
            }
          }
        ]
      }
    }
  ]
}
```

#### d) Channel Information:
- `GET /channels?part=snippet,statistics,brandingSettings&id={channelId}&key={key}`
- **Response Format:**
```json
{
  "kind": "youtube#channelListResponse",
  "items": [
    {
      "id": "UC_channel_123",
      "snippet": {
        "title": "VTV Công Nghệ",
        "description": "Kênh thông tin chuyển đổi số và khoa học công nghệ",
        "customUrl": "@vtvcongnghe",
        "publishedAt": "2015-06-10T00:00:00Z",
        "thumbnails": {
          "high": { "url": "https://yt3.ggpht.com/avatar_channel.jpg" }
        },
        "country": "VN"
      },
      "statistics": {
        "viewCount": "450000000",
        "subscriberCount": "1800000",
        "videoCount": "3200"
      }
    }
  ]
}
```

---

## Code Map

```
src/scrapers/social/youtube/
├── index.js          # Barrel exports + createYouTubeVNCrawler, createYouTubeClient, scrapeYouTube helper
├── client.js         # YouTubeClient extending AbstractApiClient (API key injection, endpoint builders)
├── crawler.js        # YouTubeVNCrawler extending AbstractCrawler (Action router, AccountPool, Lifecycle)
├── normalizer.js     # Data transformations to PostItem, CommentItem & ProfileItem
├── schema.js         # Validation schemas, ISO duration parser, ID generators
└── validator.js      # YouTubePlatformResponseValidator extending AbstractPlatformResponseValidator

src/core/types.js     # Verify or add VIDEO: 'video' to CATEGORIES

src/scrapers/index.js # Unified dispatcher wiring (aliases: youtube, yt, youtube_vn)

tests/scrapers/social/youtube/
├── fixtures/
│   ├── youtube-search.json     # Sample search videos response
│   ├── youtube-trending.json   # Sample trending videos response
│   ├── youtube-channel.json    # Sample channel details response
│   ├── youtube-comments.json   # Sample comment threads response
│   └── youtube-video.json      # Sample single video details response
├── client.test.js              # Unit tests for YouTubeClient
├── validator.test.js           # Unit tests for YouTubePlatformResponseValidator
├── normalizer.test.js          # Unit tests for normalization logic
├── crawler.test.js             # Integration tests for YouTubeVNCrawler
└── dispatch.test.js            # Dispatcher routing & alias tests
```

---

## Tasks / Subtasks

### Phase 0: Foundation & Directory Structure
- [x] **Task 0.1** — Tạo thư mục module `src/scrapers/social/youtube/` và fixtures `tests/scrapers/social/youtube/fixtures/` (AC: #1)
  - [x] Khởi tạo `schema.js`, `validator.js`, `normalizer.js`, `client.js`, `crawler.js`, `index.js`
  - [x] Tạo các fixture file JSON mẫu từ YouTube Data API v3
- [x] **Task 0.2** — Đảm bảo `CATEGORIES.VIDEO` (hoặc `CATEGORIES.SOCIAL`) hợp lệ trong `src/core/types.js` (AC: #1, #2)
  - [x] Thêm `VIDEO: 'video'` vào `CATEGORIES` trong `src/core/types.js`
  - [x] Cập nhật comment trong `prisma/schema.prisma`

### Phase 1: YouTubePlatformResponseValidator
- [x] **Task 1.1** — Cài đặt `YouTubePlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator` (AC: #7)
  - [x] Thiết lập `platform = 'youtube'`
  - [x] Cài đặt `isValidPayload(res)`: nhận diện `items` array hoặc `kind.startsWith('youtube#')`
  - [x] Cài đặt `isRateLimit(res)`: nhận diện HTTP 429 hoặc `quotaExceeded` / `rateLimitExceeded`
  - [x] Cài đặt `isAuthExpired(res)`: nhận diện HTTP 400/401 với `keyInvalid` hoặc API key bị vô hiệu hóa
  - [x] Cài đặt `isBotChallenge(res)`: nhận diện HTTP 403 Google WAF / captcha challenge
  - [x] Cài đặt `isLoginWall(res)`: nhận diện video riêng tư (`private`) hoặc giới hạn độ tuổi

### Phase 2: YouTubeClient
- [x] **Task 2.1** — Cài đặt `YouTubeClient` kế thừa `AbstractApiClient` (AC: #1, #2, #3, #4, #5, #6)
  - [x] Cấu hình `baseUrl = 'https://www.googleapis.com/youtube/v3'`
  - [x] Tự động truyền query param `key` hoặc header `Authorization`
  - [x] Triển khai `searchVideos({ query, regionCode, maxResults, pageToken, order })`
  - [x] Triển khai `getTrending({ regionCode, maxResults, pageToken })`
  - [x] Triển khai `getChannelVideos({ channelId, maxResults, pageToken })`
  - [x] Triển khai `getChannelDetail({ channelId, forHandle, forUsername })`
  - [x] Triển khai `getVideoDetail({ videoId })`
  - [x] Triển khai `getVideoComments({ videoId, maxResults, pageToken })`
  - [x] Cài đặt lifecycle `cleanup()`

### Phase 3: Normalizer & Schema Helpers
- [x] **Task 3.1** — Triển khai `schema.js` (AC: #2, #3, #5, #6)
  - [x] `namespacedYouTubeId(externalId, prefix)` -> `youtube:${externalId}`
  - [x] `parseIsoDuration(durationStr)` (ví dụ `PT4M15S` -> 255 giây)
  - [x] `extractBestThumbnail(thumbnails)`
- [x] **Task 3.2** — Triển khai `normalizer.js` (AC: #2, #3, #4, #5, #6)
  - [x] `normalizeYouTubeVideo(video)` -> `PostItem`
  - [x] `normalizeYouTubeChannel(channel)` -> `ProfileItem`
  - [x] `normalizeYouTubeCommentThread(thread, videoId)` -> `CommentItem[]` (bao gồm top-level + replies)
  - [x] `normalizeYouTubeResults(rawPayload, action, context)` -> chuẩn hóa kết quả và `pageInfo`

### Phase 4: YouTubeVNCrawler
- [x] **Task 4.1** — Cài đặt `YouTubeVNCrawler` kế thừa `AbstractCrawler` (AC: #1, #2, #3, #4, #5, #6, #8)
  - [x] Cài đặt lifecycle `init()` và `cleanup()`
  - [x] Đăng ký các actions: `search`, `trending_vn`, `channel_videos`, `channel_detail`, `video_detail`, `video_comments`
  - [x] Đăng ký action aliases: `trending` -> `trending_vn`, `channel` / `profile` -> `channel_detail`, `video` / `detail` -> `video_detail`, `comments` -> `video_comments`
  - [x] Quản lý API Key: ưu tiên `args.apiKey` -> `AccountPool` -> `process.env.YOUTUBE_API_KEY`
  - [x] Tự động gắn mặc định `regionCode = 'VN'` cho các tác vụ tìm kiếm và thịnh hành
  - [x] Xác thực từng item qua `this.validateItem(item)`
  - [x] Lưu trữ qua `store.savePost()` / `store.saveProfile()` / `store.saveComment()` nếu có `store`
  - [x] Bắn thin-event qua `publisher.publish()` tới `stream:social:raw_posts`

### Phase 5: Unified Dispatcher Integration
- [x] **Task 5.1** — Đăng ký YouTube trong `src/scrapers/index.js` (AC: #9)
  - [x] Import `createYouTubeVNCrawler`, `createYouTubeClient`, `YouTubeVNCrawler`, `YouTubeClient`
  - [x] Thêm platform aliases: `youtube`, `yt`, `youtube_vn`
  - [x] Thêm dispatch handler định tuyến các action tương ứng
  - [x] Export factory functions và helper `scrapeYouTube`

### Phase 6: Test Suite & Quality Verification
- [x] **Task 6.1** — Viết unit tests cho validator: `tests/scrapers/social/youtube/validator.test.js` (AC: #7)
- [x] **Task 6.2** — Viết unit tests cho normalizer: `tests/scrapers/social/youtube/normalizer.test.js` (AC: #2, #3, #5, #6)
- [x] **Task 6.3** — Viết unit tests cho client: `tests/scrapers/social/youtube/client.test.js` (AC: #1, #7)
- [x] **Task 6.4** — Viết integration tests cho crawler: `tests/scrapers/social/youtube/crawler.test.js` (AC: #1, #8)
- [x] **Task 6.5** — Viết dispatcher tests: `tests/scrapers/social/youtube/dispatch.test.js` (AC: #9)
- [x] **Task 6.6** — Chạy toàn bộ test suite `vitest run tests/scrapers/social/youtube/` đảm bảo 100% pass

### Review Findings
- [x] [Review][Patch] parseIsoDuration ignores day component (P1DT...) and returns 0 on malformed input without digits [src/scrapers/social/youtube/schema.js:37]
- [x] [Review][Patch] getVideoComments disabled-comments detector fails when error payload is stored in err.details object [src/scrapers/social/youtube/client.js:283]
- [x] [Review][Patch] normalizeYouTubeVideo risks producing youtube:[object Object] on non-string video id shapes [src/scrapers/social/youtube/normalizer.js:28]
- [x] [Review][Patch] Unified dispatcher maps options.id to videoId even for channel actions [src/scrapers/index.js:856]
- [x] [Review][Patch] YouTubeVNCrawler does not propagate command.session.apiKey to crawler action args [src/scrapers/social/youtube/crawler.js:68]

---

## Dev Notes & Architecture Guardrails

### 1. Quota Awareness & Cost Management
- YouTube Data API v3 giới hạn 10,000 units/ngày trên mỗi dự án Google Cloud.
- `search.list` tốn **100 units/lần gọi**. Vì vậy, crawler nên ưu tiên `videos.list` (1 unit) hoặc `commentThreads.list` (1 unit) khi đã biết sẵn ID.
- Không lặp lại lệnh gọi search nếu dữ liệu có thể trích xuất từ playlist uploads của channel.

### 2. Zero-Mock Policy for Internal Logic
- Không mock `AbstractCrawler`, `AbstractApiClient` hay `YouTubePlatformResponseValidator`.
- Toàn bộ pipeline normalizer, schema validation và error envelopes phải chạy code thực tế.

### 3. Preserved Systems
- Unified dispatcher `src/scrapers/index.js` phải giữ tính tương thích ngược cho tất cả các platform hiện có.

### 4. Previous Story Intelligence
- **Từ Story 33.1 (`ZaloCrawler`):** Áp dụng cơ chế nạp credentials linh hoạt: ưu tiên `args.apiKey` ➔ `AccountPool` ➔ `process.env.YOUTUBE_API_KEY`.
- **Từ Story 22.3 (`IpLegalCrawler`):** Tận dụng ID deterministic `youtube:${videoId}` và `youtube:${videoId}:${commentId}` để đảm bảo tính idempotent.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Debug Log References
- Initial validation gap identified: Missing BDD ACs, missing Tasks breakdown, missing YouTube Data API v3 contracts, missing quota handling and CommentItem threading details.
- Addressed: Upgraded story context with exhaustive BDD AC 1-9, 7-phase task checklist, quota cost matrix, and concrete architectural guidelines.

### Completion Notes List
- Story 33.2 upgraded to comprehensive BMad Master Context format.
- Acceptance criteria aligned with PRD FR-97 and NFR-18/NFR-19.
- Sprint status updated to `ready-for-dev`.

### File List
- `src/core/types.js` (added VIDEO to CATEGORIES)
- `prisma/schema.prisma` (updated category documentation)
- `src/scrapers/social/youtube/schema.js`
- `src/scrapers/social/youtube/validator.js`
- `src/scrapers/social/youtube/client.js`
- `src/scrapers/social/youtube/normalizer.js`
- `src/scrapers/social/youtube/crawler.js`
- `src/scrapers/social/youtube/index.js`
- `tests/scrapers/social/youtube/fixtures/*` (5 JSON fixtures)
- `tests/scrapers/social/youtube/validator.test.js`
- `tests/scrapers/social/youtube/client.test.js`
- `tests/scrapers/social/youtube/schema.test.js`
- `tests/scrapers/social/youtube/normalizer.test.js`
- `tests/scrapers/social/youtube/crawler.test.js`
- `tests/scrapers/social/youtube/dispatch.test.js`
- `tests/e2e/youtube-vn-crawler.e2e.test.js`
- `src/scrapers/index.js` (wired dispatcher aliases youtube, yt, youtube_vn)
- `_bmad-output/implementation-artifacts/stories/33-2-youtube-vn-channel-video-crawler.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
