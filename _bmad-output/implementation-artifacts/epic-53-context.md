# Epic 53 Context: Browser Page Pool — Sharded, Backend-Aware

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Thay mô hình scrape **launch-per-job** (mỗi Bull job spawn một browser process riêng, ~300–500MB Chrome / ~30MB Obscura — lý do concurrency bị kẹt ở 2) bằng một **`BrowserPool` dùng chung**: N job đồng thời acquire page/context từ browser sẵn có. Đây là enabler thực sự duy nhất cho các mục tiêu RAM ≥85% và tốc độ 5–10x ở worker layer. Toàn bộ tính năng **opt-in qua `MEDIRUS_BROWSER_POOL_SIZE` (default 0 = off)** — flag tắt thì hành vi byte-identical hiện tại, không đổi default, không rollback epic nào.

## Stories

- Story 53.1: BrowserPool Core — acquire/release/drain/stats + isolated contexts
- Story 53.2: Adapter + stealthBrowser `pooled` opt
- Story 53.3: jobQueue scrape processor thread `pooled`
- Story 53.4: Obscura pool-of-processes shard strategy
- Story 53.5: Crash containment + respawn + Bull re-queue
- Story 53.6: Telemetry dims + spike verify gate

## Requirements & Constraints

- Mỗi scrape job acquire một **isolated `browserContext`** riêng (incognito-equivalent, cookie/storage isolated) — không leak state cross-job. Shared-context chỉ được phép cho anonymous public scraping, qua opt-in tường minh (`SharedContextPool`).
- `release()` chỉ đóng context/page của job — **không đụng shared browser**. Browser lifecycle thuộc pool, không thuộc job.
- Pool phải có queue/backpressure khi hết slot, `drain()` cho shutdown, `stats()` cho observability.
- Post-auth jobs vẫn reject `obscura` backend (guard `requiresAuth===true` từ AD-23); pooled post-auth dùng isolated chrome context per account.
- Crash containment: pool detect browser chết → respawn; chỉ in-flight jobs trên browser đó fail, Bull `attempts`/`backoff` re-queue — không silent loss.
- Telemetry: `emitRun` thêm `pooled`, `poolBackend`, `poolWaitMs` khi `MEDIRUS_BROWSER_BACKEND_METRICS=1`.
- Spike (`scripts/browser-pool-spike.mjs`) được promote thành verify gate pre-release.

## Technical Decisions

**Evidence từ spike** (`implementation-artifacts/spike-browser-page-pool.md`, measured 2026-10-02):
- `newPage()`/context-acquire p50 ~70ms vs `browser.launch()` ~1558ms (≈22x rẻ); ΔRSS pool ~2–9MB vs +33MB launch-per-job.
- Shared context **bị leak state** → không dùng mặc định; isolated context clean.
- Contention sweep: chrome knee ở N=8 (nav p95 437→1659ms) — bottleneck là `createBrowserContext()` serialization, không phải nav.
- Obscura: `createBrowserContext` gần-free (23–78ms) nhưng nav/render là bottleneck (p95 6342ms @ N=16) → scaling axis của Obscura là **nhiều process**, không phải nhiều page-per-connection.

**Backend-aware ceiling** (chiến lược ngược nhau giữa 2 backend):
- **chrome** → sharded-pool: ~4–6 isolated contexts/browser, spawn browser thứ hai khi vượt ceiling.
- **obscura** → pool-of-processes: nhiều `obscura serve` (~30MB/process), mỗi process ~2–4 page/CDP-connection.

**Teardown contract** (AD-23 vẫn binding): `browser.__backend === 'obscura'` → `disconnect()`; `chrome` → `close()`. Pool sở hữu browser lifecycle; adapter trả handle, không close browser.

**Touchpoints** (đã ghi trong AD-24): `src/scraping/browserPool.js` (new), `src/scraping/stealthBrowser.js` (`pooled` opt), `src/scrapers/adapters/puppeteer.js` (`launch` pooled), `api/services/jobQueue.js` (thread `pooled` từ `job.data.pooled`/`MEDIRUS_BROWSER_POOL_SIZE`), `api/services/scrapeDispatch.js` (clamp + propagate pool size hints).

## Cross-Story Dependencies

- 53.1 (core) là nền — 53.2 adapter phụ thuộc `acquire/release` contract; 53.3 jobQueue phụ thuộc 53.2; 53.4 mở rộng policy của 53.1 cho obscura; 53.5, 53.6 orthogonal nhưng cần pool tồn tại.
- Epic 35 (story 35.5) vẫn đang mở — verification-only, không conflict; Epic 53 là layer mới giữa Bull worker và adapter.
- Reuse sẵn có: `stealthBrowser.js` (launch config), `puppeteer.js` adapter (`__backend` contract, `requiresAuth` guard), `jobQueue.js` (Bull `scrapeQueue.process('scrape', 2)` — concurrency cap cần nới khi pooled), telemetry `emitRun` path đã có `browserBackend` dim.
