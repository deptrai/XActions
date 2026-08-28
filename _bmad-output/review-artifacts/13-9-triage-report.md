# Story 13.9 — Facebook Hybrid Social Actions (Write & Messenger)
## Code Review Triage Report

**Story key:** `13-9-facebook-hybrid-social-actions-write-messenger`

**Inputs:**
- Diff: `_bmad-output/review-13.9.diff`
- Spec: `_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md`
- Review subagents: Acceptance Auditor, Blind Hunter, Edge Case Hunter

**Verification run (read-only):**
- `npx tsc --noEmit` — passed
- `npx vitest run tests/scrapers/social/facebook/crawler-actions.test.js` — 13/13 passed
- `npx prisma validate` — passed

**Overall Verdict:** `REJECT / NEEDS MAJOR REVISION`

The code compiles and the dry-run ATDD tests pass, but the live write paths and several pieces of supporting architecture are not implemented to the level required by AC-1..AC-19. Most actions are effectively no-ops that navigate to a page and return a fabricated success payload.

---

## 1. Executive summary

| Area | Status | Notes |
|---|---|---|
| Action registration & dry-run gate | Mostly OK | All 8 write actions are registered with `requiresAuth: true` and default `dryRun: true`. |
| Live DOM execution | **Failed** | `like`, `comment`, `post`, `share`, `messenger_share`, `join_group`, `send_friend_request` do not perform the required DOM interactions or result verification. |
| GraphQL write mutation plumbing | **Failed** | Anti-bot fields, `friendlyNames`, multi-`doc_id` fallback, `fallbackDocIds` and `requiresResidential` are missing. |
| Browser bridge integration | **Failed** | `withPage` creates and closes a new page for every item; no `evaluateDom` seam; residential proxy is not requested for write sessions. |
| Input validation / SSRF | **Failed** | `assertFacebookUrlLocal` in `actions.js` is weaker than the existing `src/scrapers/facebook/core.js` guard and there are now two competing implementations. |
| Rate/velocity/delay governance | **Failed** | Delay floors are not enforced, `maxBatch` is ignored by several actions, velocity tracker contract does not match the spec, failed items are still counted as successes. |
| Error envelope / codes | **Failed** | Wrong `suggestedAction` for `XACT_4010` and `XACT_5030`; velocity breach uses `XACT_4290` instead of `XACT_4291`. |
| Test coverage | **Failed** | Test file name does not match the spec (`crawler-actions.test.js` vs `crawler-social-actions.test.js`) and the 13 passing tests only exercise dry-run and registration. |

---

## 2. Critical findings (must fix before merge)

### 2.1 Live write action handlers are no-ops

The live (`dryRun: false`) paths for every write action stop at `page.goto(...)` and return a fabricated success object.

| Action | Evidence | Required behavior not implemented |
|---|---|---|
| `like` | `src/scrapers/social/facebook/actions.js:189-209` | Clicks the first Like/Unlike button but does not wait for or verify the state change, does not apply the 1–3s human-like click delay, does not call `resolvePostFeedbackContext`, and does not implement the optional GraphQL like mutation. |
| `comment` | `src/scrapers/social/facebook/actions.js:309-318` | Uses `input.textContent = msg` and a generic `input` event, does not type human-like, does not press Enter/click send, does not parse a real `commentId` from the response, and fabricates `comment_${Date.now()}`. |
| `post` | `src/scrapers/social/facebook/actions.js:424-427` | Only navigates to the target URL, then returns a fabricated `post_${Date.now()}`. Does not open the composer, enter text, handle attachments, or submit. |
| `share` | `src/scrapers/social/facebook/actions.js:503-506` | Navigates to the post and returns `shared: true`. Does not open the share dialog, select a destination, or click share. `message` is accepted but ignored. |
| `messenger_share` | `src/scrapers/social/facebook/actions.js:581-584` | Only navigates to `https://www.facebook.com/messages/t/{recipientUid}` and returns `ok: true`. Does not paste the link, type the message, click send, or fall back to the share dialog or GraphQL CTA mutation. |
| `join_group` | `src/scrapers/social/facebook/actions.js:690-693` | Only navigates to the group URL and returns `joined: true`. Does not call `resolveGroupId`, locate the Join button, click it, or verify pending/member status. |
| `send_friend_request` | `src/scrapers/social/facebook/actions.js:772-775` | Only navigates to the profile and returns `ok: true`. Does not click the Add Friend button or verify the request. |

This violates **AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9**.

### 2.2 GraphQL write-mutation plumbing is not built

- `FacebookClient.buildGraphQlBody` (`src/scrapers/social/facebook/client.js:431-475`) does not include anti-bot fields `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd` or `fb_api_req_friendly_name`.
- `extractFacebookTokensScript` (`src/scrapers/social/facebook/signer-bridge.js:47-121`) does not parse any of the above tokens.
- `friendlyNames` is initialized to `{}` (`src/scrapers/social/facebook/client.js:91`); no write-mutation friendly names are registered.
- `DEFAULT_FB_DOC_IDS` (`src/scrapers/social/facebook/crawler.js:224-230`) contains placeholder `fb_xxx_mutation_doc` strings that will fail in production.
- `requestGraphQl` (`src/scrapers/social/facebook/client.js:485-568`) has no `fallbackDocIds` rotation and throws `XACT_5000` on the first GraphQL error.
- No write action calls `client.requestGraphQl` or passes `requiresResidential: true` to it.

This violates **AC-7 (tertiary path), AC-18, Dev Note anti-bot fields, and Technical Requirements**.

### 2.3 Residential proxy is not requested for write sessions

- `FacebookBrowserBridge.withPage` (`src/scrapers/social/facebook/signer-bridge.js:945-972`) accepts only `{ accountId, cookies }` and does not pass or request a residential proxy.
- `#resolveProxy` (`src/scrapers/social/facebook/signer-bridge.js:464-497`) calls `proxyProvider.getProxy({ accountId })` and `proxyPool.getStickyProxy(accountId)` but never sets `requiresResidential`.
- `FacebookClient.ensureBrowserBridge` (`src/scrapers/social/facebook/client.js:623-642`) creates the bridge without `requiresResidential` semantics.
- None of the live write paths invoke `client.request(..., { requiresResidential: true })`.

This violates **AC-10, AC-17, AC-18 and the Dev Note “Residential Proxy Mandatory”**.

### 2.4 Browser bridge `withPage` does not reuse a page across a batch

`withPage` launches a new page for every invocation (`adapter.newPage(browser, { preserveProfile: false })` at `src/scrapers/social/facebook/signer-bridge.js:955`) and immediately closes it in the `finally` block. Because each action handler calls `withPage` once per item, a 30-post like batch will create 30 new pages. This contradicts **OP-1** and the **AC-17** requirement to reuse one page throughout the batch.

There is also no public `evaluateDom(fn, options)` seam.

### 2.5 `assertFacebookUrlLocal` is weaker than the existing guard and duplicated

`src/scrapers/social/facebook/actions.js:21-35`:
- Accepts relative paths starting with a single `/`.
- Allows `messenger.com`, `fb.watch`, `fb.com` for post/comment/share URLs.
- Uses `host.endsWith('.' + domain)` which is spoofable by e.g. `notfacebook.com` unless `host === domain` also matches; the list is also not limited to `facebook.com`.
- Group checks only look for the literal substring `/groups/` in the full URL, so `?x=/groups/` fools it.
- Does not reject `..` path traversal or validate the pathname pattern.

Meanwhile `src/scrapers/facebook/core.js:348-367` already contains a stricter, throwing `assertFacebookUrlLocal` that only allows exact `facebook.com` hosts. `src/scrapers/social/facebook/crawler.js:31` imports the stricter one, while `actions.js` defines and exports its own weaker version, creating drift.

This violates **AC-3, AC-4, AC-5, AC-6 and the Scope Note input validation**.

### 2.6 Delay floors and `maxBatch` are not properly enforced

- `runGuardedActionBatch` uses caller-supplied `delayMin`/`delayMax` directly; `enforceActionDelay` (`src/scrapers/social/facebook/batch-runner.js:114-121`) only clamps to `0` and `min*2`, so a caller can pass `0`/`0` and bypass the 1–3s / 30–90s floors.
- `comment` always uses `actionName: 'comment'`; it never selects the `group_comment` floor (5–15s) for group targets.
- `post` sets `actionName: 'group_post'` if *any* target contains `/groups/`, forcing 30–90s delays on profile posts in mixed batches.
- `post` clamps `maxBatch` to 20 unconditionally; the Scope Note `force` flag for higher group-post batches is missing.
- `share`, `messenger_share` and `join_group` pass the full user-provided array to `runGuardedActionBatch` and do not slice it.
- `runGuardedActionBatch` itself has no `maxBatch` option; callers must pre-slice.

This violates **AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, NFR-5 and NFR-10**.

### 2.7 `FacebookActionVelocityTracker` contract mismatch and counting logic

- The spec (`AC-2`, `AC-14`) requires `canDoAction(accountId, action)`, `recordAction(accountId, action)` and `getActionLimit(action)`. The implementation exposes `canExecute`/`record` and has no `getActionLimit`.
- The tracker stores every timestamp in an unbounded in-memory `Map`; there is no persistence or concurrency safety across parallel batches.
- `runGuardedActionBatch` throws `XACT_4290` when the velocity limit is exceeded; per the error convention it should throw `XACT_4291` for per-action hibernation/velocity breaches (reserving `XACT_4290` for upstream Facebook rate-limits / GraphQL code 368).
- The runner does not `await` `governor.canAccountRequest` / `governor.recordRequest`, so an async governor implementation will be treated as truthy and recording may become an unhandled rejection.
- Failed items (`ok: false`) still call `governor.recordRequest` and `velocityTracker.record` in non-dry-run mode (`src/scrapers/social/facebook/batch-runner.js:210-218`).

This violates **AC-2, AC-10, AC-11, AC-14, AC-15**.

### 2.8 Error code / `suggestedAction` misalignments

- Missing auth session throws `XACT_4010` with `suggestedAction: SuggestedActions.ROTATE_ACCOUNT` (`src/scrapers/social/facebook/actions.js:129`); spec requires `relogin`.
- No bridge / proxy unavailable throws `XACT_5030` with `suggestedAction: SuggestedActions.ROTATE_ACCOUNT` in every action handler; spec requires `suggestedAction: 'wait'`.
- Velocity breach throws `XACT_4290` instead of `XACT_4291` (`src/scrapers/social/facebook/batch-runner.js:183`).

This violates **AC-10, AC-11**.

### 2.9 `resolvePostFeedbackContext` is public but not reused

`FacebookCrawler.resolvePostFeedbackContext` is public (`src/scrapers/social/facebook/crawler.js:2981-2983`) but `FacebookActions.like`, `comment` and `share` never call it. This violates **AC-19**.

### 2.10 Test coverage is shallow and the test file name does not match the spec

- The spec (`AC-13`) names the test `tests/scrapers/social/facebook/crawler-social-actions.test.js`; the created file is `tests/scrapers/social/facebook/crawler-actions.test.js`.
- The 13 passing tests do not exercise live DOM, GraphQL fallback, `fallbackDocIds`, `requiresResidential`, anti-bot body fields, `resolvePostFeedbackContext` reuse, `maxBatch` clamping, or PII stripping.

This violates **AC-13**.

---

## 3. High-priority findings

### 3.1 `messenger_share` ignores validated inputs

- `message` and `recipientNames` are accepted but never used.
- `stripEmojiSurrogates` and `pickRandomSegment` are defined in `actions.js:54-69` but never called.
- `postUrl` is validated but not pasted into the Messenger composer.

### 3.2 `post` `mediaUrls` handling

`mediaUrls` is accepted and validated in the JSDoc but the live path does not read, validate, or document that media upload is reserved. The code does not throw a reserved/unsupported error either.

### 3.3 `join_group` ignores keyword / limit / maxBatch

`keyword`, `limit` and `maxBatch` are declared as optional args but never used. `requiredArgs` is empty in the registry (`src/scrapers/social/facebook/crawler.js:516`) even though the action requires `groupUrls` or `groupIds`.

### 3.4 `send_friend_request` ignores `mode` and `location`

`mode` and `location` are declared as optional args but never used.

### 3.5 `stripEmojiSurrogates` over-strips

The surrogate-pair regex removes every Unicode supplementary-plane character (CJK Extension B, mathematical symbols, etc.), not just emojis.

### 3.6 `client.ensureBrowserBridge` drops `profileDir`

`ensureBrowserBridge` passes `userDataDir: this.userDataDir || undefined, profileDir: this.profileDir || undefined`, but the private `#createBrowserBridge` in the constructor uses `this.userDataDir || this.profileDir || undefined`. If only `profileDir` is set, `ensureBrowserBridge` will not use it.

### 3.7 `api/services/facebookAutomation.js` is not marked deprecated in the file

The deprecation plan lists `api/services/facebookAutomation.js` as `deprecated-marked`, but the file itself has no `@deprecated` or `LEGACY` marker. This is not an architecture risk because `actions.js`/`batch-runner.js` do not import it, but it is inconsistent with AC-12.

---

## 4. Disputed / clarified findings

### 4.1 License header

One review subagent noted that `actions.js`, `batch-runner.js` and the new test file use an Apache 2.0 header while the rest of the repo is BSL 1.1. **Clarified:** the root `LICENSE` and the majority of `src/` files (including `client.js` and `crawler.js`) also use the Apache 2.0 header. The BSL 1.1 header appears only in some legacy files such as `api/services/facebookAutomation.js`. No license inconsistency needs to be fixed for the new files.

---

## 5. Next steps

1. **Move Story 13.9 back to `in-progress`** in `sprint-status.yaml` and update the implementation artifact status from `done` to `needs-rework`; do **not** start Story 13.10 until 13.9 is accepted.
2. **Implement the live DOM paths** for all seven write actions, using `FacebookBrowserBridge.withPage` and `evaluateDom`, with locale-aware selectors, human-like typing/clicking, and post-action verification.
3. **Implement the GraphQL write-mutation tier:** extend token extraction and `buildGraphQlBody` with anti-bot fields, register `friendlyNames`, add `fallbackDocIds` rotation to `requestGraphQl`, and call it from the live action handlers with `requiresResidential: true`.
4. **Enforce residential proxy** for every write bridge / request call.
5. **Fix `withPage` page reuse** so one page is used for the whole batch (or add a page-pool/cursor mechanism) and expose `evaluateDom`.
6. **Replace `actions.js#assertFacebookUrlLocal`** with the stricter `assertFacebookUrlLocal` from `src/scrapers/facebook/core.js` (or a shared utility), and validate `pathname` for post/group/profile paths.
7. **Fix `runGuardedActionBatch` delay clamping, velocity tracker contract (`canDoAction`/`recordAction`/`getActionLimit`), error codes, and failed-item counting.**
8. **Add `maxBatch` enforcement** to `runGuardedActionBatch` and to `share`, `messenger_share`, `join_group`.
9. **Expand the test suite** to exercise live DOM/GraphQL fallback, `fallbackDocIds`, `requiresResidential`, anti-bot fields, `resolvePostFeedbackContext` reuse, `maxBatch` clamping, PII stripping, and the correct `XACT_4290`/`XACT_4291` semantics. Rename to `crawler-social-actions.test.js` or update the spec to match the actual filename.
10. **Re-run the full review subagent workflow** after the above changes are complete.

---

## 6. Sign-off

| Reviewer | Verdict |
|---|---|
| Acceptance Auditor | `REJECT / NEEDS MAJOR REVISION` |
| Blind Hunter | `REJECT` (live paths are no-ops, multiple safety gates bypassable) |
| Edge Case Hunter | High density of unhandled edge cases in live execution and batch governance |
| Parent triage | **Reject as-is; return to development for major rework.** |
