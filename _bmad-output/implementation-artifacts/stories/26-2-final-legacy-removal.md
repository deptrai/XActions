---
epic: 26
story: 26.2
title: Final Legacy Removal (Scraper.js & Standalone Scrapers)
status: done
date: 09-13-2026
retro_date: 09-21-2026
---

# Story 26.2: Final Legacy Removal

## Intent
Thực thi giai đoạn cuối của kế hoạch decommission (Epic 26): xóa bỏ vĩnh viễn các module scraper độc lập legacy đã được thay thế hoàn toàn bởi hybrid crawlers (Epic 13, 15, 23).

## Deliverables
- Xóa 5 thư mục legacy: `src/scrapers/{twitter,facebook,threads,bluesky,mastodon}/`
- Xóa `src/client/Scraper.js` và tạo stub tương thích ngược trong `src/client/index.js` (266 dòng, @deprecated, delegate qua `scrape()`)
- Cập nhật `package.json` exports trỏ tới hybrid barrels (`src/scrapers/social/*`)
- Archive 51 test legacy sang `archive/tests/`
- Net code delta: −9.399 dòng qua 137 files (commit `ddc16c7c`)

## Accepted Deviations
- **Shadow-run 7 ngày field-level diff ≤1%** (AC gốc từ epics.md): được thay thế bằng fallback criterion #2 của `docs/deprecation-plan.md` — parity matrix khai báo 100% coverage + functional parity qua 91 test files pass (1.049 tests). Đã được chấp nhận trong retrospective Epic 26.
- **Scraper stub backward-compatibility**: class `Scraper` được giữ lại dưới dạng stub mỏng thay vì xóa sạch surface, đáp ứng NFR16 (không break caller hiện có). Các method không có tương đương trong hybrid crawler (`getLikedTweets`, `getListTweets`) ném lỗi rõ ràng kèm hướng dẫn migrate thay vì gọi sai action.

## Commit Evidence
- `ddc16c7c` — refactor(decommission): Final legacy removal — delete Scraper.js & standalone scrapers
- `e01d0ac1`, `0f9f4b8e` — review remediation passes
- `41429b19`, `4c8337f6` — retro remediation & verification
