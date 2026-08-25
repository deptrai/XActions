# ATDD Checklist — Story 13.1: Tiered Signer Architecture (Pre-Signed Token Ring & Worker Page Pool)

**Story ID:** 13.1  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine  
**Status:** 🔴 RED Phase (ATDD Initialized)  
**Author:** Master Test Architect (TEA)  
**Target Files:**
- `src/core/signer-pool.js`
- `src/core/base-client.js`
- `types/core.d.ts`
- `tests/core/signer-pool.test.js`
- `tests/core/base-client-sign.test.js`

---

## 📋 Acceptance Test Coverage Matrix

| AC # | Yêu cầu Kỹ thuật / Test Case | File Kiểm thử | Trạng thái Red Phase |
|---|---|---|:---:|
| **AC-1** | `PreSignedTokenRing` O(1) synchronous token allocation, capacity clamp, round-robin wrap, size, isEmpty, refill reset | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | `SignerWorkerPagePool.init()` khởi tạo `minSize` (4) pages với state `idle`, `load: 0` | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | `SignerWorkerPagePool.evaluate()` chọn page theo thuật toán Least-Connections | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | `SignerWorkerPagePool` timeout handling (3000ms default, 8000ms warmup) bọc trong Promise.race | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | Tự động đánh dấu `state: 'dead'`, spawn thay thế nếu `< maxSize`, retry tối đa 1 lần | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | Ném `PlatformError` code `XACT_5000` khi toàn bộ pages `dead` hoặc vượt quá `maxSize` | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-2** | `SignerWorkerPagePool.close()` đóng toàn bộ worker pages an toàn | `tests/core/signer-pool.test.js` | 🔴 RED / PENDING |
| **AC-3** | `AbstractApiClient.requestWithSign` dispatch sang `tokenRing` khi `signType === 'token'` (header/query/cookie injection) | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-3** | `AbstractApiClient.requestWithSign` dispatch sang `signerPool` khi `signType === 'page'` (`evaluate` script & merge options) | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-3** | Fallback về `this.sign(payload)` khi không có `tokenRing` / `signerPool` | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-4** | `requestWithSign` chuyển tiếp request qua pipeline `request()` giữ nguyên AC-1 -> AC-9 của Story 11.3 | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-5** | Default HTTP client factory xử lý `undici` và `got-scraping` với proxy dispatcher/proxyUrl đúng chuẩn | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-6** | Đồng bộ cookie từ sign result vào `this.cookies` và gửi header `Cookie` tự động | `tests/core/base-client-sign.test.js` | 🔴 RED / PENDING |
| **AC-7** | TypeScript type declarations trong `types/core.d.ts` cho `SignPayload`, `SignResult`, `requestWithSign` | `npx tsc --noEmit` | 🔴 RED / PENDING |

---

## 🎯 Verification Plan (Red ➔ Green Transition)

1. Chạy `npx vitest run tests/core/signer-pool.test.js tests/core/base-client-sign.test.js` để xác nhận các test fail đúng do code chưa implement (Method not implemented / undefined).
2. Chuyển giao sang **Amelia (DEV)** để triển khai logic trong `src/core/signer-pool.js` và `src/core/base-client.js`.
3. Chạy lại test suite để chuyển toàn bộ sang 🟢 GREEN Phase.
