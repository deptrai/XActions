---
title: 'Story 53.6 — Telemetry dims (pooled/poolBackend/poolWaitMs) + spike verify gate'
type: 'feature'
created: '2026-10-04'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '27aa9c45'
context:
  - '_bmad-output/implementation-artifacts/epic-53-context.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-02-browser-page-pool.md'
---

<intent-contract>

## Intent

**Problem:**
1. Khi scrape job chạy qua `BrowserPool` (Story 53.1–53.5), telemetry hiện tại chỉ có `browserBackend`. Hệ thống thiếu các dimensions đo lường quan trọng: `pooled` (boolean), `poolBackend` (string: 'chrome'|'obscura'), và `poolWaitMs` (number: thời gian chờ slot trong queue của pool tính bằng milliseconds). Thiếu các dims này, đội ngũ vận hành không thể phân biệt giữa job dùng pool vs job launch-per-job, không đo lường được hiệu quả của pool hay độ nghẽn (`poolWaitMs`) trong production, và không kiểm soát được SLA theo AD-24 mục 7.
2. `TelemetryEmitter` cần đảm bảo tính nhất quán: nếu cờ `XACTIONS_BROWSER_BACKEND_METRICS !== '1'`, các trường `pooled`, `poolBackend`, `poolWaitMs` phải bị loại bỏ hoàn toàn (cùng với `browserBackend`).
3. `scripts/browser-pool-spike.mjs` trước đây chỉ là một spike exploration script độc lập, cần được nâng cấp thành một pre-release / CI verification gate chuẩn (`--gate` hoặc `VERIFY_GATE=1`), xác thực tính cô lập ngữ cảnh (no state leak, `isolatedContextLeak === false`) và khả năng vận hành của BrowserPool, trả về exit code 0/1 để chặn release nếu pool bị lỗi.

**Approach:**
1. **TelemetryContext (`src/core/telemetry-context.js`)**:
   - Thêm các trường `pooled`, `poolBackend`, `poolWaitMs` vào state của context.
   - Bổ sung phương thức `setPoolTelemetry({ pooled, poolBackend, poolWaitMs })`.
   - Cập nhật `toRunPayload(runDetails)`: khi `process.env.XACTIONS_BROWSER_BACKEND_METRICS === '1'`, bổ sung các trường `pooled`, `poolBackend`, `poolWaitMs` vào payload nếu có.
2. **TelemetryEmitter (`src/core/telemetry-emitter.js`)**:
   - Trong `emitRun(payload)`: khi `process.env.XACTIONS_BROWSER_BACKEND_METRICS !== '1'`, thực hiện xóa sạch cả `browserBackend`, `pooled`, `poolBackend`, `poolWaitMs`.
3. **Adapter & Launcher Wiring (`src/scraping/stealthBrowser.js`, `src/scrapers/adapters/puppeteer.js`)**:
   - Khi `options.pooled` được bật và `pool.acquire()` trả về lease (`{ page, context, backend, waitMs, pageMs, endpoint }`), gọi `telemetryContext.setPoolTelemetry({ pooled: true, poolBackend: lease.backend, poolWaitMs: lease.waitMs })`.
   - Giữ nguyên `setBrowserBackend(lease.backend)` để duy trì tương thích ngược.
4. **Spike Verify Gate (`scripts/browser-pool-spike.mjs`) & package.json**:
   - Hỗ trợ tham số dòng lệnh `--gate` hoặc biến môi trường `VERIFY_GATE=1`.
   - Ở chế độ gate: chạy scenario `pool-isolated-context` (với backend tương ứng), xác nhận `isolatedContextLeak === false`, tỷ lệ thành công 100% (`failed === 0`), không có `fatal` error. Trả về `process.exit(0)` nếu pass, `process.exit(1)` nếu fail.
   - Thêm npm script `"verify:browser-pool": "node scripts/browser-pool-spike.mjs --gate"`.
5. **Quality Verification**:
   - Viết test suite toàn diện `tests/scraping/browser-pool-telemetry.test.js`.
   - Kiểm tra typecheck và test pass 100%.

## Boundaries & Constraints

**Always:**
- Kiểm tra cờ `process.env.XACTIONS_BROWSER_BACKEND_METRICS === '1'` nghiêm ngặt. Khi cờ không bằng `'1'` (bao gồm undefined), không một trường telemetry pool nào (`pooled`, `poolBackend`, `poolWaitMs`, `browserBackend`) được phép xuất hiện trong emitted run payload.
- Mọi trường dữ liệu số (`poolWaitMs`) phải là kiểu number hợp lệ, không âm.
- `stealthBrowser.js` và `puppeteer.js` kiểm tra an toàn sự tồn tại của `options.telemetryContext` và phương thức `setPoolTelemetry` trước khi gọi.
- Không phá vỡ bất kỳ bài kiểm tra hiện tại nào của telemetry pipeline và browser pool.

</intent-contract>
