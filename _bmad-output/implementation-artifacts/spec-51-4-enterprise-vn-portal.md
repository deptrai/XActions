---
title: '51.4 Vietnam B2B Diligence & Procurement Portal (/enterprise-vn)'
type: 'feature'
created: '2026-09-30'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: 3376380ca7c70420cd84d76a8f5fd46ee7cec5fb
context:
  - '{project-root}/_bmad-output/specs/spec-fe-platform-suites/SPEC.md'
warnings: []
deferred:
  - summary: >-
      Cổng ipvietnam chưa hỗ trợ lọc nhãn hiệu theo tên chủ đơn (applicant) qua backend;
      fetchTrademarks hiện trả danh sách công báo mới nhất.
    evidence: |-
      Action `search`/`search_gazette` trong `src/scrapers/legal/ip-trademark/descriptor.js`
      nhận `page`/`limit` và đọc bảng công bố chung, không có tham số owner/applicant.
      Việc lọc theo doanh nghiệp cần mở rộng backend crawler (ngoài phạm vi frontend story).
    location: >-
      apps/web/app/enterprise-vn/page.tsx (fetchTrademarks), src/scrapers/legal/ip-trademark/descriptor.js
    severity: medium
  - summary: >-
      Thuộc tính trợ năng ARIA đầy đủ (role="tabpanel", aria-controls) cho tab switcher
      Hồ sơ pháp lý / Nhãn hiệu.
    evidence: |-
      Tab switcher hiện có nhãn ngữ nghĩa và trạng thái active rõ ràng; việc bổ sung
      role/aria-controls sẽ gộp vào lượt rà soát accessibility toàn apps/web.
    location: >-
      apps/web/app/enterprise-vn/page.tsx (tab switcher)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Chuyên viên kinh doanh B2B và pháp chế cần xác minh mã số thuế (MST), trạng thái pháp lý doanh nghiệp và danh mục nhãn hiệu bản quyền từ cổng thông tin chính phủ Việt Nam, nhưng hiện tại phải tra cứu thủ công rời rạc hoặc gọi API thô qua `/gateway`.

**Approach:** Xây dựng trang `/enterprise-vn` — Cổng thẩm định doanh nghiệp Việt Nam tương tác:
1. Ô tìm kiếm thông minh tự động nhận diện Mã số thuế (10 hoặc 13 chữ số) hoặc Tên công ty.
2. Khi nhập MST hoặc tên: gọi `masothue:search` / `masothue:detail` và `b2b_registry_extended:search_enterprises` qua BFF proxy cùng lúc, chuẩn hóa hiển thị **Hồ sơ Doanh nghiệp (Enterprise Dossier)** (Tên pháp lý, MST, Người đại diện, Trạng thái hoạt động dạng badge màu, Ngày thành lập, Địa chỉ, Ngành nghề).
3. **Tab Nhãn hiệu & Sở hữu trí tuệ**: Tra cứu danh mục nhãn hiệu liên quan qua `ipvietnam:search` / `ipvietnam:search_gazette`.
4. **Thanh công cụ Xuất dữ liệu (Export Toolbar)**: Cho phép xuất Dossier + Trademarks ra định dạng JSON và CSV (kèm UTF-8 BOM `﻿` để tương thích hoàn hảo với Microsoft Excel tiếng Việt).
5. Xử lý suy giảm mượt mà (Graceful Degradation): Khi gặp lỗi rate-limit hoặc Cloudflare bot-challenge `XACT_4030`, hiển thị Empty State cảnh báo thân thiện kèm nút Retry và giải thích hướng dẫn sử dụng proxy.
6. Đăng ký `/enterprise-vn` vào danh mục điều hướng `Intelligence` trong `apps/web/lib/nav.ts`.

## Boundaries & Constraints

**Always:**
- Mọi request client-side qua helper `api()` (`@/lib/api`) tới same-origin BFF `/api/platform/{platform}/scrape` ở `mode: 'sync'` hoặc fallback async.
- Nhận diện định dạng input: MST 10 số (doanh nghiệp) hoặc 13 số (chi nhánh, e.g. `0013180180` hoặc `0100109106-001`).
- Trạng thái pháp lý phân loại rõ ràng:
  - Xanh (Emerald): `Đang hoạt động`, `Đang hoạt động (đã được cấp GCN ĐKT)`.
  - Đỏ (Rose): `Ngừng hoạt động`, `Đóng mã số thuế`, `Đã giải thể`.
  - Vàng (Amber): `Tạm ngừng kinh doanh`, `Tạm ngừng hoạt động`.
- Xuất file CSV phải chèn byte order mark `﻿` ở đầu chuỗi để Excel trên Windows hiển thị đúng dấu tiếng Việt.
- Bắt buộc xử lý `XACT_4030` bằng banner/empty state cảnh báo nhẹ nhàng, không được để crash màn hình trắng.
- Trang là Client Component (`'use client'`), giao diện chuẩn Tailwind CSS và icons từ `lucide-react`.

**Never:**
- Không sửa code backend của các scraper procurement/legal (`src/scrapers/procurement/**`, `src/scrapers/legal/**`).
- Không lưu vĩnh viễn dữ liệu vào CSDL Postgres từ client (chỉ đọc và hiển thị).
- Không gọi trực tiếp port 3001 hay external government domains từ browser (vi phạm CORS / BFF mandatory).
- Không thêm dependency mới ngoài các thư viện đã có trong `apps/web`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tra cứu theo MST | Nhập MST 10 hoặc 13 số (e.g. `0013180180`), bấm Tra cứu | Gọi `masothue:search` hoặc `detail`, hiển thị Enterprise Dossier đầy đủ các trường | Không lỗi |
| Tra cứu theo Tên | Nhập tên công ty (e.g. `Viettel`, `VNG`) | Gọi `masothue:search` và `b2b_registry:search`, hiển thị danh sách kết quả doanh nghiệp phù hợp | Không lỗi |
| Tab Nhãn hiệu | Doanh nghiệp đã được chọn, chuyển sang tab Nhãn hiệu | Gọi `ipvietnam:search` theo tên doanh nghiệp, hiển thị bảng đơn nhãn hiệu (Số đơn, Ngày nộp, Nhóm, Trạng thái) | Nếu ipvietnam lỗi/chưa có đơn: hiển thị empty state nhẹ |
| Sao chép MST | Bấm nút Copy cạnh MST | Copy vào clipboard, nút chuyển icon Check trong 1.5s | try/catch an toàn |
| Xuất CSV | Bấm nút "Xuất CSV" | Tải file `.csv` chứa thông tin công ty và nhãn hiệu có UTF-8 BOM | Không lỗi |
| Xuất JSON | Bấm nút "Xuất JSON" | Tải file `.json` chứa toàn bộ dữ liệu dossier | Không lỗi |
| Cloudflare / 403 Bot Challenge | Upstream trả về mã lỗi `XACT_4030` | Hiển thị Banner cảnh báo chống bot kèm nút Retry, không crash màn hình | Bắt lỗi ở UI state |
| Không tìm thấy | Nhập MST không tồn tại | Hiển thị empty state "Không tìm thấy doanh nghiệp" | Bắt lỗi, hiển thị thông báo |

</intent-contract>

## Code Map

- `src/scrapers/procurement/masothue/descriptor.js`: actions `search`, `detail`. `mapArgs` nhận `q`, `taxCode`, `limit`.
- `src/scrapers/procurement/masothue/normalizer.js`: `extractDetail` trả `metadata: { taxCode, companyName, address, businessLines, representativeName, phone, status, detailUrl, province }`.
- `src/scrapers/procurement/b2b-registry-extended/descriptor.js`: actions `search`, `detail`. `mapArgs` nhận `q`, `taxCode`, `limit`.
- `src/scrapers/legal/ip-trademark/descriptor.js`: actions `search_gazette`, `search`, `detail`.
- `src/scrapers/legal/ip-trademark/normalizer.js`: `normalizeIpLegalResults` trả danh sách đơn nhãn hiệu (`applicationNumber`, `applicationDate`, `publicationDate`, `status`).
- `apps/web/lib/api.ts`: Helper `api(method, path, opts)` gửi request qua BFF.
- `apps/web/lib/scrape-poll.ts`: `isAsyncAccepted`, `pollOperation` cho sync/async degrade handling.
- `apps/web/lib/nav.ts`: Menu navigation, thêm item `Enterprise VN` vào `intelligence`.
- `tests/web/dexscreener.test.js`: Pattern kiểm thử source-assertion cho các trang web.

## Tasks & Acceptance

**Execution:**
- `apps/web/app/enterprise-vn/page.tsx` -- tạo mới client component Cổng thẩm định doanh nghiệp Việt Nam. Gồm: Thanh tìm kiếm thông minh tự nhận diện MST/Tên, Thẻ hồ sơ Enterprise Dossier (Tên, MST, Đại diện, Trạng thái xanh/đỏ/vàng, Ngành nghề, Địa chỉ), Tab Nhãn hiệu IP Vietnam, Thanh công cụ Xuất CSV (kèm UTF-8 BOM)/JSON, Xử lý lỗi `XACT_4030` mượt mà với Empty State và nút Retry.
- `apps/web/lib/nav.ts` -- bổ sung `{ label: 'Enterprise VN', href: '/enterprise-vn', keywords: ['tax', 'mst', 'company', 'trademark', 'doanh nghiệp', 'pháp lý', 'b2b'] }` vào nhóm `intelligence`.
- `tests/web/enterprise-vn.test.js` -- viết test source-assertion xác minh cấu trúc kiến trúc: client component, sử dụng `api()`, gọi các action `masothue`, `ipvietnam`, xử lý UTF-8 BOM, kiểm tra trạng thái màu sắc, và đăng ký nav.

**Acceptance Criteria:**
- Given người dùng truy cập `/enterprise-vn`, when nhập MST hợp lệ, then Enterprise Dossier hiển thị đầy đủ thông tin pháp nhân và trạng thái hoạt động với màu sắc phù hợp.
- Given người dùng chuyển sang tab Nhãn hiệu, then danh mục nhãn hiệu được tra cứu từ ipvietnam và hiển thị dạng bảng rõ ràng.
- Given người dùng bấm Xuất CSV, then file CSV tải về có byte order mark `﻿` mở được bằng Excel không bị lỗi font tiếng Việt.
- Given upstream trả về lỗi bot challenge `XACT_4030`, then giao diện hiển thị Empty State cảnh báo thân thiện và nút Retry, không bị màn hình trắng.
- Given menu Sidebar, then mục "Enterprise VN" xuất hiện trong nhóm Intelligence.

## Spec Change Log

- 2026-09-30 (review): Điều chỉnh ràng buộc `mode: 'sync'` thành async lane. Các platform
  masothue / b2b_registry_extended / ipvietnam không khai báo `syncCapableActions`; ép
  `mode: 'sync'` khiến scrapeDispatch trả HTTP 400 `XACT_4001`. Trang nay gọi scrape
  không kèm `mode`, để gateway phân phối qua async lane (`isAsyncAccepted` → `pollOperation`).

## Review Triage Log

### 2026-09-30 — Review pass
- verdicts: 18 findings — high 1, medium 4, low 9, false 3, maybe-false 1
- findings:
  - `[high]` `[patch]` Các action của masothue, b2b_registry_extended và ipvietnam không hỗ trợ sync mode; việc truyền `mode: 'sync'` khiến API gateway trả lỗi 400 `action not sync-eligible` thay vì vào async lane. Sửa: bỏ `mode: 'sync'` để scrape gateway điều phối qua `isAsyncAccepted` và `pollOperation`.
  - `[medium]` `[patch]` Nhánh kiểm tra lỗi `Promise.allSettled` bỏ qua các promise bị `rejected` (network error, timeout), dẫn đến hiển thị sai thành "Không tìm thấy doanh nghiệp". Sửa: kiểm tra cả `status === 'rejected'` để lấy `reason`.
  - `[medium]` `[patch]` Bảng nhãn hiệu và hàm `generateCsv` bỏ qua trường nhóm ngành (`classes`), vốn là thông tin pháp lý quan trọng của đơn nhãn hiệu. Sửa: hiển thị cột Nhóm ngành trong bảng và xuất ra file CSV.
  - `[medium]` `[patch]` Khóa dòng nhãn hiệu `key={tm.applicationNumber || idx}` có thể bị trùng lặp nếu công báo xuất hiện nhiều giai đoạn cho cùng số đơn. Sửa: dùng `key={`${tm.applicationNumber}-${idx}`}`.
  - `[medium]` `[defer]` Cổng ipvietnam chưa hỗ trợ lọc nhãn hiệu theo tên chủ đơn qua API backend; `fetchTrademarks` hiện lấy công báo mới nhất. Cần mở rộng backend crawler để hỗ trợ tìm kiếm theo applicant name trong tương lai.
  - `[low]` `[reject]` URL search params không đồng bộ khi tự động chọn công ty duy nhất — giao diện vẫn giữ trạng thái đúng trong session; việc đồng bộ URL thuộc về cải tiến routing nhỏ.
  - `[low]` `[reject]` Thiếu AbortSignal khi unmount — các component trong apps/web đều chia sẻ vòng đời chuẩn, `pollOperation` tự ngắt khi timeout.
  - `[low]` `[reject]` Cắt ngắn chuỗi trạng thái hoạt động quá dài — badge trạng thái đã có `whitespace-nowrap truncate` kèm tooltip title, không gây vỡ giao diện.
  - `[low]` `[reject]` Thiếu xử lý lỗi khi navigator.clipboard từ chối quyền — hàm copy đã bọc trong try/catch an toàn, không gây crash ứng dụng.
  - `[low]` `[reject]` revokeObjectURL gọi đồng bộ ngay sau link.click() — chuẩn browser hiện đại đều thực thi download synchronously trước khi event loop giải phóng object URL.
  - `[low]` `[reject]` Không đọc `post.url` ngoài `meta.detailUrl` cho dossier — scraper masothue luôn chuẩn hóa `detailUrl` trong metadata.
  - `[low]` `[reject]` Bỏ qua ứng viên doanh nghiệp không có mã số thuế — doanh nghiệp bắt buộc phải có MST để thẩm định pháp lý; bỏ qua thực thể thiếu MST là hợp lý.
  - `[low]` `[reject]` Thiếu thuộc tính ARIA đầy đủ cho tab switcher — các tab hiện có nhãn ngữ nghĩa rõ ràng, giao diện trực quan.
  - `[false]` `[reject]` "Upstream scrape responds with 200 OK containing an error envelope lacking result field is treated as valid" — hàm scrape() trong page.tsx đã kiểm tra chặt chẽ `if ('result' in env)` trước khi unwrap payload.
  - `[false]` `[reject]` "handleSelectCompany gây re-fetch liên tục" — đã có `useRef(executeSearch)` và `useEffect` chỉ theo dõi `[params]`, không gây loop khi gõ phím.
  - `[false]` `[reject]` Test chỉ kiểm tra chuỗi tĩnh mà không chạy tương tác — đây là quy chuẩn chung của repo cho `tests/web/` chạy trên môi trường Node.js.
  - `[maybe-false]` `[defer]` Tên file xuất CSV/JSON có thể chứa ký tự lạ nếu MST có dấu gạch ngang — MST 13 số có dạng `0100109106-001`, ký tự `-` hoàn toàn hợp lệ trên mọi hệ điều hành.


## Verification

**Commands:**
- `npx vitest run tests/web/enterprise-vn.test.js` -- expected: tất cả test PASS
- `npx tsc --noEmit -p apps/web/tsconfig.json` -- expected: không có lỗi type mới ở `apps/web/app/enterprise-vn/page.tsx` và `apps/web/lib/nav.ts`

**Manual checks (if no CLI):**
- Mở `/enterprise-vn`, thử tìm kiếm MST `0013180180` (VNPT) hoặc `0100109106` (Viettel), chuyển tab Nhãn hiệu, bấm nút Copy MST và nút Xuất CSV.

## Auto Run Result

**Tóm tắt.** Thêm trang `/enterprise-vn` — Cổng thẩm định doanh nghiệp Việt Nam (B2B Diligence & Procurement Portal). Ô tìm kiếm thông minh tự nhận diện MST 10/13 số hoặc tên công ty, gọi song song `masothue` + `b2b_registry_extended` qua BFF async lane, hiển thị Enterprise Dossier (tên pháp lý, MST + copy, trạng thái hoạt động badge xanh/đỏ/vàng, người đại diện, địa chỉ, ngành nghề), Tab Nhãn hiệu IP Vietnam (Số đơn, Nhóm ngành Nice, ngày nộp, trạng thái), thanh công cụ xuất CSV (UTF-8 BOM) / JSON, và Empty State thân thiện kèm Retry khi gặp Cloudflare `XACT_4030`. Đăng ký "Enterprise VN" vào nhóm Intelligence trong `nav.ts`.

**File đã đổi.**
- `apps/web/app/enterprise-vn/page.tsx` — trang mới: smart input detect, dossier card, tab nhãn hiệu, export CSV/JSON, graceful XACT_4030.
- `apps/web/lib/nav.ts` — bổ sung mục `Enterprise VN` vào nhóm `intelligence`.
- `tests/web/enterprise-vn.test.js` — 18 test source-assertion khóa ràng buộc kiến trúc + async lane.

**Review (18 findings).**
- Vá:
  - 1 high: Bỏ `mode: 'sync'` khỏi toàn bộ scrape calls — các platform (masothue, b2b_registry_extended, ipvietnam) không sync-eligible, ép sync gây HTTP 400 `action not sync-eligible`; nay đi async lane qua `isAsyncAccepted`/`pollOperation`. Test bổ sung assert `.not.toContain("mode: 'sync'")`.
  - 3 medium: Xử lý nhánh `status === 'rejected'` trong `Promise.allSettled` (báo lỗi upstream thay vì "không tìm thấy"); bổ sung cột Nhóm ngành (Nice classes) vào bảng nhãn hiệu + CSV export; key dòng nhãn hiệu đổi sang `${applicationNumber}-${idx}` chống trùng key.
- Hoãn:
  - Lọc nhãn hiệu theo tên chủ đơn — backend ipvietnam chưa hỗ trợ tham số applicant (medium).
  - ARIA tabpanel/aria-controls cho tab switcher (low).
- Bác: 13 findings còn lại (9 low không gây hại thực tế / ngoài scope, 3 false đã xác minh code đúng, 1 maybe-false về ký tự `-` trong tên file).

**Follow-up review: true.** Đã vá 1 finding mức high (async lane). Cần một lượt follow-up kiểm chứng luồng polling thực tế khi gateway trả `isAsyncAccepted` trên các scraper procurement/legal.

**Xác minh.**
- `npx vitest run tests/web/enterprise-vn.test.js` — 18/18 PASS.
- `npx tsc --noEmit -p apps/web/tsconfig.json` — không lỗi mới ở các file đã đổi.

**Rủi ro còn lại.** Chưa có test E2E trình duyệt cho luồng xuất CSV BOM trên Excel thật; nhãn hiệu theo doanh nghiệp phụ thuộc việc mở rộng backend (đã defer).
