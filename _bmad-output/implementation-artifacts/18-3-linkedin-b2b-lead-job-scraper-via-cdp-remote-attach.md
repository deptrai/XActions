---
story_id: "18.3"
epic: 18
story_key: "18-3-linkedin-b2b-lead-job-scraper-via-cdp-remote-attach"
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T09:00:00Z
owner: "DEV"
reviewed: "Pending"
baseline_commit: "322c874d"
---

# Story 18.3: LinkedIn B2B Lead & Job Scraper via CDP Remote Attach

Status: ready-for-dev

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/recruitment/linkedin/crawler.js` and `AbstractApiClient` in `src/scrapers/recruitment/linkedin/client.js`.
   - Must provide `LinkedInPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/recruitment/linkedin/validator.js`.
   - Must expose clean barrel in `src/scrapers/recruitment/linkedin/index.js` and integrate into `src/scrapers/index.js` (`scrape('linkedin', ...)`).
2. **Dual-Mode Hybrid Strategy (CDP Remote Attach & Public Guest API):**
   - **Mode 1 (HTTP Guest API):** Public jobs search endpoint (`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`) and job detail endpoint (`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}`) for fast, headless job scraping without login.
   - **Mode 2 (CDP Remote Attach):** Connect to the user's existing Chrome session via Chrome DevTools Protocol (`src/core/cdp-launcher.js`, default port 9222 from Story 12.2) for authenticated B2B lead profiles, company headcount insights, and protected views.
3. **Anti-Detection & Humanized Safety Guardrails:**
   - Gaussian delay distribution with jitter (3–7s floor) via `gaussianDelay` (`src/utils/gaussian-delay.js`).
   - Active checkpoint & security challenge detection: detect `/checkpoint/challenge`, security verification screens, 429 rate limit or auth walls.
   - Circuit breaker and session health checks: if checkpoint is hit in CDP mode, pause immediately and emit `PlatformError` with code `XACT_4030` (`ErrorTypes.BOT_CHALLENGE`).
4. **Data Normalization & Namespaced Models:**
   - Job postings normalized as `PostItem` (`id: linkedin:job:<jobId>`, `platform: 'linkedin'`, `category: 'recruitment'`).
   - Company profiles & B2B leads normalized as `ProfileItem` (`id: linkedin:company:<companySlug>` or `id: linkedin:lead:<profileSlug>`, `platform: 'linkedin'`).
   - Schema validation via `schemas/recruitment/job.json` and storage in `PrismaStore.storeBatch()`.
5. **Zero Mocks Testing (AD-10):**
   - Tests in `tests/scrapers/recruitment/linkedin/crawler-linkedin.test.js` using local `node:http` mock servers returning realistic LinkedIn guest HTML/DOM and CDP interaction responses.

## Story

As a **B2B Growth Marketer & Talent Sourcing Lead**,  
I want **cào tin tuyển dụng, hồ sơ công ty và thông tin nhân sự chủ chốt (B2B leads) từ LinkedIn qua `LinkedInCrawler` và `LinkedInClient` hỗ trợ cả Public Guest API lẫn CDP Remote Attach**,  
So that **tôi có thể thu thập dữ liệu tuyển dụng và lead B2B chất lượng cao mà không bị khóa tài khoản hoặc dính bot challenge.**

## Scope Note

Story 18.3 hoàn thành mảnh ghép cuối cùng của Epic 18 (HR & B2B Recruitment Crawlers).

- **Trong phạm vi Story 18.3:**
  - `src/scrapers/recruitment/linkedin/client.js`: `LinkedInClient` hỗ trợ HTTP request tới Guest Jobs API và tương tác qua CDP Page Session khi cần authenticated scraping.
  - `src/scrapers/recruitment/linkedin/crawler.js`: `LinkedInCrawler` đăng ký 4 actions:
    1. `search_jobs`: Tìm kiếm việc làm qua Public Guest API (keyword, location, pagination) hoặc CDP.
    2. `job_detail`: Bóc tách chi tiết JD, yêu cầu kỹ năng, cấp bậc (seniority), loại hình công việc (employment type).
    3. `company_profile`: Bóc tách thông tin công ty, quy mô nhân sự, ngành nghề, website.
    4. `lead_profile`: Bóc tách thông tin hồ sơ nhân sự (tên, chức danh, công ty hiện tại, địa điểm) qua CDP Attach.
  - `src/scrapers/recruitment/linkedin/normalize-linkedin.js`: Parser bóc tách dữ liệu việc làm, kỹ năng, lương (nếu có), kinh nghiệm, thông tin công ty và B2B lead.
  - `src/scrapers/recruitment/linkedin/validator.js`: Kiểm tra rate limit (429), auth wall / login redirect, và checkpoint challenge (`/checkpoint/challenge`).
  - `src/scrapers/recruitment/linkedin/index.js`: Barrel xuất `LinkedInCrawler`, `LinkedInClient`, `scrapeLinkedIn`.
  - `src/scrapers/index.js`: Đăng ký `linkedin` vào unified `scrape()` dispatcher.
  - `package.json`: Export `./scrapers/recruitment/linkedin`.
  - `tests/scrapers/recruitment/linkedin/crawler-linkedin.test.js`: Suite test đầy đủ red-phase ATDD.

- **Ngoài phạm vi:**
  - Tự động hóa gửi tin nhắn InMail hoặc connect tự động (thuộc automation workflows sau).
  - Thay đổi schema Prisma.

## Acceptance Criteria

### AC-1: Action Registry & Crawler Contract
- **Given** `LinkedInCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/recruitment/linkedin/crawler.js`
- **When** gọi `crawler.listActions()`
- **Then** đăng ký đầy đủ 4 action với đúng `ActionDescriptor`:

| action | category | requiredArgs | optionalArgs | requiresAuth |
|---|---|---|---|---|
| `search_jobs` | `recruitment` | `['keyword']` | `['location', 'start', 'limit', 'useCdp']` | `false` |
| `job_detail` | `recruitment` | `['jobId']` | `['jobUrl', 'useCdp']` | `false` |
| `company_profile` | `recruitment` | `['companySlug']` | `['companyUrl', 'useCdp']` | `false` |
| `lead_profile` | `recruitment` | `['profileUrl']` | `['profileSlug', 'cdpPort']` | `true` |

### AC-2: Public Guest Job Search & Normalization
- **Given** gọi `crawler.start({ action: 'search_jobs', args: { keyword: 'Software Engineer', location: 'Vietnam', limit: 10 } })`
- **When** `LinkedInClient` thực thi HTTP GET tới `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
- **Then** bóc tách danh sách việc làm trả về `{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }`.
- **And** mỗi job chuẩn hóa thành `PostItem` với `id: 'linkedin:job:<jobId>'`, `category: 'recruitment'`, `metadata.title`, `metadata.companyName`, `metadata.location`, `metadata.postedAt`.

### AC-3: Job Detail & Criteria Extraction
- **Given** gọi `crawler.start({ action: 'job_detail', args: { jobId: '3892104910' } })`
- **When** fetch `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/3892104910`
- **Then** bóc tách đầy đủ: `title`, `companyName`, `companyUrl`, `location`, `description`, `employmentType`, `seniorityLevel`, `skills`.

### AC-4: Company Profile & B2B Lead Extraction via CDP
- **Given** gọi `crawler.start({ action: 'company_profile', args: { companySlug: 'microsoft' } })`
- **Then** trích xuất `ProfileItem` (`id: 'linkedin:company:microsoft'`, `name`, `industry`, `scale`, `website`, `location`).
- **And** action `lead_profile` kết nối CDP remote attach (port 9222) trích xuất `ProfileItem` (`id: 'linkedin:lead:<slug>'`, `name`, `bio` / headline, `location`, `companyName`, `title`).
- **And** áp dụng Gaussian jitter (3–7s) an toàn khi duyệt trang.

### AC-5: Unified `scrape("linkedin", ...)` Dispatcher & Package Exports
- **Given** `scrape('linkedin', 'search_jobs', { keyword: 'Fullstack' })`
- **When** gọi từ `src/scrapers/index.js`
- **Then** khởi tạo `LinkedInCrawler` và trả về kết quả chuẩn hóa `jobs`.
- **And** `package.json` export `./scrapers/recruitment/linkedin`.

### AC-6: No-Mocks Integration Test Suite
- **Given** `tests/scrapers/recruitment/linkedin/crawler-linkedin.test.js`
- **When** chạy `npx vitest run tests/scrapers/recruitment/linkedin/crawler-linkedin.test.js`
- **Then** toàn bộ test cases (search_jobs, job_detail, company_profile, lead_profile, validator, dispatcher) đều PASS 100%.

## Tasks / Subtasks

- [ ] **Task 1 — Core Module Scaffolding (AC-1, AC-5)**
  - [ ] 1.1 Tạo thư mục `src/scrapers/recruitment/linkedin/`.
  - [ ] 1.2 Tạo `client.js` — `LinkedInClient` kế thừa `AbstractApiClient` hỗ trợ HTTP Guest + CDP session.
  - [ ] 1.3 Tạo `validator.js` — `LinkedInPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [ ] 1.4 Tạo `crawler.js` — `LinkedInCrawler` kế thừa `AbstractCrawler` với 4 action descriptors.
  - [ ] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeLinkedIn`.
  - [ ] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [ ] **Task 2 — Normalizer & Parsing Engine (AC-2, AC-3, AC-4)**
  - [ ] 2.1 Tạo `src/scrapers/recruitment/linkedin/normalize-linkedin.js`.
  - [ ] 2.2 Viết `parseLinkedInJobCard(htmlChunk)` bóc tách jobId, title, company, location.
  - [ ] 2.3 Viết `parseLinkedInJobDetail(html)` bóc tách description, criteria, skills.
  - [ ] 2.4 Viết `normalizeLinkedInCompany(obj)` → `ProfileItem`.
  - [ ] 2.5 Viết `normalizeLinkedInLead(obj)` → `ProfileItem`.

- [ ] **Task 3 — Crawler Action Handlers (AC-2, AC-3, AC-4)**
  - [ ] 3.1 Cài đặt `searchJobs(args, session)` — gọi Guest Jobs search API với pagination (`start=0, 25, 50...`).
  - [ ] 3.2 Cài đặt `jobDetail(args, session)` — bóc tách chi tiết JD.
  - [ ] 3.3 Cài đặt `companyProfile(args, session)` — bóc tách thông tin công ty.
  - [ ] 3.4 Cài đặt `leadProfile(args, session)` — kết nối CDP remote attach với Gaussian delay (3–7s).
  - [ ] 3.5 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [ ] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [ ] 4.1 Cài đặt `LinkedInPlatformResponseValidator.isBotChallenge` phát hiện `/checkpoint/challenge`, authwall, 429.
  - [ ] 4.2 Cài đặt `isValidPayload` kiểm tra HTML job card hoặc JSON response.

- [ ] **Task 5 — Test Suite & Verification (AC-6)**
  - [ ] 5.1 Tạo `tests/scrapers/recruitment/linkedin/crawler-linkedin.test.js` dùng `node:http`.
  - [ ] 5.2 Test search_jobs, job_detail, company_profile, lead_profile, unified dispatcher.
  - [ ] 5.3 Chạy test suite và xác nhận 100% green.

## Dev Notes
- Guest Search Endpoint: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<keyword>&location=<location>&start=<offset>`
- Guest Detail Endpoint: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>`
- CDP Remote Attach: Sử dụng `attachToExistingChrome({ port: 9222 })` từ `src/core/cdp-launcher.js`.
- Gaussian Delays: Sử dụng `gaussianDelay(3000, 7000)` từ `src/utils/gaussian-delay.js`.
EOF