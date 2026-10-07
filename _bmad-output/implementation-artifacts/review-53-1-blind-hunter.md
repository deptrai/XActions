Conduct a review of CONTENT.
Look for what's missing, not only what's wrong.
Compute your finding floor N from the diff file's size: N = min(floor(sqrt(kB) + 1), 10), where kB is the file's size in kilobytes. State the arithmetic in one line, then find at least N issues to fix or improve.
Output a Markdown list of findings only — no severity, priority, or ranking.
If the content is empty, stop and say so.
If you have zero findings, re-check and keep thinking; do not stop with an empty list.

CONTENT: the unified diff inline below (it is the content under review).

Do not invoke any skill, and do not spawn subagents of your own — you are the reviewer. Return your findings as text in your final message; do not route them through any findings-reporting tool the host may offer.

--- DIFF (43KB) ---
diff --git a/_bmad-output/implementation-artifacts/epic-53-context.md b/_bmad-output/implementation-artifacts/epic-53-context.md
new file mode 100644
index 00000000..dbc63d3a
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/epic-53-context.md
@@ -0,0 +1,48 @@
+# Epic 53 Context: Browser Page Pool — Sharded, Backend-Aware
+
+<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->
+
+## Goal
+
+Thay mô hình scrape **launch-per-job** (mỗi Bull job spawn một browser process riêng, ~300–500MB Chrome / ~30MB Obscura — lý do concurrency bị kẹt ở 2) bằng một **`BrowserPool` dùng chung**: N job đồng thời acquire page/context từ browser sẵn có. Đây là enabler thực sự duy nhất cho các mục tiêu RAM ≥85% và tốc độ 5–10x ở worker layer. Toàn bộ tính năng **opt-in qua `MEDIRUS_BROWSER_POOL_SIZE` (default 0 = off)** — flag tắt thì hành vi byte-identical hiện tại, không đổi default, không rollback epic nào.
+
+## Stories
+
+- Story 53.1: BrowserPool Core — acquire/release/drain/stats + isolated contexts
+- Story 53.2: Adapter + stealthBrowser `pooled` opt
+- Story 53.3: jobQueue scrape processor thread `pooled`
+- Story 53.4: Obscura pool-of-processes shard strategy
+- Story 53.5: Crash containment + respawn + Bull re-queue
+- Story 53.6: Telemetry dims + spike verify gate
+
+## Requirements & Constraints
+
+- Mỗi scrape job acquire một **isolated `browserContext`** riêng (incognito-equivalent, cookie/storage isolated) — không leak state cross-job. Shared-context chỉ được phép cho anonymous public scraping, qua opt-in tường minh (`SharedContextPool`).
+- `release()` chỉ đóng context/page của job — **không đụng shared browser**. Browser lifecycle thuộc pool, không thuộc job.
+- Pool phải có queue/backpressure khi hết slot, `drain()` cho shutdown, `stats()` cho observability.
+- Post-auth jobs vẫn reject `obscura` backend (guard `requiresAuth===true` từ AD-23); pooled post-auth dùng isolated chrome context per account.
+- Crash containment: pool detect browser chết → respawn; chỉ in-flight jobs trên browser đó fail, Bull `attempts`/`backoff` re-queue — không silent loss.
+- Telemetry: `emitRun` thêm `pooled`, `poolBackend`, `poolWaitMs` khi `MEDIRUS_BROWSER_BACKEND_METRICS=1`.
+- Spike (`scripts/browser-pool-spike.mjs`) được promote thành verify gate pre-release.
+
+## Technical Decisions
+
+**Evidence từ spike** (`implementation-artifacts/spike-browser-page-pool.md`, measured 2026-10-02):
+- `newPage()`/context-acquire p50 ~70ms vs `browser.launch()` ~1558ms (≈22x rẻ); ΔRSS pool ~2–9MB vs +33MB launch-per-job.
+- Shared context **bị leak state** → không dùng mặc định; isolated context clean.
+- Contention sweep: chrome knee ở N=8 (nav p95 437→1659ms) — bottleneck là `createBrowserContext()` serialization, không phải nav.
+- Obscura: `createBrowserContext` gần-free (23–78ms) nhưng nav/render là bottleneck (p95 6342ms @ N=16) → scaling axis của Obscura là **nhiều process**, không phải nhiều page-per-connection.
+
+**Backend-aware ceiling** (chiến lược ngược nhau giữa 2 backend):
+- **chrome** → sharded-pool: ~4–6 isolated contexts/browser, spawn browser thứ hai khi vượt ceiling.
+- **obscura** → pool-of-processes: nhiều `obscura serve` (~30MB/process), mỗi process ~2–4 page/CDP-connection.
+
+**Teardown contract** (AD-23 vẫn binding): `browser.__backend === 'obscura'` → `disconnect()`; `chrome` → `close()`. Pool sở hữu browser lifecycle; adapter trả handle, không close browser.
+
+**Touchpoints** (đã ghi trong AD-24): `src/scraping/browserPool.js` (new), `src/scraping/stealthBrowser.js` (`pooled` opt), `src/scrapers/adapters/puppeteer.js` (`launch` pooled), `api/services/jobQueue.js` (thread `pooled` từ `job.data.pooled`/`MEDIRUS_BROWSER_POOL_SIZE`), `api/services/scrapeDispatch.js` (clamp + propagate pool size hints).
+
+## Cross-Story Dependencies
+
+- 53.1 (core) là nền — 53.2 adapter phụ thuộc `acquire/release` contract; 53.3 jobQueue phụ thuộc 53.2; 53.4 mở rộng policy của 53.1 cho obscura; 53.5, 53.6 orthogonal nhưng cần pool tồn tại.
+- Epic 35 (story 35.5) vẫn đang mở — verification-only, không conflict; Epic 53 là layer mới giữa Bull worker và adapter.
+- Reuse sẵn có: `stealthBrowser.js` (launch config), `puppeteer.js` adapter (`__backend` contract, `requiresAuth` guard), `jobQueue.js` (Bull `scrapeQueue.process('scrape', 2)` — concurrency cap cần nới khi pooled), telemetry `emitRun` path đã có `browserBackend` dim.
diff --git a/_bmad-output/implementation-artifacts/spec-53-1-browserpool-core-acquire-release-drain-stats-isolated-contexts.md b/_bmad-output/implementation-artifacts/spec-53-1-browserpool-core-acquire-release-drain-stats-isolated-contexts.md
new file mode 100644
index 00000000..0d0a7484
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/spec-53-1-browserpool-core-acquire-release-drain-stats-isolated-contexts.md
@@ -0,0 +1,98 @@
+---
+title: '53.1 BrowserPool Core — acquire/release/drain/stats + isolated contexts'
+type: 'feature'
+created: '2026-10-03'
+status: 'in-review'
+baseline_commit: '958e9419373ae4e1f7653bb2e50a38d05a5fde8f'
+route: 'dispatch'
+review_loop_iteration: 0
+context: []
+---
+
+<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">
+
+## Intent
+
+**Problem:** Scrape jobs hiện launch một browser process riêng mỗi job (~300–500MB Chrome), kẹt concurrency ở 2 và chặn mục tiêu RAM/tốc độ (NFR-11/12). Cần một pool chia sẻ browser phục vụ N job qua page/context — nhưng nền (core pool) phải đúng isolation contract trước khi adapter/jobQueue được nối vào (53.2+).
+
+**Approach:** Tạo `src/scraping/browserPool.js` — class `BrowserPool` per-backend với `acquire()` trả page trong **isolated `browserContext`** mặc định, `release()` chỉ đóng context/page (không đụng browser), FIFO queue khi cạn slot, `drain()`, `stats()`. Kèm `SharedContextPool` opt-in tường minh cho anonymous public scraping. Opt-in toàn bộ qua `MEDIRUS_BROWSER_POOL_SIZE` (default 0 = không dùng).
+
+## Boundaries & Constraints
+
+**Always:**
+- Mỗi `acquire()` trả một page trong `browserContext` riêng (incognito-equivalent) — mặc định isolated, cookie/storage không leak cross-job (spike đo `isoLeak=false`, shared `leak=true`).
+- `release(page)` đóng page + context của job đó; **không** đóng/disconnect shared browser. Browser lifecycle thuộc pool. Acquire fail giữa chừng (createBrowserContext throw) → giải phóng slot + đánh thức waiter tiếp theo.
+- Hết slot → FIFO wait queue (backpressure), không reject, không spawn vô hạn. `acquireTimeoutMs` option (default 0 = chờ vô hạn); timeout → reject `PoolAcquireTimeoutError` để caller (Bull) không bị kẹt vĩnh viễn.
+- Context ceiling per-browser theo backend (AD-24 Rule 3): chrome ~4–6 contexts/browser → spawn browser mới khi vượt và còn slot; obscura giữ ít page/connection (~2–4) — cấu hình qua `contextsPerBrowser`, default `5` cho chrome / `3` cho obscura.
+- Pool launch browser **lazy** ở acquire đầu tiên qua `launchStealthBrowser({backend, fallbackBackend:'none', proxy, headless})` — reuse nguyên xi AD-23 backend resolution + post-auth guard (`requiresAuth:true` + obscura → throw). Pool phải propagate `browser.__fingerprint` xuống `createStealthPage` (qua opt `fingerprint`) — page từ `context` không nhìn thấy `browser.__fingerprint`, thiếu sẽ phá fingerprint-stable (Story 27.1).
+- `drain()` từ chối acquire mới, đợi in-flight release xong, rồi teardown mọi browser theo AD-23 (`closeStealthBrowser`: obscura→`disconnect()`, chrome→`close()`). Idempotent — gọi lại trả cùng promise, không race teardown.
+
+**Never:**
+- Không sửa `stealthBrowser.js`, adapter, `jobQueue.js` — wiring là story 53.2/53.3.
+- Không crash-containment/respawn (story 53.5), không telemetry dims (story 53.6).
+- Không shared-context mặc định; `SharedContextPool` chỉ tồn tại như class opt-in riêng, không tự động được chọn.
+- Không đổi hành vi khi flag tắt — file mới, không import vào code path hiện có.
+
+## I/O & Edge-Case Matrix
+
+| Scenario | Input / State | Expected Output / Behavior | Error Handling |
+|----------|--------------|---------------------------|----------------|
+| HAPPY_ACQUIRE | pool size 4, 1 job | `acquire()` → `{page, context, backend, waitMs, pageMs}` trong isolated context; `stats().active=1` | N/A |
+| BACKPRESSURE | size 2, 4 job đồng thời | job 3–4 xếp hàng FIFO; nhận slot theo thứ tự release; `waitMs` > 0 | timeout → `PoolAcquireTimeoutError` |
+| STATS | pool đang chạy | `stats()` = `{size, active, queued, browsers, draining}` | N/A |
+| CEILING_SPAWN | chrome, size 6, contextsPerBrowser 5 | acquire thứ 6 → spawn browser thứ hai | launch fail → throw, waiter được đánh thức |
+| ISOLATION | job A set cookie | job B (context khác) không thấy cookie | N/A |
+| RELEASE_CLEAN | page đã release | browser process sống; `stats().active` giảm | close context lỗi → nuốt lỗi, vẫn giải phóng slot |
+| DRAIN | `drain()` khi 2 job in-flight + 1 waiter | waiter reject `PoolDrainingError`; đợi in-flight; browser teardown theo backend; gọi lần 2 → cùng promise | teardown lỗi → vẫn resolve drain |
+| REQUIRES_AUTH | `requiresAuth:true`, backend obscura | `acquire()` reject PlatformError ngay | propagate lỗi guard AD-23 |
+| OBSCURA_BACKEND | backend obscura, wsEndpoint | `puppeteer-core.connect` tới `OBSCURA_WS_ENDPOINT`; context ceiling 3 | connect fail → fallback 'none' → throw |
+| SHARED_POOL_OPT | `new SharedContextPool(...)` | acquire trả page trong default context chung (chỉ public anon) | release chỉ close page |
+
+</frozen-after-approval>
+
+## Code Map
+
+- `src/scraping/browserPool.js` — **FILE MỚI**, duy nhất trong story này
+- `src/scraping/stealthBrowser.js` — reuse nguyên xi: `launchStealthBrowser()` (backend resolution, post-auth guard, fingerprint), `closeStealthBrowser()` (AD-23 teardown), `createStealthPage(browser, opts)` (áp stealth patches lên page — nhưng cần page từ context; kiểm tra signature: nhận `browser`, gọi `browser.newPage()` → cho isolated context cần gọi `context.newPage()`; wrapper page-level phải chấp nhận context làm source)
+- `scripts/browser-pool-spike.mjs` — `SpikeBrowserPool` (lines ~85–120) là prototype đã đo: acquire/release/stats/queue skeleton → promote thành production
+- `src/scrapers/adapters/puppeteer.js` — contract `_native`/`_backend`/`__backend` để tái dùng ở 53.2 (chỉ đọc, không sửa)
+- `api/services/jobQueue.js:538` — `scrapeQueue.process('scrape', 2, ...)` (surface của 53.3; chỉ đọc)
+
+## Tasks & Acceptance
+
+**Execution:**
+- [x] `src/scraping/browserPool.js` — implement `BrowserPool` + `SharedContextPool` + `PoolDrainingError` + `PoolAcquireTimeoutError`; lazy launch qua `launchStealthBrowser`; acquire trả `{page, context, backend, waitMs, pageMs}`; gọi `createStealthPage(context, {fingerprint: browser.__fingerprint, ...})` — `BrowserContext.newPage()` cùng signature nên không cần sửa `stealthBrowser.js`; KHÔNG sửa stealthBrowser.js ở story này
+- [x] `tests/scraping/browserPool.test.js` — unit test I/O matrix: acquire/release/stats/backpressure FIFO/isolation/drain/guard (mock launchStealthBrowser nếu cần, ưu tiên browser thật nhẹ hoặc fake context object — test contract không test Chrome)
+- [x] `src/scraping/browserPool.d.ts` — type stub theo convention (`stealthBrowser.d.ts`, `paginationEngine.d.ts` tồn tại)
+
+**Acceptance Criteria:**
+- Given `MEDIRUS_BROWSER_POOL_SIZE=0` (hoặc không set), when code path hiện có chạy, then không file nào import browserPool — zero behavior change.
+- Given pool size N, when N+1 acquire đồng thời, then acquire thứ N+1 block cho tới khi có release, và slot được trao theo thứ tự FIFO.
+- Given `release(page)`, when gọi xong, then shared browser vẫn sống và acquire tiếp được (Q5).
+- Given 2 isolated context, when job A ghi cookie/localStorage, then job B không đọc được (Q1, spike-verified).
+- Given `drain()`, when đang chạy, then acquire mới reject có tên lỗi rõ ràng, in-flight hoàn tất, browser teardown theo đúng backend contract.
+
+## Implementation Notes
+
+- Implemented 2026-10-03 (baseline `958e9419`). `BrowserPool` + `SharedContextPool` + `PoolDrainingError` + `PoolAcquireTimeoutError` trong `src/scraping/browserPool.js` (~360 dòng).
+- **Quyết định trong lúc implement:** `_waitForSlot` grant slot **atomic** (active++ trong cùng synchronous check hoặc tại `_wakeNext` khi transfer) — tránh race oversubscribe khi 2 acquire cùng tick; `!queue.length` guard giữ fairness FIFO.
+- `_leases` dùng `WeakMap` — job crash quên release không leak lease entry.
+- Fingerprint propagation: `acquire()` truyền `browser.__fingerprint` vào `createStealthPage(context, {fingerprint})` — page từ context không đọc được `browser.__fingerprint`.
+- `drain()` memoize `_drainPromise` (idempotent), reject toàn bộ waiters trước khi đợi idle, teardown qua `closeStealthBrowser` (AD-23).
+- Launch fail được wrap `BrowserPool: launch failed for backend` + `cause` giữ nguyên.
+- TS strict (`checkJs`): thêm `BrowserPoolOptions` typedef, `PoolAcquire`/`PoolStats` interfaces ở `.d.ts`.
+- Verify: `npx vitest run tests/scraping/browserPool.test.js` → **12/12 pass**; module import sạch; `createStealthPage(context)` hoạt động vì `BrowserContext.newPage()` cùng signature — `stealthBrowser.js` không sửa đúng như spec.
+
+## Spec Change Log
+
+## Review Triage Log
+
+## Design Notes
+
+Pool core chỉ giải quyết "đơn vị công việc = context". Sharding obscura nhiều process (53.4) là policy layer phía trên — core chỉ cần `contextsPerBrowser` khả cấu hình. `SharedContextPool` kế thừa/`BrowserPool` với `isolated:false` — tách class để opt-in tường minh ở call site (Rule 2 AD-24).
+
+## Verification
+
+**Commands:**
+- `node --test tests/scraping/browserPool.test.js` — expected: all pass (hoặc runner hiện có: `npx vitest run tests/scraping/` — check `package.json` scripts trước)
+- `node -e "import('./src/scraping/browserPool.js').then(m=>console.log(Object.keys(m)))"` — module load sạch
diff --git a/_bmad-output/implementation-artifacts/sprint-status.yaml b/_bmad-output/implementation-artifacts/sprint-status.yaml
index 45701dbd..13d69e0f 100644
--- a/_bmad-output/implementation-artifacts/sprint-status.yaml
+++ b/_bmad-output/implementation-artifacts/sprint-status.yaml
@@ -24,7 +24,7 @@
 #   - done: Retrospective has been completed
 
 generated: "2026-08-27 06:00"
-last_updated: "10-03-2026 02:58"
+last_updated: "10-03-2026 03:10"
 project: Medirus
 project_key: XACT
 tracking_system: file-system
@@ -458,13 +458,13 @@ epic-50:
 
 # Epic 53: Browser Page Pool — Sharded, Backend-Aware (sprint-change 2026-10-02)
 epic-53:
-  status: backlog
+  status: in-progress
   source_proposal: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-02-browser-page-pool.md
   source_spike: _bmad-output/implementation-artifacts/spike-browser-page-pool.md
   stories:
     story-53-1:
       slug: browserpool-core-acquire-release-drain-stats-isolated-contexts
-      status: backlog
+      status: in-progress
     story-53-2:
       slug: adapter-stealthbrowser-pooled-opt-teardown-contract
       status: backlog
diff --git a/src/scraping/browserPool.d.ts b/src/scraping/browserPool.d.ts
new file mode 100644
index 00000000..b078ad87
--- /dev/null
+++ b/src/scraping/browserPool.d.ts
@@ -0,0 +1,78 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * TypeScript declarations for the Medirus Browser Page Pool (Story 53.1, AD-24).
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+import type { Browser, BrowserContext, Page } from 'puppeteer';
+import type { Fingerprint, FingerprintManager } from '../core/fingerprint-manager.js';
+import type { StealthBrowserOptions } from './stealthBrowser.js';
+
+export interface BrowserPoolOptions {
+  /** Max concurrent slots (default env `MEDIRUS_BROWSER_POOL_SIZE`, then 4). */
+  size?: number;
+  /** Isolated-context ceiling per browser before spawning another (default 5 chrome / 3 obscura). */
+  contextsPerBrowser?: number;
+  /** Max wait for a slot; 0 = forever. */
+  acquireTimeoutMs?: number;
+  /** 'chrome' | 'obscura' */
+  backend?: string;
+  /** Default 'none' inside a pool — no silent backend swap mid-run. */
+  fallbackBackend?: string;
+  /** Obscura CDP endpoint. */
+  wsEndpoint?: string;
+  proxy?: StealthBrowserOptions['proxy'];
+  headless?: boolean;
+  /** Post-auth guard (AD-23): obscura rejected upstream. */
+  requiresAuth?: boolean;
+  /** @internal subclasses set false — use SharedContextPool instead. */
+  isolated?: boolean;
+  telemetryContext?: any;
+  userDataDir?: string;
+  userAgent?: string;
+  fingerprint?: Fingerprint;
+  fingerprintManager?: FingerprintManager;
+  accountId?: string;
+  platform?: string;
+}
+
+export interface PoolAcquire {
+  page: Page;
+  /** Isolated BrowserContext — null for SharedContextPool. */
+  context: BrowserContext | null;
+  /** 'chrome' | 'obscura' — actual backend serving this page. */
+  backend: string;
+  /** Time spent queued for a slot. */
+  waitMs: number;
+  /** Context+page creation time. */
+  pageMs: number;
+}
+
+export interface PoolStats {
+  size: number;
+  active: number;
+  queued: number;
+  browsers: number;
+  draining: boolean;
+}
+
+export class PoolDrainingError extends Error {}
+export class PoolAcquireTimeoutError extends Error {
+  timeoutMs: number;
+  constructor(timeoutMs: number);
+}
+
+export class BrowserPool {
+  constructor(options?: BrowserPoolOptions);
+  acquire(): Promise<PoolAcquire>;
+  release(page: Page): Promise<void>;
+  drain(): Promise<void>;
+  stats(): PoolStats;
+}
+
+/**
+ * Shared default-context pool — anonymous public scraping only (AD-24 Rule 2).
+ * Cookies/storage ARE shared between jobs.
+ */
+export class SharedContextPool extends BrowserPool {}
diff --git a/src/scraping/browserPool.js b/src/scraping/browserPool.js
new file mode 100644
index 00000000..4af5569f
--- /dev/null
+++ b/src/scraping/browserPool.js
@@ -0,0 +1,362 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * Medirus Browser Page Pool (Epic 53 / AD-24)
+ *
+ * One shared browser process serves N concurrent scrape jobs via per-job
+ * pages/contexts — replaces launch-per-job (~300–500MB/job → ~9MB).
+ *
+ * - Isolated `browserContext` per job by default (incognito-equivalent —
+ *   cookie/storage do NOT leak cross-job; spike-verified `isoLeak=false`).
+ * - Backend-aware context ceiling (AD-24 Rule 3): chrome ~5 contexts/browser
+ *   (spike knee @ N=8 on context-create serialization), obscura ~3
+ *   (nav/render is the bottleneck — sharding across processes is 53.4).
+ * - Opt-in only: `MEDIRUS_BROWSER_POOL_SIZE` (0/undefined = caller stays on
+ *   launch-per-job; this module is never imported into default paths).
+ * - Teardown honors AD-23 via `closeStealthBrowser` (obscura→disconnect,
+ *   chrome→close). `release()` closes the job's page+context only — the
+ *   shared browser stays alive.
+ *
+ * @author nich (@nichxbt) - https://github.com/nirholas
+ * @license MIT
+ */
+
+import { launchStealthBrowser, createStealthPage, closeStealthBrowser } from './stealthBrowser.js';
+
+/**
+ * @typedef {object} BrowserPoolOptions
+ * @property {number} [size] - max concurrent slots (default env `MEDIRUS_BROWSER_POOL_SIZE`, then 4).
+ * @property {number} [contextsPerBrowser] - isolated-context ceiling per browser before spawning another (default 5 chrome / 3 obscura).
+ * @property {number} [acquireTimeoutMs] - max wait for a slot; 0 = forever.
+ * @property {string} [backend] - 'chrome' | 'obscura'.
+ * @property {string} [fallbackBackend] - default 'none' inside a pool.
+ * @property {string} [wsEndpoint] - obscura CDP endpoint.
+ * @property {any} [proxy] - proxy spec passed through to launch/page.
+ * @property {boolean} [headless] - default true.
+ * @property {boolean} [requiresAuth] - post-auth guard (AD-23).
+ * @property {boolean} [isolated] - internal; subclasses set false.
+ * @property {any} [telemetryContext] - optional TelemetryContext.
+ * @property {string} [userDataDir] - browser profile dir (chrome only).
+ * @property {string} [userAgent] - fixed UA for pooled pages.
+ * @property {any} [fingerprint] - explicit fingerprint (overrides browser's).
+ * @property {any} [fingerprintManager] - FingerprintManager instance.
+ * @property {string} [accountId] - account for fingerprint resolution.
+ * @property {string} [platform] - platform key for fingerprint resolution.
+ */
+
+// ============================================================================
+// Errors
+// ============================================================================
+
+/** Thrown to waiters/new acquires when the pool is draining. */
+export class PoolDrainingError extends Error {
+  constructor(message = 'BrowserPool is draining — no new acquires accepted') {
+    super(message);
+    this.name = 'PoolDrainingError';
+  }
+}
+
+/** Thrown when `acquireTimeoutMs` elapses while queued for a slot. */
+export class PoolAcquireTimeoutError extends Error {
+  /** @param {number} timeoutMs */
+  constructor(timeoutMs) {
+    super(`BrowserPool acquire timed out after ${timeoutMs}ms waiting for a slot`);
+    this.name = 'PoolAcquireTimeoutError';
+    this.timeoutMs = timeoutMs;
+  }
+}
+
+// ============================================================================
+// BrowserPool
+// ============================================================================
+
+/**
+ * Per-backend browser pool. Unit of work = one browser context (isolated) or
+ * one page on the shared default context (SharedContextPool subclass).
+ *
+ * @param {BrowserPoolOptions} [options]
+ */
+export class BrowserPool {
+  /** @param {BrowserPoolOptions} [options] */
+  constructor(options = {}) {
+    this._size = Number(options.size ?? process.env.MEDIRUS_BROWSER_POOL_SIZE ?? 4) || 4;
+    this._backend = options.backend || process.env.MEDIRUS_BROWSER_BACKEND || 'chrome';
+    this._contextsPerBrowser = Number(
+      options.contextsPerBrowser ?? (this._backend === 'obscura' ? 3 : 5)
+    );
+    this._acquireTimeoutMs = Number(options.acquireTimeoutMs ?? 0) || 0;
+    this._isolated = options.isolated !== false;
+
+    // Launch options forwarded verbatim to launchStealthBrowser on each spawn.
+    this._launchOptions = {
+      backend: this._backend,
+      fallbackBackend: options.fallbackBackend === undefined ? 'none' : options.fallbackBackend,
+      wsEndpoint: options.wsEndpoint,
+      proxy: options.proxy,
+      headless: options.headless !== false,
+      requiresAuth: options.requiresAuth === true,
+      telemetryContext: options.telemetryContext,
+      userDataDir: options.userDataDir,
+    };
+    // Page options forwarded to createStealthPage per acquire.
+    this._pageOptions = {
+      proxy: options.proxy,
+      userAgent: options.userAgent,
+      fingerprint: options.fingerprint,
+      fingerprintManager: options.fingerprintManager,
+      accountId: options.accountId,
+      platform: options.platform,
+    };
+
+    /** @type {Array<{browser: any, contexts: Set<any>}>} */
+    this._browsers = [];
+    this._active = 0;
+    /** @type {Array<{resolve: Function, reject: Function, timer: any}>} */
+    this._queue = [];
+    this._draining = false;
+    this._drainPromise = null;
+    /** @type {Function|null} */ this._onIdle = null;
+    /** page → {context, browser, backend} — WeakMap: an un-released page can be GC'd without leaking the lease. */
+    this._leases = new WeakMap();
+    // Serialize browser spawning — two concurrent acquires must not both spawn.
+    /** @type {Promise<any>} */
+    this._spawnLock = Promise.resolve(null);
+  }
+
+  // ── Public API ────────────────────────────────────────────────────────────
+
+  /**
+   * Acquire a page for one job.
+   * @returns {Promise<{page: any, context: any, backend: string, waitMs: number, pageMs: number}>}
+   *   `context` is the isolated BrowserContext (null for SharedContextPool).
+   *   `waitMs` = time queued; `pageMs` = context+page creation — feed
+   *   `poolWaitMs` telemetry dim (53.6).
+   */
+  async acquire() {
+    const t0 = Date.now();
+    if (this._draining) throw new PoolDrainingError();
+
+    // _waitForSlot grants the slot atomically (increments _active inside the
+    // same synchronous check) — two concurrent acquires cannot oversubscribe.
+    await this._waitForSlot();
+    const waitMs = Date.now() - t0;
+
+    try {
+      const tPage = Date.now();
+      const { browser, context } = await this._obtainContext();
+      // createStealthPage accepts a BrowserContext transparently
+      // (`ctxOrBrowser._native || ctxOrBrowser` → context, which owns newPage()).
+      // Fingerprint must be passed explicitly — a context can't see
+      // `browser.__fingerprint` (Story 27.1 stability).
+      const fingerprint = this._pageOptions.fingerprint || browser.__fingerprint || null;
+      const page = await createStealthPage(context || browser, {
+        ...this._pageOptions,
+        fingerprint,
+      });
+      const pageMs = Date.now() - tPage;
+      const backend = browser.__backend || this._backend;
+      this._leases.set(page, { context, browser, backend });
+      return { page, context, backend, waitMs, pageMs };
+    } catch (err) {
+      // Context/page creation failed after the slot was granted — free the
+      // slot and wake the next waiter instead of leaking the capacity.
+      this._active--;
+      this._wakeNext();
+      throw err;
+    }
+  }
+
+  /**
+   * Release a page acquired from this pool. Closes the page and its isolated
+   * context — never touches the shared browser. Always frees the slot even
+   * if close throws.
+   * @param {any} page — the page returned by `acquire()`.
+   */
+  async release(page) {
+    const lease = this._leases.get(page);
+    if (!lease) return; // not ours / double-release — no-op
+    this._leases.delete(page);
+    try { await page.close(); } catch { /* page may already be gone */ }
+    if (lease.context) {
+      try { await lease.context.close(); } catch { /* teardown best-effort */ }
+      const entry = this._browsers.find((e) => e.contexts.has(lease.context));
+      if (entry) entry.contexts.delete(lease.context);
+    }
+    this._active--;
+    this._wakeNext();
+    if (this._active === 0 && this._onIdle) {
+      const fn = this._onIdle;
+      this._onIdle = null;
+      fn();
+    }
+  }
+
+  /**
+   * Drain: reject queued waiters, refuse new acquires, wait for in-flight
+   * releases, then tear down every browser per AD-23. Idempotent — repeated
+   * calls return the same promise.
+   */
+  drain() {
+    if (this._drainPromise) return this._drainPromise;
+    this._draining = true;
+
+    // Reject everyone still queued — they never got a slot.
+    const waiters = this._queue.splice(0);
+    for (const w of waiters) {
+      if (w.timer) clearTimeout(w.timer);
+      w.reject(new PoolDrainingError());
+    }
+
+    this._drainPromise = (async () => {
+      if (this._active > 0) {
+        await new Promise((resolve) => { this._onIdle = resolve; });
+      }
+      for (const entry of this._browsers.splice(0)) {
+        try { await closeStealthBrowser(entry.browser); } catch { /* best-effort */ }
+      }
+    })();
+    return this._drainPromise;
+  }
+
+  /**
+   * @returns {{size: number, active: number, queued: number, browsers: number, draining: boolean}}
+   */
+  stats() {
+    return {
+      size: this._size,
+      active: this._active,
+      queued: this._queue.length,
+      browsers: this._browsers.length,
+      draining: this._draining,
+    };
+  }
+
+  // ── Internals ─────────────────────────────────────────────────────────────
+
+  /**
+   * Block until a slot frees (or drain/timeout). Grants the slot atomically:
+   * the `_active++` happens inside the same synchronous check for the
+   * immediate path, or inside `_wakeNext` for a queued waiter (slot transfer).
+   */
+  _waitForSlot() {
+    // `!this._queue.length` guard: never let a newcomer jump ahead of waiters.
+    if (this._active < this._size && this._queue.length === 0) {
+      this._active++;
+      return Promise.resolve();
+    }
+    if (this._draining) return Promise.reject(new PoolDrainingError());
+
+    return new Promise((resolve, reject) => {
+      const waiter = /** @type {{resolve: Function, reject: Function, timer: any}} */ ({ resolve, reject, timer: null });
+      if (this._acquireTimeoutMs > 0) {
+        waiter.timer = setTimeout(() => {
+          const i = this._queue.indexOf(waiter);
+          if (i !== -1) this._queue.splice(i, 1);
+          reject(new PoolAcquireTimeoutError(this._acquireTimeoutMs));
+        }, this._acquireTimeoutMs);
+      }
+      this._queue.push(waiter);
+    });
+  }
+
+  _wakeNext() {
+    const next = this._queue.shift();
+    if (!next) return;
+    if (next.timer) clearTimeout(next.timer);
+    if (this._draining) {
+      next.reject(new PoolDrainingError());
+      this._wakeNext();
+      return;
+    }
+    this._active++; // slot transfer: release() freed one, waiter takes it
+    next.resolve();
+  }
+
+  /**
+   * Pick (or lazily spawn) a browser with context headroom, then create the
+   * job's context on it. Returns `{browser, context}` — context is null for
+   * shared mode (subclass).
+   * @private
+   */
+  async _obtainContext() {
+    if (!this._isolated) {
+      // SharedContextPool: one browser, pages on the default context.
+      const entry = await this._ensureBrowser(0);
+      return { browser: entry.browser, context: null };
+    }
+
+    // Find a browser below its context ceiling.
+    let entry = this._browsers.find((e) => e.contexts.size < this._contextsPerBrowser);
+    if (!entry) {
+      entry = await this._spawnBrowser();
+    }
+
+    const context = typeof entry.browser.createBrowserContext === 'function'
+      ? await entry.browser.createBrowserContext()
+      : null;
+    if (context) entry.contexts.add(context);
+    return { browser: entry.browser, context };
+  }
+
+  /** Serialize spawns: concurrent acquires must not double-launch. */
+  _spawnBrowser() {
+    const run = this._spawnLock.then(() => this._ensureBrowser(this._browsers.length));
+    this._spawnLock = run.catch(() => {});
+    return run;
+  }
+
+  /**
+   * Return existing entry at index or launch a new browser into the pool.
+   * @param {number} index
+   * @private
+   */
+  async _ensureBrowser(index) {
+    if (this._browsers[index]) return this._browsers[index];
+    let browser;
+    try {
+      browser = await launchStealthBrowser(this._launchOptions);
+    } catch (err) {
+      const e = /** @type {any} */ (err);
+      const wrapped = new Error(`BrowserPool: launch failed for backend '${this._backend}': ${e?.message || e}`);
+      wrapped.cause = e;
+      wrapped.name = e?.name || 'Error';
+      throw wrapped;
+    }
+    const entry = { browser, contexts: new Set() };
+    this._browsers.push(entry);
+    return entry;
+  }
+}
+
+// ============================================================================
+// SharedContextPool — explicit opt-in for anonymous public scraping only
+// ============================================================================
+
+/**
+ * Same pool mechanics but every job gets a page on the browser's DEFAULT
+ * context — cookies/storage ARE shared. Use ONLY for anonymous public
+ * scraping (AD-24 Rule 2); anything account-tied must use BrowserPool.
+ */
+export class SharedContextPool extends BrowserPool {
+  constructor(options = {}) {
+    super({ ...options, isolated: false });
+  }
+
+  /** Shared mode has no per-job context — release only closes the page.
+   * @param {any} page
+   */
+  async release(page) {
+    const lease = this._leases.get(page);
+    if (!lease) return;
+    this._leases.delete(page);
+    try { await page.close(); } catch { /* noop */ }
+    this._active--;
+    this._wakeNext();
+    if (this._active === 0 && this._onIdle) {
+      const fn = this._onIdle;
+      this._onIdle = null;
+      fn();
+    }
+  }
+}
+
+// by nichxbt
diff --git a/tests/scraping/browserPool.test.js b/tests/scraping/browserPool.test.js
new file mode 100644
index 00000000..063461fb
--- /dev/null
+++ b/tests/scraping/browserPool.test.js
@@ -0,0 +1,245 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * BrowserPool unit tests — Story 53.1 (Epic 53 / AD-24)
+ * Tests the pool contract with mocked stealthBrowser layer (no real Chrome).
+ */
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+
+// ── Mock stealthBrowser before importing the pool ────────────────────────────
+const mocks = vi.hoisted(() => {
+  const state = {
+    launches: [],
+    teardowns: [],
+    launchError: null,
+    nextBackend: 'chrome',
+  };
+  function makeFakeBrowser(backend) {
+    const browser = {
+      __backend: backend,
+      __fingerprint: { userAgent: 'TEST-UA', locale: 'en-US' },
+      _contexts: 0,
+      async createBrowserContext() {
+        const ctx = {
+          _id: ++browser._contexts,
+          _closed: false,
+          _pages: 0,
+          async newPage() {
+            return { _ctx: ctx, _id: ++ctx._pages, _closed: false, async close() { this._closed = true; }, __backend: backend };
+          },
+          async close() { ctx._closed = true; },
+        };
+        return ctx;
+      },
+      async newPage() {
+        return { _ctx: null, _id: ++browser._contexts, _closed: false, async close() { this._closed = true; }, __backend: backend };
+      },
+      async close() { browser._closed = true; },
+      async disconnect() { browser._disconnected = true; },
+    };
+    return browser;
+  }
+  return {
+    state,
+    makeFakeBrowser,
+    launchStealthBrowser: vi.fn(async (opts) => {
+      if (state.launchError) throw state.launchError;
+      const b = makeFakeBrowser(opts.backend === 'obscura' ? 'obscura' : (state.nextBackend || 'chrome'));
+      state.launches.push({ opts, browser: b });
+      return b;
+    }),
+    createStealthPage: vi.fn(async (src, opts) => {
+      const page = await src.newPage();
+      page.__stealthOpts = opts;
+      return page;
+    }),
+    closeStealthBrowser: vi.fn(async (browser) => {
+      state.teardowns.push(browser);
+      if (browser.__backend === 'obscura') await browser.disconnect();
+      else await browser.close();
+    }),
+  };
+});
+
+vi.mock('../../src/scraping/stealthBrowser.js', () => ({
+  launchStealthBrowser: mocks.launchStealthBrowser,
+  createStealthPage: mocks.createStealthPage,
+  closeStealthBrowser: mocks.closeStealthBrowser,
+}));
+
+import { BrowserPool, SharedContextPool, PoolDrainingError, PoolAcquireTimeoutError } from '../../src/scraping/browserPool.js';
+
+const tick = () => new Promise((r) => setTimeout(r, 0));
+const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
+
+describe('BrowserPool', () => {
+  beforeEach(() => {
+    mocks.state.launches.length = 0;
+    mocks.state.teardowns.length = 0;
+    mocks.state.launchError = null;
+    mocks.state.nextBackend = 'chrome';
+    vi.clearAllMocks();
+  });
+
+  it('HAPPY_ACQUIRE — acquire trả page trong isolated context + stats đúng', async () => {
+    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
+    const acq = await pool.acquire();
+    expect(acq.page).toBeTruthy();
+    expect(acq.context).toBeTruthy(); // isolated context
+    expect(acq.backend).toBe('chrome');
+    expect(typeof acq.waitMs).toBe('number');
+    expect(typeof acq.pageMs).toBe('number');
+    expect(pool.stats().active).toBe(1);
+    expect(pool.stats().browsers).toBe(1);
+    // fingerprint từ browser được propagate xuống createStealthPage
+    expect(acq.page.__stealthOpts.fingerprint?.userAgent).toBe('TEST-UA');
+    await pool.release(acq.page);
+    await pool.drain();
+  });
+
+  it('BACKPRESSURE — hết slot → FIFO queue, waiter thứ N chỉ được phục vụ khi có release', async () => {
+    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
+    const order = [];
+    const a = await pool.acquire();
+    const b = await pool.acquire();
+    const p3 = pool.acquire().then((r) => { order.push('c'); return r; });
+    const p4 = pool.acquire().then((r) => { order.push('d'); return r; });
+    await tick();
+    expect(pool.stats()).toMatchObject({ active: 2, queued: 2 });
+    await pool.release(a.page);
+    await tick();
+    expect(order).toEqual(['c']);
+    await pool.release(b.page);
+    await tick();
+    const c = await p3;
+    const d = await p4;
+    expect(order).toEqual(['c', 'd']); // FIFO
+    expect(c.waitMs).toBeGreaterThanOrEqual(0);
+    expect(d.waitMs).toBeGreaterThan(c.waitMs); // d queued longer
+    await pool.release(c.page);
+    await pool.release(d.page);
+    await pool.drain();
+  });
+
+  it('ACQUIRE_TIMEOUT — waiter quá acquireTimeoutMs → PoolAcquireTimeoutError', async () => {
+    const pool = new BrowserPool({ size: 1, backend: 'chrome', acquireTimeoutMs: 40 });
+    const a = await pool.acquire();
+    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
+    await pool.release(a.page);
+    await pool.drain();
+  });
+
+  it('CEILING_SPAWN — vượt contextsPerBrowser → spawn browser thứ hai', async () => {
+    const pool = new BrowserPool({ size: 6, contextsPerBrowser: 2, backend: 'chrome' });
+    const acqs = [await pool.acquire(), await pool.acquire(), await pool.acquire()];
+    // 3 contexts > ceiling 2 → browser thứ hai đã spawn
+    expect(mocks.state.launches.length).toBe(2);
+    expect(pool.stats().browsers).toBe(2);
+    for (const a of acqs) await pool.release(a.page);
+    await pool.drain();
+  });
+
+  it('ISOLATION — hai acquire trả hai context khác nhau', async () => {
+    const pool = new BrowserPool({ size: 4, backend: 'chrome' });
+    const a = await pool.acquire();
+    const b = await pool.acquire();
+    expect(a.context).not.toBe(b.context);
+    await pool.release(a.page);
+    await pool.release(b.page);
+    await pool.drain();
+  });
+
+  it('RELEASE_CLEAN — release đóng page+context, browser sống, slot được trả', async () => {
+    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
+    const a = await pool.acquire();
+    const browser = mocks.state.launches[0].browser;
+    await pool.release(a.page);
+    expect(a.page._closed).toBe(true);
+    expect(a.context._closed).toBe(true);
+    expect(browser._closed).toBeUndefined(); // browser NOT closed
+    expect(pool.stats().active).toBe(0);
+    // acquire tiếp được — browser vẫn phục vụ
+    const b = await pool.acquire();
+    await pool.release(b.page);
+    await pool.drain();
+  });
+
+  it('DRAIN — reject waiters, đợi in-flight, teardown browser theo backend, idempotent', async () => {
+    const pool = new BrowserPool({ size: 2, backend: 'chrome' });
+    const a = await pool.acquire();
+    const waiter = pool.acquire(); // will queue? size 2, only 1 active → this gets a slot
+    const b = await waiter;
+    const queued = pool.acquire();
+    await tick();
+    expect(pool.stats().queued).toBe(1);
+
+    const d1 = pool.drain();
+    await expect(queued).rejects.toBeInstanceOf(PoolDrainingError);
+    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolDrainingError);
+
+    // in-flight chưa release → drain đang chờ
+    await pool.release(a.page);
+    await pool.release(b.page);
+    await d1;
+    expect(mocks.state.teardowns.length).toBe(1);
+    // idempotent — same promise
+    expect(pool.drain()).toBe(d1);
+  });
+
+  it('REQUIRES_AUTH — launch guard propagate lỗi', async () => {
+    mocks.state.launchError = new Error('obscura backend không hỗ trợ post-auth');
+    const pool = new BrowserPool({ backend: 'obscura', requiresAuth: true });
+    await expect(pool.acquire()).rejects.toThrow(/post-auth/);
+  });
+
+  it('LAUNCH_FAIL — acquire fail giải phóng slot, waiter sau vẫn được phục vụ', async () => {
+    mocks.state.launchError = new Error('boom');
+    const pool = new BrowserPool({ size: 1, backend: 'chrome' });
+    await expect(pool.acquire()).rejects.toThrow(/launch failed.*boom/);
+    expect(pool.stats().active).toBe(0);
+    mocks.state.launchError = null;
+    const a = await pool.acquire(); // slot not leaked
+    expect(pool.stats().active).toBe(1);
+    await pool.release(a.page);
+    await pool.drain();
+  });
+
+  it('OBSCURA_BACKEND — default contextsPerBrowser=3, teardown qua disconnect', async () => {
+    mocks.state.nextBackend = 'obscura';
+    const pool = new BrowserPool({ size: 4, backend: 'obscura', wsEndpoint: 'ws://x' });
+    const a = await pool.acquire();
+    expect(mocks.launchStealthBrowser).toHaveBeenCalledWith(
+      expect.objectContaining({ backend: 'obscura', wsEndpoint: 'ws://x', fallbackBackend: 'none' })
+    );
+    await pool.release(a.page);
+    await pool.drain();
+    expect(mocks.state.teardowns[0]._disconnected).toBe(true);
+  });
+
+  it('release() page không thuộc pool → no-op', async () => {
+    const pool = new BrowserPool({ size: 1 });
+    await expect(pool.release({ close: async () => {} })).resolves.toBeUndefined();
+    await pool.drain();
+  });
+});
+
+describe('SharedContextPool (opt-in, public anon only)', () => {
+  beforeEach(() => {
+    mocks.state.launches.length = 0;
+    mocks.state.teardowns.length = 0;
+    mocks.state.launchError = null;
+    vi.clearAllMocks();
+  });
+
+  it('SHARED_POOL_OPT — context=null, release chỉ close page', async () => {
+    const pool = new SharedContextPool({ size: 2, backend: 'chrome' });
+    const a = await pool.acquire();
+    const b = await pool.acquire();
+    expect(a.context).toBeNull();
+    expect(b.context).toBeNull();
+    await pool.release(a.page);
+    expect(a.page._closed).toBe(true);
+    await pool.release(b.page);
+    await pool.drain();
+    expect(mocks.state.teardowns.length).toBe(1);
+  });
+});

