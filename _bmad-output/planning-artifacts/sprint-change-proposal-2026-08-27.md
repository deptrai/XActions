# Sprint Change Proposal — 2026-08-27

**Issue Triggered By:** Sprint Change Request của Luisphan — *"Chuẩn hóa kiến trúc Action-Level Granular Authentication & Proxy Strategy (Phân rã cơ chế Auth và điều phối Proxy từ cấp Platform xuống cấp Action)"*
**Scope:** Core contract `AbstractCrawler` / `ActionDescriptor`, Proxy & Account orchestration, Facebook action classification, ARCHITECTURE-SPINE.md, epics.md.
**Recommended Path:** Direct Adjustment (Option 1) — không rollback, không giảm MVP scope.
**Scope Classification:** **Moderate** — thay đổi core contract đã triển khai (retroactive cho stories done), cần backlog coordination + 1 dev task trước khi Story 13.9/13.10 bắt đầu.

---

## 1. Issue Summary (Vấn đề & Bối cảnh)

Dự án đang ở **Epic 13 — High-Throughput Hybrid Scraping Engine**, Facebook sub-thread. Stories 13.3–13.8 đã `done`; 13.9 (Social Actions) và 13.10 (Caller Migration) đang `backlog`.

**Vấn đề cốt lõi:** Cờ `requiresAuth` hiện được khai báo cứng ở **cấp Platform / Crawler class**:

- `src/core/base-crawler.js:174-190` — `AbstractCrawler.start()` dùng `this.requiresAuth` để quyết định rút tài khoản từ `AccountPool` và throw `AUTH_EXPIRED` nếu không có account.
- `src/scrapers/social/facebook/crawler.js:262,288` — `FacebookCrawler` hardcode `requiresAuth = true`, ép **TẤT CẢ** action của Facebook phải có tài khoản + sticky proxy.

**Hậu quả thực tế trên Facebook (nền tảng hỗn hợp public/private):**

1. **Lãng phí tài khoản pool:** Các action công khai — `marketplace` (Story 13.8), `search` (Story 13.6), `page_posts` (Story 13.3), `profile` (public) — về bản chất chỉ cần guest token (`lsd`/`jazoest` từ Pre-Signed Token Ring) nhưng vẫn rút account từ pool, làm cạn tài khoản và tăng nguy cơ checkpoint cho các action thật sự cần auth.
2. **Sai chiến lược proxy:** `AbstractApiClient.resolveProxy()` gán **Sticky Residential Proxy cố định** cho mọi request của platform auth-required. Với action công khai, chiến lược đúng là **Rotating Residential Proxy xoay per-request** để tối đa throughput, chống rate-limit.
3. **Điểm nghẽn forward:** Story 13.9 (like/comment/post/messenger) sắp build sẽ kế thừa contract sai — write actions **bắt buộc** sticky account + sticky IP, trong khi read-public actions thì không.

**Phát hiện cộng hưởng:** AD-11 rule 2 trong `ARCHITECTURE-SPINE.md:230` **đã pin sẵn `requiresAuth: boolean` trong shape `ActionDescriptor`** từ r3 (2026-08-18), nhưng code (`src/core/types.js:93-100`), Story 10.1 và Story 14.2 trong `epics.md` chưa bao giờ triển khai. Thay đổi này là **hoàn tất một quyết định kiến trúc đã duyệt**, không phải đảo ngược.

---

## 2. Evidence / Data Sources

| Nguồn | Mô tả | Phát hiện |
|-------|-------|-----------|
| `src/core/base-crawler.js:172-236` | Account resolution trong `start()` | Platform-level `this.requiresAuth`; rút pool + throw `XACT_4010` khi thiếu account |
| `src/core/types.js:93-100` | `ActionDescriptor` typedef | **Chưa có** trường `requiresAuth` |
| `src/scrapers/social/facebook/crawler.js:262,288` | `FacebookCrawler` constructor | Hardcode `requiresAuth = true` cấp platform |
| `src/core/base-client.js:181-229` | `resolveProxy(accountId)` | Sticky chỉ khi `this.requiresAuth && rawAccountId`; ngược lại → `getNext()` rotating |
| `src/core/base-client.js:486` | Request guard | Throw `XACT_4010` chỉ khi `requiresAuth && !accountId && !accountPool` — accountId=null + accountPool tồn tại → đi tiếp bình thường |
| `src/proxy/providers.js:578` | `DynamicTunnelProvider` | `rotatePerRequest` **default `true`** |
| `src/proxy/providers.js:880-908` | `#resolveSessionId(req, accountId)` | Có accountId → sticky session hash; không accountId + `rotatePerRequest` → **random session mỗi request (xoay IP)** — hạ tầng đã sẵn sàng, chỉ bị chặn bởi accountId bắt buộc |
| `src/core/base-crawler.js:231` | Governor tracking | `recordRequest(accountId || 'noauth')` — đã xử lý null accountId |
| `ARCHITECTURE-SPINE.md:230` (AD-11) | ActionDescriptor shape | Đã pin `requiresAuth: boolean` — chưa implement |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Trạng thái story | 10.1, 11.5, 13.3–13.8 `done`; 13.9, 13.10 `backlog` |
| `tests/core/base-crawler.test.js`, `tests/core/crawler-governor.test.js`, `tests/scrapers/social/facebook/crawler-*.test.js` | Test coverage hiện có | Cần bổ sung assert cho action-level auth |

---

## 3. Impact Analysis

### 3.1 Epic Impact

| Epic/Story | Thay đổi cần thiết |
|---|---|
| **Epic 10 — Story 10.1** | AC bổ sung: `ActionDescriptor.requiresAuth?: boolean` + resolution precedence trong `start()`. **Retroactive** (story done). |
| **Epic 11 — Story 11.5** | AC bổ sung (ngoài danh sách SCR nhưng bắt buộc về tính nhất quán): pipeline step 1 xác định `requiresAuth` **hiệu dụng của action** thay vì của platform. **Retroactive** (story done). |
| **Epic 13 — Stories 13.3, 13.5, 13.6, 13.7, 13.8** | AC cập nhật phân loại auth từng action. **Retroactive** (done) — kèm dev task phân loại lại descriptors. |
| **Epic 13 — Stories 13.9, 13.10** | AC cập nhật. **Proactive** (backlog) — build đúng contract mới ngay từ đầu, tiết kiệm rework. |
| **Epic 15 (Threads), 23 (Bluesky/Mastodon)** | Không bắt buộc — fallback `descriptor.requiresAuth ?? crawler.requiresAuth` giữ nguyên hành vi hiện tại. |
| **Epics 14, 16–20, 24–26** | Không bị ảnh hưởng. |

### 3.2 Phân loại Action Facebook (Target)

| Action | `requiresAuth` | Auth source | Proxy strategy | Lý do |
|---|---|---|---|---|
| `marketplace` | **false** | Guest token `lsd`/`jazoest` (Pre-Signed Ring) | **Rotating residential, xoay per-request** | Public data; tối đa throughput, chống rate-limit |
| `search` (global) | **false** | Guest token | Rotating per-request | Public |
| `page_posts` | **false** | Guest token | Rotating per-request | Fanpage public |
| `profile` | **false** | Guest token | Rotating per-request | Profile public |
| `group_posts` | **true** (fallback platform) | AccountPool | **Sticky residential theo accountId** | Nhóm kín cần member session; chống checkpoint do đổi IP |
| `group_members` | **true** (fallback) | AccountPool | Sticky | Nhóm kín |
| `group_search` | **true** (fallback) | AccountPool | Sticky | Ngữ cảnh nhóm kín |
| `post_comments` | **true** (fallback) | AccountPool | Sticky | Bài trong nhóm kín (use case chính) |
| `group_comments` | **true** (fallback) | AccountPool | Sticky | Bài nhóm kín |
| `followers` / `following` | **true** (fallback) | AccountPool | Sticky | Identity graph, endpoint thường restricted |
| Social actions: `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request` (Story 13.9) | **true** (fallback) | AccountPool | Sticky, **bắt buộc** | Write action gắn danh tính tài khoản |

*Ghi chú: action không khai báo `requiresAuth` → fallback về `crawler.requiresAuth` (Facebook = `true`). Do đó chỉ cần khai báo `false` cho 4 action public; các action còn lại tự động đúng.*

### 3.3 Artifact Conflicts

| Artifact | Xung đột | Hành động |
|---|---|---|
| **PRD (`prd.md`)** | Không — FR-64/FR-72 không cố định cấp granularity; thay đổi nâng cao FR-88 (tiết kiệm proxy cost) | Không sửa |
| **ARCHITECTURE-SPINE.md** | AD-3 mô tả proxy strategy theo **platform auth mode**; AD-11 thiếu resolution semantics; AD-8/AD-14 dùng ngôn ngữ platform-level | Sửa AD-3, AD-11 (chính); AD-8, AD-14 (consistency); changelog + `updated` |
| **epics.md** | Story 10.1, 11.5, 13.3–13.10 thiếu action-level auth AC | Sửa 9 stories |
| **UX specs** | Không — chỉ thêm trường `requiresAuth` vào action discovery (additive, non-breaking) | Không sửa |
| **Code** | `types.js`, `base-crawler.js`, `facebook/crawler.js` | Dev task (mục 6) |

### 3.4 Technical Impact (Code)

1. `src/core/types.js` — thêm `@property {boolean} [requiresAuth]` vào `ActionDescriptor` typedef (T1).
2. `src/core/base-crawler.js` — `start()`: tính `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`; thay 3 check `this.requiresAuth` (rút pool, throw 4010, governor account check); `listActions()` expose `requiresAuth` đã resolve (T2, T3).
3. `src/scrapers/social/facebook/crawler.js` — thêm `requiresAuth: false` vào descriptor của `page_posts`, `profile`, `search`, `marketplace` (T4).
4. `src/scrapers/social/facebook/client.js` — **CẦN SỬA (T7)**: `requestGraphQl` (dòng 436) bỏ fallback `options.accountId || 'default'` thành `options.accountId || null` để không bị ép gán sticky proxy; `buildGraphQlBody` (dòng 389) bổ sung guest body mode (`__user: '0'`, `av: '0'`) khi không có `c_user`/`userId` thay vì ném lỗi `XACT_4010`.
5. `src/core/base-client.js` — **CẦN SỬA (T8)**: truyền signal auth-mode của action xuống client qua `options.requiresAuth` (hoặc `session`); nới guard dòng 486 (`if (this.requiresAuth && !currentAccountId && !this.accountPool)`) khi `options.requiresAuth === false` để standalone environment không có `accountPool` vẫn thực thi được các action public.
6. `src/proxy/providers.js` — **không cần sửa** (`rotatePerRequest` default `true`; `#resolveSessionId` đã xoay IP khi `accountId` là null).
7. Tests — `tests/core/base-crawler.test.js`, `tests/core/crawler-governor.test.js`, `tests/scrapers/social/facebook/crawler-*.test.js`, `tests/scrapers/social/facebook/client.test.js` bổ sung assert cho action-level auth, guest GraphQL body, và standalone pool-less execution.

**Backward Compatibility:**
- Action không khai báo `requiresAuth` → hành vi **giữ nguyên 100%** (Twitter, Threads, các platform khác không đổi).
- `listActions()` thêm trường → additive; consumer (CLI/MCP) parse theo field nên không break.
- 4 action Facebook (`page_posts`, `profile`, `search`, `marketplace`) **đổi hành vi có chủ đích**: không còn tự rút account pool. Consumer muốn chạy authenticated variant → truyền `accountId` rõ ràng trong `session`/`args` (opt-in).

**Design Decision D1 (cần Dev tuân thủ):** Khi `actionRequiresAuth === false`, hệ thống **không tự rút account** từ pool, nhưng `accountId` do caller truyền rõ (qua `command.session.accountId` / `args.accountId`) **vẫn được tôn trọng** — request đó chạy sticky proxy + chịu governor account velocity như tài khoản gắn liền. Điều này giữ được opt-in authenticated search (ví dụ search trong ngữ cảnh member) mà vẫn đạt mục tiêu chống cạn pool của SCR.

---

## 4. Recommended Approach

### Option 1 — Direct Adjustment ✅ (Được chọn)

Sửa contract core + phân loại lại descriptors trong nền tảng hiện có + bổ sung guest GraphQL mode cho client. Không rollback, không thay đổi MVP scope.

- **Effort:** Low-Medium — ước tính **~1.5–2 dev-days** (contract ~2h, Facebook descriptors ~1h, Facebook client guest mode ~3h, base-client signal & guard ~1.5h, tests ~4h, verification ~2h).
- **Risk:** **Low** — fallback `?? this.requiresAuth` đảm bảo zero regression cho platforms khác; hạ tầng proxy (`rotatePerRequest`, `#resolveSessionId`) đã sẵn sàng, không cần sửa.
- **Timeline impact:** Không đổi. Nên thực hiện **trước khi Story 13.9 bắt đầu** để write actions sinh ra đúng contract.
- **Momentum:** 13.9/13.10 hưởng lợi trực tiếp (không rework sau này).

### Option 2 — Rollback: ❌ Không khả thi
Không có gì cần rollback — 13.3–13.8 hoạt động đúng như AC cũ; đây là tinh chỉnh granularity, không phải hướng sai.

### Option 3 — MVP Review: ❌ Không cần
MVP không bị ảnh hưởng; thay đổi còn tăng khả năng đạt FR-88 (proxy cost saving).

---

## 5. Detailed Change Proposals

### 5.1 ARCHITECTURE-SPINE.md

#### AD-3 — Bổ sung action-level granularity & invariant điều phối

```
Section: AD-3 — Rule 2 & 3 (và rule mới)

OLD (rule 3, phần đầu):
  3. `ProxyIpPool` hỗ trợ `getStickyProxy(accountId)` cho chế độ sticky và
  `getNext()` cho chế độ round-robin. Mỗi platform crawler khai báo
  `requiresAuth: boolean` để chọn chế độ. Đối với optional-auth (Bluesky,
  Mastodon), `requiresAuth = false` khi chạy public, và `requiresAuth = true`
  khi session có `accountId` (sticky IP được gán theo session).

NEW (rule 3 + rule mới 3b):
  3. `ProxyIpPool` hỗ trợ `getStickyProxy(accountId)` cho chế độ sticky và
  `getNext()` cho chế độ round-robin. Chế độ được chọn theo
  **`requiresAuth` hiệu dụng của ACTION** (xem 3b), mặc định là cờ
  `requiresAuth` của platform crawler. Đối với optional-auth (Bluesky,
  Mastodon), `requiresAuth = false` khi chạy public, và `requiresAuth = true`
  khi session có `accountId` (sticky IP được gán theo session).

  3b. **Action-Level Auth Granularity:** `ActionDescriptor` cho phép khai báo
  `requiresAuth?: boolean` override cờ cấp platform:
  - **Precedence:** `actionRequiresAuth = descriptor.requiresAuth ?? crawler.requiresAuth`.
  - **`actionRequiresAuth === true`:** bắt buộc resolve `accountId` từ
    `AccountPool` (hoặc từ caller); gắn **Sticky Residential Proxy** qua
    `proxyPool.getStickyProxy(accountId)` trong suốt session; chịu
    account velocity limit của governor.
  - **`actionRequiresAuth === false`:** không rút `AccountPool`, không kiểm
    tra `governor.canAccountRequest`; `accountId = null`; API client truyền
    `accountId: null` khiến `DynamicTunnelProvider` sinh session ngẫu nhiên
    và **xoay IP dân cư trên từng request (`rotatePerRequest`)**. Guest
    tokens (`lsd`/`jazoest`/`fb_dtsg`) lấy từ Pre-Signed Token Ring.
    Caller truyền `accountId` rõ ràng vẫn được tôn trọng (opt-in auth).
  - **Invariant điều phối Sticky ↔ Rotating:** một request thuộc đúng MỘT
    chế độ; tài khoản đã đăng nhập không bao giờ bị gán IP xoay per-request;
    request công khai không giữ sticky session; không trộn proxy mode trong
    cùng một `CrawlerCommand`.
```

#### AD-11 — Bổ sung resolution semantics

```
Section: AD-11 — Rule 2 & rule mới 3

OLD (rule 2):
  2. `AbstractCrawler.listActions()` trả về `ActionDescriptor[]` với shape
  cố định: `{ action, description, requiredArgs, example, category,
  requiresAuth: boolean }`. Không cho phép trường tên `args`, `params`,
  hoặc `inputs`; consumer parse theo `requiredArgs` và `example`.

NEW (rule 2 + rule mới 3):
  2. `AbstractCrawler.listActions()` trả về `ActionDescriptor[]` với shape
  cố định: `{ action, description, requiredArgs, optionalArgs, example,
  outputType, requiresAuth }` — trong đó `requiresAuth` là giá trị ĐÃ PHÂN
  GIẢI (`descriptor.requiresAuth ?? crawler.requiresAuth`). Không cho phép
  trường tên `args`, `params`, hoặc `inputs`; consumer parse theo
  `requiredArgs` và `example`.

  3. **Action-Level Auth Resolution trong `start()`:** `AbstractCrawler.
  start(command)` tính `actionRequiresAuth = entry.descriptor.requiresAuth
  ?? this.requiresAuth` và dùng nó cho toàn bộ account resolution:
  - `actionRequiresAuth === false` và caller không truyền `accountId` ➔
    chạy với `accountId = null`, bỏ qua `AccountPool` và governor account
    check; proxy xoay per-request (Rotating Residential).
  - `actionRequiresAuth === true` ➔ resolve `accountId` từ `AccountPool`;
    thiếu account ➔ error envelope `XACT_4010` (`auth_expired`,
    `suggestedAction: relogin`); Sticky Residential Proxy theo accountId.
  - Action không khai báo `requiresAuth` ➔ fallback crawler-level (giữ
    backward compatibility 100% cho các platform chưa migrate).
```

#### AD-8 & AD-14 — Consistency (minor)

```
AD-8 Rule (dòng 196):
OLD: "Mỗi crawler khai báo `requiresAuth` để hệ thống chọn sticky IP +
     account rotation hoặc rotating residential IP"
NEW: "Mỗi crawler khai báo `requiresAuth` mặc định ở cấp platform; từng
     action có thể override qua `ActionDescriptor.requiresAuth` (xem AD-3
     rule 3b, AD-11 rule 3) để hệ thống chọn sticky IP + account rotation
     hay rotating residential IP"

AD-14 Rule 2 (dòng 268):
OLD: shape `{ action, description, requiredArgs, optionalArgs, example, outputType }`
NEW: shape `{ action, description, requiredArgs, optionalArgs, example,
     outputType, requiresAuth }`
```

Cộng: cập nhật `updated:` frontmatter → `2026-08-27`, thêm 2 dòng Decision Changelog (mục 7).

### 5.2 epics.md

#### Story 10.1 — Core Domain Interfaces (thêm AC)

```
NEW (bổ sung vào cuối Acceptance Criteria của Story 10.1):
* **And** `ActionDescriptor` hỗ trợ trường tùy chọn `requiresAuth?: boolean`;
  `AbstractCrawler.start(command)` tính `actionRequiresAuth =
  entry.descriptor.requiresAuth ?? this.requiresAuth` và dùng giá trị này
  cho account resolution (rút AccountPool, throw XACT_4010, governor
  account check).
* **And** action có `requiresAuth: false` chạy với `accountId = null` khi
  caller không truyền accountId: không rút `AccountPool`, không kiểm tra
  `governor.canAccountRequest`; `listActions()` trả về `requiresAuth` đã
  phân giải cho từng action.
```

#### Story 11.5 — End-to-End Request Pipeline (sửa step 1-2)

```
OLD:
  1. Xác định `requiresAuth` của platform. Nếu `true` → lấy `accountId`
     từ `accountPool.getNextAvailable(platform)`; kiểm tra
     `governor.canAccountRequest(accountId, platform)`; nếu hibernation
     thì chuyển account.

NEW:
  1. Xác định `requiresAuth` hiệu dụng của action
     (`ActionDescriptor.requiresAuth ?? crawler.requiresAuth`). Nếu
     `true` → lấy `accountId` từ `accountPool.getNextAvailable(platform)`;
     kiểm tra `governor.canAccountRequest(accountId, platform)`; nếu
     hibernation thì chuyển account. Nếu `false` → `accountId = null`,
     bỏ qua AccountPool và account velocity check (caller truyền accountId
     rõ ràng vẫn được tôn trọng).
```

#### Story 13.3 — Facebook Group/Page Posts (thêm AC)

```
NEW:
* **And** action `group_posts` khai báo `requiresAuth: true` (nhóm kín —
  account từ pool + Sticky Residential Proxy cố định suốt session);
  action `page_posts` khai báo `requiresAuth: false` (fanpage public —
  guest token `lsd`/`jazoest` từ Pre-Signed Ring + Rotating Residential
  Proxy xoay per-request, không rút account pool).
```

#### Story 13.5 — Profile, Followers & Group Members (thêm AC)

```
NEW:
* **And** action `profile` (public) khai báo `requiresAuth: false` — chạy
  guest token + rotating residential proxy; `group_members` và
  `followers`/`following` giữ `requiresAuth: true` (fallback platform) —
  account + sticky proxy.
```

#### Story 13.6 — Search (thêm AC)

```
NEW:
* **And** action `search` (global) khai báo `requiresAuth: false` — guest
  token + rotating residential proxy xoay per-request; `group_search` giữ
  `requiresAuth: true` (ngữ cảnh nhóm kín, fallback platform).
```

#### Story 13.7 — Post & Group Comments (thêm AC)

```
NEW:
* **And** `post_comments` và `group_comments` giữ `requiresAuth: true`
  (fallback platform — use case chính là bài trong nhóm kín): account từ
  pool + sticky residential proxy.
```

#### Story 13.8 — Marketplace (thêm AC)

```
NEW:
* **And** action `marketplace` khai báo `requiresAuth: false`: chỉ dùng
  guest token `lsd`/`jazoest` từ Pre-Signed Token Ring + Rotating
  Residential Proxy xoay per-request (`DynamicTunnelProvider` sinh session
  ngẫu nhiên); KHÔNG rút tài khoản từ `AccountPool`, không kiểm tra
  `governor.canAccountRequest` cho action này.
```

#### Story 13.9 — Social Actions (thêm AC)

```
NEW:
* **And** toàn bộ social actions (`like`, `comment`, `post`, `share`,
  `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`)
  khai báo/tự fallback `requiresAuth: true`: BẮT BUỘC account từ
  `AccountPool` + Sticky Residential Proxy cố định theo accountId trong
  suốt session (chống checkpoint do IP nhảy); thiếu account trả error
  envelope `XACT_4010` với `suggestedAction: 'relogin'`.
```

#### Story 13.10 — Integration & Caller Migration (thêm AC)

```
NEW:
* **And** action discovery qua `FacebookCrawler.listActions()`, MCP
  `x_actions_list` và CLI `xactions actions --platform facebook` trả về
  `requiresAuth` đã phân giải cho từng action; `api/routes/facebook.js`
  validation vẫn chấp nhận cùng action set, response shape không đổi với
  consumer (trừ trường `requiresAuth` additive trong discovery output).
```

---

## 6. Implementation Handoff

**Scope Classification: MODERATE** — cần PO/DEV coordination (chạm core contract đã done) nhưng không cần fundamental replan.

### Dev Tasks (Dev agent — Amelia)

| # | Task | File | Ước tính |
|---|---|---|---|
| T1 | Thêm `requiresAuth?: boolean` vào `ActionDescriptor` typedef | `src/core/types.js` | 5m |
| T2 | `start()`: `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`; thay 3 check; governor account check keyed theo accountId presence; truyền signal auth mode qua options | `src/core/base-crawler.js:172-243` | 45m |
| T3 | `listActions()` trả về `requiresAuth` đã resolve; đảm bảo `registerAction` truyền descriptor đã resolve vào `globalActionRegistry` (F12) | `src/core/base-crawler.js:100-115` | 15m |
| T4 | Thêm `requiresAuth: false` vào descriptors: `page_posts`, `profile`, `search`, `marketplace` | `src/scrapers/social/facebook/crawler.js` | 20m |
| T7 | `FacebookClient`: sửa `requestGraphQl` (dòng 436) bỏ fallback `'default'` (dùng `null`); sửa `buildGraphQlBody` (dòng 389) hỗ trợ guest body mode (`__user: '0'`, `av: '0'`) khi không có `c_user` (F3, F4) | `src/scrapers/social/facebook/client.js` | 3h |
| T8 | `AbstractApiClient`: nhận signal `options.requiresAuth`; nới guard dòng 486 khi `options.requiresAuth === false` để standalone mode không có `accountPool` không bị ném `XACT_4010` (F5) | `src/core/base-client.js` | 1.5h |
| T5 | Tests: no-auth action không gọi `accountPool.getNextAvailable`, không throw `XACT_4010` khi pool rỗng (kể cả standalone); auth action vẫn rút pool; explicit accountId trên no-auth action được tôn trọng + sticky; opt-in accountId đang hibernation bị từ chối `XACT_4291`; `listActions()` expose đúng | `tests/core/base-crawler.test.js`, `tests/core/crawler-governor.test.js`, `tests/scrapers/social/facebook/crawler-*.test.js`, `tests/scrapers/social/facebook/client.test.js` | 3h |
| T6 | Verify MCP `x_actions_list` surface trường `requiresAuth`; chạy full test suite + lint | `src/mcp/server.js`, CI | 1h |

**Thứ tự thực hiện:** T1 → T2 → T3 → T4 → T7 → T8 → T5 → T6. Nên hoàn tất **trước khi Story 13.9 vào sprint**.

### Handoff

- **Dev agent (Amelia):** thực thi T1–T8 theo Section 5 và Section 6 làm spec.
- **PO:** duyệt cập nhật `epics.md` (Section 5.2) — đã nằm trong proposal này.
- **Lưu ý vận hành:** sau deploy, 4 action Facebook public không còn tiêu thụ account pool — dashboard "Accounts" view sẽ thấy velocity giảm; đây là hành vi đúng.

### Success Criteria

1. `node --test tests/core/base-crawler.test.js tests/core/crawler-governor.test.js tests/scrapers/social/facebook/client.test.js` pass với các case action-level mới.
2. Gọi `crawler.start({ action: 'marketplace', args: { query: 'iphone' } })` với `AccountPool` rỗng (kể cả standalone không có `accountPool`) → **thành công**, gửi GraphQL body với `__user: '0'` và nhận session proxy ngẫu nhiên mỗi request (Rotating Residential).
3. Gọi `crawler.start({ action: 'group_posts', ... })` với pool rỗng → throw `XACT_4010` như cũ.
4. Truyền `session: { accountId: 'fb:hibernating' }` vào action `marketplace` → bị chặn với mã `XACT_4291` (`hibernation`) thay vì bypass governor.
5. `listActions()` của Facebook và MCP `x_actions_list` trả về `requiresAuth: false` cho `marketplace`/`search`/`page_posts`/`profile`, `true` cho `group_posts`/`group_members`.
6. Twitter/Threads crawler: hành vi byte-for-byte không đổi (không descriptor khai báo).

---

## 7. Sprint Status Impact

Không thêm/xóa/renumber epic hay story nào — chỉ cập nhật AC của các story hiện có (10.1, 11.5, 13.3, 13.5–13.10, 14.2). `sprint-status.yaml` **không cần thay đổi**.

---

*Tài liệu được tạo bởi workflow Correct Course (bmad-correct-course) ngày 27/08/2026. Cập nhật Revision 1 sau Reviewer Gate (bmad-architecture) ngày 27/08/2026.*

**Trạng thái phê duyệt:** ✅ **APPROVED (Revision 1)** — Luisphan phê duyệt toàn bộ ngày 27/08/2026. Các chỉnh sửa đã được áp dụng trực tiếp vào `ARCHITECTURE-SPINE.md` (AD-3 rule 3b với partition token ring + opt-in governor + dual-pool, AD-11 rule 3, AD-8, AD-14, AD-5 rule 4, AD-9 rule 1, Decision Changelog) và `epics.md` (Stories 10.1, 11.5, 13.3, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 14.2).

**Handoff tiếp theo:** Dev tasks T1–T8 (Section 6) chuyển cho Developer agent thực thi **trước khi Story 13.9 vào sprint**.
