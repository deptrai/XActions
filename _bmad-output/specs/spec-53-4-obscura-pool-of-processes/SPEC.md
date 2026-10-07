---
id: SPEC-53-4-obscura-pool-of-processes
companions:
  - shard-policy.md
  - ../../implementation-artifacts/epic-53-context.md
  - ../../planning-artifacts/architecture/medirus-hybrid-scraping-spine/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# Story 53.4 — Obscura Pool-of-Processes Shard Strategy

## Why

Pain: Epic 53's `BrowserPool` (53.1–53.3, đã merged) coi mọi backend giống nhau —
mỗi entry `_browsers[]` là một CDP connection tới **cùng một** `OBSCURA_WS_ENDPOINT`.
Với obscura, bottleneck nằm ở nav/render bên trong tiến trình `obscura serve`
(~30MB/process), không phải context-create — spike-verified trên một process duy
nhất (số liệu ở `shard-policy.md`). Opportunity: shard obscura qua fleet nhiều
process bên ngoài bằng endpoint-rotation, còn chrome giữ sharding bằng isolated
contexts — làm pool backend-aware đúng AD-24.

## Capabilities

- **CAP-1**
  - **intent:** Pool với backend `obscura` phân phối jobs qua một fleet các
    `obscura serve` process bên ngoài — địa chỉ qua `OBSCURA_WS_ENDPOINTS`
    (comma list; fallback `OBSCURA_WS_ENDPOINT` = fleet of 1), mỗi process phục vụ
    tối đa `pagesPerProcess` (mặc định 3, khoảng 2–4) CDP page connections.
  - **success:** Acquire chọn endpoint entry có `(pages + pending)` headroom cao
    nhất (first-fit, không round-robin); acquire thứ `N×P+1` khi fleet bão hòa
    phải queue + bounded bởi `acquireTimeoutMs`; `stats()` expose
    `endpoints: [{endpoint, pages, pending}]` để verify phân phối.

- **CAP-2**
  - **intent:** Pool với backend `chrome` giữ sharding bằng ~4–6 isolated
    `browserContext` per browser, spawn browser mới khi mọi browser hiện hữu đạt
    ceiling (hành vi 53.1 hiện có).
  - **success:** `contextsPerBrowser` trong khoảng 4–6 theo AD-24; acquire thứ
    `contextsPerBrowser+1` spawn browser thứ hai — test tồn tại và xanh.

- **CAP-3**
  - **intent:** Obscura jobs vẫn nhận isolated `browserContext` per job bên trong
    mỗi process (spike-verified: `isolatedContextLeak=false`) — shard unit là
    process vì throughput, không phải vì isolation.
  - **success:** Cookie set trong context job A không hiện trong context job B
    trên cùng một obscura process — giữ đúng probe của spike suite.

- **CAP-4**
  - **intent:** Shard policy backend-aware và configurable qua cùng API
    `BrowserPool`/`acquire`/`release` — caller 53.2/53.3 không đổi.
  - **success:** Không callsite adapter/stealthBrowser/jobQueue đổi signature;
    ceiling knob tách per-backend (`contextsPerBrowser` vs `pagesPerProcess`).

## Constraints

- AD-23 teardown binding: connection tới mỗi obscura endpoint `disconnect()` —
  KHÔNG terminate daemon (external ownership); `drain()` chỉ đóng connections.
  (Dev auto-spawn qua `OBSCURA_BIN` — nếu implement — phải kill child processes
  trong `drain()`; `OBSCURA_WS_ENDPOINTS` non-empty luôn thắng `OBSCURA_BIN`.)
- `requiresAuth === true` vẫn reject `obscura` backend (AD-23 guard).
- Endpoint list parsing: trim từng entry, dedupe sau URL-normalize, entry
  malformed → pool init fails loudly; `OBSCURA_WS_ENDPOINTS` rỗng/whitespace →
  coi như unset, fallback `OBSCURA_WS_ENDPOINT`.
- Effective capacity = `min(size, N_endpoints × pagesPerProcess)`; khi `size`
  vượt capacity, pool clamp slot ceiling về capacity và `stats().capacity`
  expose giá trị đó — không silent starvation.
- `pagesPerProcess` phải `Number.isFinite && >= 1`, else fallback default 3;
  ceiling đếm cả `pending` reservations (carry-over từ 53.1) — concurrent
  acquires không overshoot.
- Endpoint entries connect lazy — lần acquire đầu cần entry đó (khớp lazy-spawn
  hiện có); connect-fail trên một endpoint → skip và thử entry kế tiếp có
  headroom; toàn fleet fail → wrapped error như `_ensureBrowser` (respawn và
  health-check là 53.5).
- `createBrowserContext` trên obscura connection trả null/throw → reuse error
  wrap của `_obtainContext` — không cho phép page rơi về default shared context.
- `drain()` giữa lúc acquire đang connect → post-connect re-check `_draining`
  → `disconnect()` + `PoolDrainingError` (không orphan connection).
- Fleet membership fixed suốt pool lifetime — đổi endpoints yêu cầu
  `drain()` + rebuild; env re-read không hot-reload.
- Acquire result và `stats()` expose endpoint identity (`endpoint` field) để
  53.6 telemetry dim `poolEndpoint` dựng trên schema có sẵn.
- Opt-in nghiêm ngặt: `MEDIRUS_BROWSER_POOL_SIZE=0` (default) giữ byte-identical
  behavior; fleet sharding không kích hoạt ngầm.
- Acquire serialized qua connect-lock hiện có — concurrent acquires không
  double-connect cùng endpoint.

## Non-goals

- Không respawn/crash recovery/health-probing cho endpoint chết — Story 53.5.
- Không autoscale theo tải — fleet size và ceiling là tĩnh theo cấu hình.
- Không đổi caller-facing API từ 53.2/53.3.
- Không spawn `obscura serve` child_process trong prod path — fleet là external;
  `OBSCURA_BIN` auto-spawn chỉ là dev/spike nicety, optional và thua env list.
- `SharedContextPool` giữ pin một endpoint (anonymous public scraping) —
  fleet rotation không apply cho shared mode.
- Telemetry dim `poolEndpoint` — deferred 53.6; story này chỉ expose identity.

## Success signal

Chạy `scripts/browser-pool-spike.mjs` backend `obscura`, `JOBS=32` cùng target,
hai lần đo với `POOL_SIZE=8`, `pagesPerProcess=4`: fleet 1 endpoint
(`OBSCURA_WS_ENDPOINT`) vs fleet 2 endpoints (`OBSCURA_WS_ENDPOINTS` two ports).
Pass khi `metrics.wallMs` của fleet-2 ≤ ~0.6× fleet-1 VÀ `stats().endpoints`
cho thấy leases phân phối qua cả hai endpoint.

## Assumptions

- Fleet processes do supervisor/operator quản lý (docs/obscura-backend.md định
  nghĩa `obscura serve` là external shared daemon); pool chỉ connect+rotate.
