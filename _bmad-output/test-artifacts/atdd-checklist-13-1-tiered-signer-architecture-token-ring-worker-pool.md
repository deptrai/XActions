# ATDD Checklist — Story 13.1: Tiered Signer Architecture (Pre-Signed Token Ring & Worker Page Pool)

**Story ID:** 13.1  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine  
**Status:** 🟢 GREEN Phase (ATDD Complete & Verified)  
**Author:** Master Test Architect (TEA) & Senior Dev (Amelia)  
**Target Files:**
- `src/core/signer-pool.js`
- `src/core/base-client.js`
- `types/core.d.ts`
- `tests/core/signer-pool.test.js`
- `tests/core/base-client-sign.test.js`

---

## 📋 Acceptance Test Coverage Matrix

| AC # | Yêu cầu Kỹ thuật / Test Case | File Kiểm thử | Trạng thái Green Phase |
|---|---|---|:---:|
| **AC-1** | `PreSignedTokenRing` O(1) synchronous token allocation, capacity clamp, round-robin wrap, size, isEmpty, refill reset | `tests/core/signer-pool.test.js` | 🟢 PASS (3/3) |
| **AC-2** | `SignerWorkerPagePool.init()` khởi tạo `minSize` (4) pages với state `idle`, `load: 0` | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-2** | `SignerWorkerPagePool.evaluate()` chọn page theo thuật toán Least-Connections | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-2** | `SignerWorkerPagePool` timeout handling (3000ms default, 8000ms warmup) bọc trong Promise.race | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-2** | Tự động đánh dấu `state: 'dead'`, spawn thay thế nếu `< maxSize`, retry tối đa 1 lần | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-2** | Ném `PlatformError` code `XACT_5000` khi toàn bộ pages `dead` hoặc vượt quá `maxSize` | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-2** | `SignerWorkerPagePool.close()` đóng toàn bộ worker pages an toàn | `tests/core/signer-pool.test.js` | 🟢 PASS (1/1) |
| **AC-3** | `AbstractApiClient.requestWithSign` dispatch sang `tokenRing` khi `signType === 'token'` (header/query/cookie injection) | `tests/core/base-client-sign.test.js` | 🟢 PASS (2/2) |
| **AC-3** | `AbstractApiClient.requestWithSign` dispatch sang `signerPool` khi `signType === 'page'` (`evaluate` script & merge options) | `tests/core/base-client-sign.test.js` | 🟢 PASS (1/1) |
| **AC-3** | Fallback về `this.sign(payload)` khi không có `tokenRing` / `signerPool` | `tests/core/base-client-sign.test.js` | 🟢 PASS (1/1) |
| **AC-4** | `requestWithSign` chuyển tiếp request qua pipeline `request()` giữ nguyên AC-1 -> AC-9 của Story 11.3 | `tests/core/base-client-sign.test.js` | 🟢 PASS (12/12 regression) |
| **AC-5** | Default HTTP client factory xử lý `undici` và `got-scraping` với proxy dispatcher/proxyUrl đúng chuẩn | `tests/core/base-client-sign.test.js` | 🟢 PASS (1/1) |
| **AC-6** | Đồng bộ cookie từ sign result vào `this.cookies` và gửi header `Cookie` tự động | `tests/core/base-client-sign.test.js` | 🟢 PASS (1/1) |
| **AC-7** | TypeScript type declarations trong `types/core.d.ts` cho `SignPayload`, `SignResult`, `requestWithSign` | `npx tsc --noEmit` | 🟢 PASS (Clean) |

---

## 🎯 Verification Summary (Green Phase)

- `npx vitest run tests/core/` $\rightarrow$ **13/13 test files PASS, 152/152 tests PASS**.
- `npx tsc --noEmit` $\rightarrow$ **0 errors (Clean TypeScript build)**.
