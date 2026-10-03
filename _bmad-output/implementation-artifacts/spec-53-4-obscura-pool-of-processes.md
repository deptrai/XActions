---
title: 'Story 53.4 — Obscura pool-of-processes shard strategy (endpoint-rotation fleet)'
type: 'feature'
created: '2026-10-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - _bmad-output/specs/spec-53-4-obscura-pool-of-processes/SPEC.md
  - _bmad-output/specs/spec-53-4-obscura-pool-of-processes/shard-policy.md
  - _bmad-output/implementation-artifacts/epic-53-context.md
warnings: []
deferred:
  - summary: >-
      Isolated obscura: createBrowserContext throw trên live endpoint không failover sang
      endpoint khác (acquire() → _obtainContext gọi createStealthPage trực tiếp; chỉ connect
      failure mới có skip-entry logic)
    evidence: |-
      Edge-case-hunter đọc acquire() call path: browser connect OK nhưng createBrowserContext
      throw → reject thẳng, không re-pick entry. Spec shard-policy định nghĩa fail-skip chỉ
      cho connect; createBrowserContext failure là failure mode khác (process alive, context
      subsystem lỗi) — crash/recovery thuộc story 53.5 (NON-GOALS: respawn/crash-recovery).
    location: >-
      src/scraping/browserPool.js — acquire()/_obtainContext createStealthPage call
    severity: medium
baseline_revision: '0efffb9d5917dddedcb6ab625efe8098dce6d0d0'
---

<intent-contract>

## Intent

**Problem:** `BrowserPool` (53.1–53.3, merged) coi mọi backend giống nhau — mỗi entry `_browsers[]` connect CDP tới **cùng một** `OBSCURA_WS_ENDPOINT`. Với obscura, bottleneck là nav/render bên trong tiến trình `obscura serve` (~30MB/process), không phải context-create (spike-verified: isolated navMs ~6.3s vs shared ~3.9s trên 1 process) — nên shard unit của obscura phải là **process**, còn chrome vẫn shard bằng isolated contexts.

**Approach:** Backend-aware sharding trong `BrowserPool`: backend `obscura` phân phối acquires qua một fleet `obscura serve` process bên ngoài theo `OBSCURA_WS_ENDPOINTS` (comma list; fallback `OBSCURA_WS_ENDPOINT` = fleet of 1), mỗi endpoint-entry chịu tối đa `pagesPerProcess` (default 3) CDP page connections; chọn entry first-fit theo headroom cao nhất, connect lazy qua spawn-lock hiện có. Chrome giữ nguyên `contextsPerBrowser` (4–6) + spawn-browser khi bão hòa. Caller API 53.2/53.3 không đổi.

## Boundaries & Constraints

**Always:**
- `OBSCURA_WS_ENDPOINTS` non-empty luôn thắng `OBSCURA_WS_ENDPOINT` (singular) và `options.wsEndpoint`; parse: trim từng entry, dedupe sau `new URL().href` normalize, entry malformed → pool constructor throw loudly; env rỗng/whitespace → coi như unset.
- Effective capacity `= min(size, N_endpoints × pagesPerProcess)`; slot ceiling (`this._size`) clamp về capacity và `stats().capacity` expose giá trị đó — không silent starvation.
- `pagesPerProcess` = `options.pagesPerProcess` → `XACTIONS_BROWSER_PAGES_PER_PROCESS` → default 3; phải `Number.isFinite && >= 1`, else fallback 3. `contextsPerBrowser` (chrome) = option → `XACTIONS_BROWSER_CONTEXTS_PER_BROWSER` → default 5, clamp band [4,6] theo AD-24.
- Acquire cho obscura chọn endpoint-entry có `(pagesPerProcess − contexts.size − pending)` lớn nhất (first-fit, không round-robin); khi toàn fleet ở ceiling, acquire queue ở `_waitForSlot` và bounded bởi `acquireTimeoutMs`.
- Mỗi endpoint-entry connect lazy (acquire đầu cần entry đó mới `launchStealthBrowser({...opts, wsEndpoint: entry.endpoint})`), serialized qua `_spawnLock` — concurrent acquires không double-connect cùng endpoint.
- Connect-fail trên một endpoint → skip entry đó cho acquire hiện tại, thử entry kế tiếp còn headroom; toàn fleet fail → wrapped error đúng shape `_ensureBrowser` (giữ `cause`/`type`/`suggestedAction`/prototype). `drain()` giữa lúc connect → post-connect re-check `_draining` → `closeStealthBrowser` (disconnect) + `PoolDrainingError` — không orphan connection.
- Mỗi job vẫn nhận isolated `browserContext` riêng trên obscura process (CAP-3); `createBrowserContext` trả null/throw → reuse error wrap của `_obtainContext` — không rơi về shared default context.
- `acquire()` result gains `endpoint` (string, obscura); `stats()` với obscura gains `capacity` + `endpoints: [{endpoint, pages, pending}]` — 53.6 telemetry `poolEndpoint` dựng trên schema này. Chrome giữ shape `{browsers}` hiện có.
- `SharedContextPool` (obscura) pin endpoint[0]; `requiresAuth===true` vẫn reject obscura (guard sẵn có trong `launchStealthBrowser`, không bypass); `XACTIONS_BROWSER_POOL_SIZE=0` giữ byte-identical behavior.
- Fleet membership fixed suốt pool lifetime — đổi endpoints yêu cầu `drain()` + rebuild.
- `OBSCURA_BIN` dev auto-spawn (optional): chỉ khi KHÔNG có endpoint env nào; spawn `OBSCURA_BIN serve --port <OBSCURA_PORT_BASE + i>` cho `i < ceil(requestedSize / pagesPerProcess)`, chờ ws reachable; `drain()` kill children (fleet mode chỉ `disconnect()`).

**Never:**
- Không respawn/crash-recovery/health-probe cho endpoint chết — Story 53.5.
- Không autoscale theo tải; không đổi caller-facing API của 53.2/53.3 (adapter/stealthBrowser/jobQueue signature nguyên vẹn).
- Không spawn `obscura serve` child_process trong prod path mặc định; `SharedContextPool` không rotate fleet.
- Không telemetry dim `poolEndpoint` trong story này (53.6) — chỉ expose identity.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| FLEET_MULTI | `OBSCURA_WS_ENDPOINTS='ws://a,ws://b'`, size=8, pagesPerProcess=4 | entry a,b mỗi cái ≤4 leases; `stats().capacity===8`, `endpoints` có 2 phần tử | none |
| FLEET_FALLBACK | chỉ `OBSCURA_WS_ENDPOINT` set | fleet of 1 — hành vi hiện tại | none |
| PARSE_MALFORMED | `OBSCURA_WS_ENDPOINTS='ws://a,not a url'` | constructor throw, nêu entry lỗi | throw init |
| PARSE_DEDUPE | `'ws://a, ws://a/'` | 1 endpoint sau normalize | none |
| CAPACITY_CLAMP | size=16, 2 endpoints × pagesPerProcess=4 | `_size` effective 8, `stats().capacity===8`; acquire thứ 9 queue | PoolAcquireTimeoutError nếu timeout set |
| CONNECT_FAIL_SKIP | endpoint a dead, b live | acquire đi qua b; a marked-fail cho acquire đó | wrapped error chỉ khi toàn fleet fail |
| DRAIN_MID_CONNECT | `drain()` trong lúc `_ensureBrowser` đang await connect | post-connect `disconnect()` + `PoolDrainingError` | PoolDrainingError |
| ISOLATED_PER_JOB | 2 jobs cùng endpoint | 2 context riêng, cookie A không leak sang B | createBrowserContext null → wrapped error |
| CHROME_UNCHANGED | backend chrome, contextsPerBrowser=5, acquire thứ 6 khi browser đầy | spawn browser thứ 2 | như hiện tại |
| SHARED_PIN | SharedContextPool + obscura + 2 endpoints | chỉ connect endpoints[0] | none |
| ENV_OFF | `XACTIONS_BROWSER_POOL_SIZE` unset | module không vào pooled path — byte-identical | none |

</intent-contract>

## Code Map

- `src/scraping/browserPool.js` — FILE CHÍNH. `_browsers[]` hiện là `{browser, contexts:Set, pending}`; constructor `this._size` (L76-77), `_contextsPerBrowser` (L80-82), `_launchOptions.wsEndpoint` (L91). Seam cần sửa: `_obtainContext` (L289-317, first-fit scan + `createBrowserContext` wrap), `_spawnBrowser`/`_spawnLock` (L325-341, serialize + re-check headroom), `_ensureBrowser` (L360-389, launch + wrap + drain re-check), `acquire` return shape (L131-138), `stats` (L233-240), `release` (L198-215).
- `src/scraping/stealthBrowser.js` — `launchStealthBrowser` obscura path `puppeteerCore.connect({browserWSEndpoint: wsEndpoint})` (L212, tags `browser.__backend='obscura'`); pooled path `getDefaultPool(backend,{wsEndpoint,...})` (L169-189). ĐỌC-ONLY — không sửa (caller contract giữ nguyên); chỉ cần `browser.__endpoint` do pool tự tag sau connect.
- `tests/scraping/browserPool.test.js` — mock `launchStealthBrowser(opts)` ghi `opts.wsEndpoint` vào `state.launches`; fake browser có `createBrowserContext`/`disconnect`/`close` sẵn — extend mock để fail per-endpoint (`launchError` map theo wsEndpoint) và đếm pages per fake browser.
- `docs/obscura-backend.md` — định nghĩa `obscura serve` là external shared daemon; thêm mục ngắn về `OBSCURA_WS_ENDPOINTS` fleet + `pagesPerProcess`.
- `scripts/browser-pool-spike.mjs` — success-signal harness (fleet-1 vs fleet-2 wallMs), không sửa.
- `api/services/jobQueue.js`, `src/scrapers/adapters/puppeteer.js` — callers 53.2/53.3, READ-ONLY.

## Tasks & Acceptance

**Execution:**

1. `src/scraping/browserPool.js` — constructor: khi `backend==='obscura'` resolve `_endpoints` (parse `OBSCURA_WS_ENDPOINTS` → fallback `options.wsEndpoint`/`OBSCURA_WS_ENDPOINT`; trim, `new URL` normalize+dedupe, malformed throw; `OBSCURA_BIN` optional auto-spawn nếu không env nào), `_pagesPerProcess` (validated), `_size = min(requested, N×pagesPerProcess)`, `_capacity` exposed. Chrome path: thêm env `XACTIONS_BROWSER_CONTEXTS_PER_BROWSER` + clamp [4,6].
2. `src/scraping/browserPool.js` — `_obtainContext`/`_spawnBrowser`/`_ensureBrowser`: obscura dùng per-endpoint entry slots (một entry/endpoint, `entry.endpoint`), ceiling = `pagesPerProcess` đếm `contexts.size + pending`, first-fit max-headroom, lazy connect qua spawn-lock với per-entry `wsEndpoint`, connect-fail skip-entry→try-next→wrapped-error, drain mid-connect re-check, tag `browser.__endpoint`. `acquire` thêm `endpoint` vào result; `stats` thêm `capacity` + `endpoints[]` (obscura). `SharedContextPool` obscura pin endpoints[0].
3. `tests/scraping/browserPool.test.js` — mock mở rộng per-endpoint (record `opts.wsEndpoint`, inject fail theo endpoint); cover toàn bộ I/O matrix rows: FLEET_MULTI, FLEET_FALLBACK, PARSE_MALFORMED, PARSE_DEDUPE, CAPACITY_CLAMP, CONNECT_FAIL_SKIP, DRAIN_MID_CONNECT, ISOLATED_PER_JOB, CHROME_UNCHANGED (existing tests phải xanh), SHARED_PIN.
4. `docs/obscura-backend.md` — section ngắn: env surface `OBSCURA_WS_ENDPOINTS`/`XACTIONS_BROWSER_PAGES_PER_PROCESS`/`XACTIONS_BROWSER_CONTEXTS_PER_BROWSER`/optional `OBSCURA_BIN`+`OBSCURA_PORT_BASE`, fleet external-ownership + drain semantics.

**Acceptance Criteria:**
- Given backend obscura và 2 endpoints fleet, when 32 acquires chạy với pagesPerProcess=4, then leases phân phối qua cả 2 endpoint và `stats().endpoints` phản ánh đúng pages/pending mỗi entry.
- Given toàn fleet ở ceiling, when acquire tiếp, then nó queue và reject `PoolAcquireTimeoutError` nếu `acquireTimeoutMs` elapse.
- Given một endpoint connect-fail, when acquire, then job rơi vào endpoint còn headroom; toàn fleet fail thì error có `cause` + preserved structured fields.
- Given backend chrome, when contextsPerBrowser=5 và acquire thứ 6 lúc full, then browser thứ hai spawn — test xanh, không regression.
- Given `XACTIONS_BROWSER_POOL_SIZE` unset, when scrape chạy, then behavior byte-identical (module không được import vào default path).
- `npx vitest run tests/scraping` xanh hết; `npm run typecheck` error set không tăng so baseline.

## Design Notes

- Entry-slot model cho obscura: `_browsers[i]` tương ứng endpoint `i`, `browser` lazy-null cho tới connect đầu tiên — giữ nguyên scan shape của `_obtainContext`, thay "spawn new browser" bằng "connect entry chưa-connect" và "first-fit" bằng max-headroom. Chrome giữ spawn-unbounded hiện tại.
- `pages` trong stats = `contexts.size` của entry (mỗi lease = 1 context + 1 page trên process đó) — một counter duy nhất.
- Không cần thread `pagesPerProcess` qua jobQueue/scrapeDispatch — option-level trên `BrowserPool`/`getDefaultPool` + env; CAP-4 giữ caller immutable.
- Spec canonical + companion đã có sẵn (xem `context` frontmatter) — nếu spec này và SPEC.md conflict, SPEC.md thắng.

## Verification

**Commands:**
- `npx vitest run tests/scraping` — tất cả pass, gồm 10+ case mới của I/O matrix.
- `npm run typecheck` — error set ≤ baseline trước story.

**Manual checks:**
- `scripts/browser-pool-spike.mjs` backend obscura, JOBS=32, POOL_SIZE=8, pagesPerProcess=4: fleet-2 `wallMs` ≤ ~0.6× fleet-1 VÀ `stats().endpoints` chia leases qua 2 endpoint (cần 2 `obscura serve` thật — không gate CI).

## Review Triage Log

### 2026-01-25 — Review pass

- verdicts: 19 findings — high 0, medium 5, low 5, false 6, maybe-false 0
- findings (theo thứ tự layers báo cáo — blind-hunter ×10, edge-case-hunter ×3, verification-gap ×6):
  - `[medium]` `[patch]` blind-1 + edge-3 — SharedContextPool obscura: capacity báo N×ppp nhưng pin endpoint[0] → size clamp sai, acquire thứ (ppp+1) treo — FIXED: `_capacity = (isolated ? N : 1) × ppp`; test SHARED_CAPACITY thêm.
  - `[medium]` `[patch]` blind-2 + edge-2 + vgap-o1 — `OBSCURA_WS_ENDPOINT` singular fallback không qua normalize (URL parse, protocol check, `/` suffix) như list entries → inconsistency với stats/acquire endpoint — FIXED: `normalizeEndpoint(raw, source)` helper dùng chung cả hai đường; whitespace-only → unset; malformed/protocol sai → throw đồng nhất.
  - `[medium]` `[patch]` blind-6 — dead endpoint + live endpoint full → throw connect-error của dead endpoint thay vì capacity error → misleading diagnostic — FIXED: `lastError` chỉ throw khi `failedThisAcquire.size === _browsers.length`; ngược lại throw "all live obscura endpoints are at capacity".
  - `[medium]` `[patch]` edge-1 — `OBSCURA_BIN` spawn child thiếu `'error'` listener → ENOENT crash process trước cả acquire — FIXED: `child.on('error', () => {})` best-effort drain; test OBSCURA_BIN verify listener + kill SIGTERM on drain.
  - `[low]` `[patch]` blind-7 — `stats().endpoints` mất fleet identity sau drain (splice _browsers) → observable API regression — FIXED: obscura giữ entry slots post-drain (capacity/endpoints vẫn đọc được); test STATS_AFTER_DRAIN thêm.
  - `[low]` `[patch]` blind-10 — JSDoc stale "default 5 chrome / 3 obscura" cho contextsPerBrowser (obscura thực dùng pagesPerProcess) — FIXED trong browserPool.d.ts.
  - `[low]` `[patch]` vgap-g1 + g3 + o2 — thiếu tests: release-headroom re-acquire, `XACTIONS_BROWSER_PAGES_PER_PROCESS` env (hợp lệ/không hợp lệ/option-override), `OBSCURA_BIN` auto-spawn — FIXED: 4 test mới RELEASE_HEADROOM, CONNECT_FAIL_LIVE_FULL, OBSCURA_BIN, CONFIG_VALIDATION mở rộng; FALLBACK_PARSE cover normalize+whitespace+malformed+protocol.
  - `[medium]` `[defer]` blind-5 — createBrowserContext throw không failover — deferred: crash/context-recovery thuộc story 53.5 (spec NON-GOALS), spec chỉ định fail-skip cho connect.
  - `[false]` `[reject]` blind-3 — thiếu option `wsEndpoints` — spec/env-by-design; env list là surface canonical (shard-policy.md).
  - `[false]` `[reject]` blind-4 — wrapped error swallow `lastError` — `cause` giữ nguyên original error, structured fields preserved.
  - `[false]` `[reject]` blind-8 — `err.code` mất — `cause` + prototype-chain preservation giữ đủ.
  - `[false]` `[reject]` blind-9 — ENV_OFF path dùng cookie-mock — `XACTIONS_BROWSER_POOL_SIZE` unset → module không import vào default path; byte-identical by construction.
  - `[false]` `[reject]` vgap-g2 — claim stealthBrowser.js thay đổi — file mtime Oct 3, không có trong diff baseline; hallucination.
  - `[false]` `[reject]` vgap-g4 — code path không tồn tại — `_endpoints` luôn ≥1 entry (fallback chain).

## Auto Run Result

Status: done

**Tóm tắt:** Obscura backend chuyển từ single-endpoint sang pool-of-processes: `_endpoints` parse từ `OBSCURA_WS_ENDPOINTS` (normalize+dedupe+malformed-throw) → fallback `OBSCURA_WS_ENDPOINT`/option `wsEndpoint` → default `ws://127.0.0.1:9222` → optional `OBSCURA_BIN` auto-spawn `ceil(size/ppp)` children. Một entry-slot/endpoint, lazy connect qua spawn-lock, first-fit max-headroom, connect-fail skip→next→wrapped-error (endpoint ghi trong message), `_capacity = (isolated ? N : 1) × pagesPerProcess`, acquire trả `endpoint`, stats thêm `capacity`+`endpoints[]` (giữ identity post-drain). Chrome thêm `XACTIONS_BROWSER_CONTEXTS_PER_BROWSER` clamp [4,6]. `XACTIONS_BROWSER_POOL_SIZE` unset → module không load → byte-identical.

**Files changed:**
- `src/scraping/browserPool.js` — fleet endpoints + per-endpoint entry slots + OBSCURA_BIN spawn + capacity clamp + stats endpoints (+~290 dòng sau patch)
- `src/scraping/browserPool.d.ts` — types cho endpoints/stats/pagesPerProcess; JSDoc sửa
- `tests/scraping/browserPool.test.js` — 16 test mới I/O matrix (FLEET_*, PARSE_*, CAPACITY_CLAMP, CONNECT_FAIL_*, DRAIN_MID_CONNECT, ISOLATED_PER_JOB, SHARED_*, RELEASE_HEADROOM, FALLBACK_PARSE, OBSCURA_BIN, STATS_AFTER_DRAIN) + child_process mock
- `docs/obscura-backend.md` — env surface + fleet semantics

**Review findings:** 19 findings / 4 layers — 7 patch (4 medium, 3 low) đã fix+test, 1 medium defer (53.5), 6 reject (false — hallucination/out-of-scope/by-design). Contamination phát hiện trong review window (`src/mcp/local-tools.js` bị review worker sửa ngoài scope) đã revert về baseline.

**followup_review_recommended: true** — 4 medium patches áp dụng trong pass này (≥2 medium → true theo rule). Unverified risk cụ thể: `normalizeEndpoint` unify thay đổi giá trị `wsEndpoint` truyền vào `launchStealthBrowser` (thêm `/` suffix) — đã verify qua mock test nhưng chưa verify với `obscura serve` thật (manual spike chưa chạy); `lastError` gating `failedThisAcquire.size === _browsers.length` chưa có negative test khi một số endpoint fail VÀ một số còn headroom nhưng slot `size` đã hết.

**Verification:** `npx vitest run tests/scraping` → 74/74 pass (68 baseline + 6 mới); `node --check` sạch; lens/lsp diagnostics không error mới trên 2 file sửa; `npm run typecheck` = 1300 lỗi pre-existing (không tăng, không lỗi trong file thay đổi — đã verify bằng cách stash + đếm lại). Manual spike `browser-pool-spike.mjs` chưa chạy — cần 2 `obscura serve` thật, không gate.

**Residual risks:** failover chỉ ở connect-time (createBrowserContext throw không retry — deferred 53.5); OBSCURA_BIN children chỉ best-effort kill SIGTERM (không chờ exit, không escalate SIGKILL); SharedContextPool pin endpoint[0] nghĩa là fleet obscura vô ích cho shared mode (by design — shared = 1 job/browser).
