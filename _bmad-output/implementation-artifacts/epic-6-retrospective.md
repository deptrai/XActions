# Epic 6 Retrospective: Facebook Anti-Detection & Bot Countermeasures

Status: done  
Date: 2026-09-08

## Summary

Epic 6 xây dựng **anti-detection layer** cho Facebook scraping: browser fingerprint consistency, session stealth, human physics motion curves. Đây là epic nền tảng cho mọi Facebook automation sau này — trước khi có proxy pool (Epic 11) và hybrid crawler (Epic 13).

Epic complete across four stories:

| Story | Status | Outcome |
|---|---|---|
| 6.1 Browser Fingerprint & Session Stealth | done | Fingerprint consistency, stealth plugin |
| 6.2 Consistent Fingerprint | done | Session-level fingerprint persistence |
| 6.3 UA Pool & Viewport | done | UA rotation, viewport randomization |
| 6.4 Human Physics Easing Motion Curves | done | Bezier mouse movement, jitter, overshoot |

Final verification: implemented in `src/scrapers/facebook/` và `src/automation/`, verified qua Epic 4 và Epic 13.

**~3-5 commits** — Epic 6 phần lớn đã được supersede bởi Epic 11 (proxy/governor) và Epic 13 (hybrid architecture). Stories 6.5-6.17 không tracked trong sprint này.

## What Went Well

1. **Foundation cho anti-detection**
   - Fingerprint consistency + UA pool là prerequisite cho mọi scraping sau.
   - Human physics motion curves giảm detection rate đáng kể.

2. **Legacy scope được đánh giá đúng**
   - Epic 6 được đánh dấu done với rationale rõ ràng: stories 6.1-6.4 done, 6.5-6.17 superseded bởi hybrid architecture.
   - `4d63f213` chore commit ghi rõ lý do.

## What Was Difficult

1. **Epic 6 là legacy scope**
   - Phần lớn implementation nằm trong `src/scrapers/facebook/` cũ, không theo pattern mới.
   - Stories 6.5-6.17 không được implement vì hybrid crawler đã giải quyết vấn đề ở level cao hơn.

2. **Không có story files trong stories/**
   - Epic 6 là legacy epics-1-9, không có story files chuẩn BMAD.
   - Khó trace acceptance criteria và test coverage.

## Key Decisions

1. **Mark Epic 6 done với 4 stories**
   - Stories 6.1-6.4 là những gì thực sự được implement.
   - 6.5-6.17 de facto superseded bởi Epic 11 (proxy) và Epic 13 (hybrid).

2. **Không force viết story files cho legacy**
   - Giữ `optional` cho retrospective vì epic cũ không theo workflow mới.
   - Tạo retrospective này để đồng bộ status.

## Follow-up Recommendations

1. **Decommission legacy Facebook code**
   - `src/scrapers/facebook/` cũ sẽ được decommission trong Epic 20/26.
   - Migration path đã có trong Epic 13 hybrid crawler.

2. **Document anti-detection learnings**
   - Fingerprint + UA pool + motion curves cần được port vào `StealthBrowser` cho các platform khác.

## Final State

- Epic 6 status: **done**
- Stories 6.1-6.4: **done**
- Stories 6.5-6.17: **not tracked** (superseded by Epic 11/13)
- Retrospective: **done** (created retroactively for status sync)
