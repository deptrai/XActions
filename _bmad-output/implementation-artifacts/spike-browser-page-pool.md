---
title: 'Spike — Browser Page Pool: Shared Browser, Per-Job Pages'
type: 'spike'
status: 'draft'
created: '2026-10-02'
author: 'Winston (System Architect)'
related:
  - 'docs/obscura-backend.md'
  - 'docs/obscura-watch.md'
  - 'src/scraping/stealthBrowser.js'
  - 'src/scrapers/adapters/puppeteer.js'
  - 'src/scrapers/adapters/base.js'
  - 'api/services/jobQueue.js'
  - 'api/services/scrapeDispatch.js'
---

# Spike — Browser Page Pool

## 1. Vấn đề

Mỗi scrape job hiện tại **launch 1 browser process riêng** (Chrome ~300–500MB RAM, Obscura ~30MB nhưng vẫn là 1 CDP connection + engine context). Bull `concurrency=2` nghĩa là ~1GB RAM cho 2 job chạy song song — và muốn tăng throughput phải tăng RAM tuyến tính theo số browser, không phải theo số page.

**Root cause kiến trúc**: `adapter.launch()` được gọi **per-job**, không phải **per-worker**. `browser` là throwaway — mở, dùng 1 page, đóng/kill.

## 2. Mục tiêu spike

Chứng minh một **browser-page-pool** có thể:

1. **Một browser process phục vụ N job đồng thời** bằng cách mượn `page` (tab) từ pool thay vì launch browser mới.
2. **Giảm RAM/CPU per job** từ O(browser) xuống O(page) (~50–80MB/page vs ~300–500MB/browser).
3. **Không phá contract hiện tại**: teardown per-backend (`close()`/`disconnect()`), guard `requiresAuth`, fingerprint, backend resolution.
4. **Định lượng được ceiling**: bao nhiêu page/browser trước khi upstream rate-limit / memory per page / renderer contention thành bottleneck mới.

**Không phải mục tiêu**: thay đổi public scraping contract, đổi default backend, hay đụng post-auth paths.

## 3. Câu hỏi cần trả lời

| # | Câu hỏi | Tại sao quan trọng |
|---|---|---|
| Q1 | `page` có thực sự isolated không? (cookie, storage, UA, fingerprint, proxy-auth) | Nếu state leak giữa page → cross-contamination giữa job/account |
| Q2 | `browser.newPage()` cost bao nhiêu ms vs `browser.launch()`? | Quyết định latency gain |
| Q3 | Một browser chịu được bao nhiêu page concurrent trước khi renderer contention? | Xác định pool ceiling thực tế |
| Q4 | Obscura (CDP) có hỗ trợ multi-page trên 1 connection không? | `browser.pages()` / `newPage()` semantics trên non-Chromium engine |
| Q5 | Teardown: `page.close()` trên shared browser có giết browser không? | Contract hiện tại `close()` giết chrome, `disconnect()` giữ obscura |
| Q6 | Proxy per-page vs per-browser? | Medirus proxy-pool cấp proxy theo account — page-level proxy auth khác browser-level `--proxy-server` |
| Q7 | Backpressure: khi pool cạn, job xếp hàng hay fail? | Tương tác với Bull `concurrency` + `adaptive-governor` |

## 4. Đề xuất kiến trúc (2 hướng)

### Option A — Browser Pool ở Worker Process (khuyến nghị)

```
Bull Worker Process
   │
   ├─ BrowserPool (1 per backend: chrome | obscura)
   │     ├─ chromeBrowser  ── newPage() ──► [page1, page2, ... pageN]
   │     └─ obscuraBrowser ─ newPage() ──► [page1, page2, ... pageN]
   │
   └─ Job handler: acquirePage(backend) → scrape → releasePage()
```

- `BrowserPool` là **module-level singleton** trong worker process, lazy-init khi job đầu tiên cần backend đó.
- `acquirePage()` trả `AdapterPage` bọc `{_native, _adapter, _backend, _poolId}`.
- `releasePage()` → `page.close()` (không đụng browser).
- Pool config: `MEDIRUS_BROWSER_POOL_SIZE` (default 0 = off, opt-in), `MEDIRUS_BROWSER_POOL_MAX_PAGES_PER_BROWSER`.
- **Giữ `requiresAuth` guard**: post-auth job vẫn force `chrome` backend + có thể force dedicated browser (không pool) nếu fingerprint/account cần cô lập tuyệt đối.

**Ưu**: ít invasive nhất, giữ nguyên `adapter.launch()` contract, dễ A/B.
**Nhược**: một browser crash → mất N job đang chạy trên nó (cần circuit-breaker + respawn).

### Option B — Page Pool ở Adapter Layer

`PuppeteerAdapter.launch()` trả **virtual browser** thực chất là handle vào shared pool. Caller tưởng đang launch riêng nhưng thực tế mượn page.

**Ưu**: transparent với caller, không cần đổi job handler.
**Nhược**: phá vỡ mental model "1 launch = 1 browser", teardown contract phức tạp (caller `close()` nhưng thực tế chỉ release page → nguy cơ leak browser). **Không khuyến nghị** — quá nhiều magic.

## 5. Phạm vi spike (in-scope)

- `src/scraping/browserPool.js` **mới** — `BrowserPool` class: `acquire(backend)`, `release(page)`, `drain()`, `stats()`.
- `src/scraping/stealthBrowser.js` — thêm `pooled` option → `launchStealthBrowser` trả pooled page thay vì browser khi pool on.
- `src/scrapers/adapters/puppeteer.js` — `launch()` nhận `options.pooled` để lấy page từ pool.
- `api/services/jobQueue.js` — scrape processor thread `pooled` từ job data / env.
- `scripts/browser-pool-spike.mjs` — benchmark: N concurrent scrape jobs, đo RAM/CPU/latency so với launch-per-job.

**Out of scope**: post-auth paths, signer-pool (đã là page-pool riêng), Facebook account pool (đã là p-limit riêng), đổi default.

## 6. Rủi ro chính cần đo trong spike

| Rủi ro | Cách đo | Ngưỡng "fail" |
|---|---|---|
| State leak giữa page (cookie/storage) | 2 job xen kẽ set cookie → job B đọc thấy cookie job A | leak = fail |
| Renderer contention | Tăng page/browser 1→2→4→8, đo p95 goto latency | latency >2x baseline ở N=4 → ceiling thấp hơn kỳ vọng |
| Obscura multi-page | `obscura serve` + N `newPage()` song song trên 1 connection | crash/hang = fail (document giới hạn) |
| Crash blast radius | kill -9 browser mid-job → đếm job bị ảnh hưởng | pool phải respawn + retry job, không hang |
| Proxy per-page không hoạt động | 2 page khác proxy trên cùng browser | nếu IP không đổi theo page → proxy-pool design phải đổi (per-context) |
| Memory fragmentation | chạy 100 job, đo RSS drift | leak >20% sau 100 job → cần browser recycle policy |

## 7. Kết quả mong đợi

- **Go**: page-pool cho **public scraping lane** (chrome + obscura) với `MEDIRUS_BROWSER_POOL_SIZE` opt-in. RAM/job giảm ~5–10x.
- **No-go**: document rõ ràng tại sao (state leak / Obscura không multi-page / contention), giữ launch-per-job.
- **Partial**: pool chỉ cho chrome, hoặc chỉ public, hoặc cần per-page browser-context (Chrome `createBrowserContext` cho isolation).

## 8. Kết quả spike thực tế (chrome backend, 2026-10-02)

Benchmark: `PUPPETEER_EXECUTABLE_PATH=<system-chrome> MODE=all JOBS=4 POOL_SIZE=2` trên `https://example.com`. Script: `scripts/browser-pool-spike.mjs`.

| Mode | Wall (4 jobs) | ΔRSS | nav p50 | nav p95 | page-acquire p50 | State leak |
|---|---|---|---|---|---|---|
| `launch-per-job` (baseline hiện tại) | 4061 ms | +33 MB | 288 ms | 314 ms | **1558 ms** | n/a |
| `pool-shared-context` | **2022 ms** | **+2 MB** | 47 ms | 54 ms | **70 ms** | **sharedLeak=true** ⚠️ |
| `pool-isolated-context` | 4988 ms | +9 MB | 293 ms | 295 ms | 392 ms | **sharedLeak=false, isoLeak=false** ✅ |

### Trả lời các câu hỏi spike

- **Q1 — isolation**: `browserContext` (isolated mode) **không leak state** (cookie không cross giữa 2 context). Shared-context **leak** — đúng như dự đoán, không dùng cho multi-account/multi-tenant.
- **Q2 — newPage vs launch cost**: `newPage()` ~**70 ms** p50 vs `launch()` ~**1558 ms** p50 → **~22x nhanh hơn**. Đây là win lớn nhất.
- **Q3 — contention ceiling**: ở POOL_SIZE=2, shared-context nav p95 chỉ **54 ms** (vs 314 ms baseline) — chưa thấy contention. Cần sweep N=4/8/16 để tìm knee point.
- **Q4 — Obscura multi-page**: chưa đo (binary không có sẵn trong env). `createBrowserContext` trên Obscura CDP **chưa verify** — đây là risk còn lại.
- **Q5 — teardown**: `page.close()` không kill shared browser — pool release đúng.
- **Q6 — proxy per-page**: chưa test trực tiếp; isolated context là prerequisite cho per-page proxy auth.
- **Q7 — backpressure**: pool cạn → `acquire()` queue wait (implemented). Wall-time growth ở isolated mode (4988ms) chủ yếu do context-create cost, không phải contention.

### Kết luận sơ bộ

**Pool có giá trị thật**:
- `pool-shared-context`: **2x wall-time nhanh hơn**, **~16x ít RAM hơn** (ΔRSS 2MB vs 33MB), page-acquire **22x nhanh hơn**. Nhưng **chỉ an toàn cho single-tenant/no-cookie** workloads.
- `pool-isolated-context`: **state-isolated đúng** (cần cho multi-account) nhưng page-acquire đắt hơn (~392ms — vẫn **4x nhanh hơn** launch-per-job) và wall-time cao hơn do context-create.

**Hướng kiến trúc nổi lên**: `pool-isolated-context` là **sweet spot** cho multi-account scraping (giữ isolation, vẫn nhanh hơn launch-per-job ~4x và ít RAM hơn ~3.7x). `pool-shared-context` chỉ cho anonymous/public scraping không cần cookie isolation.

---

## 8b. Contention sweep — N=4 → 8 → 16 (chrome, 2026-10-02)

Sweep concurrency để tìm knee point. `JOBS = 2×POOL_SIZE` mỗi run.

| Mode | N (pool) | Jobs | Wall | ΔRSS | nav p95 | pageAcq p50 | Verdict |
|---|---|---|---|---|---|---|---|
| **isolated-context** | 2 | 4 | 4988 ms | +9 MB | 295 ms | 392 ms | baseline |
| **isolated-context** | 4 | 8 | 6398 ms | +34 MB | 437 ms | 1001 ms | pageAcq ×2.5 — context-create queueing |
| **isolated-context** | 8 | 16 | 9289 ms | +47 MB | 1659 ms | 1757 ms | nav p95 ×3.8 — contention bắt đầu |
| **isolated-context** | 16 | 32 | 15418 ms | +52 MB | 1011 ms | 3741 ms | pageAcq ×9.5 — **context-create là bottleneck, không phải nav** |
| **shared-context** | 8 | 16 | 2442 ms | +44 MB | 167 ms | 263 ms | scale tốt |
| **shared-context** | 16 | 32 | 3225 ms | +59 MB | 279 ms | 597 ms | vẫn scale — chưa thấy knee |

### Phát hiện then chốt từ sweep

1. **Bottleneck của isolated mode là `createBrowserContext()`, không phải nav.** Ở N=16, page-acquire p50 = 3741 ms (gồm context-create) trong khi nav p95 chỉ 1011 ms. Context creation serialize trong 1 browser → queue.
2. **Shared-context scale mượt tới N=16** (nav p95 279 ms, wall 3.2s cho 32 jobs) — nhưng không isolation.
3. **Knee point isolated-context ≈ N=8**: nav p95 tăng đột (437→1659 ms) và page-acquire tăng gấp đôi mỗi bậc. Trên ~8 isolated context/browser → diminishing return.
4. **RAM scale tuyến tính nhẹ** cả hai mode (~1.5–2 MB/job marginal sau pool warm) — RAM không phải ceiling; **context-create throughput là ceiling**.

### Khuyến nghị kiến trúc cập nhật (dựa trên sweep)

- **Anonymous/public scraping** (không cần cookie isolation) → `pool-shared-context`, ceiling thực tế **~16 page/browser** trước khi cần thêm browser process.
- **Multi-account/authenticated scraping** → `pool-isolated-context`, ceiling **~4–6 context/browser**. Vượt ceiling → spawn browser thứ hai (pool-of-browsers), không phải nhồi thêm context.
- **Pool-of-pools**: khi cần >6 isolated context, kiến trúc đúng là **nhiều browser, mỗi browser một pool nhỏ** — không phải 1 browser N context. Đây là pattern "sharded browser pool".

---

## 8c. Obscura multi-page — sweep thực tế (v0.2.3, 2026-10-02)

Test trên `obscura serve --port 9222 --stealth` (binary `obscura-aarch64-macos-stealth`, V8 14.5). **Kết quả đảo ngược Chrome hoàn toàn** — và đây là phát hiện quan trọng nhất của spike.

| Mode | N (pool) | Jobs | Wall | ΔRSS | nav p95 | pageAcq p50 | State leak |
|---|---|---|---|---|---|---|---|
| **obscura shared** | 4 | 8 | 2929 ms | +31 MB | 1001 ms | **24 ms** | sharedLeak=true |
| **obscura isolated** | 4 | 8 | 4644 ms | +28 MB | 1412 ms | **23 ms** | **isoLeak=false** ✅ |
| **obscura isolated** | 8 | 16 | 7994 ms | +29 MB | 3145 ms | **41 ms** | isoLeak=false |
| **obscura isolated** | 16 | 32 | 13726 ms | +32 MB | 6342 ms | **78 ms** | isoLeak=false |
| **obscura shared** | 16 | 32 | 8850 ms | +33 MB | 3953 ms | 77 ms | sharedLeak=true |

### Q4 trả lời dứt khoát — Obscura HỖ TRỢ multi-page + isolated context

- `createBrowserContext()` trên Obscura CDP **hoạt động đúng**: `isolatedLeak=false` ở mọi N → isolation thật, không phải facade.
- Obscura giữ multi-page trên **1 CDP connection** — không crash, không hang ở N=16 (log sạch).

### Điểm đảo ngược Chrome — và ý nghĩa kiến trúc

| Metric | Chrome (isolated) | Obscura (isolated) | Ý nghĩa |
|---|---|---|---|
| page-acquire p50 @ N=16 | 3741 ms | **78 ms** | **Context-create ~48x rẻ hơn** trên Obscura |
| nav p95 @ N=16 | 1011 ms | 6342 ms | Nav contention **xấu hơn ~6x** trên Obscura |
| ΔRSS @ 32 jobs | +52 MB | +32 MB | Obscura nhẹ hơn ~40% |
| Bottleneck | `createBrowserContext()` serialize | **per-page render/nav engine** | Bottleneck **dịch chuyển** |

**Đảo ngược cốt lõi**: trên Chrome, context-create là bottleneck còn nav rẻ; trên Obscura, context-create gần như free (~30–80ms) còn **nav/render là bottleneck thực**. Obscura dùng non-Chromium engine — mỗi page render nặng hơn khi concurrent (V8 isolate + layout per page).

### Ceiling thực tế trên Obscura

- Isolated context: nav p95 vượt 3s ở N=8, 6s ở N=16 → ceiling hợp lý **~4 page/CDP-connection** cho workload nặng nav.
- Nhưng page-acquire gần-free → **scale bằng nhiều `obscura serve` process** (mỗi cái ~30MB) rẻ hơn nhiều so với nhồi page vào 1 connection. **10 obscura serve ≈ 300MB — rẻ hơn 1 Chrome.**

### Kết luận kiến trúc cuối — backend-dependent ceiling

```
Chrome isolated   → bottleneck = createBrowserContext → sharded-pool (nhiều browser, ít context)
Obscura           → bottleneck = nav/render engine    → MANY obscura serve processes, ít page/process
```

**Đây là insight then chốt**: chiến lược pool cho Obscura **ngược** với Chrome. Với Obscura ~30MB/process, pattern đúng là **"nhiều process obscura, mỗi process 2–4 page"** — không phải "1 engine nhiều page". RAM/process rẻ đến mức sharding theo process rẻ hơn sharding theo context.

## 9. Câu hỏi mở cần Luisphan quyết

1. **Isolation granularity**: pool chia sẻ 1 browser context (cookie chung) hay mỗi job 1 `browserContext` riêng (isolated incognito)? — quyết định Q1 và Q6.
2. **Blast radius chấp nhận được?**: 1 browser crash kéo theo N job — có cần per-account dedicated browser không?
3. **Pool share scope**: per-worker-process (an toàn, đơn giản) hay cross-process qua CDP-endpoint chia sẻ (phức tạp, cần orchestrator)?

---

> Spike này chỉ trả lời "có nên build browser-page-pool không và ceiling ở đâu" — implementation story sẽ là change request riêng sau khi spike xanh.
