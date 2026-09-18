# Technical Specification: Story 36.2 — OSINT Fault Isolation & Adaptive Circuit Breaker

**Story:** 36.2 (Epic 36: Unified Person OSINT & Identity Harvesting Dispatcher)  
**Author:** Winston (System Architect)  
**Status:** done  
**Date:** 2026-09-18  

---

## 1. Mục tiêu kỹ thuật

Hoàn thiện cơ chế chịu lỗi từng phần (Fault Isolation) và bảo vệ hạ tầng cho `x_social_find_profiles` (AD-40 / Option D):
1. **Tier-Aware Deadline Timeouts:** Tách biệt thời gian chờ theo loại trang — Tier 0 (HTTP tĩnh / API nhẹ như Masothue, Chợ Tốt, TopCV, VietnamWorks, Reddit, Medium) = `4,000ms - 5,000ms`; Tier 1 (Puppeteer / bot-heavy như Facebook, Twitter, LinkedIn, Instagram, TikTok) = `15,000ms`. Tránh làm downstream (Nowing/ChainLens) chờ 15s vô ích khi các trang nhẹ bị treo.
2. **Error Taxonomy Chuẩn Hoá:** Phân loại mã lỗi trả về trong `platformStatus.error.code` thành các mã danh mục rõ ràng:
   - `PLATFORM_TIMEOUT`: Quá hạn deadline per-platform.
   - `RATE_LIMITED`: Bị giới hạn tần suất (HTTP 429 hoặc `XACT_4291`).
   - `BOT_BLOCKED`: Bị chặn bởi Captcha / Cloudflare / WAF (HTTP 403 hoặc `XACT_5030`).
   - `AUTH_REQUIRED`: Yêu cầu session / cookie đăng nhập (HTTP 401 hoặc `XACT_4010`).
   - `SCRAPE_ERROR`: Các lỗi logic scraper khác.
3. **Account Health Guard:** Kiểm tra trạng thái tài khoản trước khi gọi `scrape()`. Nếu `accountId` đang ở trạng thái ngủ đông (`isHibernating`) trong `AdaptiveRateGovernor`, lập tức trả về `status: 'account_sick'` mà không thực thi request, tránh làm tài khoản bị ban nặng hơn.

---

## 2. Thiết kế chi tiết (File: `src/mcp/osint-find-profiles.js`)

### 2.1. Bảng phân tầng Timeout tĩnh
```javascript
export const PLATFORM_TIMEOUTS_MS = {
  // Tier 0: Static HTML / lightweight REST (4s - 5s)
  masothue: 4_000,
  chotot: 4_000,
  topcv: 4_000,
  vietnamworks: 4_000,
  reddit: 5_000,
  medium: 5_000,
  bluesky: 6_000,
  mastodon: 6_000,
  zalo: 10_000,

  // Tier 1: Browser / heavy anti-bot / GraphQL (15s)
  twitter: 15_000,
  facebook: 15_000,
  threads: 15_000,
  instagram: 15_000,
  tiktok: 15_000,
  youtube: 15_000,
  linkedin: 15_000,
};
```
Khi người dùng gọi `executeSocialFindProfiles({ query, timeoutMs })`:
- Nếu `timeoutMs` được truyền cụ thể (> 0), áp dụng `timeoutMs` đó cho mọi platform (tôn trọng caller).
- Nếu không truyền `timeoutMs`, mỗi platform tự động áp dụng deadline từ `PLATFORM_TIMEOUTS_MS[platform] || DEFAULT_TIMEOUT_MS`.

### 2.2. Error Taxonomy Classifier
```javascript
export function classifyPlatformError(err) {
  if (!err) return { code: 'SCRAPE_ERROR', message: 'Unknown error' };
  if (err.code === 'OSINT_TIMEOUT') {
    return { code: 'PLATFORM_TIMEOUT', message: err.message };
  }
  const code = err.code || '';
  const msg = err.message || String(err);
  const status = err.status || err.statusCode;

  if (code === 'XACT_4291' || status === 429 || /rate limit/i.test(msg)) {
    return { code: 'RATE_LIMITED', message: msg };
  }
  if (code === 'XACT_5030' || status === 403 || /captcha|challenge|blocked|forbidden|anti-bot/i.test(msg)) {
    return { code: 'BOT_BLOCKED', message: msg };
  }
  if (code === 'XACT_4010' || status === 401 || /auth|login|unauthorized|session expired/i.test(msg)) {
    return { code: 'AUTH_REQUIRED', message: msg };
  }
  return { code: code || 'SCRAPE_ERROR', message: msg };
}
```

### 2.3. Account Health Guard
Tích hợp `globalAdaptiveRateGovernor`:
```javascript
import { globalAdaptiveRateGovernor } from '../core/adaptive-governor.js';

// Trong runOne(platform):
if (accountId && globalAdaptiveRateGovernor?.isHibernating(accountId, platform)) {
  return { ...base, status: 'account_sick', reason: 'account is hibernating', durationMs: elapsed(), profiles: [] };
}
```

---

## 3. Acceptance Criteria

- [x] AC-1: Platform Tier-Aware Timeout hoạt động đúng — nền tảng Tier 0 (như `chotot`, `masothue`) áp dụng 4s, Tier 1 (như `facebook`, `twitter`) áp dụng 15s khi không truyền `timeoutMs`.
- [x] AC-2: Khi caller truyền `timeoutMs`, giá trị caller ghi đè tất cả các default.
- [x] AC-3: Error taxonomy chuẩn hoá đúng 4 danh mục (`PLATFORM_TIMEOUT`, `RATE_LIMITED`, `BOT_BLOCKED`, `AUTH_REQUIRED`) thay vì báo chung chung `SCRAPE_ERROR`.
- [x] AC-4: Khi `accountId` đang ngủ đông trong `AdaptiveRateGovernor`, query bị dừng với `status: 'account_sick'`.
- [x] AC-5: 100% test hiện tại tiếp tục pass, thêm test suite mới bao phủ 3 tiêu chí trên.
