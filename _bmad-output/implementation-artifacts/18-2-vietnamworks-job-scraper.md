---
story_id: "18.2"
epic: 18
story_key: "18-2-vietnamworks-job-scraper"
status: "done"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T08:30:00Z
owner: "DEV"
reviewed: "approved"
baseline_commit: "322c874d"
---

# Story 18.2: VietnamWorks Job Scraper

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-31  
**Summary:**
- `VietnamWorksCrawler` và `VietnamWorksClient` kế thừa `AbstractCrawler` và `AbstractApiClient` chuẩn mực, đăng ký 3 actions: `search_jobs`, `job_detail`, `company_detail`.
- Tích hợp microservices API `https://ms.vietnamworks.com/job-search/v1.0/search`.
- Chuẩn hóa dải lương `normalizeVietnamWorksSalary`, hình thức làm việc `mapWorkingType` và ngày tháng ISO `parseVietnamWorksDate` chính xác.
- Đã kiểm thử live với API thật của VietnamWorks: bóc tách chính xác vị trí tuyển dụng, dải lương, công ty, kỹ năng và địa điểm.
- Toàn bộ 10/10 ATDD tests tại `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` passed 100%.

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

## Tasks / Subtasks

- [x] **Task 1 — Core Module Scaffolding (AC-1, AC-5)**
  - [x] 1.1 Tạo thư mục `src/scrapers/recruitment/vietnamworks/`.
  - [x] 1.2 Tạo `client.js` — `VietnamWorksClient` kế thừa `AbstractApiClient`.
  - [x] 1.3 Tạo `validator.js` — `VietnamWorksPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [x] 1.4 Tạo `crawler.js` — `VietnamWorksCrawler` kế thừa `AbstractCrawler` với 3 action descriptors.
  - [x] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeVietnamWorks`.
  - [x] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [x] **Task 2 — Normalizer & Field Mapping Engine (AC-2, AC-3)**
  - [x] 2.1 Tạo `src/scrapers/recruitment/vietnamworks/normalize-job.js`.
  - [x] 2.2 Viết `normalizeVietnamWorksSalary(min, max)` xử lý các quy tắc dải lương.
  - [x] 2.3 Viết `mapWorkingType(id)` và `parseVietnamWorksDate(dateStr)`.
  - [x] 2.4 Viết `normalizeVietnamWorksJob(jobObj)` → `PostItem` với metadata recruitment.
  - [x] 2.5 Viết `normalizeVietnamWorksCompany(companyObj)` → `ProfileItem`.

- [x] **Task 3 — Crawler Action Handlers (AC-2, AC-4)**
  - [x] 3.1 Cài đặt `searchJobs(args, session)` — gọi API search & phân trang.
  - [x] 3.2 Cài đặt `jobDetail(args, session)` — trích xuất chi tiết công việc.
  - [x] 3.3 Cài đặt `companyDetail(args, session)` — trích xuất hồ sơ công ty.
  - [x] 3.4 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [x] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [x] 4.1 Cài đặt `VietnamWorksPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare / rate limit block.
  - [x] 4.2 Cài đặt `isValidPayload` kiểm tra cấu trúc JSON `data` array hoặc object.

- [x] **Task 5 — Test Suite & Verification (AC-6)**
  - [x] 5.1 Tạo `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` dùng `node:http`.
  - [x] 5.2 Test salary & working type mapping.
  - [x] 5.3 Test search_jobs, job_detail, company_detail, dispatcher end-to-end.
  - [x] 5.4 Chạy test suite và xác nhận 100% green.

## Dev Agent Record

### Implementation Plan
- Khởi tạo thư mục `src/scrapers/recruitment/vietnamworks/`.
- Cài đặt `VietnamWorksClient`, `VietnamWorksPlatformResponseValidator`, `normalize-job.js`, `VietnamWorksCrawler`, và barrel `index.js`.
- Đăng ký `vietnamworks` vào unified `scrape()` dispatcher tại `src/scrapers/index.js` và `package.json` exports.
- Viết test suite ATDD `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` và xác thực Live API thực tế.

### Completion Notes
- Tất cả 10/10 test cases đều PASS 100%.
- Kiểm thử Live API VietnamWorks: gọi `POST https://ms.vietnamworks.com/job-search/v1.0/search` thành công, lấy về danh sách việc làm và thông tin công ty thực tế.

## File List
- `src/scrapers/recruitment/vietnamworks/client.js` (NEW)
- `src/scrapers/recruitment/vietnamworks/validator.js` (NEW)
- `src/scrapers/recruitment/vietnamworks/normalize-job.js` (NEW)
- `src/scrapers/recruitment/vietnamworks/crawler.js` (NEW)
- `src/scrapers/recruitment/vietnamworks/index.js` (NEW)
- `tests/scrapers/recruitment/vietnamworks/crawler-vietnamworks.test.js` (NEW)
- `src/scrapers/index.js` (MODIFIED)
- `package.json` (MODIFIED)
- `_bmad-output/implementation-artifacts/18-2-vietnamworks-job-scraper.md` (MODIFIED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)

## Change Log
- 2026-08-31: Triển khai hoàn thiện Story 18.2 VietnamWorks Job Scraper theo chuẩn BMad Hexagonal Architecture.
