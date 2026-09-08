---
title: 'Story 34.3: Platform-Specific Validators & False-200 Detection'
type: 'feature'
created: '2026-09-08'
updated: '2026-09-08'
status: 'review'
epic: 34
story_number: 34.3
phase: 'MVP'
priority: 'high'
baseline_commit: 'a2e411e1'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md#epic-34
  - _bmad-output/planning-artifacts/backlog-epic-34.md
  - src/core/platform-validator.js
  - src/core/base-client.js
  - src/core/types.js
  - src/scrapers/social/twitter/validator.js
  - src/scrapers/social/facebook/validator.js
  - src/scrapers/ecom/shopee/validator.js
  - src/scrapers/fnb/merchant/validator.js
  - src/scrapers/procurement/masothue/validator.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trong thực tế cào dữ liệu, các nền tảng thường trả về mã phản hồi HTTP 200 kèm nội dung lỗi hoặc trang chắn bảo vệ (False 200): Cloudflare challenge pages, Arkose captchas, trang yêu cầu đăng nhập (login wall), hoặc object JSON rỗng (empty wrapper). Nếu chỉ kiểm tra `status === 200` đơn thuần, hệ thống sẽ đánh giá sai lệch tỷ lệ thành công (True Success Rate), che giấu các sự cố phân giải dữ liệu và vô hiệu hóa các cổng hạ hạng (Knock-Out Gates theo AD-26).

**Approach:**
1. **AbstractPlatformResponseValidator Enhancement (AD-30):**
   - Mở rộng lớp cơ sở `AbstractPlatformResponseValidator` (`src/core/platform-validator.js`) với phương thức composite `validateResponse(response)` trả về cấu trúc chuẩn: `{ isValid: boolean, isFalse200: boolean, isCheckpoint: boolean, isRateLimit: boolean, isAuthExpired: boolean, reason?: string }`.
   - Bổ sung phát hiện mặc định các mẫu False-200 phổ biến (Cloudflare interstitial, Arkose captcha, generic captcha, login walls, Cloudflare waiting rooms) trên toàn bộ hệ sinh thái.
   - Cung cấp các helper methods chuẩn hóa payload (`_extractText`, `_extractData`, `_extractStatus`) để mọi validator con thừa hưởng và xử lý an toàn mọi dạng response wrapper.
2. **Platform-Specific False-200 & Structural Signal Detection (AD-30):**
   - Nâng cấp các validators nền tảng hiện hữu (Twitter, Facebook, Shopee, PasGo/F&B, MaSoThue, Threads, TikTok, TopCV, Zalo, YouTube...) để kế thừa và triển khai phương thức `isFalse200(response)` và `isCheckpoint(response)` chuyên biệt dựa trên cấu trúc DOM hoặc JSON schema.
   - Định nghĩa tín hiệu dữ liệu đặc trưng cho từng nền tảng:
     - Twitter: JSON thiếu các instructions GraphQL hợp lệ hoặc trả về tombstone/unauthorized.
     - Facebook: HTML/JSON thiếu `domops`/`DTSGInitialData` hoặc trỏ đến URL `/checkpoint/`.
     - Shopee: JSON có `error: 90309999` hoặc thiếu thuộc tính `items`/`itemid`.
     - PasGo / F&B: HTML thiếu JSON-LD `Restaurant`/`LocalBusiness` hoặc chứa dưới 2 thuật ngữ F&B chuẩn.
     - MaSoThue: HTML thiếu bảng thông tin doanh nghiệp `.table-taxpayer` hoặc thiếu các trường mã số thuế.
3. **Diagnostic Bridge Integration (AD-30):**
   - Kết nối trực tiếp kết quả của `validateResponse(response)` từ `AbstractApiClient.request()` vào `TelemetryContext.recordRequest()` với các trường `isFalse200` và `isCheckpoint`.
   - Đồng bộ từ vựng định danh: `noise.false_200` và `stability.checkpoint_triggered`, đảm bảo `ScraperCanaryRun.false200Detected` và `checkpointDetected` nhận diện chính xác 100%.

## Boundaries & Constraints

**Always:**
- Phân biệt tuyệt đối giữa **True Success** (`isValid && !isFalse200 && !isCheckpoint`) và HTTP 200 thông thường (theo định nghĩa trong `metrics-catalog.md`).
- Sử dụng các tín hiệu cấu trúc (structural markers) và heuristic chuyên sâu của từng nền tảng, không chỉ dựa vào status code hoặc regex hời hợt.
- Giữ vững tính đóng gói: mã nguồn chẩn đoán False-200 nằm trong `src/core/platform-validator.js` hoặc các module validator nền tảng tương ứng `src/scrapers/**/validator.js`.
- Tuân thủ hiệu năng NFR-19: các kiểm tra regex và parsing trong validator phải diễn ra trong < 1ms trên mỗi response. Biên dịch sẵn các `RegExp` ở module level và giới hạn độ dài quét text (64KB đầu tiên).

**Ask First:**
- Trước khi thêm bất kỳ logic tự động giải CAPTCHA hoặc bypass challenge nào (việc giải quyết challenge hoàn toàn nằm ngoài phạm vi Epic 34; chỉ phát hiện và cảnh báo).

**Never:**
- KHÔNG BAO GIỜ coi một response là thành công chỉ vì `status === 200`.
- KHÔNG cố gắng gọi các thư viện bên thứ ba nặng nề (như Puppeteer parser hoặc DOM parser đầy đủ) bên trong validator trên transport hot path.

## I/O & Edge-Case Matrix

| Kịch bản | Input | Expected Output | Ghi chú xử lý |
|---|---|---|---|
| Cloudflare Turnstile / Challenge | HTTP 200 kèm HTML chứa `__cf_chl_jschl_tk__` hoặc `cf-browser-verification` | `isFalse200: true`, `isValid: false`, `isCheckpoint: true` | Đánh dấu cả false200 và checkpoint |
| Arkose / FunCaptcha | HTTP 200 kèm script `arkose` / `fc/api/` | `isFalse200: true`, `isValid: false`, `isCheckpoint: true` | Nhận diện bot challenge |
| Login Wall (Đăng nhập) | HTTP 200 kèm form password / `log in to facebook` / `Đăng nhập để tiếp tục` | `isFalse200: true`, `isCheckpoint: true`, `isLoginWall: true` | Cảnh báo login checkpoint |
| Empty Wrapper JSON | HTTP 200 kèm `{ "data": {}, "status": "ok" }` hoặc `{}` | `isFalse200: true`, `isValid: false` | Nhận diện thiếu cấu trúc dữ liệu bắt buộc |
| Rate Limit dạng 200 | HTTP 200 kèm body `{"errors":[{"code":88,"message":"Rate limit exceeded"}]}` | `isRateLimit: true`, `isValid: false` | Nhận diện rate limit ẩn trong HTTP 200 |
| Valid Platform Payload | HTTP 200 kèm đầy đủ GraphQL timeline hoặc HTML schema hợp lệ | `isValid: true`, `isFalse200: false`, `isCheckpoint: false` | True Success |
| HTTP 4xx / 5xx error | HTTP 403 / 429 / 500 kèm body lỗi | `isValid: false`, `isFalse200: false` (chỉ áp dụng false-200 cho 2xx) | Phân loại đúng mã trạng thái |

</frozen-after-approval>

## Code Map

- `src/core/platform-validator.js` (UPDATE):
  - Khai báo hằng số `GENERIC_FALSE_200_MARKERS` và `GENERIC_CHECKPOINT_MARKERS`.
  - Cài đặt helper methods: `_extractText(response)`, `_extractData(response)`, `_extractStatus(response)`.
  - Bổ sung phương thức `isFalse200(response)` và `validateResponse(response)` trên `AbstractPlatformResponseValidator`.
- `src/scrapers/social/twitter/validator.js` (UPDATE): Triển khai `isFalse200` và `isCheckpoint` cho Twitter GraphQL payload & HTML challenge.
- `src/scrapers/social/facebook/validator.js` (UPDATE): Triển khai `isFalse200` và `isCheckpoint` cho Facebook HTML/GraphQL.
- `src/scrapers/ecom/shopee/validator.js` (UPDATE): Triển khai `isFalse200` cho Shopee Web API (lỗi WAF 90309999).
- `src/scrapers/fnb/merchant/validator.js` (UPDATE): Triển khai `isFalse200` cho PasGo/Foody/Riviu (schema.org & F&B keywords).
- `src/scrapers/procurement/masothue/validator.js` (UPDATE): Triển khai `isFalse200` cho MaSoThue (table taxpayer & mst keywords).
- `tests/benchmark/platform-validators.test.js` (NEW): Test suite toàn diện với 25+ fixture cases kiểm thử nhận diện False-200 và checkpoint.

## Acceptance Criteria (BDD)

### AC 1: Generic False-200 & Composite validateResponse on AbstractPlatformResponseValidator (AD-30)
- **Given** class `AbstractPlatformResponseValidator` trong `src/core/platform-validator.js`
- **When** gọi phương thức composite `validateResponse(response)`
- **Then** phương thức trả về object `{ isValid, isFalse200, isCheckpoint, isRateLimit, isAuthExpired, reason }`.
- **And** tự động phát hiện ít nhất 5 mẫu False-200 chung phổ biến: Cloudflare challenge (`__cf_chl_jschl_tk__`, `cf-browser-verification`), Arkose captcha (`arkose`), generic captcha (`/captcha/i`), login walls (`id="login"`, `class="login"`, `sign in to`), Cloudflare waiting room (`please enable javascript`, `checking your browser`).
- **And** `isFalse200` chỉ trả về `true` khi status code của response thuộc dải 2xx (`status >= 200 && status < 300`), không gán cờ false-200 cho các mã lỗi 4xx/5xx.

### AC 2: Platform-Specific False-200 Detection for Twitter & Facebook (AD-30)
- **Given** `TwitterPlatformResponseValidator` và `FacebookPlatformResponseValidator`
- **When** nhận được response HTTP 200 nhưng không chứa dữ liệu mong đợi
- **Then** Twitter validator đánh dấu `isFalse200: true` nếu JSON GraphQL trả về mảng instructions rỗng hoặc chứa lỗi rate limit/tombstone dù HTTP status là 200.
- **And** Facebook validator đánh dấu `isFalse200: true` và `isCheckpoint: true` nếu URL chuyển hướng về `/checkpoint/` hoặc body HTML chỉ chứa form đăng nhập/xác minh danh tính dù HTTP status là 200.

### AC 3: Platform-Specific False-200 Detection for Shopee, PasGo/F&B & MaSoThue (AD-30)
- **Given** các validators `ShopeePlatformResponseValidator`, `FnbPlatformResponseValidator`, và `MaSoThuePlatformResponseValidator`
- **When** nhận được response HTTP 200 từ các nền tảng này
- **Then** Shopee validator phát hiện `error: 90309999` (WAF block) hoặc body không chứa `itemid`/`items` hợp lệ và gắn cờ `isFalse200: true`.
- **And** PasGo / F&B validator phát hiện các trang Cloudflare bot interstitial hoặc trang thiếu JSON-LD `Restaurant`/`LocalBusiness` và gắn cờ `isFalse200: true`.
- **And** MaSoThue validator phát hiện trang chặn bot hoặc trang rỗng không có `.table-taxpayer`/thông tin doanh nghiệp và gắn cờ `isFalse200: true`.

### AC 4: True Success Rate Telemetry Integration (AD-26, AD-30)
- **Given** pipeline truyền tải `AbstractApiClient.request()` tích hợp `validateResponse(response)`
- **When** request hoàn tất
- **Then** client ghi nhận chính xác `isFalse200` và `isCheckpoint` vào `telemetryContext.recordRequest(...)`.
- **And** sự kiện tổng hợp `telemetry:run` ghi nhận `isSuccess: false` nếu toàn bộ request bị False 200 hoặc checkpoint, phản ánh đúng chỉ số True Success Rate phục vụ cổng Hard Knock-Out Gates (AD-26).

### AC 5: Fixture Test Coverage (25+ Test Cases)
- **Given** file kiểm thử `tests/benchmark/platform-validators.test.js`
- **When** thực thi kiểm thử với bộ dữ liệu fixture (JSON và HTML) cho ít nhất 5 nền tảng
- **Then** 100% các ca thử nghiệm nhận diện chính xác các biến thể Cloudflare, Arkose, Login Wall, Empty Payload và Valid Content mà không có bất kỳ false positive hoặc false negative nào.

---

## Technical Notes & Contracts

### 1. AbstractPlatformResponseValidator Contract (`src/core/platform-validator.js`)

```javascript
export const GENERIC_FALSE_200_MARKERS = [
  /__cf_chl_jschl_tk__/i,
  /cf-browser-verification/i,
  /arkose/i,
  /captcha/i,
  /checking your browser before accessing/i,
  /please enable javascript and cookies/i,
  /just a moment\.\.\./i,
  /attention required! \| cloudflare/i,
];

export const GENERIC_CHECKPOINT_MARKERS = [
  /id=["']login["']/i,
  /class=["'].*login.*["']/i,
  /sign in to/i,
  /đăng nhập để tiếp tục/i,
  /confirm your identity/i,
  /\/checkpoint\//i,
];

export class AbstractPlatformResponseValidator {
  platform = 'base';

  validateResponse(response) {
    const isRate = this.isRateLimit(response);
    const isChallenge = this.isBotChallenge(response);
    const isLogin = this.isLoginWall(response);
    const isExpired = this.isAuthExpired(response);
    const isFalse = this.isFalse200(response);
    const isValid = !isRate && !isChallenge && !isLogin && !isExpired && !isFalse && this.isValidPayload(response);

    return {
      isValid,
      isFalse200: isFalse,
      isCheckpoint: isChallenge || isLogin,
      isRateLimit: isRate,
      isAuthExpired: isExpired,
    };
  }

  isFalse200(response) {
    const status = this._extractStatus(response);
    if (status < 200 || status >= 300) return false;

    // Check generic HTML markers
    const text = this._extractText(response);
    if (text) {
      const slice = text.length > 65536 ? text.slice(0, 65536) : text;
      if (GENERIC_FALSE_200_MARKERS.some((re) => re.test(slice))) return true;
      if (GENERIC_CHECKPOINT_MARKERS.some((re) => re.test(slice))) return true;
    }
    return false;
  }

  _extractStatus(response) {
    return response?.status !== undefined ? Number(response.status) : (response?.statusCode !== undefined ? Number(response.statusCode) : 200);
  }

  _extractText(response) {
    if (typeof response === 'string') return response.toLowerCase();
    const raw = response?.data ?? response?.body;
    if (typeof raw === 'string') return raw.toLowerCase();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return raw.toString('utf-8').toLowerCase();
    if (raw !== null && typeof raw === 'object') {
      try {
        return JSON.stringify(raw).toLowerCase();
      } catch {
        return '';
      }
    }
    return '';
  }

  _extractData(response) {
    const root = response?.data !== undefined ? response.data : response;
    return root?.data !== undefined ? root.data : root;
  }
}
```

---

## Dev Notes & Architecture Guardrails

### 1. Previous Story Learnings (Story 34.1 & 34.2)
- **Transport Metric Sync:** `AbstractApiClient.request()` đã được cấu hình gọi `isFalse200` và `validateResponse(res)` để gán cờ `isFalse200` và `isCheckpoint` vào `TelemetryContext.recordRequest()`.
- **False-200 vs Checkpoint Distinction:** Cần nhớ rằng trang Cloudflare hay Login Wall có mã HTTP 200 thì vừa là `isFalse200: true`, vừa là `isCheckpoint: true`. Không được loại trừ lẫn nhau.
- **Non-blocking & Zero ReDoS:** Mọi regex phải được compiled tĩnh ở module level, không dùng regex lồng nhau hoặc back-tracking không giới hạn để đảm bảo latency overhead < 1ms theo NFR-19.
- **Zero Platform Crawler Modification (AD-25):** Toàn bộ logic validation nằm trong `src/core/platform-validator.js` và các file `validator.js` chuyên biệt, TUYỆT ĐỐI KHÔNG sửa các crawler con trong `src/scrapers/**/crawler.js`.

---

## Tasks / Subtasks

- [x] **Phase 1: AbstractPlatformResponseValidator Foundation (`src/core/platform-validator.js`)**
  - [x] Khai báo hằng số `GENERIC_FALSE_200_MARKERS` và `GENERIC_CHECKPOINT_MARKERS` (AC 1).
  - [x] Cài đặt các helper methods `_extractStatus`, `_extractText`, `_extractData` (AC 1).
  - [x] Cài đặt phương thức composite `validateResponse(response)` trả về cấu trúc chuẩn (AC 1).
  - [x] Cài đặt phương thức cơ sở `isFalse200(response)` bảo vệ dải status 2xx (AC 1).

- [x] **Phase 2: Social Platform Validators (`src/scrapers/social/{twitter,facebook}/validator.js`)**
  - [x] Triển khai `isFalse200` cho `TwitterPlatformResponseValidator` (GraphQL empty instructions / tombstone) (AC 2).
  - [x] Triển khai `isFalse200` và cập nhật `isCheckpoint` cho `FacebookPlatformResponseValidator` (/checkpoint/ url & login wall) (AC 2).

- [x] **Phase 3: E-Commerce, F&B & Registry Validators (`src/scrapers/{ecom,fnb,procurement}/**/validator.js`)**
  - [x] Triển khai `isFalse200` cho `ShopeePlatformResponseValidator` (WAF error 90309999 & empty items) (AC 3).
  - [x] Triển khai `isFalse200` cho `FnbPlatformResponseValidator` (PasGo schema.org & F&B keywords) (AC 3).
  - [x] Triển khai `isFalse200` cho `MaSoThuePlatformResponseValidator` (table-taxpayer & mst signals) (AC 3).

- [x] **Phase 4: Test Suite & Fixture Validation**
  - [x] Xây dựng test suite `tests/benchmark/platform-validators.test.js` với 25+ fixture cases (AC 5).
  - [x] Kiểm chứng tương thích ngược với `AbstractApiClient.request()` và telemetry recording (AC 4).
  - [x] Chạy toàn bộ test suites hiện hữu đảm bảo không có regression.

### Review Findings

- [x] [Review][Patch] Fix greedy regex in GENERIC_CHECKPOINT_MARKERS to prevent false positives [src/core/platform-validator.js:23]
- [x] [Review][Patch] Guard validateResponse isValid with status < 400 to avoid marking 4xx/5xx errors as valid [src/core/platform-validator.js:125]
- [x] [Review][Patch] Validate Number.isFinite in _extractStatus to prevent NaN status bypass [src/core/platform-validator.js:47]
- [x] [Review][Patch] Detect empty JSON wrapper payloads in base isFalse200 [src/core/platform-validator.js:87]
- [x] [Review][Patch] Check TweetTombstone and unwrap sibling GraphQL errors in Twitter isFalse200 [src/scrapers/social/twitter/validator.js:178]
- [x] [Review][Patch] Check empty item arrays and missing itemid in Shopee isFalse200 [src/scrapers/ecom/shopee/validator.js:75]
- [x] [Review][Patch] Validate F&B structural markers in Fnb isFalse200 and refine login wall detection [src/scrapers/fnb/merchant/validator.js:114]
- [x] [Review][Patch] Fix overly restrictive conjunction in MaSoThue isFalse200 to prevent false-200 bypass [src/scrapers/procurement/masothue/validator.js:88]
- [x] [Review][Patch] Include isRateLimit check and prefix handling in Facebook isFalse200 [src/scrapers/social/facebook/validator.js:218]


---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Debug Log References
- Triển khai `GENERIC_FALSE_200_MARKERS`, `GENERIC_CHECKPOINT_MARKERS`, `_extractStatus`, `_extractText`, `_extractData`, `isFalse200`, và composite `validateResponse(response)` trên `AbstractPlatformResponseValidator` (`src/core/platform-validator.js`).
- Cài đặt `isFalse200` chuyên biệt trên các validator nền tảng: Twitter, Facebook, Shopee, PasGo/F&B, MaSoThue.
- Xây dựng 2 test suites mới: `tests/benchmark/platform-validator-base.test.js` và `tests/benchmark/platform-validators.test.js` (31 fixtures).
- Áp dụng 9 bản vá từ kết quả 4-layer Code Review: fix greedy regex, status finite check, empty JSON wrapper detection, TweetTombstone & unwrap errors, Shopee empty items, F&B navbar login wall guard, MaSoThue false-200 bypass fix, Facebook rate limit 368 detection.
- Toàn bộ 85 tests trong `tests/benchmark/` và 629 tests client/http-scraper đều vượt qua 100%.

### Completion Notes List
- 100% Acceptance Criteria (AC 1 -> AC 5) đã được hoàn thành.
- Nhận diện chính xác Cloudflare Turnstile, Arkose captcha, login walls, empty data wrappers, rate limit 200, WAF blocks.
- Đảm bảo `isFalse200` chỉ kích hoạt trên status 2xx, không đánh dấu sai các mã lỗi 4xx/5xx.

### File List
- `src/core/platform-validator.js` (UPDATE)
- `src/scrapers/social/twitter/validator.js` (UPDATE)
- `src/scrapers/social/facebook/validator.js` (UPDATE)
- `src/scrapers/ecom/shopee/validator.js` (UPDATE)
- `src/scrapers/fnb/merchant/validator.js` (UPDATE)
- `src/scrapers/procurement/masothue/validator.js` (UPDATE)
- `tests/benchmark/platform-validator-base.test.js` (NEW)
- `tests/benchmark/platform-validators.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-3-platform-validators-false-200.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Triển khai hoàn tất Phase 1 đến Phase 4 của Story 34.3, áp dụng toàn bộ 9 bản vá review và nghiệm thu thành công.

### Status
done
