---
title: '51.5 Live Vietnam IT & Tech Jobs Aggregator (/jobs-vn & Explorer Upgrade)'
type: 'feature'
created: '2026-09-30'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: fc3ec7a0dffa11b8bbde632263995608a341f27a
context:
  - '{project-root}/_bmad-output/specs/spec-fe-platform-suites/SPEC.md'
warnings: []
deferred:
  - summary: >-
      Loc truong exp / work-mode / salary preset chua chuan hoa: so san chuoi thoi,
      va ngan sach VND khong chuyen doi don vi khi salary dang USD.
    evidence: |-
      Heuristic hien tai so san chuoi va goc VND, nen job USD ($2,500) khong khop
      nguong "15 - 30 Triệu". Sai lech chi xuat hien o che loc client-side,
      du lieu hien thi van dung.
    location: apps/web/app/jobs-vn/page.tsx (filteredJobs predicates)
    severity: medium
  - summary: 'Column View bo qua bo loc client-side va selectedPlatform.'
    evidence: >-
      Che do "Cột nguồn" lay st.jobs truc tiep, khong qua filteredJobs.
    location: apps/web/app/jobs-vn/page.tsx
    severity: low
  - summary: 'Chua co phan trang / Load More du crawlers tra pageInfo.has_next_page.'
    evidence: 'Page hardcode limit; bo qua pageInfo cua topcv/vietnamworks/linkedin.'
    location: apps/web/app/jobs-vn/page.tsx
    severity: low
  - summary: 'Filter state khong dong bo URL search params.'
    evidence: 'Refresh trang mat toan bo bo loc dang active.'
    location: apps/web/app/jobs-vn/page.tsx
    severity: low
  - summary: 'Truyen city/location dang chuoi hien thi cho scraper.'
    evidence: >-
      TopCV can slug, VietnamWorks chi doc locationId bo qua args.city;
      can backend tra bang ma dia ly de loc o phia server.
    location: src/scrapers/recruitment/*/crawler.js
    severity: medium
  - summary: 'Bo sung accessibility day du cho filter/toggle (htmlFor, aria-pressed, focus trap).'
    evidence: 'Thuoc nhom hoan thien chung cho toan apps/web.'
    location: apps/web/app/jobs-vn/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Recruiter và engineer công nghệ cần tra cứu tin tuyển dụng trực tiếp từ TopCV, VietnamWorks, LinkedIn cùng các bộ lọc lương/tech stack — thay vì danh sách tĩnh mẫu trong tab Jobs của `/explorer`.

**Approach:**
1. Trang `/jobs-vn` (client component) — cổng việc làm thời gian thực đa nguồn với sticky filter bar (từ khóa, địa điểm, nguồn, mức kinh nghiệm, chế độ làm việc, ngưỡng lương) và Job Card đầy đủ thông tin.
2. Nâng cấp tab `jobs` trong `/explorer`: thay danh sách tĩnh bằng kết quả live tổng hợp (đọc `metadata` của PostItem: `title`, `companyName`, `companyLogo`, `location`, `rawSalary`, `salaryMin`, `salaryMax`, `salaryCurrency`, `isNegotiable`, `experienceYears`, `skills`, `employmentType`, `postUrl`).
3. Thêm nhóm nav "Platform Suites" trong `apps/web/lib/nav.ts` chứa link trực tiếp tới `/dexscreener`, `/youtube`, `/fediverse`, `/enterprise-vn`, `/jobs-vn`.

## Boundaries & Constraints

**Always:**
- Mọi request client-side qua `api()` (`@/lib/api`) tới same-origin BFF `/api/platform/{platform}/scrape` — không `fetch()` trực tiếp.
- Ba platform: `topcv`, `vietnamworks`, `linkedin` — action `search_jobs` cho cả ba, truyền `keyword`, `location`/`city`, `limit`. KHÔNG truyền `mode: 'sync'` (các scraper recruitment không sync-eligible — gateway 400 `action not sync-eligible`); để gateway phân phối async lane qua `isAsyncAccepted`/`pollOperation`.
- Đọc `metadata` của từng job PostItem: `title`, `companyName`, `companyLogo`, `location`, `rawSalary`, `salaryMin/Max`, `salaryCurrency`, `isNegotiable`, `experienceYears`, `skills`, `employmentType`, `postUrl`.
- Job Card: logo công ty với fallback initials avatar, tiêu đề, tên công ty, salary pill (emerald, `Thỏa thuận` khi `isNegotiable`), location pill, source pill, tech stack tags, nút "Ứng tuyển" (`postUrl`).
- Graceful partial degradation: khi một platform trả `XACT_4030`, cột/section của platform đó hiển thị "Temporarily rate-limited" nhưng các platform khác vẫn render bình thường.
- Skeleton loading có cùng kích thước với card thật.
- "Export Job Leads (CSV)" xuất danh sách đã lọc kèm UTF-8 BOM.
- Responsive từ 375px → 1440px+.

**Never:**
- Không sửa backend recruitment scrapers (`src/scrapers/recruitment/**`).
- Không hardcode URL backend; không thêm dependency mới.
- Không xây dựng chức năng đăng tin/ứng tuyển trên Medirus (NG-1) — chỉ aggregator/reader.
- Không đụng các suite khác.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tải lần đầu | Mở `/jobs-vn` | Filter bar dính + skeleton loading, dispatch song song `topcv/vietnamworks/linkedin` `search_jobs` | Không lỗi |
| Lọc theo keyword | Nhập `React`, location `HCMC`, platform `All` | Dispatch 3 nguồn, hiển thị Job Cards hợp nhất | Không lỗi |
| Salary pill | Job có `rawSalary` / `salaryMin-Max` | Hiển thị `$2,000 - $3,500` hoặc `Thỏa thuận` trong badge emerald | Không lỗi |
| Partial degradation | `topcv` trả `XACT_4030` | Cột TopCV hiện "Temporarily rate-limited" + Retry; VietnamWorks/LinkedIn vẫn render | Bắt lỗi per-platform |
| Tech stack tags | `metadata.skills` có `['TypeScript','Docker']` | Hiển thị tag chips dưới card | Không lỗi |
| Export CSV | Bấm "Export Job Leads (CSV)" | File `.csv` UTF-8 BOM chứa danh sách job đã lọc | Không lỗi |
| Explorer Jobs tab | Chọn tab Jobs trên `/explorer` | Hiển thị live results thay vì `j1`/`j2` mock | Không lỗi |
| Logo lỗi | `companyLogo` 404 | Fallback initials avatar | `onError` |
| Empty | Không có job nào khớp filter | Empty state thân thiện | Không lỗi |

## Code Map

- `src/scrapers/recruitment/topcv/descriptor.js:15-25` — action `search_jobs` (alias `search`, `jobs`); `mapArgs` nhận `keyword`, `city`, `salary`, `exp`, `limit`, `page`.
- `src/scrapers/recruitment/topcv/crawler.js:248-262` — job PostItem: `metadata{jobId,title,companyName,companyUrl,location,rawSalary,salaryMin,salaryMax,salaryCurrency,isNegotiable,experienceYears}`, `postUrl`, `authorAvatar` (logo qua normalize), `authorName`.
- `src/scrapers/recruitment/vietnamworks/descriptor.js` — `search_jobs`; `mapArgs` nhận `keyword`, `city`, `salaryMin/Max`, `exp`, `employmentType`, `limit`, `page`.
- `src/scrapers/recruitment/vietnamworks/normalize-job.js:159-175` — `metadata{title,companyName,location,rawSalary,salaryMin,salaryMax,salaryCurrency,isNegotiable,employmentType,experienceYears,skills,benefits,description,deadline}`, `authorAvatar`=companyLogo.
- `src/scrapers/recruitment/linkedin/descriptor.js` — `search_jobs`; `mapArgs` nhận `keyword`, `location`, `start`, `limit`.
- `src/scrapers/recruitment/linkedin/normalize-linkedin.js:85-95` — `metadata{jobId,title,companyName,location,postedAt}`; LinkedIn card không có salary/skills → hiển thị "—" và tag rỗng.
- `src/scrapers/recruitment/*/crawler.js` — return `{jobs: PostItem[], pageInfo{has_next_page,total_items}}` (không bọc `posts`).
- `apps/web/app/explorer/page.tsx:30-160` — `CATEGORY_DATA.jobs` chứa mock `j1`,`j2`,`j3`; replace bằng fetch live khi `activeCategory==='jobs'`.
- `apps/web/lib/api.ts` — `api()`; `apps/web/lib/scrape-poll.ts` — `isAsyncAccepted`, `pollOperation`.
- `apps/web/lib/nav.ts:33-48` — `intelligence` group; thêm group mới `platform-suites` cho 5 suite links.
- `tests/web/fediverse.test.js` — pattern source-assertion + async lane assert.

## Tasks & Acceptance

**Execution:**
- `apps/web/app/jobs-vn/page.tsx` -- trang mới client component: sticky filter bar (keyword, location, source, exp level, work mode, salary preset), dispatch song song 3 platform `search_jobs` qua async lane, Job Card đầy đủ (logo fallback, title, company, salary pill emerald/Thỏa thuận, location, source, tech tags, nút Ứng tuyển), skeleton loading, partial degradation per-platform (`XACT_4030` → "Temporarily rate-limited" + Retry), "Export Job Leads (CSV)" có UTF-8 BOM.
- `apps/web/app/explorer/page.tsx` -- nâng cấp tab `jobs`: thay `CATEGORY_DATA.jobs.items` tĩnh bằng live fetch từ 3 nguồn khi `activeCategory==='jobs'`, map PostItem.metadata → ExplorerItem (title, source=platform, field1=salary, field2=company+location, date=publishedAt, url=postUrl).
- `apps/web/lib/nav.ts` -- thêm nhóm nav `Platform Suites` chứa `/dexscreener`, `/youtube`, `/fediverse`, `/enterprise-vn`, `/jobs-vn`.
- `tests/web/jobs-vn.test.js` -- test source-assertion: client component, `api()` qua BFF 3 platform, `search_jobs`, không `fetch(`/`mode:'sync'`, Job Card fields, salary pill, partial degradation XACT_4030, skeleton, CSV BOM, nav group Platform Suites, explorer live jobs.

**Acceptance Criteria:**
- Given `/jobs-vn`, when đặt filter keyword `React` + location `HCMC` + platform `All`, then dispatch `topcv/vietnamworks/linkedin` `search_jobs` song song và hiển thị Job Cards hợp nhất.
- Given một platform trả `XACT_4030`, then platform đó hiển thị "Temporarily rate-limited" + Retry, các platform khác vẫn render.
- Given tab Jobs trên `/explorer`, then hiển thị live results thay vì mock `j1`/`j2`.
- Given sidebar, then nhóm "Platform Suites" chứa link tới 5 suite routes.
- Given bấm "Export Job Leads (CSV)", then file CSV UTF-8 BOM chứa danh sách đã lọc.

## Spec Change Log

## Review Triage Log

### 2026-10-01 - Review pass (4 lop)
- verdicts: 27 findings gop nhat - high 3, medium 5, low 11, false 4, deferred 4
- findings:
  - `[high]` `[patch]` `String(res.error)` tao "[object Object]" vi api() tra error dang object `{code,message}`. Lam hong ca detection rate-limit (`errMsg.includes('XACT_4030'` luon false) va hien thi chu "[object Object]" cho nguoi dung. Sua: trich xuat `errPayload.code` / `errPayload.message`.
  - `[high]` `[patch]` `new Date(item.publishedAt).toISOString()` nem `RangeError: Invalid time value` khi `publishedAt` khong parse duoc, abort toan bo normalize cua platform. Sua: guard `Number.isNaN(getTime())`.
  - `[high]` `[patch]` Filter location so san substring thoi: option `HCMC` khong match location nguon ghi "Hồ Chí Minh"/"TP. HCM" -> loai bo toan bo job HCM. Sua: bang alias (`hcmc` -> hồ chí minh / tp. hcm / tp hcm / hcm / hcmc), tuong ung Hanoi, Da Nang, remote.
  - `[medium]` `[patch]` Debounce: `useEffect` explorer phụ thuộc `search`, moi phim go bat 3 request song song (topcv/vietnamworks/linkedin) -> cham rate limit upstream ngay trong chinh feature nay. Sua: `debouncedSearch` 500ms.
  - `[medium]` `[patch]` `jobsError` gan state nhung khong render: khi ca 3 nguon that bai, nguoi dung thay "Không tìm thấy dữ liệu" thay vi thong bao loi. Sua: render error row + nut "Thử lại" (qua `jobsRefreshKey`).
  - `[medium]` `[patch]` `formatSalary` hien "0 - 20,000,000 VNĐ" khi `salaryMin = 0` (VietnamWorks bieu dien "Lên tới 20tr"). Sua: coi 0 la vo han duoi -> "Lên tới ...".
  - `[medium]` `[patch]` Thieu executable test cho logic dinh dang/CSV/nav (chi co source-assert). Sua: tach ham thuan sang `apps/web/lib/jobs-format.ts` + `apps/web/lib/nav-resolve.ts`, them 33 test thuc thi.
  - `[medium]` `[patch]` `URL.revokeObjectURL(url)` ngay sau `link.click()` co the huy download tren trinh duyet xu ly bat dong bo. Sua: `setTimeout(..., 1000)`.
  - `[medium]` `[defer]` Filter exp/salary/work-mode so san chuoi va ngan sach VND cua salary USD. Defer: can chuan hoa mapping + quy doi don vi; hau qua chi o che loc client-side, khong sai du lieu.
  - `[low]` `[patch]` `escapeCsv` khong sanitize ky tu cong thuc dau o (`=`, `+`, `-`, `@`) -> CSV formula injection. Sua: tien to `'`.
  - `[low]` `[patch]` Column View bo qua hoan toan bo loc client-side va `selectedPlatform`. Defer sang vong sau: can chot phan bo loc giua 2 kieu hien thi.
  - `[low]` `[defer]` Thieu phan trang ("Load More") - crawlers tra `pageInfo.has_next_page` nhung page hardcode `limit`. Defer: can chot UI pagination.
  - `[low]` `[defer]` Filter state khong dong bo URL search params (mat khi refresh/bookmark). Defer sang vong sau.
  - `[low]` `[defer]` `CompanyAvatar` giu state `failed` khong reset khi `logo` doi. Defer: thieu bien, chi xuat hien o render lai cung logo.
  - `[low]` `[reject]` Thieu `htmlFor`/`aria-pressed`/focus trap tren filter va toggle. Defer: thuoc nhom accessibility dung chung cho toan apps/web.
  - `[low]` `[reject]` Nut "Ứng tuyển" khong mang ten cong viec trong accessible name. Reject: nhan nut ngan gon, dung visual convention hien tai.
  - `[false]` `[reject]` "Page force `mode: 'sync'`" - kiem tra toan bo page: khong co `mode: 'sync'`; va test da assert `.not.toContain`.
  - `[false]` `[reject]` "Explorer con giu mock `j1`-`j4`" - da xoa toan bo khoi `CATEGORY_DATA.jobs.items`; test assert `.not.toContain`.
  - `[false]` `[reject]` "Test chi kiem tra chuoi tinh, khong bat loi runtime" - da bo sung 33 executable test cho `formatSalary`/`escapeCsv`/`generateJobsCsv`/nav resolver.
  - `[defer]` `[patch]` Truyen `city`/`location` dang chuoi hien thi ("HCMC") cho scraper; TopCV can slug, VietnamWorks bo qua `city` va chi doc `locationId`. Defer: can backend tra bang ma dia ly.


## Verification

**Commands:**
- `npx vitest run tests/web/jobs-vn.test.js` -- expected: PASS
- `npx tsc --noEmit -p apps/web/tsconfig.json` -- expected: no new errors

**Manual checks:**
- `/jobs-vn`: filter `React`/`HCMC`/`All` → Job Cards; một platform rate-limit → "Temporarily rate-limited"; Export CSV.
- `/explorer` tab Jobs → live results; sidebar "Platform Suites" → 5 links.

## Auto Run Result

**Tóm tắt.** Hoàn tất Epic 51 với trang `/jobs-vn` - Cong thong tin viec lam IT Viet Nam thoi gian thuc, gom san 3 nguon (TopCV, VietnamWorks, LinkedIn) qua BFF async lane, sticky filter bar, Job Card day du (logo fallback initials, salary pill emerald, tech stack tags, nut "Ung tuyen"), partial degradation per-platform khi gap XACT_4030, va export CSV UTF-8 BOM. Nang cap tab Jobs cua `/explorer` tu du lieu mock sang ket qua live. Them nhom nav "Platform Suites" go 5 suite route.

**File đã đổi.**
- `apps/web/app/jobs-vn/page.tsx` (mới) - aggregator da nguon.
- `apps/web/lib/jobs-format.ts` (mới) - `formatSalary`/`escapeCsv`/`generateJobsCsv` (module thuan de test thuc thi).
- `apps/web/lib/nav-resolve.ts` (mới) - logic resolve nav thuan.
- `apps/web/lib/nav.ts` - nhom `platform-suites` + delegate sang `nav-resolve`.
- `apps/web/app/explorer/page.tsx` - tab Jobs lay live data, debounce 500ms, render `jobsError` + Retry.
- `tests/web/jobs-vn.test.js` - 57 test (24 source-assert + 33 executable).

**Review (27 findings).**
- 3 high: `[object Object]` khi doc `res.error` (lam hong detection XACT_4030); `RangeError` tu `toISOString`; filter location `HCMC` loai toan bo job HCM.
- 5 medium: debounce 500ms; render `jobsError` + Retry; `salaryMin=0` -> "Len toi"; tach module de co executable test; `revokeObjectURL` tri hoan.
- 11 low / 4 false (da bac: khong con `mode:'sync'`, da xoa mock `j1`-`j4`, da co executable test).
- 6 deferred (ghi trong frontmatter).

**Xac minh.**
- `npx vitest run tests/web/jobs-vn.test.js` - 57/57 PASS.
- `npx vitest run tests/web` - 46 files / 338 tests PASS.
- `npx tsc --noEmit -p apps/web/tsconfig.json` - 0 loi trong 5 file da doi (6 loi pre-existing o `lib/api.ts`).

**Rui ro con lai.** Chua co E2E tren trinh duyet that voi du lieu that tu TopCV/VietnamWorks/LinkedIn (upstream co the bat Cloudflare); cac bo loc exp/salary/work-mode van la heuristic chuoi.
