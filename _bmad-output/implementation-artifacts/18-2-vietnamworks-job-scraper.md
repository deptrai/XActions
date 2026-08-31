---
story_id: "18.2"
epic: 18
story_key: "18-2-vietnamworks-job-scraper"
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T08:00:00Z
owner: "DEV"
reviewed: "Pending"
baseline_commit: "322c874d"
---

# Story 18.2: VietnamWorks Job Scraper

Status: ready-for-dev

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/recruitment/vietnamworks/crawler.js` and `AbstractApiClient` in `src/scrapers/recruitment/vietnamworks/client.js`.
   - Must provide `VietnamWorksPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/recruitment/vietnamworks/validator.js`.
   - Must expose clean barrel in `src/scrapers/recruitment/vietnamworks/index.js` and integrate into `src/scrapers/index.js` (`scrape('vietnamworks', ...)`).
2. **VietnamWorks API Endpoint & Payload Structure:**
   - Base endpoint: `https://ms.vietnamworks.com/job-search/v1.0/search`.
   - Method: `POST` with JSON body (`keyword`, `page`, `hitsPerPage`, `locationId`, `salaryMin`, `salaryMax`, `yearsOfExperience`, `typeWorkingId`).
   - Working type mapping:
     - `1` → `full_time`
     - `2` → `part_time`
     - `3` → `contract`
     - `4` → `intern`
   - Strict salary normalization:
     - `min == 0 && max == 0` → `salaryMin: 0, salaryMax: 0, isNegotiable: true`
     - `min > 0 && max == 0` → `salaryMin: min, salaryMax: null, isNegotiable: false` ("Từ X")
     - `min == 0 && max > 0` → `salaryMin: 0, salaryMax: max, isNegotiable: false` ("Tới X")
     - `min > 0 && max > 0` → `salaryMin: min, salaryMax: max, isNegotiable: false` (Range)
3. **Data Normalization & Namespaced Models:**
   - Every job post normalized as `PostItem` (`id: vietnamworks:job:<jobId>`, `platform: 'vietnamworks'`, `category: 'recruitment'`).
   - Every company/employer normalized as `ProfileItem` (`id: vietnamworks:company:<companyId>`, `platform: 'vietnamworks'`).
   - Schema validation via `schemas/recruitment/job.json` and `PrismaStore.storeBatch()`.
4. **Zero Mocks Testing (AD-10):**
   - Tests in `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` using local `node:http` server returning realistic JSON responses.

## Story

As an **HR Executive & Talent Sourcing Specialist**,  
I want **cào danh sách tin tuyển dụng, dải lương, yêu cầu kinh nghiệm, và phúc lợi từ VietnamWorks qua `VietnamWorksCrawler` và `VietnamWorksClient`**,  
So that **tôi có thể phân tích cơ hội việc làm cấp trung & cao cấp, xây dựng dữ liệu lương thị trường và tìm kiếm ứng viên/lead B2B theo thời gian thực.**

## Scope Note

Story 18.2 xây dựng crawler tuyển dụng cho VietnamWorks trong Epic 18 (HR & B2B Recruitment).

- **Trong phạm vi Story 18.2:**
  - `src/scrapers/recruitment/vietnamworks/client.js`: `VietnamWorksClient` gửi HTTP requests tới search microservice endpoint với User-Agent rotation, proxy support, xử lý mã lỗi 401/403/429.
  - `src/scrapers/recruitment/vietnamworks/crawler.js`: `VietnamWorksCrawler` đăng ký 3 actions:
    1. `search_jobs`: Tìm kiếm việc làm qua JSON API theo `keyword`, `city`/`locationId`, `salaryMin`, `salaryMax`, `exp`, `employmentType`, `page`, `limit`.
    2. `job_detail`: Bóc tách chi tiết JD, kỹ năng, quyền lợi từ job item payload hoặc direct API.
    3. `company_detail`: Bóc tách thông tin công ty từ job metadata.
  - `src/scrapers/recruitment/vietnamworks/normalize-job.js`: Parser bóc tách dải lương, skills array, benefits, locations, và ISO date (`createdOn`, `approvedOn`, `expiredOn`).
  - `src/scrapers/recruitment/vietnamworks/validator.js`: Kiểm tra response structure (`data` array, error code, rate limit, IP challenge).
  - `src/scrapers/recruitment/vietnamworks/index.js`: Barrel xuất `VietnamWorksCrawler`, `VietnamWorksClient`, `scrapeVietnamWorks`.
  - `src/scrapers/index.js`: Đăng ký `vietnamworks` vào unified `scrape()` dispatcher.
  - `package.json`: Export `./scrapers/recruitment/vietnamworks`.
  - `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js`: Suite test đầy đủ red-phase ATDD.

- **Ngoài phạm vi:**
  - LinkedIn CDP attach (thuộc Story 18.3).
  - Thay đổi database schema hay Prisma client.

## Acceptance Criteria

### AC-1: Action Registry & Crawler Contract
- **Given** `VietnamWorksCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/recruitment/vietnamworks/crawler.js`
- **When** gọi `crawler.listActions()`
- **Then** đăng ký đầy đủ 3 action với đúng `ActionDescriptor`:

| action | category | requiredArgs | optionalArgs | requiresAuth |
|---|---|---|---|---|
| `search_jobs` | `recruitment` | `['keyword']` | `['city', 'locationId', 'salaryMin', 'salaryMax', 'exp', 'employmentType', 'page', 'limit']` | `false` |
| `job_detail` | `recruitment` | `['jobId']` | `['jobUrl']` | `false` |
| `company_detail` | `recruitment` | `['companyId']` | `['companyName']` | `false` |

### AC-2: Search Jobs Payload & Normalization
- **Given** gọi `crawler.start({ action: 'search_jobs', args: { keyword: 'Senior Backend', salaryMin: 20000000, limit: 10 } })`
- **When** `VietnamWorksClient` thực thi HTTP POST tới `https://ms.vietnamworks.com/job-search/v1.0/search`
- **Then** gửi JSON body chuẩn hóa (`keyword`, `page`, `hitsPerPage`, `salaryMin`, v.v.).
- **And** kết quả trả về `{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }`.
- **And** mỗi job có `id: 'vietnamworks:job:<jobId>'`, `category: 'recruitment'`, `metadata.salaryMin`, `metadata.salaryMax`, `metadata.salaryCurrency`, `metadata.companyName`, `metadata.location`, `metadata.skills`, `metadata.benefits`.

### AC-3: Strict Salary & Working Type Mapping
- **Given** các trường `salaryMin`, `salaryMax`, `typeWorkingId` từ API VietnamWorks
- **When** qua hàm `normalizeVietnamWorksSalary(min, max)` và `mapWorkingType(id)`
- **Then** ánh xạ chính xác:
  - `min: 0, max: 0` → `salaryMin: 0, salaryMax: 0, isNegotiable: true`
  - `min: 15000000, max: 0` → `salaryMin: 15000000, salaryMax: null, isNegotiable: false`
  - `min: 0, max: 30000000` → `salaryMin: 0, salaryMax: 30000000, isNegotiable: false`
  - `min: 15000000, max: 25000000` → `salaryMin: 15000000, salaryMax: 25000000, isNegotiable: false`
  - `typeWorkingId: 1` → `full_time`, `2` → `part_time`, `3` → `contract`, `4` → `intern`.

### AC-4: Job Detail & Company Extraction
- **Given** gọi `crawler.start({ action: 'job_detail', args: { jobId: '1234567' } })`
- **When** bóc tách thông tin công việc chi tiết
- **Then** trích xuất đầy đủ: `title`, `companyName`, `location`, `salaryMin`, `salaryMax`, `description`, `requirements`, `benefits`, `skills`, `postedAt`, `expiredAt`.
- **And** action `company_detail` trích xuất `ProfileItem` (`id: 'vietnamworks:company:<companyId>'`, `name`, `profileUrl`, `sourceMethod: 'company_detail'`).

### AC-5: Unified `scrape("vietnamworks", ...)` Dispatcher & Package Exports
- **Given** `scrape('vietnamworks', 'search_jobs', { keyword: 'NodeJS' })`
- **When** gọi từ `src/scrapers/index.js`
- **Then** khởi tạo `VietnamWorksCrawler` và trả về kết quả chuẩn hóa `jobs`.
- **And** `package.json` export `./scrapers/recruitment/vietnamworks`.

### AC-6: No-Mocks Integration Test Suite
- **Given** `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js`
- **When** chạy `npx vitest run tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js`
- **Then** toàn bộ test cases (search, salary mapping, job detail, company detail, validator, unified dispatcher) đều PASS 100%.

## Tasks / Subtasks

- [ ] **Task 1 — Core Module Scaffolding (AC-1, AC-5)**
  - [ ] 1.1 Tạo thư mục `src/scrapers/recruitment/vietnamworks/`.
  - [ ] 1.2 Tạo `client.js` — `VietnamWorksClient` kế thừa `AbstractApiClient`.
  - [ ] 1.3 Tạo `validator.js` — `VietnamWorksPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [ ] 1.4 Tạo `crawler.js` — `VietnamWorksCrawler` kế thừa `AbstractCrawler` với 3 action descriptors.
  - [ ] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeVietnamWorks`.
  - [ ] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [ ] **Task 2 — Normalizer & Field Mapping Engine (AC-2, AC-3)**
  - [ ] 2.1 Tạo `src/scrapers/recruitment/vietnamworks/normalize-job.js`.
  - [ ] 2.2 Viết `normalizeVietnamWorksSalary(min, max)` xử lý các quy tắc dải lương.
  - [ ] 2.3 Viết `mapWorkingType(id)` và `parseVietnamWorksDate(dateStr)`.
  - [ ] 2.4 Viết `normalizeVietnamWorksJob(jobObj)` → `PostItem` với metadata recruitment.
  - [ ] 2.5 Viết `normalizeVietnamWorksCompany(companyObj)` → `ProfileItem`.

- [ ] **Task 3 — Crawler Action Handlers (AC-2, AC-4)**
  - [ ] 3.1 Cài đặt `searchJobs(args, session)` — gọi API search & phân trang.
  - [ ] 3.2 Cài đặt `jobDetail(args, session)` — trích xuất chi tiết công việc.
  - [ ] 3.3 Cài đặt `companyDetail(args, session)` — trích xuất hồ sơ công ty.
  - [ ] 3.4 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [ ] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [ ] 4.1 Cài đặt `VietnamWorksPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare / rate limit block.
  - [ ] 4.2 Cài đặt `isValidPayload` kiểm tra cấu trúc JSON `data` array hoặc object.

- [ ] **Task 5 — Test Suite & Verification (AC-6)**
  - [ ] 5.1 Tạo `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` dùng `node:http`.
  - [ ] 5.2 Test salary & working type mapping.
  - [ ] 5.3 Test search_jobs, job_detail, company_detail, dispatcher end-to-end.
  - [ ] 5.4 Chạy test suite và xác nhận 100% green.

## Dev Notes
- API Endpoint: `https://ms.vietnamworks.com/job-search/v1.0/search`
- Headers:
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `User-Agent: Mozilla/5.0...`
- Locations: Ho Chi Minh (`29`), Ha Noi (`24`), Da Nang (`17`), v.v.
