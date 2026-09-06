---
title: 'Story 33.2: YouTube VN Channel & Video Crawler'
type: 'feature'
created: '2026-09-05'
status: 'backlog'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/epics.md#epic-33
  - _bmad-output/planning-artifacts/prd.md#fr-97
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần dữ liệu YouTube VN (channels, videos, comments, trending) cho influencer marketing và content analysis.

**Approach:**
1. Tạo `YouTubeVNCrawler` tại `src/scrapers/social/youtube/index.js` kế thừa `AbstractCrawler`.
2. Dùng YouTube Data API v3 (`googleapis.com/youtube/v3`) với `YOUTUBE_API_KEY` từ env.
3. `regionCode: 'VN'` cho tất cả search/trending queries.
4. Actions: `search`, `channel_videos`, `video_comments`, `channel_detail`, `trending_vn`.
5. HTML fallback khi quota exhausted (10k units/day free tier).
6. Chuẩn hóa `PostItem` với `platform: 'youtube'`, `category: 'video'`.
7. Comments → `CommentItem` với parent-child threading.
8. Dispatch alias: `youtube`, `yt`, `youtube_vn`.

## Boundaries & Constraints

**Always:**
- Dùng `YOUTUBE_API_KEY` env var.
- `regionCode: 'VN'` cho VN-specific queries.
- HTML fallback khi API quota hết.
- Rate limit theo YouTube API quota (10000 units/day).

**Ask First:**
- Nếu cần YouTube live chat.
- Nếu cần YouTube Music hoặc Shorts riêng.

**Never:**
- Không scrape YouTube khi chưa có API key.
- Không bypass quota bằng cách tạo nhiều API keys.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search VN | `scrape('youtube','search',{query:'nhạc trẻ',regionCode:'VN'})` | `PostItem[]` videos | Quota exhausted → HTML fallback |
| Channel videos | `scrape('youtube','channel_videos',{channelId:'UC...'})` | `PostItem[]` | Not found → `XACT_4001` |
| Video comments | `scrape('youtube','video_comments',{videoId:'abc123'})` | `CommentItem[]` threaded | Disabled comments → `[]` |
| VN trending | `scrape('youtube','trending_vn',{maxResults:20})` | `PostItem[]` trending | API error → fallback HTML |
| Missing API key | No `YOUTUBE_API_KEY` | Fallback to HTML scrape | `note: 'api_key_missing'` |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/youtube/index.js` — `YouTubeVNCrawler`
- `src/scrapers/social/youtube/client.js` — `YouTubeClient` extends `AbstractApiClient`
- `src/scrapers/social/youtube/validator.js`
- `src/scrapers/social/youtube/normalize.js`
- `src/scrapers/index.js` — dispatcher alias
- `tests/scrapers/social/youtube/`
