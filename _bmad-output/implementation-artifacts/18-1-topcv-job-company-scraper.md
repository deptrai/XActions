---
story_id: "18.1"
epic: 18
story_key: "18-1-topcv-job-company-scraper"
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T07:00:00Z
owner: "DEV"
reviewed: "Pending"
baseline_commit: "513d35cd"
---

# Story 18.1: TopCV Job & Company Scraper

Status: ready-for-dev

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/recruitment/topcv/crawler.js` and `AbstractApiClient` in `src/scrapers/recruitment/topcv/client.js`.
   - Must provide `TopCvPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/recruitment/topcv/validator.js`.
   - Must expose clean barrel in `src/scrapers/recruitment/topcv/index.js` and integrate into `src/scrapers/index.js` (`scrape('topcv', ...)`).
2. **Vietnamese Market Specifics & Parsing Rigor:**
   - URL slug conversion for search keywords (e.g. "Lập trình viên Node.js" → `tim-viec-lam-lap-trinh-vien-nodejs`).
   - Strict Vietnamese salary parsing:
     - "Thương lượng", "Thoả thuận", "Negotiable" → `salaryMin: 0, salaryMax: 0, salaryCurrency: 'VND', isNegotiable: true`.
     - "15 - 25 triệu", "15-25tr", "15 - 25 triệu VND" → `salaryMin: 15000000, salaryMax: 25000000, salaryCurrency: 'VND'`.
     - "Tới 30 triệu" / "Lên đến 30 triệu" → `salaryMin: 0, salaryMax: 30000000`.
     - "Từ 20 triệu" → `salaryMin: 20000000, salaryMax: null`.
     - "$1000 - $2000" / "1000 - 2000 USD" → `salaryCurrency: 'USD'`.
   - Location parsing: City name, address, province codes (Hà Nội, TP.HCM, Đà Nẵng, v.v.).
3. **Data Normalization & Namespaced Models:**
   - Every job post normalized as `PostItem` (`id: topcv:job:<jobId>`, `platform: 'topcv'`, `category: 'recruitment'`).
   - Every company/employer normalized as `ProfileItem` (`id: topcv:company:<companyId>`, `platform: 'topcv'`).
   - Schema validation via `schemas/recruitment/job.json` and `PrismaStore.storeBatch()`.
4. **Zero Mocks Testing (AD-10):**
   - Tests in `tests/scrapers/recruitment/topcv/crawler-topcv.test.js` using local `node:http` server returning realistic HTML/DOM responses.

## Story

As an **HR Tech Recruiter & Talent Intelligence Analyst**,  
I want **cào tin tuyển dụng, dải lương, kỹ năng yêu cầu và hồ sơ công ty từ TopCV Việt Nam qua `TopCvCrawler` và `TopCvClient`**,  
So that **tôi có thể phân tích xu hướng tuyển dụng IT, tài chính, mức lương thị trường và phát hiện cơ hội tuyển dụng/lead B2B theo thời gian thực.**

## Scope Note

Story 18.1 thiết lập crawler tuyển dụng đầu tiên cho thị trường Việt Nam trong Epic 18.

- **Trong phạm vi Story 18.1:**
  - `src/scrapers/recruitment/topcv/client.js`: `TopCvClient` gửi HTTP requests với User-Agent rotation, proxy support, xử lý redirect và URL slug encoding tiếng Việt.
  - `src/scrapers/recruitment/topcv/crawler.js`: `TopCvCrawler` đăng ký 3 actions:
    1. `search_jobs`: Tìm kiếm việc làm theo keyword, city/location, salary level, experience, pagination.
    2. `job_detail`: Bóc tách chi tiết JD, yêu cầu ứng viên, quyền lợi, địa điểm, hạn nộp hồ sơ.
    3. `company_detail`: Bóc tách thông tin công ty, quy mô, địa chỉ, danh sách việc làm đang mở.
  - `src/scrapers/recruitment/topcv/normalize-job.js`: Parser bóc tách dải lương tiếng Việt, kỹ năng, số năm kinh nghiệm, hình thức làm việc (`full_time`, `part_time`, `intern`, `remote`, `contract`).
  - `src/scrapers/recruitment/topcv/validator.js`: Kiểm tra Cloudflare challenge, Captcha, IP ban, cấu trúc HTML trả về.
  - `src/scrapers/recruitment/topcv/index.js`: Barrel xuất `TopCvCrawler`, `TopCvClient`, `scrapeTopCv`.
  - `src/scrapers/index.js`: Đăng ký `topcv` vào unified `scrape()` dispatcher.
  - `schemas/recruitment/job.json`: Schema JSON Schema chuẩn hóa cho domain recruitment.
  - `package.json`: Export `./scrapers/recruitment/topcv`.
  - `tests/scrapers/recruitment/topcv/crawler-topcv.test.js`: Suite test đầy đủ red-phase ATDD.

- **Ngoài phạm vi:**
  - VietnamWorks (thuộc Story 18.2).
  - LinkedIn CDP attach (thuộc Story 18.3).

## Acceptance Criteria

### AC-1: Action Registry & Crawler Contract
- **Given** `TopCvCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/recruitment/topcv/crawler.js`
- **When** gọi `crawler.listActions()`
- **Then** đăng ký đầy đủ 3 action với đúng `ActionDescriptor`:

| action | category | requiredArgs | optionalArgs | requiresAuth |
|---|---|---|---|---|
| `search_jobs` | `recruitment` | `['keyword']` | `['city', 'salary', 'exp', 'page', 'limit']` | `false` |
| `job_detail` | `recruitment` | `['jobUrl']` hoặc `['jobId']` | `[]` | `false` |
| `company_detail` | `recruitment` | `['companyUrl']` hoặc `['companyId']` | `[]` | `false` |

### AC-2: Search Jobs & Slug Normalization
- **Given** gọi `crawler.start({ action: 'search_jobs', args: { keyword: 'NodeJS Developer', city: 'hanoi' } })`
- **When** `TopCvClient` thực thi HTTP GET
- **Then** keyword tiếng Việt có dấu được normalize thành URL slug an toàn (e.g. `tim-viec-lam-nodejs-developer`).
- **And** kết quả trả về `{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }`.
- **And** mỗi job có `id: 'topcv:job:<jobId>'`, `category: 'recruitment'`, `metadata.salaryMin`, `metadata.salaryMax`, `metadata.salaryCurrency`, `metadata.companyName`, `metadata.location`.

### AC-3: Vietnamese Salary & Requirement Parsing
- **Given** text lương thô từ TopCV HTML
- **When** qua hàm `parseVietnameseSalary(rawSalary)`
- **Then** trích xuất chính xác dải lương dạng số nguyên (`VND` hoặc `USD`):
  - `"Thương lượng"` → `salaryMin: 0, salaryMax: 0, isNegotiable: true`
  - `"15 - 25 triệu"` → `salaryMin: 15000000, salaryMax: 25000000, isNegotiable: false`
  - `"Tới 40 triệu"` → `salaryMin: 0, salaryMax: 40000000, isNegotiable: false`
  - `"Từ 20 triệu"` → `salaryMin: 20000000, salaryMax: null, isNegotiable: false`
  - `"1,000 - 2,500 USD"` → `salaryMin: 1000, salaryMax: 2500, salaryCurrency: 'USD'`
- **And** trích xuất số năm kinh nghiệm từ tag/mô tả (e.g. `"2 năm" -> experienceYears: 2`).

### AC-4: Job Detail & Company Extraction
- **Given** gọi `crawler.start({ action: 'job_detail', args: { jobId: '123456' } })` hoặc URL
- **When** bóc tách trang chi tiết JD
- **Then** trích xuất đầy đủ: `title`, `companyName`, `companyUrl`, `description` (Mô tả công việc), `requirements` (Yêu cầu ứng viên), `benefits` (Quyền lợi), `deadline` (Hạn nộp), `location`, `skills` (tags).
- **And** action `company_detail` trích xuất `ProfileItem` (`id: 'topcv:company:<companyId>'`, `name`, `website`, `scale`, `address`, `bio`, `openJobsCount`).

### AC-5: Unified `scrape("topcv", ...)` Dispatcher & Package Exports
- **Given** `scrape('topcv', 'search_jobs', { keyword: 'Python' })`
- **When** gọi từ `src/scrapers/index.js`
- **Then** khởi tạo `TopCvCrawler` và trả về kết quả chuẩn hóa `jobs`.
- **And** `package.json` export `./scrapers/recruitment/topcv`.

### AC-6: No-Mocks Integration Test Suite
- **Given** `tests/scrapers/recruitment/topcv/crawler-topcv.test.js`
- **When** chạy `npx vitest run tests/scrapers/recruitment/topcv/crawler-topcv.test.js`
- **Then** toàn bộ test cases (search, salary parsing, job detail, company detail, anti-bot challenge validation, unified dispatcher) đều PASS 100%.

## Tasks / Subtasks

- [ ] **Task 1 — Core Module Scaffolding (AC-1, AC-5)**
  - [ ] 1.1 Tạo thư mục `src/scrapers/recruitment/topcv/` và schema `schemas/recruitment/job.json`.
  - [ ] 1.2 Tạo `client.js` — `TopCvClient` kế thừa `AbstractApiClient`.
  - [ ] 1.3 Tạo `validator.js` — `TopCvPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [ ] 1.4 Tạo `crawler.js` — `TopCvCrawler` kế thừa `AbstractCrawler` với 3 action descriptors.
  - [ ] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeTopCv`.
  - [ ] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [ ] **Task 2 — Normalizer & Vietnamese Parsing Engine (AC-2, AC-3)**
  - [ ] 2.1 Tạo `src/scrapers/recruitment/topcv/normalize-job.js`.
  - [ ] 2.2 Viết `normalizeKeywordToSlug(keyword)` chuyển đổi tiếng Việt thành URL slug.
  - [ ] 2.3 Viết `parseVietnameseSalary(salaryText)` phân tích dải lương triệu/k/USD/thỏa thuận.
  - [ ] 2.4 Viết `parseExperienceYears(expText)` và `mapEmploymentType(typeText)`.
  - [ ] 2.5 Viết `normalizeTopCvJobPost(htmlOrObj)` → `PostItem` với metadata recruitment.
  - [ ] 2.6 Viết `normalizeTopCvCompany(htmlOrObj)` → `ProfileItem`.

- [ ] **Task 3 — Crawler Action Handlers (AC-2, AC-4)**
  - [ ] 3.1 Cài đặt `searchJobs(args, session)` — bóc tách danh sách việc làm & pagination từ HTML.
  - [ ] 3.2 Cài đặt `jobDetail(args, session)` — bóc tách chi tiết JD, quyền lợi, yêu cầu.
  - [ ] 3.3 Cài đặt `companyDetail(args, session)` — bóc tách hồ sơ công ty.
  - [ ] 3.4 Tích hợp `storeBatch()` với `PrismaStore` và emit checkpoint.

- [ ] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [ ] 4.1 Cài đặt `TopCvPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare, Capmonster, Captcha.
  - [ ] 4.2 Cài đặt `TopCvPlatformResponseValidator.isRateLimit` phát hiện mã lỗi 429 hoặc rate limit page.
  - [ ] 4.3 Cài đặt `isValidPayload` kiểm tra HTML chứa DOM elements hợp lệ của TopCV.

- [ ] **Task 5 — Test Suite & Verification (AC-6)**
  - [ ] 5.1 Tạo `tests/scrapers/recruitment/topcv/crawler-topcv.test.js` dùng `node:http`.
  - [ ] 5.2 Test salary parser với 15+ biến thể mức lương thực tế.
  - [ ] 5.3 Test search_jobs, job_detail, company_detail, dispatcher end-to-end.
  - [ ] 5.4 Chạy test suite và xác nhận 100% green.

## Dev Notes
- Base URL TopCV: `https://www.topcv.vn`
- HTML Selector gợi ý:
  - Search list item: `.job-item-search-result`, `.job-item-2`, `div[data-job-id]`
  - Job title & URL: `.title a`, `h3.title a`
  - Company: `.company-name`, `a.company`
  - Salary: `.salary`, `.job-salary`
  - Location: `.address`, `.location`
- Cheerio (hoặc parse regex/DOM) sẵn có trong Node.js ecosystem (dùng `jsdom` hoặc parsing regex / HTML text stream nhẹ nhàng).
