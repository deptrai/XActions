---
title: 'Story 33.1: Zalo OA & Public Content Crawler'
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

**Problem:** Nowing AI cần dữ liệu từ Zalo — nền tảng messaging lớn nhất VN — để phát hiện doanh nghiệp VN hoạt động trên Zalo OA và Zalo Marketplace.

**Approach:**
1. Tạo `ZaloCrawler` tại `src/scrapers/social/zalo/index.js` kế thừa `AbstractCrawler`.
2. Implement `client.js` kế thừa `AbstractApiClient` gọi Zalo OA API v3 (`openapi.zalo.me`) với `accessToken` từ `AccountPool`.
3. Hỗ trợ actions: `oa_posts`, `oa_followers`, `oa_detail`, `marketplace_search`.
4. Chuẩn hóa `PostItem` với `platform: 'zalo'`, `category: 'social'`.
5. Publish `ThinEvent` tới Redis Stream.
6. Dispatch alias: `zalo`, `zalo_oa`.

## Boundaries & Constraints

**Always:**
- Chỉ dùng Zalo OA API chính thức (`openapi.zalo.me`).
- Access token quản lý trong `AccountPool` với prefix `zalo:oa:`.
- Tuân thủ AD-22/NFR-19 (VN proxy + locale `vi-VN`).
- Rate limit theo Zalo OA API quota (kiểm tra Zalo docs).

**Ask First:**
- Nếu cần Zalo personal data (tin nhắn cá nhân).
- Nếu cần thêm platform Zalo Mini App.

**Never:**
- Không scrape Zalo cá nhân (gRPC/protobuf) — vi phạm ToS.
- Không lưu `accessToken` plain-text trong DB.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| OA posts | `scrape('zalo','oa_posts',{oaId:'12345'})` | `PostItem[]` | Invalid token → `auth_expired` |
| OA followers | `scrape('zalo','oa_followers',{oaId:'12345'})` | `ProfileItem[]` | Rate limit → `rate_limit` |
| Marketplace search | `scrape('zalo','marketplace_search',{query:'điện thoại'})` | `PostItem[]` listings | Empty → `[]` |
| Token expired | OA API 401 | Rotate account → retry | `XACT_4003` |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/zalo/index.js` — `ZaloCrawler`
- `src/scrapers/social/zalo/client.js` — `ZaloClient` extends `AbstractApiClient`
- `src/scrapers/social/zalo/validator.js` — `ZaloPlatformResponseValidator`
- `src/scrapers/index.js` — dispatcher alias
- `tests/scrapers/social/zalo/`

## Prerequisites

- `YOUTUBE_API_KEY` / `ZALO_OA_ACCESS_TOKEN` cần được set trước khi dev.
- Zalo Business account để lấy OA `accessToken`.
