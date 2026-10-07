---
title: '53.1 BrowserPool Core — acquire/release/drain/stats + isolated contexts'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_commit: '958e9419373ae4e1f7653bb2e50a38d05a5fde8f'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Scrape jobs hiện launch một browser process riêng mỗi job (~300–500MB Chrome), kẹt concurrency ở 2 và chặn mục tiêu RAM/tốc độ (NFR-11/12). Cần một pool chia sẻ browser phục vụ N job qua page/context — nhưng nền (core pool) phải đúng isolation contract trước khi adapter/jobQueue được nối vào (53.2+).

**Approach:** Tạo `src/scraping/browserPool.js` — class `BrowserPool` per-backend với `acquire()` trả page trong **isolated `browserContext`** mặc định, `release()` chỉ đóng context/page (không đụng browser), FIFO queue khi cạn slot, `drain()`, `stats()`. Kèm `SharedContextPool` opt-in tường minh cho anonymous public scraping. Opt-in toàn bộ qua `MEDIRUS_BROWSER_POOL_SIZE` (default 0 = không dùng).

## Boundaries & Constraints

**Always:**
- Mỗi `acquire()` trả một page trong `browserContext` riêng (incognito-equivalent) — mặc định isolated, cookie/storage không leak cross-job (spike đo `isoLeak=false`, shared `leak=true`).
- `release(page)` đóng page + context của job đó; **không** đóng/disconnect shared browser. Browser lifecycle thuộc pool. Acquire fail giữa chừng (createBrowserContext throw) → giải phóng slot + đánh thức waiter tiếp theo.
- Hết slot → FIFO wait queue (backpressure), không reject, không spawn vô hạn. `acquireTimeoutMs` option (default 0 = chờ vô hạn); timeout → reject `PoolAcquireTimeoutError` để caller (Bull) không bị kẹt vĩnh viễn.
- Context ceiling per-browser theo backend (AD-24 Rule 3): chrome ~4–6 contexts/browser → spawn browser mới khi vượt và còn slot; obscura giữ ít page/connection (~2–4) — cấu hình qua `contextsPerBrowser`, default `5` cho chrome / `3` cho obscura.
- Pool launch browser **lazy** ở acquire đầu tiên qua `launchStealthBrowser({backend, fallbackBackend:'none', proxy, headless})` — reuse nguyên xi AD-23 backend resolution + post-auth guard (`requiresAuth:true` + obscura → throw). Pool phải propagate `browser.__fingerprint` xuống `createStealthPage` (qua opt `fingerprint`) — page từ `context` không nhìn thấy `browser.__fingerprint`, thiếu sẽ phá fingerprint-stable (Story 27.1).
- `drain()` từ chối acquire mới, đợi in-flight release xong, rồi teardown mọi browser theo AD-23 (`closeStealthBrowser`: obscura→`disconnect()`, chrome→`close()`). Idempotent — gọi lại trả cùng promise, không race teardown.

**Never:**
- Không sửa `stealthBrowser.js`, adapter, `jobQueue.js` — wiring là story 53.2/53.3.
- Không crash-containment/respawn (story 53.5), không telemetry dims (story 53.6).
- Không shared-context mặc định; `SharedContextPool` chỉ tồn tại như class opt-in riêng, không tự động được chọn.
- Không đổi hành vi khi flag tắt — file mới, không import vào code path hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_ACQUIRE | pool size 4, 1 job | `acquire()` → `{page, context, backend, waitMs, pageMs}` trong isolated context; `stats().active=1` | N/A |
| BACKPRESSURE | size 2, 4 job đồng thời | job 3–4 xếp hàng FIFO; nhận slot theo thứ tự release; `waitMs` > 0 | timeout → `PoolAcquireTimeoutError` |
| STATS | pool đang chạy | `stats()` = `{size, active, queued, browsers, draining}` | N/A |
| CEILING_SPAWN | chrome, size 6, contextsPerBrowser 5 | acquire thứ 6 → spawn browser thứ hai | launch fail → throw, waiter được đánh thức |
| ISOLATION | job A set cookie | job B (context khác) không thấy cookie | N/A |
| RELEASE_CLEAN | page đã release | browser process sống; `stats().active` giảm | close context lỗi → nuốt lỗi, vẫn giải phóng slot |
| DRAIN | `drain()` khi 2 job in-flight + 1 waiter | waiter reject `PoolDrainingError`; đợi in-flight; browser teardown theo backend; gọi lần 2 → cùng promise | teardown lỗi → vẫn resolve drain |
| REQUIRES_AUTH | `requiresAuth:true`, backend obscura | `acquire()` reject PlatformError ngay | propagate lỗi guard AD-23 |
| OBSCURA_BACKEND | backend obscura, wsEndpoint | `puppeteer-core.connect` tới `OBSCURA_WS_ENDPOINT`; context ceiling 3 | connect fail → fallback 'none' → throw |
| SHARED_POOL_OPT | `new SharedContextPool(...)` | acquire trả page trong default context chung (chỉ public anon) | release chỉ close page |

</frozen-after-approval>

## Code Map

- `src/scraping/browserPool.js` — **FILE MỚI**, duy nhất trong story này
- `src/scraping/stealthBrowser.js` — reuse nguyên xi: `launchStealthBrowser()` (backend resolution, post-auth guard, fingerprint), `closeStealthBrowser()` (AD-23 teardown), `createStealthPage(browser, opts)` (áp stealth patches lên page — nhưng cần page từ context; kiểm tra signature: nhận `browser`, gọi `browser.newPage()` → cho isolated context cần gọi `context.newPage()`; wrapper page-level phải chấp nhận context làm source)
- `scripts/browser-pool-spike.mjs` — `SpikeBrowserPool` (lines ~85–120) là prototype đã đo: acquire/release/stats/queue skeleton → promote thành production
- `src/scrapers/adapters/puppeteer.js` — contract `_native`/`_backend`/`__backend` để tái dùng ở 53.2 (chỉ đọc, không sửa)
- `api/services/jobQueue.js:538` — `scrapeQueue.process('scrape', 2, ...)` (surface của 53.3; chỉ đọc)

## Tasks & Acceptance

**Execution:**
- [x] `src/scraping/browserPool.js` — implement `BrowserPool` + `SharedContextPool` + `PoolDrainingError` + `PoolAcquireTimeoutError`; lazy launch qua `launchStealthBrowser`; acquire trả `{page, context, backend, waitMs, pageMs}`; gọi `createStealthPage(context, {fingerprint: browser.__fingerprint, ...})` — `BrowserContext.newPage()` cùng signature nên không cần sửa `stealthBrowser.js`; KHÔNG sửa stealthBrowser.js ở story này
- [x] `tests/scraping/browserPool.test.js` — unit test I/O matrix: acquire/release/stats/backpressure FIFO/isolation/drain/guard (mock launchStealthBrowser nếu cần, ưu tiên browser thật nhẹ hoặc fake context object — test contract không test Chrome)
- [x] `src/scraping/browserPool.d.ts` — type stub theo convention (`stealthBrowser.d.ts`, `paginationEngine.d.ts` tồn tại)

**Acceptance Criteria:**
- Given `MEDIRUS_BROWSER_POOL_SIZE=0` (hoặc không set), when code path hiện có chạy, then không file nào import browserPool — zero behavior change.
- Given pool size N, when N+1 acquire đồng thời, then acquire thứ N+1 block cho tới khi có release, và slot được trao theo thứ tự FIFO.
- Given `release(page)`, when gọi xong, then shared browser vẫn sống và acquire tiếp được (Q5).
- Given 2 isolated context, when job A ghi cookie/localStorage, then job B không đọc được (Q1, spike-verified).
- Given `drain()`, when đang chạy, then acquire mới reject có tên lỗi rõ ràng, in-flight hoàn tất, browser teardown theo đúng backend contract.

## Implementation Notes

- Implemented 2026-10-03 (baseline `958e9419`). `BrowserPool` + `SharedContextPool` + `PoolDrainingError` + `PoolAcquireTimeoutError` trong `src/scraping/browserPool.js` (~360 dòng).
- **Quyết định trong lúc implement:** `_waitForSlot` grant slot **atomic** (active++ trong cùng synchronous check hoặc tại `_wakeNext` khi transfer) — tránh race oversubscribe khi 2 acquire cùng tick; `!queue.length` guard giữ fairness FIFO.
- `_leases` dùng `WeakMap` — job crash quên release không leak lease entry.
- Fingerprint propagation: `acquire()` truyền `browser.__fingerprint` vào `createStealthPage(context, {fingerprint})` — page từ context không đọc được `browser.__fingerprint`.
- `drain()` memoize `_drainPromise` (idempotent), reject toàn bộ waiters trước khi đợi idle, teardown qua `closeStealthBrowser` (AD-23).
- Launch fail được wrap `BrowserPool: launch failed for backend` + `cause` giữ nguyên.
- TS strict (`checkJs`): thêm `BrowserPoolOptions` typedef, `PoolAcquire`/`PoolStats` interfaces ở `.d.ts`.
- Verify: `npx vitest run tests/scraping/browserPool.test.js` → **12/12 pass**; module import sạch; `createStealthPage(context)` hoạt động vì `BrowserContext.newPage()` cùng signature — `stealthBrowser.js` không sửa đúng như spec.

**Post-review fixes (2026-10-03, 16 patches applied — 19/19 tests pass):**
- Fix `drain()` deadlock: `acquire()` catch giờ check `_onIdle` + cleanup orphan context trước khi throw.
- Fix `_waitForSlot` grant slot khi draining: move `_draining` check lên trước slot-grant check.
- Fix spawn race: `_spawnLock` re-check headroom bên trong lock trước khi spawn; `entry.pending` reservation atomic với `find()` trước `await createBrowserContext` → không vượt `contextsPerBrowser` khi concurrent.
- Fix SharedContextPool spawn race: route `_ensureBrowser(0)` qua `_spawnLock` (`_spawnSharedBrowser`).
- Fix spawn-drain orphan: `_ensureBrowser` check `_draining` sau launch → close browser + throw `PoolDrainingError`.
- Fix Obscura contract: propagate `browser.__backend` lên `context.__backend` → `createStealthPage` detect `isObscura` đúng → `page.__backend` + `networkidle0` goto patch hoạt động; thêm `fingerprintManager`/`accountId`/`platform` vào `_launchOptions` → `browser.__fingerprint` được resolve.
- Fix error wrap: preserve `type`/`suggestedAction` + `Object.setPrototypeOf` → `instanceof PlatformError` vẫn đúng.
- Fix silent degradation: throw explicit error khi `createBrowserContext` unavailable/null thay vì fallback shared context.
- Fix `size:0` falsy-coerce: dùng `Number.isFinite` thay `||` → size 0 được honor.
- Fix `_wakeNext` recursion → while loop.
- Xóa `SharedContextPool.release()` override (parent `if (lease.context)` guard đủ).

## Spec Change Log

## Review Triage Log

## Design Notes

Pool core chỉ giải quyết "đơn vị công việc = context". Sharding obscura nhiều process (53.4) là policy layer phía trên — core chỉ cần `contextsPerBrowser` khả cấu hình. `SharedContextPool` kế thừa/`BrowserPool` với `isolated:false` — tách class để opt-in tường minh ở call site (Rule 2 AD-24).

## Verification

**Commands:**
- `node --test tests/scraping/browserPool.test.js` — expected: all pass (hoặc runner hiện có: `npx vitest run tests/scraping/` — check `package.json` scripts trước)
- `node -e "import('./src/scraping/browserPool.js').then(m=>console.log(Object.keys(m)))"` — module load sạch

### Review Findings

**Code review 2026-10-03 — 4 layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor**

#### Group A — Slot/lifecycle race conditions (root cause: missing state checks in error/drain paths)

- [x] [Review][Patch] drain() deadlock khi acquire() in-flight gặp lỗi — `_active` giảm về 0 nhưng `_onIdle` không được resolve → drain() treo vĩnh viễn [`src/scraping/browserPool.js:161-165`]
- [x] [Review][Patch] `_waitForSlot()` cấp slot khi `_draining=true` — check `_active < _size` chạy trước check `_draining` → acquire mới được cấp slot trong khi drain [`src/scraping/browserPool.js:242-246`]
- [x] [Review][Patch] Browser mới spawn đồng thời với drain() bị orphan — `_ensureBrowser` push vào `_browsers` sau khi drain's splice kết thúc → browser process không bao giờ được đóng [`src/scraping/browserPool.js:324-325`]

#### Group B — Concurrency atomicity (root cause: check-then-act không atomic)

- [x] [Review][Patch] Concurrent acquires spawn nhiều browser dư thừa — `_spawnLock` không re-check headroom sau khi acquire lock → 4 acquires đồng thời = 4 browsers thay vì 1 [`src/scraping/browserPool.js:301-304`]
- [x] [Review][Patch] Context ceiling bị vượt khi concurrent — `contexts.size` check trước `await createBrowserContext()` → các acquire đồng thời cùng thấy slot trống → vượt ceiling [`src/scraping/browserPool.js:288-296`]
- [x] [Review][Patch] SharedContextPool spawn race — `_ensureBrowser(0)` không qua `_spawnLock` → concurrent acquires tạo nhiều browsers thay vì share 1 [`src/scraping/browserPool.js:281-284`]

#### Group C — Obscura backend contract broken

- [x] [Review][Patch] Page từ isolated context mất `__backend` + patch `networkidle0` — `createStealthPage` check `browser._backend`/`__backend` nhưng nhận `context` → `isObscura=false` → page thiếu backend tag và goto hook [`src/scraping/browserPool.js:151` + `src/scraping/stealthBrowser.js:217`]
- [x] [Review][Patch] `_launchOptions` thiếu `fingerprintManager`/`accountId`/`platform` → `browser.__fingerprint` luôn undefined trên Obscura → fingerprint propagation broken [`src/scraping/browserPool.js:90-99`]
- [x] [Review][Patch] Launch error wrap mất `PlatformError` type/`suggestedAction` — wrap thành `new Error` phá `instanceof` check + mất error metadata [`src/scraping/browserPool.js:318-322`]

#### Group D — Resource leaks

- [x] [Review][Patch] Context orphan khi `createStealthPage` fail — context đã add vào `entry.contexts` nhưng không bị remove/close khi page creation throw → chiếm slot vĩnh viễn [`src/scraping/browserPool.js:145-165,296`]
- [x] [Review][Patch] Silent degradation khi `createBrowserContext` trả `null` — pool dùng shared default context thay vì throw → cookie/storage leak cross-job [`src/scraping/browserPool.js:293-297`]

#### Group E — Minor/code quality

- [x] [Review][Patch] `size: 0` bị falsy-coerce thành 4 — `Number(...) || 4` coi 0 là falsy → không thể cấu hình pool size 0 [`src/scraping/browserPool.js:81`]
- [x] [Review][Patch] `_wakeNext()` đệ quy không giới hạn — recursive call khi draining + queue lớn → potential stack overflow [`src/scraping/browserPool.js:265-268`]
- [x] [Review][Patch] `SharedContextPool.release()` duplicate code — parent release() có `if (lease.context)` guard, hoạt động đúng cho `context=null` → override không cần thiết [`src/scraping/browserPool.js:347-359`]
- [x] [Review][Patch] Test ISOLATION chỉ check mock object identity, không verify cookie/storage isolation thực tế [`tests/scraping/browserPool.test.js:146-154`]
- [x] [Review][Patch] Thiếu concurrent test — tất cả test await tuần tự, không test `Promise.all` concurrent acquires [`tests/scraping/browserPool.test.js`]

#### Deferred

- [x] [Review][Defer] Missing `isConnected()` check trước khi cấp context — deferred: crash containment/respawn thuộc story 53.5, out of scope
- [x] [Review][Defer] Không có idle browser reclaim — deferred: feature gap, không có trong spec AC story 53.1
- [x] [Review][Defer] `acquire()` thiếu per-job options (proxy/accountId override) — deferred: spec không yêu cầu, wiring concern cho 53.2/53.3
