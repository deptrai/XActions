# Epic 23 Retrospective: Bluesky & Mastodon on AbstractCrawler

Status: done  
Date: 2026-09-08

## Summary

Epic 23 port **Bluesky (AT Protocol) và Mastodon** sang hybrid `AbstractCrawler` architecture. Đây là epic cuối cùng trong wave social platform expansion trước khi sang Epic 21/22/33 VN market pivot.

Epic complete across six stories:

| Story | Status | Outcome |
|---|---|---|
| 23.1 Bluesky AT Protocol Client | done | `BlueskyClient` |
| 23.2 Bluesky Hybrid Crawler | done | `BlueskyCrawler` |
| 23.3 Mastodon REST API Client | done | `MastodonClient` |
| 23.4 Mastodon Hybrid Crawler | done | `MastodonCrawler` |
| 23.5 Bluesky & Mastodon Response Validators | done | `BlueskyResponseValidator`, `MastodonResponseValidator` |
| 23.6 Bluesky & Mastodon Integration Caller Migration | done | `src/scrapers/index.js` dispatcher aliases, E2E verified |

Final verification: **23.6 integration & caller migration verified end-to-end on live dashboard** (Mastodon profile/trending, Bluesky profile/trending). Dispatcher tests pass.

## What Went Well

1. **AT Protocol chuẩn hóa tốt**
   - Bluesky có public API rõ ràng.
   - `com.atproto.*` và `app.bsky.*` endpoints.

2. **Mastodon REST đơn giản**
   - Mastodon API là standard REST.
   - OAuth2 auth.

3. **Response validators platform-specific**
   - `BlueskyResponseValidator` check `isBotChallenge` không cần thiết lắm nhưng được standardize.
   - `MastodonResponseValidator` handle 4xx/5xx.

4. **Integration caller migration smooth**
   - `bluesky`, `mastodon` aliases trong `src/scrapers/index.js`.
   - No major conflicts.

## What Was Difficult

1. **Integration caller dispatch edge cases**
   - `tests/scrapers/social/bluesky/dispatcher.test.js` với fake proxy pool.
   - `ECONNREFUSED 127.0.0.1:8888` do `_hasExplicitProxy` gate sai.
   - Fixed bằng `_requiresProxyExplicit` semantics trong commit `34925195`.

2. **Mastodon local URL test**
   - `MastodonClient` computed `requiresProxy` từ `isLocalUrl(baseUrl)`.
   - Truyền vào `super()` làm nó thành explicit, disable proxy.
   - Fixed trong commit `34925195`.

3. **Type declarations**
   - `types/index.d.ts` cần cập nhật cho Bluesky/Mastodon client types.

## Key Decisions

1. **Bluesky + Mastodon dùng API client thuần**
   - Không cần browser vì API public.
   - `AbstractApiClient` với `got`/`undici`.

2. **Bluesky dùng `handle` làm author**
   - `authorId` là `did` hoặc `handle`.

3. **Mastodon dùng `acct` làm author**
   - `authorId` là `@username@instance`.

## Follow-up Recommendations

1. **Bluesky firehose (Jetstream)**
   - Real-time streaming chưa có.
   - Có thể implement trong Epic 29.

2. **Mastodon federation search**
   - Cross-instance search.

3. **MCP tools cho Bluesky/Mastodon**
   - Hiện chưa có dedicated MCP tools.

## Final State

- Epic 23 status: **done**
- All six stories: **done**
- Retrospective: **done**
- E2E verified on live dashboard
