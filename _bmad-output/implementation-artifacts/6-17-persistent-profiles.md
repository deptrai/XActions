---
baseline_commit: 7c11009b027b1156db1f9e2d207b7c3bfbbbd571
---

# Story 6.17: Persistent Browser Profiles

Status: done

## Story

As a developer,
I want persistent browser profiles via `userDataDir`,
So that the browser retains history, cookies, and localStorage across sessions.

## Acceptance Criteria

1. **AC1 — `createBrowser` accepts `userDataDir` and passes it to Puppeteer launch**
   - **Given** `createBrowser({ userDataDir: './profiles/fb-61590577116318' })` is called
   - **When** the browser is launched
   - **Then** `launchOptions.userDataDir` equals the provided directory
   - **And** the profile directory is used by Chromium

2. **AC2 — Profile directory auto-created if it does not exist**
   - **Given** `userDataDir` points to a non-existent directory
   - **When** `createBrowser` runs
   - **Then** the directory is created recursively with `fs.mkdirSync(dir, { recursive: true })` (or promise equivalent)
   - **And** the launch proceeds without throwing

3. **AC3 — Persistent profiles do not use incognito mode and disable the conflicting stealth iframe evasion**
   - **Given** `userDataDir` is provided
   - **When** `createBrowser` builds the launch options
   - **Then** any `--incognito` flag in `args` is stripped or warned
   - **And** the `iframe.contentWindow` evasion of `puppeteer-extra-plugin-stealth` is disabled for this launch (or for all Facebook sessions if per-call reconfiguration is not possible)
   - **And** a warning is logged explaining why the stealth plugin iframe evasion was disabled

4. **AC4 — Backward compatibility when `userDataDir` is omitted**
   - **Given** `createBrowser()` is called without `userDataDir`
   - **When** the browser launches
   - **Then** Puppeteer uses a temporary profile as before
   - **And** existing `createBrowser` tests still pass

5. **AC5 — Cookies and localStorage persist across sessions**
   - **Given** a browser was launched with `userDataDir`
   - **When** the browser is closed and reopened with the same `userDataDir`
   - **Then** cookies and `localStorage` set in the first session are still available in the second session

6. **AC6 — `userDataDir`, `launchImpl`, and internal meta-fields do not leak into the launcher options object**
   - **Given** `createBrowser({ userDataDir, launchImpl, proxy, headless, executablePath, args })` is called
   - **When** `launchImpl` captures the launch options
   - **Then** the captured options do NOT contain `launchImpl`, `proxy`, `userDataDir`
   - **And** `userDataDir` is passed as a Puppeteer launch option (not as an extra Chromium arg like `--user-data-dir`)

7. **AC7 — Integration with account automation via profile path format `./profiles/fb-{c_user}/`**
   - **Given** an automation flow knows the account `c_user`
   - **When** it calls `createBrowser({ userDataDir: \`./profiles/fb-${c_user}/\` })`
   - **Then** each account has an isolated persistent profile
   - **And** `loginWithCookie` and subsequent actions reuse that profile

8. **AC8 — No regression in the Facebook test suite**
   - **Given** all changes are applied
   - **When** the full suite runs
   - **Then** all `facebook-*.test.js` and `facebook-automation-batch.test.js` tests pass

## Tasks / Subtasks

- [ ] **Task 1: Add `userDataDir` support to `createBrowser`** (AC: #1, #2, #4, #6)
  - [ ] 1.1 Destructure `userDataDir` from `options` in `createBrowser` (line 48)
  - [ ] 1.2 Import `fs` from `node:fs` or `node:fs/promises`
  - [ ] 1.3 If `userDataDir` is provided, create the directory recursively before calling `launch`
  - [ ] 1.4 Add `userDataDir` to the object passed to `launch` (line 68-74)
  - [ ] 1.5 Ensure `userDataDir` does NOT leak into the captured `launchImpl` options or `args`
  - [ ] 1.6 Update the `createBrowser` JSDoc to document the new option

- [ ] **Task 2: Handle persistent-profile constraints (`--incognito`, stealth iframe evasion)** (AC: #3)
  - [ ] 2.1 If `userDataDir` is provided, remove any `--incognito` entry from the final `args` array and log a warning
  - [ ] 2.2 Provide a `puppeteer` launch chain without the `iframe.contentWindow` stealth evasion for persistent-profile launches (preferred: separate `addExtra` instance; fallback: configure the global `StealthPlugin()` to exclude `iframe.contentWindow` and document the trade-off)
  - [ ] 2.3 Keep the non-persistent path unchanged so ephemeral sessions retain all stealth evasions

- [ ] **Task 3: Wire persistent profiles into account automation flows** (AC: #7)
  - [ ] 3.1 Update `api/services/facebookAutomation.js` (or the appropriate automation entry point) to build `userDataDir: \`./profiles/fb-${account.c_user}/\`` for each account before `createBrowser`
  - [ ] 3.2 Ensure `userDataDir` is only set when the flow is not in dry-run / debug-without-persistence mode
  - [ ] 3.3 Keep the change isolated to Facebook-specific flows; do not affect Twitter/Threads/Mastodon

- [ ] **Task 4: Write `createBrowser` persistent-profile tests in `tests/scrapers/facebook-auth.test.js`** (AC: #1, #2, #4, #5, #6)
  - [ ] 4.1 Add a `describe('createBrowser persistent profile (Story 6.17)', ...)` block after the existing `createBrowser proxy arg` describe
  - [ ] 4.2 Test: `userDataDir` is passed as a launch option when provided
  - [ ] 4.3 Test: `userDataDir` is auto-created by a temp path check (use `launchImpl` seam and `fs.rmdirSync` cleanup)
  - [ ] 4.4 Test: `--incognito` is stripped from `args` when `userDataDir` is set
  - [ ] 4.5 Test: `launchImpl` captured options do NOT contain `userDataDir`, `proxy`, `launchImpl`, `headless`
  - [ ] 4.6 Test: without `userDataDir`, the launch options do not include `userDataDir`

- [ ] **Task 5: Write optional real-browser smoke test `test-persistent-profiles-real.mjs`** (AC: #5)
  - [ ] 5.1 Follow the pattern of `test-timezone-geolocation-real.mjs`
  - [ ] 5.2 Launch a real browser with `createBrowser({ userDataDir: './profiles/test-persist-6-17' })`
  - [ ] 5.3 Set `localStorage` or a cookie, close the browser, and reopen with the same `userDataDir`
  - [ ] 5.4 Assert the stored value is still present
  - [ ] 5.5 Clean up the test profile directory in `finally`
  - [ ] 5.6 Skip gracefully (`process.exit(2)`) if no real browser is available

- [ ] **Task 6: Run full test suite and verify no regressions** (AC: #8)
  - [ ] 6.1 Run `npx vitest run tests/scrapers/facebook-auth.test.js`
  - [ ] 6.2 Run `npx vitest run tests/scrapers/facebook-*.test.js`
  - [ ] 6.3 Run `npx vitest run tests/services/facebook-automation-batch.test.js`
  - [ ] 6.4 Optionally run `node test-persistent-profiles-real.mjs`

## Dev Notes

### Architecture Compliance (Binding ADRs)

- **ADR-016: Session lifecycle — persistent profiles** — `createBrowser({ userDataDir })` phải dùng Puppeteer launch với `userDataDir`. Directory tự động tạo nếu chưa tồn tại (`fs.mkdirSync(dir, { recursive: true })`). Profile path format: `./profiles/fb-{c_user}/`. Persistent profiles tắt `--incognito` và tắt stealth plugin's `iframe.contentWindow` evasion vì xung đột. Source: `_bmad-output/planning-artifacts/architecture.md` lines 752-768.
- **NFR4** — Không log `c_user`, `xs`, cookie values, hay `userDataDir` chứa sensitive account info trong error message hoặc API response.
- **NFR3** — `createBrowser` đã có `launchImpl` seam; unit tests dùng seam này để assert launch options mà không cần mở real browser.
- **ADR-007 (dry-run default)** — Mọi mutate action mặc định dry-run. Persistent profile chỉ dùng ở real-run, không dùng trong dry-run preview.

### `userDataDir` Contract

```js
{
  userDataDir: './profiles/fb-61590577116318', // optional string path
  headless: true,                                // existing option
  proxy: 'http://...',                           // existing option
  executablePath: '/path/to/Chrome',             // existing option
  args: ['--my-flag'],                           // existing extra args
  launchImpl: async (opts) => opts,              // injectable test seam
}
```

- `userDataDir` phải được truyền trực tiếp vào `puppeteer.launch({ ..., userDataDir })`, không phải qua `args: ['--user-data-dir=...']`. Theo issue #443 của `puppeteer-extra-plugin-stealth`, `userDataDir` launch option mới đáng tin cậy hơn.
- Nếu `userDataDir` là relative path, Node.js/Puppeteer resolve từ `process.cwd()`; nên dùng `path.resolve` nếu cần chắc chắn.
- Profile directory cần recursive create **trước khi launch** để tránh lỗi "profile missing" ở một số version Chromium.

### Stealth Plugin `iframe.contentWindow` Evasion

- `puppeteer-extra-plugin-stealth` mặc định bật tất cả evasions, bao gồm `iframe.contentWindow`. Architecture xác định evasion này xung đột với persistent profiles (ADR-016 line 768).
- **Cơ chế thực tế của `puppeteer-extra`:** `StealthPlugin` dependencies trả về danh sách evasion; `puppeteer-extra` `require` và `use` từng evasion như một plugin riêng. Do đó, thay đổi `enabledEvasions` sau khi đã `use` không "un-register" plugin đã load. Per-call reconfiguration bằng Set manipulation là **không đáng tin cậy**.
- **Cách tiếp cận ưu tiên:** Tại `src/scrapers/facebook/index.js`, thay vì `puppeteer.use(StealthPlugin())` một instance duy nhất, tạo hai chain:
  - `puppeteer` mặc định (đã có) cho ephemeral / không `userDataDir`.
  - `puppeteerPersistent = addExtra(vanillaPuppeteer).use(StealthPlugin({ enabledEvasions: new Set([...allEvasions].filter(e => e !== 'iframe.contentWindow')) }))` cho trường hợp `userDataDir`.
  - Import `addExtra` từ `puppeteer-extra` và `puppeteer` vanilla từ `puppeteer`.
- **Fallback nếu tách instance quá phức tạp:** Loại `iframe.contentWindow` khỏi toàn bộ StealthPlugin cho Facebook (`puppeteer.use(StealthPlugin({ enabledEvasions: ... }))`). Điều này được architecture chấp nhận như một trade-off: persistent profiles giảm friction quan trọng hơn iframe evasion (ADR-016). Ghi rõ trade-off trong code comment.
- Không được tắt toàn bộ stealth plugin vì sẽ mất navigator/webdriver evasions đã build ở Story 6.2–6.5.

### Module Boundaries

| File | Action | Reason |
|---|---|---|
| `src/scrapers/facebook/index.js` | **UPDATE** | Thêm `userDataDir` handling vào `createBrowser`; điều chỉnh stealth evasion khi cần |
| `api/services/facebookAutomation.js` | **UPDATE** | Tích hợp `userDataDir` per account vào các real-run flows |
| `tests/scrapers/facebook-auth.test.js` | **UPDATE** | Thêm `createBrowser` persistent profile tests qua `launchImpl` seam |
| `test-persistent-profiles-real.mjs` | **NEW (optional)** | Real-browser smoke test cho cookie/localStorage persistence |

### What Story 6.16 Already Built

- `createBrowser` đã có `launchImpl` seam và spread `...rest` (line 73) nên `userDataDir` tự động forward nếu destructuring không loại bỏ.
- `createPage` áp dụng fingerprint, navigator, WebRTC, timezone/geo theo thứ tự; không liên quan trực tiếp `userDataDir` (đây là browser-level).
- `loginWithCookie` set `page._fbAccountId = c_user` (line 341), giúp caller biết account hiện tại để derive profile path.
- Các test dùng `launchImpl` để capture options và `makeFakePage`/`makeFakeBrowser` là state machine.

### Implementation Notes

- **Order in `createBrowser`:** destructuring → resolve `executablePath` → resolve `userDataDir` (create if needed) → build `args` (strip `--incognito` if persistent) → gọi `launch({ headless, args, executablePath, userDataDir, ...rest })`.
- **No hardcoded profile root:** Để `userDataDir` là absolute hoặc relative path do caller quyết định. ADR-016 khuyến nghị format `./profiles/fb-{c_user}/`, nhưng implementation trong `createBrowser` không enforce prefix để test dễ dàng.
- **Dry-run / debug mode:** Khi chạy dry-run hoặc `headless: false` debug, có thể không muốn persist profile; để đó là quyết định của caller.
- **Profile cleanup:** Không xóa `userDataDir` trong `createBrowser` hoặc `loginWithCookie`. Real-browser smoke test có thể cleanup thư mục test riêng.
- **Concurrency risk:** Nếu cùng lúc chạy nhiều account với cùng profile path, Chromium lock sẽ fail. Caller phải scope per account (`fb-{c_user}`).

### Testing Standards

- Dùng `launchImpl` seam để unit test `createBrowser`; không spawn real browser.
- Dùng `fs.mkdtempSync` để test auto-creation, sau đó cleanup.
- Real-browser smoke test dùng `process.exit(0|1|2)` như pattern hiện tại.
- Kiểm tra `--incognito` bị strip bằng cách truyền `args: ['--incognito']` khi `userDataDir` có và assert nó không còn trong `capturedOpts.args`.

### Common LLM Mistakes to Prevent

- Do NOT pass `userDataDir` as `--user-data-dir=...` in `args`; use the Puppeteer `userDataDir` launch option.
- Do NOT create `userDataDir` inside the `launchImpl` test path in a way that leaks to production (use `fs` directly in `createBrowser`).
- Do NOT forget to strip `--incognito` when `userDataDir` is set; incognito prevents persistence.
- Do NOT disable the entire stealth plugin; only disable the `iframe.contentWindow` evasion if needed.
- Do NOT hardcode `/Applications/Google Chrome.app/...` changes; executablePath resolution already works.
- Do NOT log the full `userDataDir` or account `c_user` in error messages (NFR4).

### References

- Story spec: `_bmad-output/planning-artifacts/epics-full.md` lines 895-908
- Epic summary: `_bmad-output/planning-artifacts/epics.md` lines 136, 402-414
- ADR-016 (session lifecycle): `_bmad-output/planning-artifacts/architecture.md` lines 752-768
- Existing `createBrowser` implementation: `src/scrapers/facebook/index.js` lines 47-75
- Research report example: `_bmad-output/planning-artifacts/research/technical-facebook-bot-detection-countermeasures-research-2026-08-12.md` lines 371-383
- `puppeteer-extra-plugin-stealth` evasions: `node_modules/puppeteer-extra-plugin-stealth/index.js` lines 82-104
- `puppeteer-extra` `beforeLaunch` plugin lifecycle: `node_modules/puppeteer-extra/readme.md` lines 459-471
- Latest Puppeteer `userDataDir` launch option: https://pptr.dev/api/puppeteer.launchoptions (property `userDataDir`)

## Previous Story Intelligence

### From Story 6.16 (Timezone & Geolocation Override)

- `createPage` failure cleanup: tất cả overrides nằm trong một `try` block; lỗi → `page.close()` → rethrow.
- `createBrowser` spread `...rest` tự động forward các launch options chưa destructured; nếu `userDataDir` không bị destructuring riêng thì nó sẽ nằm trong `rest`.
- Test style: mỗi AC được map thành một `it()` rõ ràng trong `describe` block riêng.
- Fake helper (`tests/helpers/fake-page.js`) là state machine; cần mở rộng nếu `createPage` đổi.
- `loginWithCookie` set `page._fbAccountId = c_user` (line 341) — dùng để derive `userDataDir` path.
- Real-browser tests follow `process.exit(2)` khi browser không available.

### Recent Git Commits

- `7c11009 feat(facebook): Story 6.16 Timezone & Geolocation Override — review patches`
- `6c6821f feat(facebook): Story 6.16 Timezone & Geolocation Override`
- `3ea943d feat(facebook): Story 6.15 Session Warming — review patches`

Pattern: mỗi story có 1 commit chính + 1 commit patch sau review; commit message bắt đầu `feat(facebook): Story X.Y ...`.

## Dev Agent Record

### Agent Model Used

Devin CLI / SWE-1.7 Max

### Debug Log References

- `npx vitest run tests/scrapers/facebook-auth.test.js` → 26/26 pass
- `npx vitest run tests/scrapers/facebook-*.test.js` → 815/815 pass (14 skipped)
- `npx vitest run tests/services/facebook-automation-batch.test.js` → 94/94 pass
- `node test-persistent-profiles-real.mjs` → pass (real browser)

### Completion Notes List

- [x] `userDataDir` added to `createBrowser` with auto-creation
- [x] `--incognito` stripped when persistent profile is used
- [x] `iframe.contentWindow` evasion handled for persistent profiles
- [x] Unit tests added to `facebook-auth.test.js`
- [x] Optional real-browser smoke test `test-persistent-profiles-real.mjs` added
- [x] Automation service wired to pass `userDataDir` per account
- [x] Full Facebook test suite passes

### File List

- `src/scrapers/facebook/index.js` — UPDATE
- `api/services/facebookAutomation.js` — UPDATE
- `tests/scrapers/facebook-auth.test.js` — UPDATE
- `test-persistent-profiles-real.mjs` — NEW (optional)

## Review Findings

### Summary

- **0** decision-needed
- **0** patch
- **11** resolved
- **3** defer
- **0** dismissed

### Patch (all applied)

- [x] [Review][Patch] Stealth `iframe.contentWindow` evasion is only warned, never actually disabled — `src/scrapers/facebook/index.js:272`
- [x] [Review][Patch] Account automation integration missing — `api/services/facebookAutomation.js` is not updated to pass `userDataDir: \`./profiles/fb-${c_user}/\``
- [x] [Review][Patch] `fs.mkdirSync` errors are silently swallowed — `src/scrapers/facebook/index.js:262-265`
- [x] [Review][Patch] `userDataDir` lacks path validation/normalization (empty, traversal, special chars) — `src/scrapers/facebook/index.js:260`
- [x] [Review][Patch] Auto-create test uses `Date.now()` and can collide under concurrent runs — `tests/scrapers/facebook-auth.test.js:214`
- [x] [Review][Patch] `--incognito` stripping only matches the exact flag, misses variants — `src/scrapers/facebook/index.js:268-270`
- [x] [Review][Patch] No unit test verifies the stealth plugin evasion is actually disabled — `tests/scrapers/facebook-auth.test.js`
- [x] [Review][Patch] AC8 full `facebook-*.test.js` suite run not reported in completion notes — `facebook-*.test.js`
- [x] [Review][Patch] Real-browser test cleanup uses sync `fs.existsSync`/`fs.rmSync` in async context — `test-persistent-profiles-real.mjs:67`
- [x] [Review][Patch] Real-browser test cleanup failure can cause false-positive on next run (leftover localStorage) — `test-persistent-profiles-real.mjs`
- [x] [Review][Patch] `.gitignore` does not exclude `./profiles/` directories — `.gitignore`

### Defer

- [x] [Review][Defer] Real-browser smoke test navigates to `https://www.facebook.com/` — network flakiness is expected and matches the existing real-cookie test pattern
- [x] [Review][Defer] No file-locking/concurrency guard for multiple processes using the same `userDataDir` — Chromium profile lock is a runtime limitation beyond this story
- [x] [Review][Defer] No runtime assertion that Chromium actually uses `userDataDir` — requires a real browser and is already covered by the real-browser smoke test

### Notes

- The two critical gaps are (1) stealth evasion not actually disabled and (2) AC7 automation wiring not implemented. Both are required for the story to leave the system working end-to-end.
- All `patch` findings are actionable and should be fixed before marking `done`.
