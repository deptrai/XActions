# Epic 18 Retrospective: HR & B2B Recruitment Crawlers (TopCV, VietnamWorks & LinkedIn)

Status: done  
Date: 2026-09-08

## Summary

Epic 18 implement **job/recruitment scrapers** cho TopCV, VietnamWorks và LinkedIn — phục vụ B2B recruitment lead generation.

Epic complete across three stories:

| Story | Status | Outcome |
|---|---|---|
| 18.1 TopCV Job/Company Scraper | done | `TopCVCrawler` |
| 18.2 VietnamWorks Job Scraper | done | `VietnamWorksCrawler` |
| 18.3 LinkedIn B2B Lead & Job Scraper via CDP Remote Attach | done | `LinkedInCrawler` via CDP attach |

## What Went Well

1. **TopCV + VietnamWorks dễ scrape**
   - Server-side rendered HTML.
   - `cheerio` parse ổn.

2. **LinkedIn CDP attach**
   - Reuse Epic 12 CDP remote attach.
   - Login qua existing Chrome profile.

## What Was Difficult

1. **LinkedIn anti-bot nặng**
   - LinkedIn rate limit và bot detection rất nhanh.
   - CDP attach + real profile là cách hiệu quả nhất.

2. **TopCV/VietnamWorks API rate limit**
   - Mặc dù HTML dễ parse, nhưng request nhanh bị chặn.
   - Cần proxy + delay.

## Key Decisions

1. **LinkedIn dùng CDP attach**
   - Không dùng HTTP client.
   - Attach vào real Chrome profile.

2. **TopCV/VietnamWorks dùng hybrid HTTP**
   - Cheerio parse, không cần browser.

## Follow-up Recommendations

1. **LinkedIn real profile test**
   - Cần real CDP session để verify.

2. **TopCV/VietnamWorks skill extraction**
   - Extract skills từ job descriptions.

## Final State

- Epic 18 status: **done**
- All three stories: **done**
- Retrospective: **done**
