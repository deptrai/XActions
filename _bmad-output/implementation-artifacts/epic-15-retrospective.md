# Epic 15 Retrospective: Vietnam Viral Social — Threads & TikTok Scraper Engine

Status: done  
Date: 2026-09-08

## Summary

Epic 15 implement **Threads và TikTok scrapers** dựa trên hybrid architecture từ Epic 13.

Epic complete across:

| Story | Status | Outcome |
|---|---|---|
| 15.1 Threads Scraper (Meta internal GraphQL) | done | `ThreadsClient` + `ThreadsCrawler` |
| 15.1.1 Threads Hybrid Profile/Followers/Following | done | Profile scrape |
| 15.1.2 Threads Post Detail & Comment Tree | done | Post + comments |
| 15.1.3 Threads DocID Hardening + Search/Comments | done | Search, comment extraction |
| 15.1.4 Threads Integration Package Exports | done | `src/scrapers/index.js` aliases |
| 15.2 TikTok Video/Hashtag/Comment Scraper | done | `TikTokCrawler` |

## What Went Well

1. **Threads internal GraphQL reverse**
   - `doc_id` based queries.
   - `lsd` token extraction.

2. **Sub-stories 15.1.1-15.1.4**
   - Profile, post, comments, search, package exports.
   - Mỗi sub-story done qua worktree.

3. **TikTok scraper**
   - Video, hashtag, comments extraction.
   - TLS spoofing (nếu cần) cho TikTok anti-bot.

## What Was Difficult

1. **Threads doc_id thay đổi**
   - Meta thay `doc_id` frequently.
   - 15.1.3 hardening giải quyết phần nào.

2. **TikTok anti-bot mạnh**
   - TLS/JA4 fingerprint detection.
   - Cần `got-scraping` hoặc headless browser.

3. **Threads proxy gating**
   - `requiresProxy` computed từ `isLocalUrl(baseUrl)`.
   - Từng có bug khi pass computed value vào `super()` — fixed trong Epic 23.6 gần đây.

## Key Decisions

1. **Threads dùng doc_id, không dùng public API**
   - Internal GraphQL endpoints.
   - Cần update doc_id khi fail.

2. **TikTok dùng hybrid HTTP + TLS spoofing**
   - Phù hợp với platform nặng anti-bot.

## Follow-up Recommendations

1. **Threads doc_id canary**
   - Monitor khi `doc_id` fail.
   - Auto-update doc_id từ HTML.

2. **TikTok real account test**
   - Test với real cookies.

## Final State

- Epic 15 status: **done**
- All stories: **done**
- Retrospective: **done**
