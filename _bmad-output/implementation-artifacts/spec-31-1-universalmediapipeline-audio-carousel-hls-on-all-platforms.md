---
title: 'Story 31.1 — UniversalMediaPipeline: Audio, Carousel, HLS on All Platforms'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
baseline_commit: 'bd32da02'
review_loop_iteration: 0
context:
  - _bmad-output/planning-artifacts/epics.md
  - src/scrapers/social/twitter/normalize-media.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại trích xuất media chất lượng cao (HLS/MP4/video/audio) chỉ được cài đặt cục bộ cho Twitter (`src/scrapers/social/twitter/normalize-media.js` và script browser `scripts/videoDownloader.js`). Các nền tảng khác như Bluesky, Mastodon, Threads, Facebook, TikTok thiếu bộ trích xuất chuẩn hóa đa định dạng (ảnh, video đa bitrate, audio/Spaces, carousels/album), và AI Agent chưa có công cụ MCP `x_download_media` để trích xuất media đa nền tảng.

**Approach:** Xây dựng `UniversalMediaPipeline` tại `src/scrapers/social/media-pipeline.js`:
- Định nghĩa schema chuẩn `MediaObject`: `{ type, url, thumbnailUrl, width, height, durationMs, bitrate, contentType, variants, altText, title, metadata }`.
- Các adapter trích xuất per-platform: `twitter`, `bluesky`, `mastodon`, `threads`, `facebook`, `tiktok`.
- Lựa chọn URL chất lượng tốt nhất (ưu tiên MP4 bitrate cao nhất, fallback HLS `.m3u8` / DASH khi không có MP4).
- Hỗ trợ audio (Spaces, voice tweets/posts) và carousels (chuỗi album ảnh/slide).
- Tạo MCP tool `x_download_media` hỗ trợ `platform` và `postUrl`, trả về `MediaObject[]`.
- Module hóa `src/scrapers/videoDownloader.js` ủy quyền qua `media-pipeline.js`.

## Boundaries & Constraints

**Always:**
- Schema `MediaObject`:
  - `type`: `'photo' | 'video' | 'animated_gif' | 'audio' | 'carousel'`
  - `url`: best-quality direct download URL
  - `thumbnailUrl`: preview image URL
  - `variants`: array of `{ url, bitrate, contentType, width?, height? }`
- Per-platform adapters:
  - `twitter`: xử lý GraphQL `extended_entities.media` (video_info.variants, photo orig/large, spaces audio).
  - `bluesky`: xử lý AT Protocol embeds (`app.bsky.embed.images`, `app.bsky.embed.video`, external).
  - `mastodon`: xử lý REST media_attachments (`image`, `video`, `gifv`, `audio`).
  - `threads`: xử lý image_versions2, video_versions, carousel_media.
  - `facebook`: xử lý attachments (photo, video_data, subattachments).
  - `tiktok`: xử lý video play_addr, cover, music/audio.
- Hàm `extractMedia({ platform, post, url, rawData })` trả về `MediaObject[]`.
- MCP tool `x_download_media` có schema input `{ postUrl: string, platform?: string, quality?: 'highest' | 'lowest' | 'all' }`.

**Never:**
- KHÔNG yêu cầu ffmpeg hay external binary để trích xuất URL và metadata (metadata-first extraction).
- KHÔNG phá vỡ cấu trúc của `src/scrapers/social/twitter/normalize-media.js` (re-export hoặc delegate).
- KHÔNG throw unhandled khi 1 variant bị thiếu thuộc tính — fallback an toàn về thumbnail hoặc raw URL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Twitter Video nhiều bitrate | Post chứa 3 variants MP4 (320k, 832k, 2176k) | Chọn variant 2176k làm `url`, `variants` chứa đủ 3 | Fallback HLS nếu không có MP4 |
| Twitter Photo đơn | Post chứa 1 photo | URL đuôi `?format=jpg&name=orig`, type `'photo'` | N/A |
| Bluesky Images Embed | Record có `app.bsky.embed.images` 3 ảnh | Trả về 3 MediaObject type `'photo'` kèm fullsize URL | N/A |
| Mastodon Audio Post | Status có media_attachment type `'audio'` | MediaObject type `'audio'`, durationMs, url MP3/OGG | N/A |
| Threads Carousel Album | Post có carousel_media 5 ảnh | MediaObject type `'carousel'`, chứa items con hoặc tách 5 MediaObjects | N/A |
| TikTok Video + Audio | Video payload có play_addr và music | 1 video MediaObject + 1 audio MediaObject (track) | N/A |
| URL không hợp lệ | postUrl = "invalid-url" | Throw `XACT_4001` với suggestedAction | InvalidArgs envelope |
| MCP tool x_download_media | `{ postUrl: "https://x.com/...", platform: "twitter" }` | Trả về `{ success: true, media: MediaObject[], count }` | Standard envelope |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/media-pipeline.js` — File MỚI: `UniversalMediaPipeline`, các adapters (`extractTwitterMedia`, `extractBlueskyMedia`, `extractMastodonMedia`, `extractThreadsMedia`, `extractFacebookMedia`, `extractTikTokMedia`), helper `selectBestVariant`.
- `src/scrapers/social/twitter/normalize-media.js` — Kế thừa/tái sử dụng logic parse media của Twitter.
- `src/scrapers/videoDownloader.js` — Cập nhật module để export API `downloadMedia` sử dụng pipeline.
- `src/mcp/local-tools.js` & `src/mcp/server.js` — Đăng ký công cụ `x_download_media`.
- `src/scrapers/index.js` — Export `UniversalMediaPipeline`, `extractMedia`.

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/media-pipeline.js` — Tạo class `UniversalMediaPipeline` với adapters cho 6 nền tảng (Twitter, Bluesky, Mastodon, Threads, Facebook, TikTok)
- [x] `src/scrapers/videoDownloader.js` — Module hóa export `downloadMedia(postUrl, options)` ủy quyền tới `UniversalMediaPipeline`
- [x] `src/scrapers/index.js` — Re-export `UniversalMediaPipeline` và `extractMedia`
- [x] `src/mcp/local-tools.js` & `src/mcp/server.js` — Thêm MCP tool `x_download_media` (schema + handler)
- [x] `tests/scrapers/social/media-pipeline.test.js` — Unit test cho từng adapter, variant selection, audio/carousel extraction, và MCP tool

**Acceptance Criteria:**
- Given video post Twitter với nhiều bitrate MP4, when `extractMedia` chạy, then chọn URL có bitrate cao nhất làm primary URL và giữ đủ mảng variants.
- Given Bluesky post với ảnh và Threads post với carousel, when `extractMedia` chạy, then trích xuất đúng danh sách media objects với kích thước và type chuẩn.
- Given post chứa file âm thanh (Mastodon audio hoặc TikTok sound), when `extractMedia` chạy, then tạo `MediaObject` với `type: 'audio'`.
- Given lệnh gọi MCP tool `x_download_media` với URL bài viết, when thực thi, then trả về danh sách `MediaObject[]` đầy đủ thông tin tải về.

## Implementation Notes

- Implemented `UniversalMediaPipeline` in `src/scrapers/social/media-pipeline.js` defining a unified `MediaObject` contract with support for photos, videos (highest bitrate MP4 selection + HLS/DASH fallback), audio tracks/spaces, and carousel albums.
- Integrated per-platform media extraction adapters for Twitter, Bluesky, Mastodon, Threads, Facebook, and TikTok.
- Created `src/scrapers/videoDownloader.js` exporting `downloadMedia()` delegating to `extractMedia()`.
- Exposed `x_download_media` MCP tool in both `src/mcp/local-tools.js` and `src/mcp/server.js`.
- Re-exported `UniversalMediaPipeline` and `extractMedia` in `src/scrapers/index.js`.
- Authored 14 comprehensive tests in `tests/scrapers/social/media-pipeline.test.js` covering all platform adapters and MCP tool calls. All 14/14 tests passing.

## Spec Change Log

## Review Triage Log

- **patch / low** — Fixed `downloadMedia` call signature to forward `options.post` and `options.rawData` to `extractMedia`.
- **verified** — 14/14 tests in `media-pipeline.test.js` passing. Full suite 47/47 passing across all epics.
