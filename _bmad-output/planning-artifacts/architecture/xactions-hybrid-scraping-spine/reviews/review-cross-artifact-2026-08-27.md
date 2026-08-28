# Cross-Artifact Consistency Review — 2026-08-27

**Review Subject:** Sprint Change Proposal *"Action-Level Granular Authentication & Proxy Strategy"* (2026-08-27)
**Artifacts Reviewed:**
1. `sprint-change-proposal-2026-08-27.md` (Source of Truth)
2. `ARCHITECTURE-SPINE.md` (Spine Architecture r3 amended)
3. `epics.md` (Epics & Stories specification)
4. `sprint-status.yaml` (Sprint status tracker)

**Reviewer Role:** Subagent — Architecture Reviewer Gate (Cross-Artifact Consistency Lens)
**Date:** 2026-08-27
**Verdict:** **PASS-WITH-FINDINGS**

---

## 1. Executive Summary

On 2026-08-27, an architectural adjustment was approved to decompose authentication and proxy affinity from platform-level (`crawler.requiresAuth`) down to action-level (`ActionDescriptor.requiresAuth ?? crawler.requiresAuth`).

This review audited all 10 consistency criteria (X1–X10) across the proposal, the architecture spine, and the epic specifications. 

### Key Assessment
- **Core Alignment (PASS):** The primary contract changes in `ARCHITECTURE-SPINE.md` (AD-3 rule 3b, AD-11 rule 3, AD-8, AD-14, Decision Changelog) and `epics.md` (Story 10.1, 11.5 Step 1, 13.3, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10) are synchronized with zero contradictions among the Facebook action classification table.
- **Sprint Status Alignment (PASS):** `sprint-status.yaml` correctly preserves Stories 13.9 and 13.10 as `backlog` without any added, removed, or renumbered stories.
- **Missed Spots / Residual Language (FINDINGS):** 5 unamended adjacent sections carry stale platform-level phrasing or shapes:
  1. Story 14.2 Action Discovery AC (`epics.md:675`) omits `requiresAuth` from `ActionDescriptor`.
  2. Story 11.5 AC (`epics.md:271`) retains a platform-level assertion claiming Facebook always uses sticky IP.
  3. AD-9 Rule 1 (`ARCHITECTURE-SPINE.md:216-219`) branches anti-bot validation by platform name instead of action auth state.
  4. AD-5 Rule 4 (`ARCHITECTURE-SPINE.md:179`) classifies Facebook as a whole under "Auth-required platforms".
  5. AD-13 Rule 3/4 & Story 11.4 AC (`epics.md:251-252`) retain platform-scoped velocity wording.

---

## 2. Consistency Checks Matrix (X1 – X10)

| Check | Item | Evaluation | Status |
|---|---|---|---|
| **X1** | `ActionDescriptor` Shape across AD-11, AD-14, Story 10.1, Story 14.2 | AD-11, AD-14, and Story 10.1 carry `requiresAuth`. Story 14.2 line 675 is stale (omits `requiresAuth`). | ⚠️ **Finding F-01** |
| **X2** | Facebook Action Classification Table vs Epics vs AD | Exact 1:1 match across proposal Section 3.2 and Stories 13.3, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10. | ✅ **PASS** |
| **X3** | Story 11.5 Step 2 & Surrounding Language | Step 1 updated; Step 2 references resolved value; but line 271 retains whole-platform sticky IP clause for Facebook. | ⚠️ **Finding F-02** |
| **X4** | AD-5 Rule 4 (Sticky IP per Account) | AD-5 was not amended; lists Facebook under "Auth-required platforms", drifting from mixed-action reality. | ⚠️ **Finding F-04** |
| **X5** | AD-9 Rule 1 (Anti-Bot Payload Validation) | Branches by platform type; ambiguous for Facebook no-auth actions encountering WAF/challenge. | ⚠️ **Finding F-03** |
| **X6** | AD-13 Rule 3/4 & Story 11.4 (Account Velocity) | Platform-scoped phrasing; needs explicit binding to active `accountId` presence for opt-in auth. | ⚠️ **Finding F-05** |
| **X7** | Decision Changelog & Frontmatter `updated` | Frontmatter `updated: '2026-08-27T00:00:00Z'` and Section 7 changelog lines 509–514 accurately describe edits. | ✅ **PASS** |
| **X8** | Remaining Occurrences of Old Shapes & Open Questions | No stray `category` in active descriptor shapes; AD-2 dispatch aligns with AD-11 rule 3; Open Questions clean. | ✅ **PASS** |
| **X9** | `sprint-status.yaml` Backlog State | Stories 13.9 and 13.10 are listed as `backlog`; Stories 10.1, 11.5, 13.3–13.8 are `done`. | ✅ **PASS** |
| **X10** | Story Hierarchy & Numbering Preservation | No stories added, deleted, or renumbered across Epics 10–26; proposal Section 7 claim verified. | ✅ **PASS** |

---

## 3. Detailed Cross-Artifact Consistency Audits

### X1. ActionDescriptor Shape Consistency
- **Proposal Section 5.1:** Defines shape as `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }`.
- **`ARCHITECTURE-SPINE.md:235` (AD-11 Rule 2):** Pinned shape `{ action: string, description: string, requiredArgs: string[], optionalArgs: string[], example: object, outputType: string, requiresAuth: boolean }` with resolved value explanation. *(Aligned)*
- **`ARCHITECTURE-SPINE.md:277` (AD-14 Rule 2):** Pinned shape `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }`. *(Aligned)*
- **`epics.md:106-107` (Story 10.1 AC):** Explicitly specifies `ActionDescriptor` supports `requiresAuth?: boolean` and `listActions()` returns resolved `requiresAuth`. *(Aligned)*
- **`epics.md:675` (Story 14.2 Action Discovery AC):**
  ```markdown
  674: * **When** gọi tool `x_actions_list`
  675: * **Then** trả về `ActionDescriptor[]` với `{ action, description, requiredArgs, optionalArgs, example, outputType }`.
  ```
  **Discrepancy:** Story 14.2 was not included in the proposal's amended story list (Section 5.2). Line 675 still contains the pre-amendment 6-field shape without `requiresAuth`.

---

### X2. Facebook Action Classification Table Audit
Comparison between `sprint-change-proposal-2026-08-27.md` Section 3.2 and `epics.md`:

| Action | Proposal Target (Section 3.2) | `epics.md` Story AC | Alignment Evidence |
|---|---|---|---|
| `page_posts` | `requiresAuth: false`, Guest Token, Rotating Proxy | Story 13.3 (line 533) | `action page_posts khai báo requiresAuth: false... guest token lsd/jazoest... Rotating Residential Proxy...` |
| `group_posts` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.3 (line 533) | `action group_posts khai báo requiresAuth: true (nhóm kín — account từ pool + Sticky Residential Proxy)...` |
| `profile` | `requiresAuth: false`, Guest Token, Rotating Proxy | Story 13.5 (line 562) | `action profile (public) khai báo requiresAuth: false — chạy guest token + rotating residential proxy...` |
| `group_members` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.5 (line 562) | `group_members và followers/following giữ requiresAuth: true (fallback platform)...` |
| `followers` / `following` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.5 (line 562) | `group_members và followers/following giữ requiresAuth: true (fallback platform)...` |
| `search` (global) | `requiresAuth: false`, Guest Token, Rotating Proxy | Story 13.6 (line 576) | `action search (global) khai báo requiresAuth: false — guest token + rotating residential proxy...` |
| `group_search` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.6 (line 576) | `group_search giữ requiresAuth: true (ngữ cảnh nhóm kín, fallback platform)...` |
| `post_comments` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.7 (line 590) | `post_comments và group_comments giữ requiresAuth: true (fallback platform)...` |
| `group_comments` | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.7 (line 590) | `post_comments và group_comments giữ requiresAuth: true (fallback platform)...` |
| `marketplace` | `requiresAuth: false`, Guest Token, Rotating Proxy | Story 13.8 (line 604) | `action marketplace khai báo requiresAuth: false: chỉ dùng guest token lsd/jazoest... Rotating Residential Proxy...` |
| Social actions (8 write actions) | `requiresAuth: true`, AccountPool, Sticky Proxy | Story 13.9 (line 618) | `toàn bộ social actions (like, comment, post, share, messenger_share, share_link_uid, join_group, send_friend_request) khai báo/tự fallback requiresAuth: true...` |
| Discovery / Migration | Resolved `requiresAuth` per action | Story 13.10 (line 633) | `action discovery qua FacebookCrawler.listActions()... trả về requiresAuth đã phân giải...` |

**Conclusion:** 100% exact alignment. No amended story contradicts the proposal classification.

---

### X3. Story 11.5 Pipeline Wording & Residual Contradiction
In `epics.md`:
- **Line 265 (Step 1):** Successfully updated to `"Xác định requiresAuth hiệu dụng của action (ActionDescriptor.requiresAuth ?? crawler.requiresAuth)..."`.
- **Line 266 (Step 2):** Reads `"Nếu requiresAuth → proxyPool.getStickyProxy(accountId)... Nếu !requiresAuth → proxyPool.getNext()"`. While contextually referring to the resolved variable from Step 1, it should explicitly state `actionRequiresAuth` for syntactic precision.
- **Line 271 (Residual clause):**
  ```markdown
  271: * **And** Auth-required platforms (Facebook, TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) sử dụng sticky IP; no-auth platforms (Batdongsan, Chotot, v.v.) sử dụng rotating residential proxy.
  ```
  **Discrepancy:** Line 271 asserts that Facebook as a whole platform uses sticky IP, directly contradicting Step 1 and AD-3 Rule 3b where Facebook public actions run with rotating residential proxies.

---

### X4. AD-5 Rule 4 (Sticky IP per Account) vs AD-3 Rule 3b
In `ARCHITECTURE-SPINE.md:179`:
```markdown
179: 4. *Sticky IP per Account:* Auth-required platforms (Facebook, TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) và optional-auth platforms khi có account (Bluesky, Mastodon) buộc một tài khoản gắn với một proxy cố định trong suốt session...
```
**Discrepancy:** AD-5 was not in the scope of the 2026-08-27 amendment. Its opening text categorizes Facebook as an "Auth-required platform". In reality, under AD-3 Rule 3b, Facebook is a mixed-mode platform. While the trailing rule ("Không được tự động xoay IP mỗi request cho tài khoản đã đăng nhập") is consistent, the platform listing creates conceptual ambiguity.

---

### X5. AD-9 Rule 1 (Anti-Bot Payload Validation) Classification
In `ARCHITECTURE-SPINE.md:216-219`:
```markdown
216: 1. Mọi crawler phải đăng ký một PlatformResponseValidator gồm isValidPayload(response), isBotChallenge(response), isRateLimit(response). Nếu validator trả về challenge/rate-limit:
217:    - *No-auth platforms (Bluesky public, Mastodon public, Batdongsan, Chợ Tốt):* throw RateLimitError để xoay IP (rotate proxy) ngay cả khi HTTP status là 200.
218:    - *Optional-auth platforms (Bluesky/Mastodon khi có auth):* nếu lỗi liên quan đến auth → chuyển AccountPool; nếu lỗi rate-limit từ public IP → xoay proxy.
219:    - *Auth-required platforms:* throw BotChallengeError/RateLimitError, quarantine proxy, hibernate tài khoản 15–30 phút, và chuyển AccountPool sang tài khoản tiếp theo. Không xoay IP liên tục cho cùng một tài khoản.
```
**Discrepancy:** This 3-branch classification is partitioned by platform rather than request auth state. If Facebook executes a public action (`marketplace` / `search`) without an account (`accountId = null`), encountering WAF cannot hibernate an account or rotate `AccountPool`. The execution should follow the rotating-proxy branch (quarantine proxy + rotate IP).

---

### X6. AD-13 Rule 3/4 & Story 11.4 (Account Velocity Scope)
In `ARCHITECTURE-SPINE.md:251-253` and `epics.md:251-252`:
- AD-13 Rule 3/4 and Story 11.4 AC use `"cho auth-required platforms: mỗi tài khoản có token bucket safeRequestsPerMinute..."`.
- **Discrepancy:** When an explicit `accountId` is passed to a `requiresAuth: false` action (opt-in auth per D1 / AD-3 Rule 3b), it must be tracked under governor account velocity. Conversely, no-auth actions with `accountId = null` on Facebook must not be subject to platform-level account velocity blocks. The phrasing should be keyed by `accountId` presence rather than platform category.

---

### X7. Decision Changelog Verification
- **Frontmatter (`ARCHITECTURE-SPINE.md:10-11`):** `updated: '2026-08-27T00:00:00Z'` is present and valid.
- **Section 7 Changelog (`ARCHITECTURE-SPINE.md:509-514`):**
  - Accurately references AD-3 (title change, rule 3b), AD-11 (rule 3, listActions shape), AD-8 (synchronized language), AD-14 (Action Discovery contract), and references `sprint-change-proposal-2026-08-27.md`.
  - Accurately captures all textual modifications made to the spine.

---

### X8. Open Questions & Command Dispatch Consistency
- **Command Dispatch (`ARCHITECTURE-SPINE.md:139` vs `236`):** AD-2 Rule 2 establishes `crawler.start(command)` dispatching to `ActionRegistry`. AD-11 Rule 3 specifies the exact resolution of `actionRequiresAuth` within `start(command)`. Both rules are fully harmonized.
- **Open Questions (`ARCHITECTURE-SPINE.md:456-460`):** Contains 3 resolved/operational items (Intent tagging, MCP over HTTP/SSE auth, Per-platform rate limits). None conflict with the action-level strategy.

---

### X9 & X10. Sprint Status & Hierarchy Verification
- `_bmad-output/implementation-artifacts/sprint-status.yaml` verified:
  - Stories 13.9 (`13-9-facebook-hybrid-social-actions-write-messenger`) and 13.10 (`13-10-facebook-hybrid-integration-caller-migration`) are `backlog`.
  - Stories 10.1, 11.5, 13.3–13.8 are `done`.
- Epics structure in `epics.md` verified:
  - Zero epics or stories were added, removed, or renumbered.
  - Section 7 statement ("sprint-status.yaml không cần thay đổi") is 100% true.

---

## 4. Findings & Remediation Plan

### Finding F-01: Story 14.2 Action Discovery AC carries stale ActionDescriptor shape
- **Severity:** **HIGH**
- **Location:** `epics.md:675` (Story 14.2)
- **Problem:** `ActionDescriptor` shape in Story 14.2 AC lists `{ action, description, requiredArgs, optionalArgs, example, outputType }`, omitting `requiresAuth`.
- **Remediation:** Update `epics.md:675` to:
  ```markdown
  * **Then** trả về `ActionDescriptor[]` với `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }` (requiresAuth đã phân giải theo AD-11 rule 3).
  ```

### Finding F-02: Story 11.5 residual platform-level clause contradicts Step 1
- **Severity:** **HIGH**
- **Location:** `epics.md:271` (Story 11.5)
- **Problem:** Line 271 states `"Auth-required platforms (Facebook, TikTok, ...) sử dụng sticky IP..."`, directly contradicting Step 1 where Facebook no-auth actions use rotating proxy.
- **Remediation:** Update `epics.md:271` to:
  ```markdown
  * **And** Request có requiresAuth hiệu dụng = true sử dụng sticky IP theo accountId; request có requiresAuth hiệu dụng = false sử dụng rotating residential proxy xoay per-request.
  ```

### Finding F-03: AD-9 Rule 1 anti-bot validation branches by platform rather than request auth state
- **Severity:** **HIGH**
- **Location:** `ARCHITECTURE-SPINE.md:216-219` (AD-9 Rule 1)
- **Problem:** When Facebook encounters WAF on a no-auth action (`marketplace`), the "Auth-required platforms" branch attempts to hibernate a non-existent account (`accountId = null`).
- **Remediation:** Update `ARCHITECTURE-SPINE.md:217-219` to:
  ```markdown
  - *Request không dùng tài khoản (`accountId === null` / `actionRequiresAuth === false`):* throw `RateLimitError` để xoay IP (rotate proxy) ngay cả khi HTTP status là 200.
  - *Request có tài khoản (`accountId !== null` / `actionRequiresAuth === true`):* nếu lỗi bot challenge/WAF → throw `BotChallengeError`, quarantine proxy, hibernate tài khoản 15–30 phút, và chuyển `AccountPool` sang tài khoản tiếp theo. Không xoay IP liên tục cho cùng một tài khoản.
  ```

### Finding F-04: AD-5 Rule 4 lists Facebook under blanket Auth-Required Platforms
- **Severity:** **MEDIUM**
- **Location:** `ARCHITECTURE-SPINE.md:179` (AD-5 Rule 4)
- **Problem:** Classifies Facebook wholly as an auth-required platform, conflicting with AD-3 Rule 3b mixed-action definition.
- **Remediation:** Update the opening of `ARCHITECTURE-SPINE.md:179` to:
  ```markdown
  4. *Sticky IP per Account:* Các request chạy ở chế độ xác thực (platform auth-required, action có requiresAuth hiệu dụng = true, hoặc caller truyền accountId) buộc một tài khoản gắn với một proxy cố định trong suốt session...
  ```

### Finding F-05: AD-13 Rule 3/4 & Story 11.4 AC retain platform-scoped velocity wording
- **Severity:** **MEDIUM**
- **Location:** `ARCHITECTURE-SPINE.md:251-253` and `epics.md:251-252`
- **Problem:** Phrasing "cho auth-required platforms" leaves ambiguity on whether opt-in `accountId` on no-auth actions is governed by velocity limits.
- **Remediation:** Clarify in AD-13 Rule 3 and Story 11.4 AC that account velocity token buckets apply per active `accountId` whenever `accountId` is present.

---

## 5. Review Conclusion

The sprint change proposal is thoroughly grounded and correctly propagated to the critical operational interfaces (AD-3, AD-11, Story 10.1, and all Epic 13 Facebook stories). The 5 findings identified above represent unamended surrounding context and edge-case phrasing that can be resolved cleanly via minor text edits without altering the technical architecture or sprint plan.
