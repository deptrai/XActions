# Deferred Work

## Deferred from: code review of story-1.1 (2026-06-08)

- **Dispatcher `loginWithCookie` auth wiring — string vs object** [src/scrapers/index.js:213-215] — dispatcher passes string `options.authToken`; Facebook expects `{ c_user, xs }` object. Deferred to Story 1.2: add `options.authCookie` (object) support in the puppeteer branch without breaking Twitter's string `authToken` path. Until then, Facebook login works via direct module call only.
- **`--disable-web-security` disables SOP** [src/scrapers/facebook/index.js:41] — pre-existing pattern across all adapters (threads/twitter). Address cross-cutting: evaluate whether the flag is needed at all, remove from all adapters if not.
- **Login success never verified** [src/scrapers/facebook/index.js:91] — invalid/expired cookie produces a silent unauthenticated session; downstream scrape fails with cryptic selector errors. Add a post-login check (URL not redirected to /login, or logged-in indicator present). Beyond AC2 scope; siblings behave the same.
- **`page.goto` timeout → browser leak** [src/scrapers/facebook/index.js:91] — `networkidle2`/30s `goto` has no try/catch; on TimeoutError the exception propagates before the dispatcher stores the browser ref, leaking the Chromium process. Tie fix to dispatcher cleanup refactor.
- **`page.__xactions_browser` set after `loginWithCookie`** [src/scrapers/index.js:219] — pre-existing dispatcher bug affecting ALL puppeteer platforms: browser ref stored at line 219 after login at line 215, so a login throw skips cleanup. Move the ref assignment immediately after `createPage`.
- **`xs` cookie no `sameSite`** [src/scrapers/facebook/index.js:82-88] — minor hardening; set `sameSite: 'Strict'` for the session-critical cookie. Siblings same.
- **`needsPuppeteer` test is indirect** [tests/scrapers/facebook.test.js:75] — registry-membership proxy rather than asserting the dispatcher routes facebook into the Puppeteer branch. The array is a local const, not exported. Consider a dispatcher-level test that asserts `createBrowser` is invoked without launching a real browser.

## Deferred from: code review of story-1.2 (2026-06-08)

- **`page.goto` no try/catch → browser leak on timeout** [src/scrapers/facebook/index.js:165 (scrapeProfile), :141 (loginWithCookie)] — timeout/network error throws before dispatcher stores/closes browser. Same root cause as the 1.1 deferred cleanup-ordering item; fix together (wrap dispatcher puppeteer branch in try/finally, or store browser ref before login). Affects threads sibling too.
- **Follower regex unanchored → false positive** [src/scrapers/facebook/index.js:87] — bio text like "...helped 1,000 followers..." matches. Same unanchored pattern as threads template. Revisit when verifying on live Facebook data (tie to selectors-facebook.md verify checklist).
- **Bio strip regex requires trailing period** [src/scrapers/facebook/index.js:97] — descriptions without a period after the follower phrase keep the follower prefix in `bio`. Cosmetic best-effort field; revisit with live data samples.
- **AC5.13 dispatcher routing test partly proxy** [tests/scrapers/facebook.test.js] — `needsPuppeteer` membership not directly asserted (local const). Integration test at :310 covers real routing end-to-end, so coverage is adequate but not exhaustive.

## Deferred from: code review of story-1.3 (2026-06-08)

> All four are DOM-accuracy issues that cannot be fixed without a live authenticated Facebook session. Tie resolution to the selectors-facebook.md verify checklist (Open Question Q3).

- **`texts[0]` may capture author name not post body** [src/scrapers/facebook/index.js:275-279] — `[dir="auto"]` matches both author header and body; FB DOM order likely puts author first. Confirm real order on a live session; switch to a body-specific anchor. Compounds the id-collision fallback.
- **`id = text.slice(0,60)` fallback collisions** [src/scrapers/facebook/index.js:305] — distinct posts with same opening text collide in the Map and are dropped. Depends on real `text` + permalink extraction; revisit during live verify.
- **Engagement regex over full `article.textContent`** [src/scrapers/facebook/index.js:294-295] — grabs first/nested/label count, not the post's own. Needs verified per-element selectors (aria-label on reaction/comment controls).
- **Image filter leaks avatars** [src/scrapers/facebook/index.js:300-302] — `!static && !emoji` misses `scontent` profile pics. Needs live CDN URL patterns: positive-filter `scontent` + exclude profile-photo path segments.

## Deferred from: code review of story-1.4 (2026-06-08)

> DOM-accuracy items needing a live authenticated session. Tie to selectors-facebook.md Followers verify checklist (Q3).

- **Follower name selector grabs first span/strong** [src/scrapers/facebook/index.js:321] — `item.querySelector('span, strong')` may return a UI label ("Follow", icon wrapper) not the person's name. Needs live DOM to pick a name-specific anchor.
- **`id = url || name` collision on name-only rows** [src/scrapers/facebook/index.js:330] — two followers with same name and no parseable url collide in the Map. Low once username/url parsing is fixed (BLOCKER patch); revisit during live verify.

## Deferred from: code review of story-2.1 (2026-06-09)

> Guardrail polish items — low risk, defer to a cleanup pass (not blocking Epic 2 progress).

- **`shouldStop` receives mutable full `results` array** [api/services/facebookAutomation.js:137] — caller predicate sees the raw growing accumulator and could mutate it. Pass a summary `{ attempted, succeeded, failed, lastResult }` instead (consistent with onProgress).
- **`attempted` counts null-skipped items** [api/services/facebookAutomation.js:153] — semantics are "processed" not "writes attempted"; `onProgress.attempted` similarly inflated on null-item batches. Document in JSDoc or rename to `processed`.
- **`maxRetry: -1` was silently clamped (now thrown after patch)** — NOTE: the 2.1 review patch made maxRetry validation strict (throws on negative/Infinity/NaN), so the original "silent clamp" concern is resolved. Kept here only as a record; no action needed.

## Deferred from: code review of story-2.2 (2026-06-09)

> 2 fixed inline (likeFn null guard, findLikeButton combined-wait). Below deferred:

- **Selector ambiguity — `[aria-label="Like"]` matches comment Like buttons** [api/services/facebookAutomation.js:200] — first DOM match may be a comment's Like, not the post's. Scope into the post `[role="article"]` container; needs live DOM to verify. Tie to selectors-facebook.md Automate verify checklist.
- **Hardcoded `sleep(500/300)` in likeSinglePost** [api/services/facebookAutomation.js:254,268] — not the injectable delay seam; can't be sped up in direct unit tests. Refactor to accept a delay param in a cleanup pass. Minor (single-post scope).
- **Duplicate URLs collide in capturedResults Map** [api/services/facebookAutomation.js:296] — two identical URLs → second result overwrites first in the alreadyLiked merge (reporting only, counts unaffected). Key by index if needed.
- **AC4.12 locale JSDoc** [api/services/facebookAutomation.js:286] — add explicit "caller is responsible for ensuring a supported Facebook locale" to likeFacebookPosts JSDoc.

## Deferred from: batch code review of stories 2.3 / 2.4 / 3.1 (2026-06-09)

> 6 patches fixed inline (null-guards on commentFn/createPostFn, content/commentText validation, createPost postUrl capture Map, CLI hard auth guard, CLI fail-fast validation). Below deferred:

- **`findCommentInput` 4×5s sequential timeout** [api/services/facebookAutomation.js:findCommentInput] — up to 20s wait on unsupported locale. Collapse to a single combined `waitForSelector` like the findLikeButton patch. Low priority.
- **createPost `postUrl` detection unreliable** [api/services/facebookAutomation.js:createSinglePost] — Facebook composer submits via XHR without navigating; `page.url()` stays on home feed so postUrl is usually undefined even on success. Needs live DOM verify (watch for permalink/toast). Tie to selectors-facebook.md Automate verify checklist.

## Deferred from: code review of story-3.2 (2026-06-09)

> 4 patches fixed inline (action allowlist fail-fast, numeric c_user coercion, dry-run skips browser/login, browser.close catch). Below deferred:

- **MCP automate `maxBatch` validated downstream** [src/mcp/server.js:executeFacebookAutomateTool] — runGuardedBatch throws on bad maxBatch, but only in the real-run path after browser launch. Fold a numeric check into the fail-fast block. Low.
- **MCP automate `urls` entries not validated** [src/mcp/server.js:executeFacebookAutomateTool] — array non-empty checked, but individual entries aren't validated as FB post URLs. Add a format check; tie to live verify. Low.
- **`tests/mcp/server.test.js` fails under Vitest** [tests/mcp/server.test.js] — PRE-EXISTING (uses node:test imports, not Vitest). Not a Facebook regression; flagged for separate cleanup (convert to Vitest or exclude).

## Deferred from: batch code review of stories 3.3 / 3.4 (2026-06-09)

> 6 patches fixed inline (scrape target key, dry-run skips browser/login, numeric c_user coercion, orphaned-Operation guard, per-user io room, browser.close catch). Below deferred:

- **Raw `error.message` in HTTP 500 responses** [api/routes/facebook.js] — leaks Prisma/Puppeteer internals to client. Sanitize to a generic message + server-side log. authMiddleware-gated so low exposure.
- **`new PrismaClient()` per route module** [api/routes/facebook.js:7] — connection-pool fragmentation under load. Move to a shared singleton imported across routes.
- **No size bound on `urls`/`text` persisted to Operation.config** [api/routes/facebook.js] — large input bloats the row. Add length caps before JSON.stringify.
- **VERIFY Socket.IO room join** — the per-user emit `io.to('user:<id>')` (3.4 fix) requires the connection handler to join `user:${userId}` on connect. If it doesn't, dashboard live updates silently stop. Confirm the realtime layer joins that room.

---

## RESOLVED — deferred-cleanup pass (2026-06-10)

Code-only deferred items fixed in branch `worktree-facebook-deferred`:

- ✅ **Browser leak on login throw** [src/scrapers/index.js] — browser ref stored BEFORE login; login wrapped in try/catch that closes browser on throw.
- ✅ **Browser leak on fn/goto throw** [src/scrapers/index.js] — fn-call + auto-close wrapped in try/finally; `.close().catch()`.
- ✅ **`xs`/`c_user` no sameSite** [src/scrapers/facebook/index.js] — added `sameSite: 'Strict'` to both cookies.
- ✅ **Socket.IO per-user room not joined** [api/realtime/socketHandler.js] — connection handler now `socket.join('user:'+id)`. CRITICAL: this is what makes the 3.4 per-user `io.to(...)` emit actually reach the dashboard (would have been a silent regression otherwise).
- ✅ **Raw error.message in HTTP 500** [api/routes/facebook.js] — both scrape + automate catch now log full error server-side, return generic message.
- ✅ **No size bound on Operation.config** [api/routes/facebook.js] — urls capped at 100, text at 5000 chars before persist.
- ✅ **MCP maxBatch validated downstream** [src/mcp/server.js] — fail-fast numeric check before browser launch.
- ✅ **MCP urls entries not validated** [src/mcp/server.js] — each url must be a facebook.com string; checked before launch.
- ✅ **findCommentInput 4×5s sequential timeout** [api/services/facebookAutomation.js] — combined single waitForSelector (5s total).
- ✅ **shouldStop received mutable results array** [api/services/facebookAutomation.js] — now passes immutable summary { attempted, succeeded, failed, lastResult }. Test updated.

### NOT fixed — deliberately left

- **`new PrismaClient()` per route module** — project-wide convention (auth/bookmarks/creator/discovery all do this). A facebook-only change would be inconsistent; needs a cross-cutting refactor to a shared singleton. Out of scope for this pass.
- **`tests/mcp/server.test.js` fails under Vitest** — pre-existing (node:test imports), not Facebook. Separate cleanup.

### BLOCKED on live Facebook session (Open Question Q3 — cannot fix without a real authenticated account)

These are DOM-accuracy items; fixing blind risks making selectors worse. They require dDOM inspection on a real logged-in Facebook session and belong to the selectors-facebook.md verify checklist:

- 1.3: `texts[0]` author-vs-body, `id=text.slice(0,60)` collisions, engagement regex over full textContent, image filter avatar leak.
- 1.4: follower name selector (first span/strong), `id=url||name` collision.
- 2.2: Like selector ambiguity (post vs comment Like button).
- 2.4: postUrl detection after XHR submit.
- 2.2/2.3: locale coverage beyond en/vi.

**Action for these:** keep in checklist; verify + fix when a test Facebook account is available.

## Deferred from: code review of story-4.1 (2026-06-15)

- **Deleted FacebookAccount orphans its pending schedules** [prisma/schema.prisma#Schedule; api/routes/facebookAccounts.js] — `Schedule.facebookAccountId` has no FK/cascade. Deleting the source account makes the worker's `resolveAccountCookie` throw `ACCOUNT_NOT_FOUND`, so the schedule fails at execution time (status:failed + reason) with no upfront warning and no fallback to the user's default account. Failure is graceful, so deferred. Enhancement: add FK `onDelete:SetNull` + fall back to most-recent account, or block account deletion when pending schedules reference it (mirror the existing activeRun guard).

## Deferred from: code review of story-4.2 (2026-06-15)

- **Live-DOM verification of the share-to-Feed flow** [api/services/facebookAutomation.js#shareSinglePost; docs/agents/selectors-facebook.md] — the auto-share-to-timeline entry point + "Share now"/success/error/already-shared selectors are all UNVERIFIED and likely wrong: `messengerShare.js` (live-verified 2026-06) shows the `share_button` opens the Messenger recipient dialog, not a Feed-share menu. Correct entry point (post `…` overflow menu, or share-dialog "Share to Feed" tab) must be found on a live session. Tracked in selectors-facebook.md verify-checklist. Couples with the silent-success + alreadyShared-detection patches (both need the real success/already-shared indicators). Matches how messengerShare.js itself was scaffolded then verified later.
- **`likeFacebookPosts` duplicate-URL Map collision + missing input validation** [api/services/facebookAutomation.js#likeFacebookPosts] — same `capturedResults` Map-keyed-by-URL collision that story 4.2 review found in `shareFacebookPosts`, plus `likeFacebookPosts` lacks the up-front `postUrls` array/string validation that 4.2 added. Pre-existing, not caused by 4.2. Fix the like/comment/share family together (dedup or index-key the Map; add shared input-validation helper).

## Deferred from: code review of story-4.3 (2026-06-16)

- **`assertFacebookUrl` allows http: (not https-only)** [api/services/facebookAutomation.js#assertFacebookUrl] — the shared URL guard accepts both `http:` and `https:`. A `http://facebook.com` navigation downgrades the first request (MITM-interceptable on a hostile proxy/VPN). This is PRE-EXISTING behavior from Story 4.2's original inline guard; Story 4.3 only extracted it into a shared helper unchanged. Tightening to https-only is a cross-cutting change affecting both shareFacebookPosts (4.2) and warmupScrollFeed (4.3) — decide as a family change. Low risk (facebook.com force-redirects to https), but defence-in-depth wants https-only.

## Deferred from: code review of story-4.4 (2026-06-16)

- **Post-click pending detection uses sleep(800) not waitForSelector** [api/services/facebookAutomation.js#joinSingleGroup] — after clicking Join, the code waits a fixed 800ms then does a point-in-time `page.$()` for the pending/requested indicator. On a slow or CPU-throttled render, a group requiring admin-approval can be mis-reported as `status:'joined'` instead of `'pending'` (Facebook renders "Requested" via async React update). Fix is a second short `waitForSelector` for the pending/joined indicators after the click. DEFERRED because the join-button + pending selectors are themselves UNVERIFIED (need a live Facebook session); fixing the wait timing against unverified selectors is premature — couple with the live-DOM verify pass (same posture as 4.2 share-to-Feed, 4.4 join selectors already on the selectors-facebook.md verify-checklist).

## Deferred from: code review of story-4.8 (2026-06-19)

- **`parseRequestAgeDays` không bắt date-string không có chữ số** [api/services/facebookAutomation.js#parseRequestAgeDays] — các chuỗi như "a day ago" / "an hour ago" / "vừa gửi" (không có digit) → `t.match(/(\d+)/)` trả null → hàm trả `null` → request được INCLUDE vào danh sách hủy. Đây đúng posture err-toward-cleanup (AC2.7: unparseable → included) nên benign về mặt an toàn, nhưng granularity bị mất: một request "an hour ago" lẽ ra là age 0 lại bị coi là unparseable. DEFERRED vì cần mẫu text thật từ live-verify (`/friends/requests/sent` UNVERIFIED) để biết Facebook render đúng format nào trước khi mở rộng regex — couple với live-DOM verify pass cùng các selector UNVERIFIED khác của Story 4.8.

## Deferred from: code review of story-4.9 (2026-06-19)

- **Reaction-timing signature** [api/services/facebookAutomation.js#warmupAccount] — the probabilistic like fires immediately after the inter-scroll pause of the same iteration (scroll → pause → react), so every reaction sits exactly one pause-interval after a scroll. A human reads a post for a few seconds before liking. Add a second micro-delay (e.g. 500–1500ms) between the pause and the `reactFn` call to mimic "read-before-like". DEFERRED: anti-detection refinement, not a correctness bug; bundle with the live-verify / anti-detection pass alongside the other UNVERIFIED Facebook selectors.
- **Return value does not distinguish duration-complete vs backstop-hit** [api/services/facebookAutomation.js#warmupAccount] — when the loop exits via the `maxScrolls` backstop rather than wall-clock expiry, the result `{ scrolls }` gives no signal that the session was cut short. This only occurs under test injection (no-op `delay` + non-advancing `now`); a real run always exits by duration. DEFERRED: observability-only, no real-run impact.

---

## RESOLVED — EPS-5 deferred-cleanup pass (2026-06-30)

Issue EPS-5 (Deferred work cleanup) triaged all 6 priority items. Items 1, 2, 3, 6 were already fixed in commit `38a1b9b` (2026-06-10 deferred-cleanup pass). This pass resolved item 5; item 4 remains blocked on a live Facebook session.

- ✅ **Item 1 — Dispatcher cleanup-ordering bug** [src/scrapers/index.js] — resolved in `38a1b9b`: browser ref stored BEFORE login; login wrapped in try/catch that closes browser on throw.
- ✅ **Item 2 — page.goto no try/catch → browser leak on timeout** [src/scrapers/facebook/index.js] — resolved in `38a1b9b`: fn-call + auto-close wrapped in try/finally.
- ✅ **Item 3 — runGuardedBatch shouldStop semantics** [api/services/facebookAutomation.js] — resolved in `38a1b9b`: shouldStop receives immutable summary `{ attempted, succeeded, failed, lastResult }`.
- ⏳ **Item 4 — Facebook selector live-verify checklist** [docs/agents/selectors-facebook.md] — STILL BLOCKED on a live authenticated Facebook session. DOM-accuracy items (1.3 texts[0] author-vs-body, engagement regex, image filter avatar leak; 1.4 follower name selector; 2.2 Like selector ambiguity; 2.4 postUrl detection; 4.2 share-to-Feed; 4.4 join pending; 4.8 request-age date format) cannot be fixed blind without risking worse selectors. The verify checklist in selectors-facebook.md is the canonical tracker; resolve when a test Facebook account is available.
- ✅ **Item 5 — `--disable-web-security` cross-cutting** — RESOLVED THIS PASS. Evaluation: the flag disables Same-Origin Policy, a core browser security boundary. The Puppeteer scrapers (twitter/threads/facebook) navigate same-origin pages and extract DOM via `page.evaluate` — no cross-origin response reads needed. The only cross-origin `fetch` user (`videoDownloader.js`) is a browser-paste script run in DevTools on x.com, not affected by these Puppeteer launch args. Removed `--disable-web-security` from all 5 launch sites: `src/scrapers/facebook/index.js`, `src/scrapers/twitter/index.js`, `src/scrapers/threads/index.js`, `src/scrapers/adapters/puppeteer.js`, `src/scrapers/adapters/selenium.js`; plus 4 `docs/examples/*.md` and 4 `dashboard/docs/*.html` user-facing snippets. `tests/scrapers/facebook-auth.test.js` updated to assert the flag is absent. Callers can still re-add via `extraArgs`/`options.args` if a genuine cross-origin need arises.
- ✅ **Item 6 — xs cookie sameSite:Strict hardening** [src/scrapers/facebook/index.js] — resolved in `38a1b9b`: `sameSite: 'Strict'` on both `xs` and `c_user` cookies.

**Acceptance status:** vitest green (2111 passed; only `tests/x402-integration.test.js` fails — ECONNREFUSED port 3001, expected when server is down per CLAUDE.md). No mocks/stubs/fakes introduced. Committed & pushed as `nirholas`.

## Deferred from: Facebook API test session (2026-08-10)

- **Comment selector outdated** [api/services/facebookAutomation.js#findCommentInput] — "Comment input not found; locale unsupported or post unreachable". Selector needs update for current Facebook DOM.
- **Posts scraping returns 0 results** [src/scrapers/facebook/index.js#scrapeTweets] — Desktop site doesn't load posts in headless mode. Need mobile URL fallback for groups.
- **Profile scraping blocked** [src/scrapers/facebook/index.js#scrapeProfile] — "Facebook profile not found or blocked" on headless. Need graceful handling.
- **Search text garbled** [src/scrapers/facebook/index.js#searchTweets] — Returns results but text encoding is garbled.

## Deferred from: code review of 6-9-bezier-mouse (2026-08-12)

- **Overshoot disproportionate on tiny movements** [src/scrapers/facebook/human.js:124] — Fixed 5-15px overshoot regardless of movement distance. For 1px movements, overshoot is 5-15x the distance, looking unnatural. Not actionable until integration with real call sites provides realistic coordinate ranges. Revisit when humanMoveMouse is integrated into automation flows (Story 6.10+).
