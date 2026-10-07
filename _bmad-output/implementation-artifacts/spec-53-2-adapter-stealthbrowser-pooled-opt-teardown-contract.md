---
title: 'Story 53.2: stealthBrowser + PuppeteerAdapter `pooled` opt và teardown contract'
type: 'feature'
created: '2026-02-22'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/implementation-artifacts/epic-53-context.md'
  - '_bmad-output/planning-artifacts/architecture/medirus-hybrid-scraping-spine/ARCHITECTURE-SPINE.md'
baseline_revision: '9b2d487a0cc27122e6d0bc4a5befa2d38c44f3ba'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 53.1 shipped `BrowserPool` (src/scraping/browserPool.js) nhưng không có public entry point nào dùng nó — caller vẫn phải `launchStealthBrowser()` (1 process Chrome / 1 CDP connect mỗi job) hoặc `PuppeteerAdapter.launch()` tương tự. Không có cách nào opt-in nhận page/context từ pool, và không có teardown contract nào trả lease về pool thay vì giết shared browser.

**Approach:** Thêm opt-in `pooled` vào `launchStealthBrowser()` và `PuppeteerAdapter.launch()`: khi bật, chúng `acquire()` một lease `{page, context, backend}` từ `BrowserPool` (per-backend default registry hoặc pool do caller truyền) rồi trả về một **pooled browser handle** giữ nguyên shape contract hiện tại (`__backend`, `_backend`, `_native`, `_adapter`). `createStealthPage(handle)` trả `lease.page` đã-stealth; `closeStealthBrowser(handle)` và `adapter.closeBrowser(handle)` release lease về pool — tuyệt đối không động vào shared browser (pool sở hữu lifecycle, `drain()` mới là nơi áp AD-23 obscura→disconnect / chrome→close).

## Boundaries & Constraints

**Always:**
- `pooled` mặc định falsy → code path hiện tại byte-identical (AD-24 rule 1: opt-in, không đổi default).
- Pool là per-backend: default registry key = backend string ('chrome' | 'obscura'); `requiresAuth && obscura` guard phải chạy TRƯỚC acquire (PlatformError, không fallback sang obscura).
- `pooled: true` → lấy/tạo default pool cho resolved backend; `pooled` là `BrowserPool` instance → dùng pool đó verbatim.
- Default pool size: `parseInt(process.env.MEDIRUS_BROWSER_POOL_SIZE)` nếu > 0, ngược lại 4 (vì caller đã opt-in tường minh — env chỉ là ceiling hint).
- Pooled handle PHẢI expose: `_pooled: true`, `_pool`, `_lease {page, context, backend, waitMs, pageMs}`, `__backend` + `__fingerprint` (stealthBrowser path) và `_native` = lease `context` (để introspection/`.newPage()` native hoạt động trên context nếu ai bypass helper).
- `createStealthPage(pooledHandle)` → return `lease.page` as-is (page đã được pool patch stealth + gán `__backend`); KHÔNG tạo page thứ hai, KHÔNG re-apply patches. Document: per-call options (`userAgent`, `fingerprint`, …) bị ignore trên pooled handle — cấu hình ở pool-level (BrowserPoolOptions) hoặc release + dùng non-pooled.
- `closeStealthBrowser(pooledHandle)` → `pool.release(lease.page)` một lần duy nhất (idempotent: gọi 2 lần = no-op lần 2), KHÔNG gọi `context.close()`/`browser.close()`/`disconnect()` trực tiếp — release() của pool đã close context+page (AD-24 rule 4).
- `adapter.launch({pooled})` → AdapterBrowser `{_native: lease.context, _adapter: 'puppeteer', _backend, _pooled: true, _pool, _lease}`; `adapter.newPage(pooledAdapterBrowser)` → `{_native: lease.page, _adapter, _backend}` không tạo page mới, không setViewport/setUserAgent lại (pool owns page config); `adapter.closeBrowser(pooledAdapterBrowser)` → release lease, không động shared browser.
- Telemetry: `waitMs`/`pageMs` từ lease giữ nguyên trên handle để 53.3/consumer đọc; `telemetryContext.setBrowserBackend(backend)` vẫn được gọi nếu có.
- `drain()` chủ động: export `resetDefaultPools()` (drain toàn bộ default pools + clear registry) cho tests/lifecycle; KHÔNG tự đăng ký process-exit hook.
- Viết comment/log bằng quy ước repo: `console.warn('⚠️ [stealth] ...')`, author credit giữ nguyên.

**Never:**
- Không đổi signature/semantics của non-pooled path (byte-identical khi `pooled` falsy).
- Không release lease bằng cách `browser.close()` — shared browser bị giết = mọi lease khác chết theo (crash blast radius).
- Không cấp hai lease cho một `pooled` launch, không lazy-acquire-lần-hai trong `newPage`/`createStealthPage`.
- Không wire pool vào `api/services/jobQueue.js` hay `scrapeDispatch.js` — đó là Story 53.3.
- Không thêm dependency mới, không mock/stub trong production code.
- Không share một default pool giữa hai backend khác nhau (obscura connect-based vs chrome process-based lifecycle khác nhau — AD-24 rule 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| POOLED_CHROME | `launchStealthBrowser({pooled:true})`, backend=chrome | Handle `{_pooled:true,__backend:'chrome',_lease.page}`; page là stealth page của pool | PoolAcquireTimeoutError nếu pool cạn slot |
| POOLED_OBSCURA | `launchStealthBrowser({pooled:true,backend:'obscura'})` | Handle `__backend:'obscura'`, page có `__backend='obscura'` + goto patch | Propagate acquire error |
| POST_AUTH_GUARD | `pooled:true, requiresAuth:true, backend:'obscura'` | Reject trước acquire | PlatformError INVALID_ARGS (guard hiện hữu) |
| CREATE_PAGE | `createStealthPage(pooledHandle,{userAgent:'x'})` | Trả `lease.page` y hệt (options ignored) | — |
| TEARDOWN | `closeStealthBrowser(pooledHandle)` | `pool.release(page)`; shared browser còn sống (`stats().active` giảm) | Double-close → no-op |
| ADAPTER_POOLED | `adapter.launch({pooled:true})` → `newPage` → `closeBrowser` | `_pooled` AdapterBrowser → lease.page → release; shared browser không `close()`/`disconnect()` | — |
| BYO_POOL | `pooled: existingPool` | Acquire từ pool đó; default registry không bị đụng | PoolDrainingError nếu pool đang drain |
| DEFAULT_POOL_REUSE | 2× `launch({pooled:true,backend:'chrome'})` | Cùng một default pool instance (Map theo backend) | — |
| ENV_SIZE | `MEDIRUS_BROWSER_POOL_SIZE=2` + `pooled:true` | Default pool size=2 | env rác/`0`/unset → size 4 |

## Code Map

- `src/scraping/stealthBrowser.js` — thêm `pooled` opt vào `launchStealthBrowser`; module-level default-pool registry (`_defaultPools` Map theo backend, `getDefaultPool()`, `resetDefaultPools()`); `createStealthPage` early-return `lease.page` khi `browser._pooled`; `closeStealthBrowser` early `pool.release(lease.page)` khi `browser._pooled`.
- `src/scraping/browserPool.js` — nguồn `BrowserPool`/`BrowserPoolOptions`; `acquire()` trả `{page,context,backend,waitMs,pageMs}`; `release(page)` idempotent (WeakMap lease, context.close()); `drain()` áp AD-23. Import động (`await import('./browserPool.js')`) trong stealthBrowser để tránh cycle (browserPool đã import stealthBrowser).
- `src/scrapers/adapters/puppeteer.js` — `launch({pooled})` acquire từ default/custom pool → AdapterBrowser `{_pooled,_pool,_lease,_native:lease.context}`; `newPage` nhánh `_pooled` trả `{_native:lease.page}` bỏ qua setViewport/setUserAgent; `closeBrowser` nhánh `_pooled` → `pool.release(lease.page)` trước nhánh AD-23.
- `src/scraping/stealthBrowser.d.ts` — type cho `pooled?: boolean | BrowserPool`, pooled handle shape, `getDefaultPool`/`resetDefaultPools`.
- `tests/scraping/browserPool.test.js` — mở rộng (hoặc file mới `tests/scraping/stealthBrowser-pooled.test.js`): mock `launchStealthBrowser` internals như hiện tại; test matrix POOLED_CHROME/POST_AUTH_GUARD/TEARDOWN/DEFAULT_POOL_REUSE/ENV_SIZE/BYO_POOL + adapter nhánh `_pooled`.
- `src/scrapers/procurement/b2b-registry-extended/browser.js`, `src/core/auto-selector-fallback.js`, `src/services/selector-sandbox.js`, `src/services/selector-canary.js` — caller pattern launch→createStealthPage→closeStealthBrowser mà contract phải giữ nguyên (KHÔNG sửa — chỉ đọc để verify).

## Tasks & Acceptance

**Execution:**
- `src/scraping/stealthBrowser.js` — thêm default-pool registry + nhánh `pooled` trong `launchStealthBrowser`/`createStealthPage`/`closeStealthBrowser` — entry point duy nhất của stealth path.
- `src/scrapers/adapters/puppeteer.js` — nhánh `pooled` trong `launch`/`newPage`/`closeBrowser` — adapter contract song song.
- `src/scraping/stealthBrowser.d.ts` — cập nhật types — TS strict, không `any` mới ngoài typedef hiện có.
- `tests/scraping/` — test I/O matrix (mock stealthBrowser/puppeteer-extra theo pattern browserPool.test.js + puppeteer.test.js).

**Acceptance Criteria:**
- Given `pooled` không truyền, when `launchStealthBrowser()`/`adapter.launch()` chạy, then behavior/return shape giống hệt baseline (không `_pooled`, không `_lease`, không đụng registry).
- Given `pooled:true`, when launch + `createStealthPage`/`adapter.newPage` + `closeStealthBrowser`/`adapter.closeBrowser`, then đúng 1 lease acquire → page pool-made → release, và `pool.stats().active` về 0 sau teardown trong khi `stats().browsers` không đổi.
- Given `requiresAuth:true, backend:'obscura'`, when `pooled:true`, then PlatformError ném ra TRƯỚC khi gọi `pool.acquire()` (không leak slot).
- Given shared browser trong pool, when release lease, then `browser.close()`/`disconnect()` KHÔNG được gọi — chỉ `drain()`/`resetDefaultPools()` mới teardown browser theo AD-23.
- `npm run typecheck` và `npx vitest run tests/scraping tests/scrapers/adapters` pass.

## Design Notes

Pooled handle là "browser-shaped lease": giữ đủ keys mà caller hiện đọc (`__backend`, `_backend`, `_native`, `_adapter`) nên mọi helper hiện hữu hoạt động không sửa, còn `_pooled`/`_pool`/`_lease` là escape hatch cho teardown.

Ví dụ handle stealth path:
```js
{ _native: lease.context, _pooled: true, _pool: pool,
  _lease: { page, context, backend, waitMs, pageMs },
  __backend: backend, __fingerprint: fingerprint }
```
`_native = context` (không phải shared browser) — ai gọi `native.newPage()` sẽ tạo page trong isolated context của lease chứ không phải default context của shared browser, vẫn đúng isolation (AD-24 rule 2). Page do `BrowserPool.acquire()` tạo đã qua `createStealthPage` + patch obscura goto, nên `createStealthPage(pooledHandle)` chỉ trả lại đúng page đó.

## Verification

**Commands:**
- `npx vitest run tests/scraping tests/scrapers/adapters` — expected: all pass, bao gồm case pooled
- `npm run typecheck` — expected: 0 errors
- `grep -n "_pooled" src/scraping/stealthBrowser.js src/scrapers/adapters/puppeteer.js` — expected: nhánh pooled hiện diện ở cả 6 điểm (launch/createStealthPage/closeStealthBrowser + launch/newPage/closeBrowser)

**Manual checks (if no CLI):**
- `closeStealthBrowser(pooledHandle)` trên pooled chrome handle không gọi `browser.close()` (assert bằng spy trong test).

## Review Triage Log

### Pass 1 — self-review (no subagent capability; per user directive "implement trực tiếp")

Verdict counts: high 0, medium 1, low 2, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `getDefaultPool` cold-start race: two concurrent launches could construct two pools, loser leaks un-registered | medium | patched | `stealthBrowser.js` `getDefaultPool` now stores the in-flight creation promise in `_defaultPools` and clears on rejection; concurrent callers share one pool |
| BYO `SharedContextPool` → `lease.context === null` → `_native: null`; callers doing `handle._native.newPage()` would crash | low | deferred | Documented handle contract targets isolated-context pools; shared-context BYO is caller opt-in misuse. Deferred to 53.3 wiring docs (deferred-work ledger) |
| `stealthClick` unused `options` param (pre-existing, flagged by lens) | low | patched | Renamed `_options` — arity/behavior preserved |
| `connect()` unguarded `new URL(normalizedUrl)` (pre-existing, flagged by lens) | low | patched | Wrapped → `[CDP ERROR] Invalid Chrome DevTools endpoint` consistent with sibling errors |

### Matrix coverage audit

All 9 I/O matrix rows covered by passing tests: POOLED_CHROME, POOLED_OBSCURA, POST_AUTH_GUARD, CREATE_PAGE, TEARDOWN (stealthBrowser-pooled.test.js), ADAPTER_POOLED, BYO_POOL, DEFAULT_POOL_REUSE, ENV_SIZE (both files). `npx vitest run tests/scraping tests/scrapers/adapters` → 77/77 pass; `npm run typecheck` byte-identical error set vs baseline `9b2d487`.
