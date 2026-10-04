---
title: 'Story 53.5 — Crash containment: dead-browser detection, respawn + Bull re-queue'
type: 'feature'
created: '2026-10-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '71a578b7cbb53ce528edacb91338d2691159adcb'
context:
  - '_bmad-output/implementation-artifacts/epic-53-context.md'
warnings:
  - oversized
deferred:
  - summary: >-
      sprint-status.yaml còn entries backlog cho story-53-2..53-6 dù spec files + git log chứng minh done — bookkeeping của workflow, không phải defect của diff 53.5.
    evidence: |-
      Intent-alignment reviewer noted divergence giữa bề mặt sprint-status và mã nguồn. Unverified severity — settle bằng một sweep cập nhật sprint-status.yaml cho đúng spec status.
    location: >-
      _bmad-output/implementation-artifacts/sprint-status.yaml
    severity: low (unverified)
  - summary: >-
      OBSCURA_BIN spawned-child OS-process restart chưa xử lý — khi tiến trình obscura con chết ở OS level, pool chỉ reconnect CDP endpoint, không spawn lại child.
    evidence: |-
      Intent reviewer flagged divergence giữa "crash containment" tên story và bề mặt xử lý chỉ ở CDP layer. Intent-contract của spec đã ghi out-of-scope; giữ deferred để epic sau quyết nếu dev auto-spawn mode cần containment tương đương.
    location: >-
      src/scraping/browserPool.js — spawnedChildren handling
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** `BrowserPool` (53.1–53.4, merged) giả định browser sống mãi: khi Chrome process crash hoặc `obscura serve`/CDP connection chết, entry giữ `browser` cũ — acquire kế tiếp `createBrowserContext` throw "Target closed" trên xác browser (deferred finding 53.4), các `contexts` cũ chiếm headroom ảo, và không có respawn nào. Một browser chết làm cạn capacity vĩnh viễn cho tới khi restart worker — silent loss.

**Approach:** Thêm dead-browser containment trong `BrowserPool`: (1) mỗi browser launch/connect gắn `disconnected` listener + acquire path check `isConnected()`/`browser` null → `_markBrowserDead(entry)` (browser=null, contexts/pending clear, chrome splice entry / obscura giữ endpoint-slot), (2) respawn lazy ngay trong acquire path đã có (obscura `_ensureObscuraConnection` reconnect; chrome `_ensureBrowser` re-launch trên entry browser-null), (3) `createBrowserContext` throw trên browser-dead → mark dead + retry trên entry khác/respawn (1 lần per acquire). In-flight jobs trên browser chết fail tự nhiên qua CDP reject → processor throw → Bull `attempts:3` + exponential backoff (đã có sẵn) re-queue — job retry acquire trên browser mới. Observability: `stats().respawns` counter + `console.warn` khi mark-dead.

## Boundaries & Constraints

**Always:**
- `browser.on('disconnected', ...)` được attach ngay khi `_ensureBrowser`/`_ensureObscuraConnection` connect thành công, trước khi entry được gán `browser`. Listener: nếu `entry.browser === browser` thì `_markBrowserDead(entry)` — stale disconnect sau respawn không được đụng entry mới.
- `_markBrowserDead(entry)`: `entry.browser = null`, `entry.contexts.clear()`, `entry.pending = 0`; chrome → splice entry khỏi `_browsers`; obscura → giữ entry (endpoint identity cho `stats().endpoints`); `_respawnCount++`; `console.warn` một dòng (backend + endpoint/index). Idempotent — gọi hai lần không đếm respawn hai lần.
- Acquire path: `_obtainContext` chrome — entry `browser===null` (lệ sót) hoặc `isConnected()===false` → `_markBrowserDead` rồi chọn entry khác/spawn mới; `_obtainObscuraContext` — `createBrowserContext` throw/null trên entry → nếu browser dead (`isConnected()===false` hoặc `browser` đã bị listener null) → `_markBrowserDead` + `continue` sang entry kế (tối đa một vòng retry trên cùng acquire — dùng `failedThisAcquire` hiện có), nếu browser vẫn sống → giữ nguyên behavior wrapped-error hiện tại.
- `isConnected()` check chỉ khi `typeof browser.isConnected === 'function'` — fake browser/mocks thiếu nó không bị phạt.
- `release()` của job trên browser chết vẫn free slot đúng (`_active--`, `_wakeNext`, `_onIdle`) — `entry.contexts` đã clear nên context-lookup no-op; page.close/context.close throw "target closed" → best-effort catch hiện có.
- Job-side crash propagate nguyên vẹn: crawler/`closeStealthBrowser`→`release` path và processor throw giữ nguyên — Bull `defaultJobOptions.attempts=3, backoff exponential 2000` (jobQueue.js L65-72, L87-95) tự re-queue; không catch/mute lỗi crash ở bất kỳ tầng nào.
- `drain()` đè respawn: mark-dead trong khi draining chỉ clear entry, không respawn; disconnected handler check `this._draining` → no-op respawn work.
- `SharedContextPool` (chrome) — browser dead → `_spawnSharedBrowser` re-launch qua `_ensureBrowser` sau khi entry splice; `stats().browsers` giảm khi chrome dead, obscura `stats().endpoints` giữ fleet shape.
- `XACTIONS_BROWSER_POOL_SIZE` unset → module không load → byte-identical.

**Never:**
- Không respawn proactive trong `disconnected` handler (no eager relaunch — tránh crash-loop storm); respawn chỉ xảy ra lazy trên acquire tiếp theo.
- Không health-probe/heartbeat/ping timer; không circuit-breaker/backoff bên trong pool.
- Không đổi Bull `attempts`/`backoff` defaults, không thêm job-level retry riêng của scrape processor; không sửa `scrape()`/`scrapeDispatch` signature.
- Không restart `OBSCURA_BIN` spawned children khi process chết — external-fleet mode reconnect CDP; spawned-child restart out of scope (ghi deferred nếu review yêu cầu).
- Không telemetry dims mới (53.6); `stats().respawns` là counter đủ dùng.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| CHROME_CRASH_LAZY | chrome pool, browser[0] fires `disconnected` khi có 1 lease in-flight | entry splice, `stats().browsers===0`, `respawns===1`; acquire kế spawn browser mới | none — acquire thành công trên browser mới |
| CHROME_CRASH_INFLIGHT | job đang giữ page trên browser crash | `page.goto()`/CDP reject "Target closed" → job throw → `release()` vẫn free slot | Bull re-queue job (attempts/backoff sẵn) |
| OBSCURA_CONN_DROP | obscura fleet 2 endpoints, entry A `disconnected` | entry A `browser=null`, contexts clear; acquire kế chọn B nếu có headroom, ngược lại reconnect A | connect-fail path hiện có (skip → next → wrapped) |
| OBSCURA_CTX_THROW_DEAD | `createBrowserContext` throw trên entry mà `browser` đã dead (`isConnected()===false`) | mark dead + retry entry kế hoặc reconnect cùng entry | chỉ khi mọi entry fail → throw wrapped/lastError hiện có |
| OBSCURA_CTX_THROW_ALIVE | `createBrowserContext` throw nhưng `isConnected()===true` | giữ behavior hiện tại — wrapped error, không retry, không mark dead | wrapped error propagate |
| DRAIN_VS_DISCONNECT | `drain()` đang chạy khi `disconnected` fires | mark-dead clear entry, không respawn, drain loop `closeStealthBrowser` đã best-effort | PoolDrainingError cho waiter |
| DOUBLE_DISCONNECT | listener fires 2 lần / stale browser disconnect sau respawn | `_markBrowserDead` idempotent, `respawns` chỉ +1, entry mới không bị đụng | none |
| STARVATION_RECOVER | tất cả browser dead, N waiter queued | release của in-flight fail-jobs wake waiter → spawn mới → jobs chạy lại | PoolAcquireTimeoutError nếu `acquireTimeoutMs` elapse |
| ENV_OFF | `XACTIONS_BROWSER_POOL_SIZE` unset | module không vào pooled path | none — byte-identical |

</intent-contract>

## Code Map

- `src/scraping/browserPool.js` — FILE CHÍNH (708 dòng). Seams cần sửa:
  - Constructor L114-116: thêm `this._respawnCount = 0` cạnh `_capacity`/`_endpoints`.
  - `_ensureBrowser(index)` L658-688 — chrome launch: sau khi launch thành công, attach `browser.on('disconnected')` → `_markBrowserDead(entry)`; đổi guard `if (this._browsers[index])` → cho phép re-launch khi `this._browsers[index]` có `browser===null` (reuse slot) hoặc splice+push mới — chọn một, đơn giản nhất: mark-dead splice nên `_ensureBrowser` không đổi shape (push entry mới).
  - `_ensureObscuraConnection(entry)` L582-623 — sau connect, attach listener tương tự (obscura `disconnect()` cũng fire `disconnected`).
  - `_markBrowserDead(entry, reason)` — NEW private method (~L410 internals block): contract ở Always§2.
  - `_obtainContext` chrome L484-513 — trước `entry.pending++`: check `entry.browser` falsy/`isConnected()===false` → `_markBrowserDead` + continue scan.
  - `_obtainObscuraContext` L521-575 — trong `catch` của `createBrowserContext` (L561-568): phân loại dead-vs-alive theo Always§3; dead → `failedThisAcquire.add(bestEntry)` + `_markBrowserDead` + `continue`.
  - `stats()` L385-409 — thêm `respawns: this._respawnCount` vào `base` (cả chrome + obscura shape).
  - `drain()` L349-379 — obscura giữ entries (đã làm 53.4); disconnected-listener guard `_draining` đã nêu.
- `src/scraping/stealthBrowser.js` — READ-ONLY. `closeStealthBrowser` L300-316 pooled path đã release đúng; `_pooledHandle` L76-88 không đổi.
- `api/services/jobQueue.js` — scrape processor L539-590 + `defaultJobOptions` L65-72/L87-95 (attempts:3, backoff exp 2000 — RE-QUEUE ĐÃ CÓ, không sửa). READ-ONLY verify only.
- `src/scrapers/index.js` — `scrape()` L278-322, `finally` → `crawler.cleanup()` → close → release. READ-ONLY.
- `tests/scraping/browserPool.test.js` — extend `makeFakeBrowser` (L18-43): thêm minimal `EventEmitter`-shape (`on`/`off`/`emit`, `_listeners` map) + `isConnected()` (false sau `close`/`disconnect`/`crash()`), helper `browser.crash()` → `emit('disconnected')` + `_closed`. Mock hiện record per-endpoint launch (`launchErrorsByEndpoint`).
- `docs/obscura-backend.md` — một đoạn: dead-endpoint semantics (entry giữ identity, reconnect lazy, `stats().respawns`).
- `scripts/browser-pool-spike.mjs` — READ-ONLY (success signal: giết browser giữa run → jobs re-queue, run hoàn tất).

## Tasks & Acceptance

**Execution:**

1. `src/scraping/browserPool.js` — `_respawnCount` field + `_markBrowserDead(entry)` (Always§2) + attach `disconnected` listener trong `_ensureBrowser` và `_ensureObscuraConnection` (guard `typeof browser.on === 'function'`, stale-browser guard `entry.browser === browser`, `_draining` check). `stats()` thêm `respawns`.
2. `src/scraping/browserPool.js` — acquire-path dead-detection: chrome `_obtainContext` (browser-null/isConnected-false → mark dead → chọn/spawn lại) và obscura `_obtainObscuraContext` (`createBrowserContext` throw: dead → mark+`failedThisAcquire`+continue; alive → giữ wrapped-error).
3. `tests/scraping/browserPool.test.js` — extend fake browser (EventEmitter + `isConnected` + `crash()`); cover mọi row I/O matrix: CHROME_CRASH_LAZY, CHROME_CRASH_INFLIGHT (page trên dead browser → release free slot), OBSCURA_CONN_DROP, OBSCURA_CTX_THROW_DEAD, OBSCURA_CTX_THROW_ALIVE, DRAIN_VS_DISCONNECT, DOUBLE_DISCONNECT, STARVATION_RECOVER, ENV_OFF (existing tests xanh).
4. `docs/obscura-backend.md` — đoạn ngắn dead-endpoint + respawn semantics.
5. `src/scraping/browserPool.d.ts` — `PoolStats.respawns?: number`; JSDoc acquire dead-recovery note.

**Acceptance Criteria:**
- Given một chrome pooled browser bị giết giữa chừng, when acquire tiếp theo chạy, then pool trả page trên browser mới spawn, `stats().browsers` phản ánh respawn và `respawns >= 1`.
- Given obscura endpoint chết trong fleet-2, when acquire, then jobs rơi vào endpoint còn sống; khi cả fleet đầy, acquire queue/timeout theo contract hiện có.
- Given `createBrowserContext` throw trên endpoint mà browser đã disconnect, when acquire, then entry bị mark dead và acquire retry trên entry khác hoặc reconnect — không throw ngay (đóng deferred finding 53.4).
- Given job in-flight trên browser crash, when processor throw, then `release()` vẫn free slot và Bull re-queue qua `attempts`/`backoff` sẵn có — không silent loss, không stuck waiter.
- Given `drain()` đang chạy, when `disconnected` fires, then không respawn nào xảy ra.
- `npx vitest run tests/scraping` xanh hết; `npm run typecheck` error count ≤ baseline (1300 pre-existing).

## Design Notes

- **Lazy-respawn qua scan hiện có, không thread riêng:** chrome dead → splice entry → `_spawnBrowser` path tự launch mới khi không entry nào có headroom; obscura dead → `browser=null` trên endpoint-slot → `_obtainObscuraContext` `_ensureObscuraConnection` reconnect lazy qua `_spawnLock`. Tái dùng đúng hai seam serialization sẵn có — không thêm concurrency primitive.
- **Dead-detection 3 lớp phòng thủ:** (a) `disconnected` listener = phát hiện chủ động (crash giữa jobs), (b) `isConnected()` pre-check trong scan = phòng listener miss, (c) `createBrowserContext` throw classify = safety net cuối (một phần death chỉ lộ qua CDP call). Chỉ (c) mới retry — lỗi trên browser sống vẫn propagate nguyên.
- **Bull re-queue = reuse, không code:** `scrapeQueue` `attempts:3` + `backoff:{type:'exponential',delay:2000}` đã ship (50.2). Crash → processor throw → Bull tự re-queue → retry `resolvePooledFlag` → `pooled` vẫn set → acquire trên browser mới. Story này chỉ phải KHÔNG nuốt lỗi và đảm bảo slot không leak.
- **`respawns` counter** làm ground truth cho 53.6 telemetry dims; không thêm dim mới ở đây.

## Verification

**Commands:**
- `npx vitest run tests/scraping` — toàn bộ pass, gồm ≥8 case mới của I/O matrix.
- `npm run typecheck` — error count ≤ 1300 (baseline pre-existing), không lỗi mới trong file sửa.
- `node --check src/scraping/browserPool.js` — sạch.

**Manual checks (không gate CI):**
- `scripts/browser-pool-spike.mjs` với `XACTIONS_BROWSER_POOL_SIZE>0`, giết một Chrome/obscura process giữa run: jobs trên browser đó fail → Bull re-queue → run hoàn tất; `stats().respawns` > 0; không job nào mất dấu.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 17 findings — high 1, medium 1, low 6, false 7, maybe-false 2
- notes: edge-case-hunter layer spawned 4× via `pi --mode json -p --no-session` (sonnet-5, same capability); every run died mid-turn after reading instruction/diff/claims without emitting a findings report (silent stream end, rc=0). Recorded as layer failure; blind-hunter and verification-gap layers independently surfaced the same defect classes the edge layer's truncated analysis touched (pending-underflow, listener removal, claims-vs-diff checks), so coverage was preserved by overlap. Intent-alignment layer reported descriptively (no actionable findings beyond items triaged below).
- findings:
  - `[high]` `[patch]` blind: `pending = -1` trên obscura entry sau `createBrowserContext` throw+`_markBrowserDead` (mark dead reset `pending=0` rồi `finally` decrement → `-1`, entry obscura không splice nên persist → headroom ảo `pagesPerProcess+1`) — verified đọc code L649/L668/L694 + stats headroom formula; FIX: clamp `Math.max(0, pending-1)` trong cả hai `finally` (chrome đồng nhất), thêm assertion `pending===0` vào `OBSCURA_CTX_THROW_DEAD`.
  - `[medium]` `[patch]` gap (pre-verified): thiếu test cho `SharedContextPool` backend obscura crash — FIX: thêm `SHARED_OBSCURA_CRASH` test (conn drop → acquire kế reconnect, 2 launches).
  - `[low]` `[reject]` blind: listener attach trước `entry.browser = browser` tạo race window — reorder không đóng được window (disconnect giữa launch và attach vẫn miss), pre-acquire `isConnected()` scan đã cover; fix thật cần guard chưa demonstrate được.
  - `[low]` `[reject]` blind: shared-obscura branch không retry khi browser chết giữa check và `createStealthPage` — in-flight fail + next-acquire pre-scan recovery đúng contract; retry loop thêm complexity không cần.
  - `[low]` `[reject]` blind: `STARVATION_RECOVER` chưa cover `PoolAcquireTimeoutError` — timeout path đã có `ACQUIRE_TIMEOUT` test hiện hữu; starvation-recover cover đúng phần mới.
  - `[low]` `[reject]` blind: error message "does not support isolated contexts" gây hiểu nhầm khi null-context sau retry — double-dead-in-one-acquire cực hiếm, chỉ cosmetic.
  - `[low]` `[reject]` blind: `acquire()` catch không mark dead khi `createStealthPage` throw — harm chỉ là `respawns` counter trễ một nhịp; pre-scan acquire kế bắt ngay; thêm entry-lookup branch không đáng.
  - `[low]` `[reject]` gap (verification gaps §1, phần concurrent waiters): nhiều acquirer đợi trên endpoint chết — chưa demonstrate; headroom math đã được pending-clamp fix bảo vệ, scenario phức tạp để dựng.
  - `[false]` `[reject]` blind+gap: stray changes `src/mcp/local-tools.js` trong diff — verified: là uncommitted working-tree residue từ subagent lần trước (debug console.error + `pg.close()` + hardcoded URL), không thuộc story; đã `git checkout` revert và regen diff — diff cuối không còn file này.
  - `[false]` `[reject]` blind: `_markBrowserDead` không splice chrome entry `browser===null` — không có path nào chrome entry với `browser===null` tồn tại trong `_browsers` (mark dead splice ngay; entry tạo `browser:null` được gán trước khi push).
  - `[false]` `[reject]` blind: obscura full-fleet throw thay queue/timeout — `'all live obscura endpoints are at capacity'` là contract pre-existing của 53.4 (identical ở baseline L543-546), queue contract chỉ áp dụng ở slot-level.
  - `[false]` `[reject]` blind: listener `disconnected` leak — listeners nằm TRÊN emitter; `_markBrowserDead` null `entry.browser` → handle GC kèm listeners; không ref ngược từ browser về pool.
  - `[false]` `[reject]` gap §3+Other: `x_post_tweet` thiếu test luồng non-dryRun — file đã revert khỏi diff, hoàn toàn ngoài scope story.
  - `[maybe-false]` `[defer]` intent: `sprint-status.yaml` backlog entries cho 53.2–53.4 stale (git log + spec files chứng minh done) — bookkeeping của workflow, không phải defect của diff này; settle bằng một sweep cập nhật sprint-status.
  - `[maybe-false]` `[defer]` intent: `OBSCURA_BIN` spawned-child OS-process restart chưa xử lý — intent-contract của spec đã ghi out-of-scope, nhưng ghi deferred để epic sau quyết.
  - `[false]` `[reject]` intent divergence "Bull re-queue surface": spec's intent-contract scoped reuse `attempts:3`+backoff có sẵn (verified `jobQueue.js` L87-95 ở investigation) — không divergence, không code cần thêm.
  - `[medium]` `[patch]` blind §8 (test coverage) — FIX: thêm `OBSCURA_CTX_NULL_DEAD` (ctx null trên dead endpoint + pending invariant), `DOUBLE_DISCONNECT_CHROME`, `SHARED_OBSCURA_CRASH`, pending assertion vào `OBSCURA_CTX_THROW_DEAD`.

## Auto Run Result

**Summary:** Story 53.5 — crash containment cho `BrowserPool`: dead-browser detection 3 lớp (`disconnected` listener + `isConnected()` pre-scan + `createBrowserContext`-throw classify), `_markBrowserDead` idempotent (chrome splice entry, obscura giữ endpoint slot, `_respawnCount` + `console.warn`, drain suppress accounting), lazy respawn qua `_spawnLock` seams hiện có — không thread/lock mới. In-flight jobs fail tự nhiên qua CDP reject, `release()` vẫn free slot, Bull `attempts:3`+exp-backoff (sẵn có) re-queue. `stats().respawns` thêm vào `PoolStats`.

**Files changed:**
- `src/scraping/browserPool.js` — detection+mark-dead+listener infra, retry-once chrome `_obtainContext`, per-endpoint retry `_obtainObscuraContext`, pending clamp, dead sweeps trong `_spawnBrowser`/`_ensureBrowser`/shared-obscura branch.
- `src/scraping/browserPool.d.ts` — `PoolStats.respawns?: number`.
- `tests/scraping/browserPool.test.js` — fake browser +EventEmitter/`isConnected`/`crash()`; 14 case 53.5 (mọi I/O matrix row + pending-invariant + shared-obscura).
- `docs/obscura-backend.md` — mục "Dead-Endpoint Containment & Respawn (Story 53.5)".
- `_bmad-output/implementation-artifacts/spec-53-5-crash-containment-respawn-bull-requeue.md` — spec mới.

**Review findings breakdown:** 1 high patched (`pending` -1 → `Math.max` clamp), 2 medium patched (shared-obscura test coverage, missing dead-path tests), 6 low rejected (race-window reorder vô ích, complexity không đáng), 7 false rejected (stray file đã revert, leak không tồn tại, contract pre-existing), 2 maybe-false deferred (sprint-status stale — bookkeeping; OBSCURA_BIN child respawn — intent out-of-scope). Edge-case-hunter layer fail x4 (subagent died trước khi report) — coverage bù bởi overlap blind+gap.

**Patches applied:** `pending` clamp ở 2 `finally`; tests `OBSCURA_CTX_NULL_DEAD`, `DOUBLE_DISCONNECT_CHROME`, `SHARED_OBSCURA_CRASH`, pending assertion trong `OBSCURA_CTX_THROW_DEAD`.

**Verification performed:**
- `npx vitest run tests/scraping` — 88/88 pass (46 trong browserPool.test.js sau khi thêm case).
- `npm run typecheck` — 1299 errors ≤ 1300 baseline, 0 errors trong file sửa.
- `node --check src/scraping/browserPool.js` — sạch.
- `git diff` vs baseline `71a578b7` — 5 files, không stray (local-tools.js residue đã revert trước diff cuối).

**Residual risks:** `disconnected`-listener nanosecond window giữa launch và attach (pre-scan cover, không đóng được hoàn toàn); manual spike check `scripts/browser-pool-spike.mjs` chưa chạy (manual-only gate, cần Chrome thật); edge-case-hunter layer không report được nên edge coverage dựa trên overlap hai layer còn lại.
